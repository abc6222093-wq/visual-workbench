// 放映版单文件导出：文件内容、瘦身、离线打开放映、内嵌自检、命令行
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { exportHtml } from '../src/export/html.js';
import { exportProject } from '../src/export/index.js';
import { launchBrowser } from '../src/browser.js';

const SAMPLE = fileURLToPath(new URL('../examples/sample-deck/', import.meta.url));
const CHECK_CLI = fileURLToPath(new URL('../src/cli/check-motion.js', import.meta.url));
const EXPORT_CLI = fileURLToPath(new URL('../src/cli/export.js', import.meta.url));
const sample = JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf8'));
const tmp = prefix => mkdtempSync(join(tmpdir(), prefix));
const embedded = html => JSON.parse(/<script type="application\/json" id="vw-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** 把示例项目复制到临时目录，再按需改 project.json */
function copySample(change) {
  const dir = tmp('vw-export-project-');
  cpSync(SAMPLE, dir, { recursive: true });
  const project = structuredClone(sample);
  change?.(project, dir);
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  return dir;
}

async function openBrowser(t) {
  try { return await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') { t.skip('本机没有可用浏览器'); return null; } throw error; }
}

/** 用 file:// 打开放映文件；除 file: / data: / blob: 以外的请求全部拦下并记下来 */
async function openExport(browser, file, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const blocked = [];
  const errors = [];
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
const idle = page => page.waitForFunction(() => !window.vwPlayer.busy, null, { timeout: 15000 });

test('导出示例项目：单个文件、无网络地址、含每页动效代码、体积远小于 15 MB', async () => {
  const out = tmp('vw-export-out-');
  try {
    const result = await exportProject({ projectDir: SAMPLE, kind: 'html', outDir: out });
    assert.equal(result.kind, 'html');
    assert.deepEqual(readdirSync(out), [`${sample.name}.html`]);
    assert.equal(result.files.length, 1);
    const file = result.files[0].path;
    assert.equal(result.files[0].bytes, statSync(file).size);
    assert.ok(result.files[0].bytes < 2 * 1024 * 1024, `放映文件 ${result.files[0].bytes} 字节，太大`);
    const html = readFileSync(file, 'utf8');
    // src / href / url() / import 里都不能出现网络地址
    assert.doesNotMatch(html, /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    assert.doesNotMatch(html, /url\(\s*["']?\s*(?:https?:)?\/\//i);
    assert.doesNotMatch(html, /\bimport\s*\(?\s*["'`]\s*https?:/i);
    assert.doesNotMatch(html, /\bfrom\s*["'`]\s*https?:/i);
    assert.doesNotMatch(html, /<link\b/i);
    const data = embedded(html);
    for (const page of sample.pages) {
      assert.equal(data.project.pages.find(p => p.id === page.id).motion.source, page.motion.source);
    }
    // 动效用到的库连同许可证一起打包
    assert.ok(data.modules['/vendor/anime.esm.min.js']);
    assert.match(html, /Julian Garnier/);
    // 页面用到的素材都在，待排版、没用到的素材不打包
    assert.ok(data.files['assets/photo-city.png'].startsWith('data:image/'));
    assert.ok(data.files['assets/logo.png'].startsWith('data:image/'));
    assert.equal(data.files['assets/new-photo.png'], undefined);
    assert.deepEqual(result.skipped, ['assets/new-photo.png']);
    // 组成里各部分加起来正好是文件大小
    const sum = Object.values(result.breakdown).reduce((a, b) => a + b, 0);
    assert.equal(sum, result.files[0].bytes);
    for (const key of ['images', 'fonts', 'runtime', 'libraries', 'project']) assert.ok(result.breakdown[key] > 0, key);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('字体子集化：导出的字体比原字体小，且仍包含用到的字', async () => {
  const out = tmp('vw-export-font-');
  try {
    const result = await exportHtml({ projectDir: SAMPLE, outFile: join(out, 'deck.html') });
    const font = result.items.find(item => item.kind === 'font');
    assert.equal(font.original, statSync(join(SAMPLE, 'fonts/Inter-Variable.ttf')).size);
    assert.ok(font.bytes < font.original / 4, `子集 ${font.bytes} 字节，原字体 ${font.original} 字节`);
    const url = embedded(readFileSync(result.file, 'utf8')).files['fonts/Inter-Variable.ttf'];
    assert.match(url, /^data:font\/woff2;base64,/);
    assert.equal(decode(url).length, font.bytes);
    assert.match(readFileSync(result.file, 'utf8'), /SIL OPEN FONT LICENSE/i);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('图片瘦身：缩到最大显示尺寸，不透明转 JPEG，透明保留 PNG，从不放大', async () => {
  const dir = copySample((project, root) => {
    project.assets.push(
      { id: 'asset_bigphoto', kind: 'image', file: 'assets/big.png', name: '大照片', width: 1600, height: 1200, pendingLayout: false, addedAt: '2026-10-01T12:00:00.000Z', source: { type: 'upload' } },
      { id: 'asset_alpha01', kind: 'image', file: 'assets/alpha.png', name: '透明图', width: 800, height: 800, pendingLayout: false, addedAt: '2026-10-01T12:00:00.000Z', source: { type: 'upload' } },
    );
    const base = { type: 'image', zIndex: 30, fit: 'cover' };
    project.pages[0].elements.push(
      { ...base, id: 'el_big_a', name: '小', x: 0, y: 0, width: 200, height: 150, asset: 'asset_bigphoto' },
      { ...base, id: 'el_big_b', name: '大', x: 0, y: 0, width: 400, height: 300, asset: 'asset_bigphoto' },
      { ...base, id: 'el_alpha', name: '透明', x: 0, y: 0, width: 100, height: 100, asset: 'asset_alpha01', fit: 'contain' },
    );
  });
  const out = tmp('vw-export-img-');
  try {
    // 随机噪点照片（不透明），以及中间透明的图
    const noise = Buffer.alloc(1600 * 1200 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    await sharp(noise, { raw: { width: 1600, height: 1200, channels: 3 } }).png().toFile(join(dir, 'assets/big.png'));
    await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } } }, top: 200, left: 200 }])
      .png().toFile(join(dir, 'assets/alpha.png'));
    const result = await exportHtml({ projectDir: dir, outFile: join(out, 'x.html') });
    const files = embedded(readFileSync(result.file, 'utf8')).files;
    const big = await sharp(decode(files['assets/big.png'])).metadata();
    assert.equal(big.format, 'jpeg');
    assert.deepEqual([big.width, big.height], [400, 300]);
    const alpha = await sharp(decode(files['assets/alpha.png'])).metadata();
    assert.equal(alpha.format, 'png');
    assert.ok(alpha.hasAlpha);
    assert.deepEqual([alpha.width, alpha.height], [100, 100]);
    // 示例照片 640×360 被铺满 1920×1080 显示：不放大
    const city = await sharp(decode(files['assets/photo-city.png'])).metadata();
    assert.deepEqual([city.width, city.height], [640, 360]);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('瘦身后仍超过体积上限：照样导出，并给出带组成的中文警告', async () => {
  const out = tmp('vw-export-limit-');
  try {
    const result = await exportHtml({ projectDir: SAMPLE, outFile: join(out, 'deck.html'), sizeLimit: 100 * 1024 });
    assert.ok(statSync(result.file).size > 100 * 1024);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /超过 100\.0 KB.*请停下来报告.*图片 .*字体 .*动效库/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('动效代码导入了工作台里没有的库：导出给出中文错误', async () => {
  const dir = copySample(project => {
    project.pages[0].motion = { steps: 0, source: "export default async ctx => { await ctx.importModule('/vendor/not-here.js'); return {}; }" };
  });
  try {
    await assert.rejects(exportHtml({ projectDir: dir, outFile: join(dir, 'out.html') }), /找不到/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('离线打开放映文件：按键推进全部页面、动效真的在跑、内嵌自检通过', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const out = tmp('vw-export-play-');
  try {
    const { file } = await exportHtml({ projectDir: SAMPLE, outFile: join(out, 'deck.html') });
    const { page, blocked, errors } = await openExport(browser, file);
    assert.equal(await page.textContent('#vw-counter'), `1 / ${sample.pages.length}`);
    // 第 1 页初始化时把要点藏起来，第一步再逐个显示
    const bulletOpacity = () => page.evaluate(() => getComputedStyle(document.querySelector('#vw-stage [data-element-id="el_bullet3"]')).opacity);
    await idle(page);
    assert.equal(await bulletOpacity(), '0');
    await page.keyboard.press('ArrowRight');
    await idle(page);
    assert.equal(await bulletOpacity(), '1');
    // 继续按到最后一页
    for (let i = 0; i < 20 && (await page.textContent('#vw-counter')) !== `${sample.pages.length} / ${sample.pages.length}`; i++) {
      await page.keyboard.press(i % 2 ? ' ' : 'ArrowRight');
      await idle(page);
    }
    assert.equal(await page.textContent('#vw-counter'), `${sample.pages.length} / ${sample.pages.length}`);
    assert.equal(await page.locator('#vw-stage [data-page-id]').count(), 1);
    // 第 3 页第一步改变照片的裁切形状
    const clip = () => page.evaluate(() => getComputedStyle(document.querySelector('#vw-stage [data-element-id="el_clipimg3"]')).clipPath);
    const before = await clip();
    await page.keyboard.press('ArrowRight');
    await idle(page);
    assert.notEqual(await clip(), before);
    // ← 回到上一页
    await page.keyboard.press('ArrowLeft');
    await idle(page);
    assert.equal(await page.textContent('#vw-counter'), `${sample.pages.length - 1} / ${sample.pages.length}`);
    // 字体和图片都从文件里加载
    assert.ok(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(font => font.status === 'loaded'); }));
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#vw-stage img')].every(img => img.complete && img.naturalWidth > 0)));
    const check = await page.evaluate(() => window.vwCheckMotion());
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.equal(check.results.length, sample.pages.length * 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally { await browser.close(); rmSync(out, { recursive: true, force: true }); }
});

test('手机尺寸：画板缩放到屏幕内，轻点推进，左滑翻页', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const out = tmp('vw-export-phone-');
  try {
    const { file } = await exportHtml({ projectDir: SAMPLE, outFile: join(out, 'deck.html') });
    const { page, errors } = await openExport(browser, file, { viewport: { width: 390, height: 844 }, hasTouch: true });
    const box = await page.locator('#vw-stage [data-page-id]').boundingBox();
    assert.ok(Math.abs(box.width - 390) < 1.5, `画板宽 ${box.width}`);
    assert.ok(box.y > 0 && box.y + box.height < 844, '画板垂直居中');
    await idle(page);
    await page.tap('#vw-stage');
    await idle(page);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#vw-stage [data-element-id="el_bullet1"]')).opacity), '1');
    // 向左滑：前进（第 1 页还剩一步，再滑一次翻页）
    const swipe = async () => {
      await page.dispatchEvent('#vw-stage', 'pointerdown', { clientX: 300, clientY: 400, button: 0, pointerType: 'touch' });
      await page.dispatchEvent('#vw-stage', 'pointerup', { clientX: 120, clientY: 410, button: 0, pointerType: 'touch' });
      await idle(page);
    };
    await swipe();
    await swipe();
    assert.equal(await page.textContent('#vw-counter'), `2 / ${sample.pages.length}`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); rmSync(out, { recursive: true, force: true }); }
});

test('内嵌自检能发现错误；check-motion 命令行检查放映文件', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  await browser.close();
  const dir = copySample(project => {
    project.pages[1].motion = { steps: 1, source: "export default async ctx => ({ async step() { ctx.element('el_title1'); } })" };
  });
  const out = tmp('vw-export-check-');
  try {
    const good = await exportHtml({ projectDir: SAMPLE, outFile: join(out, 'good.html') });
    const bad = await exportHtml({ projectDir: dir, outFile: join(out, 'bad.html') });
    const ok = spawnSync(process.execPath, [CHECK_CLI, good.file], { encoding: 'utf8', timeout: 180000 });
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    assert.match(ok.stdout, /✓ page_cover1 \[原项目\]/);
    assert.match(ok.stdout, /✓ page_clip3 \[移动与尺寸变体\]/);
    assert.match(ok.stdout, /动效检查通过：6 项/);
    const failed = spawnSync(process.execPath, [CHECK_CLI, bad.file], { encoding: 'utf8', timeout: 180000 });
    assert.equal(failed.status, 1, failed.stdout);
    assert.match(failed.stdout, /✗ page_scene2 \[原项目\]: .*el_title1/);
    assert.match(failed.stdout, /✓ page_cover1 \[原项目\]/);
    const notExport = join(out, 'plain.html');
    writeFileSync(notExport, '<!doctype html><p>hi</p>');
    const plain = spawnSync(process.execPath, [CHECK_CLI, notExport], { encoding: 'utf8', timeout: 30000 });
    assert.equal(plain.status, 1);
    assert.match(plain.stderr, /不是视觉工作台导出的放映版/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('export 命令行：默认放到数据目录的 exports/<项目编号>/，打印中文文件清单', () => {
  const dataDir = tmp('vw-export-data-');
  try {
    mkdirSync(join(dataDir, 'projects'), { recursive: true });
    const result = spawnSync(process.execPath, [EXPORT_CLI, SAMPLE, '--html', '--data-dir', dataDir], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(dataDir, 'exports', 'sample-deck')), [`${sample.name}.html`]);
    assert.match(result.stdout, /放映版/);
    assert.match(result.stdout, /组成：图片 .*字体 .*放映代码/);
    assert.match(result.stdout, /字体 fonts\/Inter-Variable\.ttf：856\.0 KB → /);
    const bad = spawnSync(process.execPath, [EXPORT_CLI, SAMPLE, '--wat', '--data-dir', dataDir], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /未知参数/);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
