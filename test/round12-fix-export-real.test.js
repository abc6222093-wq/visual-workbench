// 第 12 轮修正 · 导出的放映版在真实使用形态下仍有动效（任务 2）：
// (a) v2 项目「转换 → 导出放映版」；(b) 旧 HTML「导入 → 导出放映版」。都放在含中文和空格的数据目录里，
// 用 file:// 打开导出的文件（拦下 file / data / blob 以外的请求）。VW_BROWSER=webkit 时在 Safari 内核里跑同一套断言
// （scripts/test-webkit.js 的清单里有本文件；GitHub Actions 的 macOS 有 webkit job）。
// 另外覆盖：课件页上页面自己的点击能收到（不再被透明挡板挡住），点击页面照样推进；
// 数据目录含中文和空格时导出 HTML / 图片 / PDF。
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertV2Project } from '../src/convert-v2.js';
import { exportProject } from '../src/export/index.js';
import { browserCandidates, launchBrowser } from '../src/browser.js';
import { createServer } from './helpers/isolated-server.js';

const V2_DECK = fileURLToPath(new URL('./fixtures/v2-projects/v2-deck/', import.meta.url));
const LEGACY = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const ENGINE = process.env.VW_BROWSER === 'webkit' ? 'webkit' : 'chromium';

let dataDir, browser;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), '我的云端硬盘 测试-'));
  mkdirSync(join(dataDir, 'projects'), { recursive: true });
  try { browser = await launchBrowser(); } catch (error) { if (error.code !== 'NO_BROWSER') throw error; }
});
after(async () => {
  await browser?.close().catch(() => {});
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** 导入、导出图片要用 Chromium（用户的桌面应用是 Chromium 内核）；WebKit job 也装了 Chromium，只有放映文件在 WebKit 里打开 */
async function withChromium(fn) {
  const saved = process.env.VW_BROWSER;
  if (browserCandidates({ only: 'chromium' }).length || browserCandidates({ only: 'chrome' }).length) process.env.VW_BROWSER = browserCandidates({ only: 'chromium' }).length ? 'chromium' : 'chrome';
  try { return await fn(); } finally { if (saved === undefined) delete process.env.VW_BROWSER; else process.env.VW_BROWSER = saved; }
}

/** 用 file:// 打开放映文件；除 file: / data: / blob: 以外的请求全部拦下并记下来；收集页面错误和提示条 */
async function openExport(file, contextOptions = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const blocked = [], errors = [];
  await page.route('**/*', route => {
    const url = route.request().url();
    if (/^(file|data|blob|about):/.test(url)) return route.continue();
    blocked.push(url);
    return route.abort();
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => window.vwReady);
  // 运行时报回的错误会显示在提示条里：一起收集，方便在 Safari 内核里看出卡在哪一步
  await page.exposeFunction('__vwToast', text => errors.push(`toast: ${text}`));
  await page.evaluate(() => {
    const toast = document.getElementById('vw-toast');
    new MutationObserver(() => { if (!toast.hidden && toast.textContent) window.__vwToast(toast.textContent); }).observe(toast, { attributes: true, childList: true, characterData: true, subtree: true });
    if (!toast.hidden && toast.textContent) window.__vwToast(toast.textContent);
  });
  return { context, page, blocked, errors };
}
const frameOf = page => page.frameLocator('#vw-layer iframe:not([aria-hidden])');
const settle = page => page.waitForFunction(() => window.vwPlayer && !window.vwPlayer.busy, null, { timeout: 20000 });
const waitStep = (page, n) => page.waitForFunction(n => !window.vwPlayer.busy && window.vwPlayer.step >= n, n, { timeout: 20000 });
const waitPage = (page, n) => page.waitForFunction(n => !window.vwPlayer.busy && window.vwPlayer.page === n, n, { timeout: 20000 });
const computed = (frame, selector, prop) => frame.locator(selector).evaluate((el, prop) => getComputedStyle(el)[prop], prop);
/** 等动画跑完（不靠固定时长） */
const finished = (frame, selector) => frame.locator(selector).evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
/** 在当前页面 iframe 中央点一下（真鼠标点击，穿过放映壳） */
async function clickPage(page, offset = { x: 0.5, y: 0.5 }) {
  const box = await page.locator('#vw-layer iframe:not([aria-hidden])').boundingBox();
  await page.mouse.click(box.x + box.width * offset.x, box.y + box.height * offset.y);
}
const translate = matrix => { const m = /matrix\(([^)]+)\)/.exec(matrix); return m ? m[1].split(',').map(Number).slice(4) : [0, 0]; };

test(`v2 转换的项目导出放映版，在 ${ENGINE} 里用 file:// 打开：动效、点击推进、后退快进都在`, { timeout: 180000 }, async t => {
  if (!browser) return t.skip('本机没有可用浏览器');
  const projectDir = join(dataDir, 'projects', 'v2-deck');
  cpSync(V2_DECK, projectDir, { recursive: true });
  await convertV2Project({ projectDir });
  const out = join(dataDir, 'exports', 'v2-deck', '放映 版');
  const result = await exportProject({ projectDir, kind: 'html', outDir: out });
  const file = result.files[0].path;
  assert.ok(file.includes('我的云端硬盘 测试-') && file.includes('放映 版'), file);
  const { context, page, blocked, errors } = await openExport(file);
  try {
    await settle(page);
    const pages = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')).pages.map(p => p.id);
    const target = pages.indexOf('page_motion4') + 1;
    assert.ok(target > 1, pages.join());
    for (let n = 2; n <= target; n++) { await page.keyboard.press('ArrowRight'); await waitPage(page, n); }
    assert.equal(await page.textContent('#vw-counter'), `${target} / ${pages.length}`);
    const frame = frameOf(page);
    // init 跑过：标题先藏起来
    await frame.locator('[data-vw-id="el_mtitle"]').waitFor({ state: 'attached' });
    assert.equal(await computed(frame, '[data-vw-id="el_mtitle"]', 'opacity'), '0', `init 没有生效（动效没跑）：${errors.join(' | ')}`);
    assert.equal(await page.evaluate(() => window.vwPlayer.step), 0);
    // 第一步：用鼠标点页面推进（点击进到页面里，运行时回 nav）
    await clickPage(page);
    await waitStep(page, 1);
    await finished(frame, '[data-vw-id="el_mbox"]');
    assert.equal(await computed(frame, '[data-vw-id="el_mtitle"]', 'opacity'), '1', errors.join(' | '));
    const [dx] = translate(await computed(frame, '[data-vw-id="el_mbox"]', 'transform'));
    assert.ok(Math.abs(dx - 160) < 1, `方块应右移 160px，实际 ${dx}`);
    // 第二步：anime.js（库从文件里的 data: 模块来）
    await page.keyboard.press('ArrowRight');
    await waitStep(page, 2);
    await page.waitForTimeout(450);
    const [, dy] = translate(await computed(frame, '[data-vw-id="el_mdot"]', 'transform'));
    assert.ok(Math.abs(dy + 120) < 1, `圆点应上移 120px，实际 ${dy}；${errors.join(' | ')}`);
    assert.equal(await computed(frame, '[data-vw-id="el_mdot"]', 'backgroundColor'), 'rgb(250, 204, 21)');
    // 往回翻：上一页再回来；End 直接跳到最后一页并停在最后一步
    await page.keyboard.press('ArrowLeft');
    await waitPage(page, target - 1);
    await page.keyboard.press('End');
    await waitPage(page, target);
    assert.equal(await page.evaluate(() => window.vwPlayer.step), 2);
    const end = frameOf(page);
    assert.equal(await computed(end, '[data-vw-id="el_mtitle"]', 'opacity'), '1');
    assert.equal(await computed(end, '[data-vw-id="el_mdot"]', 'backgroundColor'), 'rgb(250, 204, 21)');
    assert.ok(Math.abs(translate(await computed(end, '[data-vw-id="el_mbox"]', 'transform'))[0] - 160) < 1);
    // 内嵌自检
    const check = await page.evaluate(() => window.vwCheckMotion());
    assert.equal(check.ok, true, JSON.stringify(check));
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally { await context.close(); }
});

test(`旧 HTML 导入的项目导出放映版，在 ${ENGINE} 里用 file:// 打开：显示、翻页、原 CSS 动画、页面自己的点击都在`, { timeout: 240000 }, async t => {
  if (!browser) return t.skip('本机没有可用浏览器');
  // 导入走工作台的真实接口（分析用 Chromium，和桌面应用一致）
  const projectDir = await withChromium(async () => {
    const server = createServer({ dataDir });
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const created = await (await fetch(`${base}/api/import-html/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '旧课件 导入', preset: 'slide-16x9', files: [{ path: 'deck.html', data: readFileSync(join(LEGACY, 'deck.html')).toString('base64') }] }) })).json();
      assert.ok(created.jobId, JSON.stringify(created));
      let job;
      for (let i = 0; i < 900; i++) {
        job = await (await fetch(`${base}/api/import-html/jobs/${created.jobId}`)).json();
        if (job.state !== 'running') break;
        await new Promise(r => setTimeout(r, 200));
      }
      assert.equal(job.state, 'done', job.error);
      return join(dataDir, 'projects', job.projectId);
    } finally { await new Promise(r => server.close(r)); }
  });
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  assert.equal(project.pages.length, 2);
  // 第 1 页加一段页面自己的点击处理（旧 HTML 常见的「点一下出现」）：第一下由页面自己处理（preventDefault，不翻页），之后的点击交给放映
  const first = join(projectDir, project.pages[0].file);
  writeFileSync(first, readFileSync(first, 'utf8').replace(/<\/body>/i, '<script>document.addEventListener("click",e=>{const n=Number(document.body.dataset.clicks||0)+1;document.body.dataset.clicks=String(n);if(n===1){e.preventDefault();document.querySelector("h1").textContent="点过了";}});</script></body>'));
  const out = join(dataDir, 'exports', project.id, '导出 html');
  const file = (await exportProject({ projectDir, kind: 'html', outDir: out })).files[0].path;
  const { context, page, blocked, errors } = await openExport(file);
  try {
    await settle(page);
    assert.equal(await page.textContent('#vw-counter'), '1 / 2');
    const frame = frameOf(page);
    assert.match(await frame.locator('body').innerText(), /课件第一页/);
    // 原页面的 CSS 动画还在（导入不搬旧动画，但原 HTML 自带的 CSS 动画照样播）
    const animated = await frame.locator('body').evaluate(() => ({
      count: document.getAnimations().length,
      names: [...document.querySelectorAll('h1, p')].map(el => getComputedStyle(el).animationName),
    }));
    assert.ok(animated.count > 0, `iframe 里没有动画：${JSON.stringify(animated)}`);
    assert.ok(animated.names.includes('rise'), JSON.stringify(animated));
    // 用鼠标点页面：第一下页面自己的点击处理收到了（不翻页），第二下放映推进到第 2 页
    await clickPage(page, { x: 0.3, y: 0.6 });
    await frame.locator('h1', { hasText: '点过了' }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.vwPlayer.page), 1);
    await clickPage(page, { x: 0.3, y: 0.6 });
    await waitPage(page, 2);
    assert.equal(await page.textContent('#vw-counter'), '2 / 2');
    assert.match(await frameOf(page).locator('body').innerText(), /课件第二页/);
    await page.keyboard.press('ArrowLeft');
    await waitPage(page, 1);
    assert.equal(await frameOf(page).locator('body').evaluate(() => document.body.dataset.clicks || '0'), '0', '后退重建的页面是新的');
    // 右键也推进
    await clickPage(page, { x: 0.3, y: 0.6 });
    await page.waitForTimeout(300);
    await page.locator('#vw-layer iframe:not([aria-hidden])').click({ button: 'right', position: { x: 50, y: 50 } });
    await waitPage(page, 2);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
  } finally { await context.close(); }
});

test('课件页：页面自己的点击处理能收到点击（挡板不再盖住页面），页面没处理时照样推进', { timeout: 180000 }, async t => {
  if (!browser) return t.skip('本机没有可用浏览器');
  const projectDir = join(dataDir, 'projects', 'click-deck');
  mkdirSync(join(projectDir, 'pages'), { recursive: true });
  for (const dir of ['assets', 'fonts', 'versions']) mkdirSync(join(projectDir, dir));
  const now = '2026-10-05T12:00:00.000Z';
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify({
    format: 'visual-workbench/project', formatVersion: 3, id: 'click-deck', name: '点击 课件', createdAt: now, updatedAt: now,
    artboard: { preset: 'custom', width: 640, height: 360 }, assets: [], fonts: [],
    pages: [{ id: 'page_click', name: '点击', file: 'pages/page_click.html', edits: [] }, { id: 'page_two', name: '二', file: 'pages/page_two.html', edits: [] }],
  }, null, 2));
  // 页面里的按钮：点它只改自己的文字（preventDefault，不翻页）；点别处翻页
  writeFileSync(join(projectDir, 'pages/page_click.html'), '<!doctype html><html><head><meta charset="utf-8"><style>body{background:#fff}#b{position:absolute;left:20px;top:20px;width:200px;height:80px}</style></head><body><div id="b">未点</div><script>document.getElementById("b").addEventListener("click",e=>{e.preventDefault();e.currentTarget.textContent="已点"});</script></body></html>');
  writeFileSync(join(projectDir, 'pages/page_two.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><p>第二页</p></body></html>');
  const file = (await exportProject({ projectDir, kind: 'html', outDir: join(dataDir, 'exports', 'click-deck') })).files[0].path;
  const { context, page, errors } = await openExport(file, { viewport: { width: 640, height: 360 } });
  try {
    await settle(page);
    // 引擎能力探针：放映版依赖的几样东西逐个试，结果写进测试输出（WebKit job 里据此判断 Safari 卡在哪一步）
    const probe = async (where, fn) => { try { return await where.evaluate(fn); } catch (error) { return `失败：${String(error.message || error).split('\n')[0]}`; } };
    // 按元素取 iframe 的帧（Chrome 154 起把 srcdoc 帧的 url 报成 about:blank，按 url 找会找不到）
    const iframe = await (await page.locator('#vw-layer iframe:not([aria-hidden])').elementHandle())?.contentFrame();
    const probes = {
      parentBlobModule: await probe(page, async () => { const url = URL.createObjectURL(new Blob(['export default 1'], { type: 'text/javascript' })); return (await import(url)).default === 1 ? 'ok' : 'bad'; }),
      parentDataModule: await probe(page, async () => ((await import('data:text/javascript;charset=utf-8,export%20default%201')).default === 1 ? 'ok' : 'bad')),
      frameOrigin: iframe ? await probe(iframe, () => String(window.origin)) : '没找到页面 iframe',
      frameDataModule: iframe ? await probe(iframe, async () => ((await import('data:text/javascript;charset=utf-8,export%20default%201')).default === 1 ? 'ok' : 'bad')) : '没找到页面 iframe',
      frameDataBase64Module: iframe ? await probe(iframe, async () => ((await import('data:text/javascript;base64,' + btoa('export default 1'))).default === 1 ? 'ok' : 'bad')) : '没找到页面 iframe',
      frameWebAnimations: iframe ? await probe(iframe, () => (typeof document.getAnimations === 'function' && typeof document.body.animate === 'function' ? 'ok' : 'bad')) : '没找到页面 iframe',
    };
    t.diagnostic(`${ENGINE} 能力探针：${JSON.stringify(probes)}`);
    for (const key of ['parentDataModule', 'frameDataModule', 'frameDataBase64Module', 'frameWebAnimations']) assert.equal(probes[key], 'ok', `${key}：${JSON.stringify(probes)}`);
    await page.mouse.click(120, 60);
    await frameOf(page).locator('#b', { hasText: '已点' }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.vwPlayer.page), 1, '页面处理过的点击不翻页');
    await page.mouse.click(500, 300);
    await waitPage(page, 2);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('数据目录含中文和空格：导出 HTML / 图片 / PDF 都成功，文件在导出文件夹里', { timeout: 240000 }, async t => {
  if (!browser) return t.skip('本机没有可用浏览器');
  const projectDir = join(dataDir, 'projects', 'v2-paths');
  cpSync(V2_DECK, projectDir, { recursive: true });
  const json = join(projectDir, 'project.json');
  writeFileSync(json, JSON.stringify({ ...JSON.parse(readFileSync(json, 'utf8')), id: 'v2-paths', name: '路径 测试' }, null, 2));
  await convertV2Project({ projectDir });
  const out = join(dataDir, 'exports', 'v2-paths', '全部 导出');
  const progress = [];
  const html = await exportProject({ projectDir, kind: 'html', outDir: out, onProgress: p => progress.push(p) });
  assert.ok(existsSync(html.files[0].path) && html.files[0].path.endsWith('路径 测试.html'));
  const images = await withChromium(() => exportProject({ projectDir, kind: 'images', outDir: join(out, '图片 们') }));
  const count = JSON.parse(readFileSync(json, 'utf8')).pages.length;
  assert.equal(images.files.length, count);
  for (const f of images.files) assert.ok(statSync(f.path).size > 100, f.path);
  assert.equal(readdirSync(join(out, '图片 们')).length, count);
  const pdf = await withChromium(() => exportProject({ projectDir, kind: 'pdf', outDir: out }));
  assert.ok(pdf.files[0].path.endsWith('路径 测试.pdf'));
  assert.equal(readFileSync(pdf.files[0].path).subarray(0, 5).toString(), '%PDF-');
  assert.ok(progress.length >= count, JSON.stringify(progress));
});
