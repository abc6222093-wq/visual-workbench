// 第 12 轮放映版单文件：页面 HTML 内嵌、资源换成 data:、模块与 /vendor/ 库打包、运行时与修改单、
// 离线打开、按键推进、后退快进、内嵌自检、check-motion 命令行、手机尺寸、网页项目、体积警告、export 命令行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { exportHtml } from '../src/export/html.js';
import { exportProject } from '../src/export/index.js';
import { launchBrowser } from '../src/browser.js';
import { makeDeck, makeWeb, cleanup, tmp, DECK_COVER } from './round12-export-fixture.test.js';

const CHECK_CLI = fileURLToPath(new URL('../src/cli/check-motion.js', import.meta.url));
const EXPORT_CLI = fileURLToPath(new URL('../src/cli/export.js', import.meta.url));
const AT = '2026-10-05T12:00:00.000Z';
const embedded = html => JSON.parse(/<script type="application\/json" id="vw-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const EDITS = [
  { id: 'ed_bg0001', target: 'card', kind: 'background', at: AT, before: { background: '#3366ff' }, after: { background: '#ff8800' } },
  { id: 'ed_text01', target: 'title', kind: 'text', at: AT, before: { html: '你好<b>世界</b>', text: '你好世界' }, after: { html: '你好<b>世界</b>！', text: '你好世界！' } },
  { id: 'ed_add001', target: 'u_abcd1234', kind: 'addImage', at: AT, before: null, after: { asset: 'asset_paste', x: 500, y: 300, width: 60, height: 40 } },
];

async function openBrowser(t) {
  try { return await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') { t.skip('本机没有可用浏览器'); return null; } throw error; }
}

/** 用 file:// 打开放映文件；除 file: / data: / blob: 以外的请求全部拦下并记下来 */
async function openExport(browser, file, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const blocked = [], errors = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^(file|data|blob):/.test(url)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => window.vwReady);
  return { context, page, blocked, errors };
}
const current = page => page.frameLocator('#vw-layer iframe:not([aria-hidden])');
const settle = page => page.waitForFunction(() => !window.vwPlayer.busy, null, { timeout: 15000 });
const waitStep = (page, n) => page.waitForFunction(n => !window.vwPlayer.busy && window.vwPlayer.step >= n, n, { timeout: 15000 });
const waitPage = (page, n) => page.waitForFunction(n => !window.vwPlayer.busy && window.vwPlayer.page === n, n, { timeout: 15000 });

test('导出课件：单个文件、无网络地址、页面与修改单内嵌、资源换成文件内地址、库带许可证、组成加起来等于文件大小', async () => {
  const { dir } = await makeDeck({ edits: EDITS });
  const out = tmp('vw-r12-html-out-');
  try {
    const result = await exportProject({ projectDir: dir, kind: 'html', outDir: out });
    assert.deepEqual(readdirSync(out), ['第十二轮课件.html']);
    const file = result.files[0].path;
    assert.equal(result.files[0].bytes, statSync(file).size);
    const html = readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:)?\/\//i);
    assert.doesNotMatch(html, /\bimport\s*\(?\s*["'`]\s*https?:/i);
    assert.doesNotMatch(html, /<link\b/i);
    assert.match(html, /Content-Security-Policy/);
    const data = embedded(html);
    assert.deepEqual(data.project.pages[0].edits, EDITS);
    assert.equal(typeof data.runtimeText, 'string');
    assert.match(data.runtimeText, /__boot/);
    for (const path of ['/player.js', '/page-frame.js', '/playback.js', '/motion-check.js']) assert.ok(data.modules[path], path);
    // 页面文本：相对引用都换成了占位符或 data: 模块，样式表内联，<link> 没了
    const cover = data.pages.page_cover;
    assert.doesNotMatch(cover, /\.\.\/assets\//);
    assert.match(cover, /__VWFILE\[assets\/halves\.png\]__/);
    assert.match(cover, /from 'data:text\/javascript;base64,/);
    assert.match(cover, /\.unused-rule \{ background: url\("__VWFILE\[assets\/dot\.png\]__"\)/);
    assert.match(data.pages.page_second, /importModule\('data:text\/javascript;base64,/);
    assert.match(data.pages.page_second, /__VWFILE\[fonts\/Inter\.ttf\]__/);
    // data: 模块里的相对导入也展开了
    const lib = /from '(data:text\/javascript;base64,[^']+)'/.exec(cover)[1];
    assert.match(decode(lib).toString(), /from 'data:text\/javascript;base64,/);
    assert.ok(data.files['assets/halves.png'].startsWith('data:image/'));
    assert.ok(data.files['assets/paste.png'].startsWith('data:image/'), '贴进来的图也打包');
    assert.match(data.files['fonts/Inter.ttf'], /^data:font\/woff2;base64,/);
    assert.deepEqual(result.skipped, ['assets/unused.png']);
    assert.match(html, /Julian Garnier/, 'anime.js 的许可证');
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(sum, result.files[0].bytes);
    for (const key of ['images', 'fonts', 'runtime', 'libraries', 'pages', 'project']) assert.ok(result.breakdown[key] > 0, key);
    const font = result.items.find(item => item.kind === 'font');
    assert.ok(font.bytes < font.original / 4, '字体子集化');
  } finally { cleanup(dir, out); }
});

test('图片瘦身：宽于 2 × 页面宽的按比例缩小，不透明转 JPEG，透明保留 PNG，小图不放大', async () => {
  const { dir } = await makeDeck({
    cover: DECK_COVER.replace('</body>', '<img src="../assets/big.png" alt=""><img src="../assets/alpha.png" alt=""></body>'),
    change(project) {
      project.assets.push(
        { id: 'asset_big', kind: 'image', file: 'assets/big.png', name: 'big', width: 3000, height: 1000, addedAt: AT },
        { id: 'asset_alpha', kind: 'image', file: 'assets/alpha.png', name: 'alpha', width: 2000, height: 2000, addedAt: AT },
      );
    },
  });
  const out = tmp('vw-r12-html-img-');
  try {
    const noise = Buffer.alloc(3000 * 1000 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    await sharp(noise, { raw: { width: 3000, height: 1000, channels: 3 } }).png().toFile(join(dir, 'assets/big.png'));
    await sharp({ create: { width: 2000, height: 2000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } } }, top: 200, left: 200 }])
      .png().toFile(join(dir, 'assets/alpha.png'));
    const result = await exportHtml({ projectDir: dir, outFile: join(out, 'x.html') });
    const files = embedded(readFileSync(result.file, 'utf8')).files;
    const big = await sharp(decode(files['assets/big.png'])).metadata();
    assert.equal(big.format, 'jpeg');
    assert.deepEqual([big.width, big.height], [1280, 427]);
    const alpha = await sharp(decode(files['assets/alpha.png'])).metadata();
    assert.equal(alpha.format, 'png');
    assert.ok(alpha.hasAlpha);
    assert.deepEqual([alpha.width, alpha.height], [1280, 1280]);
    const halves = await sharp(decode(files['assets/halves.png'])).metadata();
    assert.deepEqual([halves.width, halves.height], [400, 300]);
  } finally { cleanup(dir, out); }
});

test('瘦身后仍超过体积上限：照样导出，并给出带组成的中文警告', async () => {
  const { dir } = await makeDeck();
  const out = tmp('vw-r12-html-limit-');
  try {
    const result = await exportHtml({ projectDir: dir, outFile: join(out, 'deck.html'), sizeLimit: 100 * 1024 });
    assert.ok(statSync(result.file).size > 100 * 1024);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /超过 100\.0 KB.*请停下来报告.*图片 .*字体 .*库与脚本 .*页面 /);
  } finally { cleanup(dir, out); }
});

test('页面导入了工作台里没有的库：导出给出中文错误', async () => {
  const { dir } = await makeDeck({ second: '<!doctype html><body><script type="module">import "/vendor/not-here.js";</script></body>' });
  try {
    await assert.rejects(exportHtml({ projectDir: dir, outFile: join(dir, 'out.html') }), /找不到/);
  } finally { cleanup(dir); }
});

test('离线打开放映文件：修改单叠上、按键推进、动效真的在跑、后退停在最后一步、内嵌自检通过', { timeout: 120000 }, async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const { dir } = await makeDeck({ edits: EDITS });
  const out = tmp('vw-r12-html-play-');
  try {
    const { file } = await exportHtml({ projectDir: dir, outFile: join(out, 'deck.html') });
    const { page, blocked, errors } = await openExport(browser, file);
    await settle(page);
    assert.equal(await page.textContent('#vw-counter'), '1 / 2');
    const frame = current(page);
    // 修改单：底色、文字、贴图
    assert.equal(await frame.locator('#card').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 136, 0)');
    assert.equal(await frame.locator('#title').textContent(), '你好世界！');
    assert.equal(await frame.locator('[data-vw-id="u_abcd1234"]').evaluate(img => img.complete && img.naturalWidth), 60);
    // 动效：init 藏起 b1 / b2，按 → 逐个出现（模块从 data: 导入）
    const opacity = selector => frame.locator(selector).evaluate(el => getComputedStyle(el).opacity);
    assert.equal(await opacity('.b1'), '0');
    await page.keyboard.press('ArrowRight');
    await waitStep(page, 1);
    assert.equal(await opacity('.b1'), '1');
    assert.equal(await opacity('.b2'), '0');
    await page.keyboard.press(' ');
    await waitStep(page, 2);
    await page.keyboard.press('ArrowRight');
    await waitPage(page, 2);
    assert.equal(await page.textContent('#vw-counter'), '2 / 2');
    // 第 2 页：字体、背景图都从文件里来
    assert.ok(await current(page).locator('#t2').evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => font.status === 'loaded'); }));
    // ← 回到第 1 页：直接停在最后一步
    await page.keyboard.press('ArrowLeft');
    await waitPage(page, 1);
    assert.equal(await page.evaluate(() => window.vwPlayer.step), 2);
    assert.equal(await current(page).locator('.b2').evaluate(el => getComputedStyle(el).opacity), '1');
    const check = await page.evaluate(() => window.vwCheckMotion());
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(check.results.map(row => `${row.page} ${row.phase}`), ['page_cover 放映', 'page_cover 快进后退', 'page_cover 中途快进', 'page_second 放映', 'page_second 快进后退']);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally { await browser.close(); cleanup(dir, out); }
});

test('手机尺寸：画板缩放到屏幕内，轻点推进，左滑翻页', { timeout: 120000 }, async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const { dir } = await makeDeck();
  const out = tmp('vw-r12-html-phone-');
  try {
    const { file } = await exportHtml({ projectDir: dir, outFile: join(out, 'deck.html') });
    const { page, errors } = await openExport(browser, file, { viewport: { width: 390, height: 844 }, hasTouch: true });
    await settle(page);
    const box = await page.locator('#vw-layer iframe:not([aria-hidden])').boundingBox();
    assert.ok(Math.abs(box.width - 390) < 1.5, `画板宽 ${box.width}`);
    assert.ok(box.y > 0 && box.y + box.height < 844, '画板垂直居中');
    await page.tap('#vw-shield');
    await waitStep(page, 1);
    const swipe = async () => {
      await page.dispatchEvent('#vw-shield', 'pointerdown', { clientX: 300, clientY: 400, button: 0, pointerType: 'touch' });
      await page.dispatchEvent('#vw-shield', 'pointerup', { clientX: 120, clientY: 410, button: 0, pointerType: 'touch' });
    };
    await swipe();
    await waitStep(page, 2);
    await swipe();
    await waitPage(page, 2);
    assert.equal(await page.textContent('#vw-counter'), '2 / 2');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); cleanup(dir, out); }
});

test('网页项目放映版：设备窗口缩放到屏幕内，页面在 iframe 里滚动，修改单叠上', { timeout: 120000 }, async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const { dir } = await makeWeb({ edits: [{ id: 'ed_wbg001', target: 's2', kind: 'background', at: AT, before: { background: '#ccddff' }, after: { background: '#112233' } }] });
  const out = tmp('vw-r12-html-web-');
  try {
    const { file } = await exportHtml({ projectDir: dir, outFile: join(out, 'web.html') });
    const { page, errors, blocked } = await openExport(browser, file, { viewport: { width: 800, height: 844 } });
    await settle(page);
    const box = await page.locator('#vw-layer iframe:not([aria-hidden])').boundingBox();
    assert.ok(Math.abs(box.width - 390) < 1.5 && Math.abs(box.height - 844) < 1.5, `窗口 ${box.width}×${box.height}`);
    assert.equal(await page.locator('#vw-shield').isHidden(), true);
    const frame = current(page);
    assert.equal(await frame.locator('#s2').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(17, 34, 51)');
    assert.equal(await frame.locator('body').evaluate(() => document.documentElement.scrollHeight), 1200);
    await frame.locator('body').evaluate(() => window.scrollTo(0, 300));
    assert.equal(await frame.locator('body').evaluate(() => window.scrollY), 300);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally { await browser.close(); cleanup(dir, out); }
});

test('内嵌自检能发现错误；check-motion 命令行检查放映文件', { timeout: 240000 }, async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  await browser.close();
  const good = await makeDeck();
  const bad = await makeDeck({ cover: DECK_COVER.replace("const el = ctx.root.querySelector('.b' + (index + 1));", "throw new Error('第二步坏了 ' + index);") });
  const out = tmp('vw-r12-html-check-');
  try {
    const goodFile = (await exportHtml({ projectDir: good.dir, outFile: join(out, 'good.html') })).file;
    const badFile = (await exportHtml({ projectDir: bad.dir, outFile: join(out, 'bad.html') })).file;
    const ok = spawnSync(process.execPath, [CHECK_CLI, goodFile], { encoding: 'utf8', timeout: 180000 });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /✓ page_cover \[放映\]/);
    assert.match(ok.stdout, /✓ page_second \[快进后退\]/);
    assert.match(ok.stdout, /动效检查通过：5 项/);
    const failed = spawnSync(process.execPath, [CHECK_CLI, badFile], { encoding: 'utf8', timeout: 180000 });
    assert.equal(failed.status, 1, failed.stdout);
    assert.match(failed.stdout, /✗ page_cover \[放映\]: .*第二步坏了/);
    assert.match(failed.stdout, /✓ page_second \[放映\]/);
    const plain = join(out, 'plain.html');
    writeFileSync(plain, '<!doctype html><p>hi</p>');
    const notExport = spawnSync(process.execPath, [CHECK_CLI, plain], { encoding: 'utf8', timeout: 30000 });
    assert.equal(notExport.status, 1);
    assert.match(notExport.stderr, /不是视觉工作台导出的放映版/);
  } finally { cleanup(good.dir, bad.dir, out); }
});

test('export 命令行：默认放到数据目录的 exports/<项目编号>/，打印中文文件清单', async () => {
  const { dir } = await makeDeck();
  const dataDir = tmp('vw-r12-html-data-');
  try {
    mkdirSync(join(dataDir, 'projects'), { recursive: true });
    const result = spawnSync(process.execPath, [EXPORT_CLI, dir, '--html', '--data-dir', dataDir], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(dataDir, 'exports', 'r12-deck')), ['第十二轮课件.html']);
    assert.match(result.stdout, /放映版/);
    assert.match(result.stdout, /组成：图片 .*字体 .*放映代码/);
    assert.match(result.stdout, /字体 fonts\/Inter\.ttf：856\.0 KB → /);
    const bad = spawnSync(process.execPath, [EXPORT_CLI, dir, '--wat', '--data-dir', dataDir], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /未知参数/);
  } finally { cleanup(dir, dataDir); }
});
