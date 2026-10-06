// 第 13 轮 0c（docs/round13-contract.md §4.2）：放映预加载的下一页只解析文档、加载资源，不跑 init；翻过去时入场才从头开始。
// 覆盖三处：page-frame 的 hold / start() / held；playback.js（测试宿主）；放映页 player.html；导出的放映版单文件（同一套 playback.js）。
// 只用临时数据目录；不碰真实数据目录和用户主目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/browser.js';
import { exportProject } from '../src/export/index.js';
import { writeProject, startServer, until, pause } from './round12-runtime-fixture.js';

const page1 = `<!doctype html><html><head><meta charset="utf-8"></head><body><h1>第一页</h1></body></html>`;
// init 里用 ctx.timer 写的入场：记下 init 开始的时间，等 300ms 后标记完成
const page2 = `<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="t" style="opacity:0">第二页</h1>
<script>vw.motion({ async init(ctx) {
  document.body.dataset.initAt = String(Date.now());
  await ctx.timer(300);
  document.getElementById('t').style.opacity = '1';
  document.body.dataset.doneAt = String(Date.now());
} });</script></body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({ id: 'rt-hold', prefix: '我的云端硬盘 预加载-', pages: [{ id: 'page_p1', html: page1 }, { id: 'page_p2', html: page2 }] });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

const dataset = frame => frame.evaluate(() => ({ initAt: document.body.dataset.initAt || null, doneAt: document.body.dataset.doneAt || null }));
async function frameOfElement(page, selector) {
  const handle = await until(() => page.$(selector), { label: selector });
  return until(() => handle.contentFrame(), { label: `${selector} 的文档` });
}
// 预加载的页（隐藏）等一会儿 init 也不跑；翻过去后从头跑（init 开始时间晚于翻页时刻，计时器的入场之后才完成）
async function checkHeldThenStart(page, hiddenSelector, shownSelector, advance) {
  const hidden = await frameOfElement(page, hiddenSelector);
  await until(() => hidden.evaluate(() => !!document.getElementById('t')), { label: '预加载的文档已解析' });
  await pause(800);
  assert.deepEqual(await dataset(hidden), { initAt: null, doneAt: null }, '预加载的下一页在翻过去之前没有跑 init');
  const t0 = Date.now();
  await advance();
  const shown = await frameOfElement(page, shownSelector);
  const done = await until(async () => { const d = await dataset(shown); return d.doneAt ? d : null; }, { label: '翻过去后入场跑完' });
  assert.ok(Number(done.initAt) >= t0 - 5, `init 在翻页之后才开始（${done.initAt} ≥ ${t0}）`);
  assert.ok(Number(done.doneAt) - Number(done.initAt) >= 250, '计时器入场按真实时长从头跑');
  return shown;
}

test('page-frame：hold 只报 loaded（held:true）、不跑 init；start() 后才跑并报 ready；start 只发一次', async t => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const loaded = await page.evaluate(async ({ project }) => {
    const { createPageFrame } = await import('/page-frame.js');
    window.__msgs = [];
    const f = createPageFrame({ project, page: project.pages[1], mode: 'play', hold: true, container: document.getElementById('stage'), onMessage: m => window.__msgs.push(m.vw) });
    window.__f = f;
    const msg = await f.loaded;
    return { held: f.held, msg: { vw: msg.vw, held: msg.held } };
  }, { project: fixture.project });
  assert.deepEqual(loaded, { held: true, msg: { vw: 'loaded', held: true } });
  const frame = await frameOfElement(page, '#stage iframe');
  await pause(600);
  assert.deepEqual(await dataset(frame), { initAt: null, doneAt: null });
  assert.deepEqual(await page.evaluate(() => window.__msgs), ['loaded'], '没有 ready');
  const t0 = Date.now();
  const ready = await page.evaluate(async () => { window.__f.start(); window.__f.start(); const r = await window.__f.ready; return { vw: r.vw, held: window.__f.held }; });
  assert.deepEqual(ready, { vw: 'ready', held: false });
  const d = await dataset(frame);
  assert.ok(Number(d.initAt) >= t0 - 5 && d.doneAt, JSON.stringify(d));
  await pause(300);
  assert.deepEqual(await page.evaluate(() => window.__msgs.filter(m => m === 'ready').length), 1, 'start 只发一次，init 只跑一次');
});

test('playback.js：预加载的下一页翻过去之前 init 没跑；翻过去后从头跑；往回翻（fast）照常', async t => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  await page.evaluate(async ({ project }) => {
    const { createPlayback } = await import('/playback.js');
    window.__pb = createPlayback({ project, container: document.getElementById('stage') });
    await window.__pb.ready;
  }, { project: fixture.project });
  await until(() => page.evaluate(() => document.querySelectorAll('#stage iframe').length === 2), { label: '预加载的第二页' });
  await checkHeldThenStart(page, '#stage iframe[aria-hidden]', '#stage iframe:not([aria-hidden])', () => page.evaluate(() => window.__pb.next()));
  assert.equal(await page.evaluate(() => window.__pb.getState().index), 1);
  // 往回翻：第一页用 fast 重建，照常显示
  await page.evaluate(() => window.__pb.prev());
  assert.equal(await page.evaluate(() => window.__pb.getState().index), 0);
});

test('放映页 player.html：同样是翻过去才开始入场', async t => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/player.html?project=rt-hold`);
  await until(() => page.evaluate(() => !!window.__vwPlayback && document.querySelectorAll('#stage iframe').length === 2), { label: '放映页就绪并预加载' });
  await checkHeldThenStart(page, '#stage iframe[aria-hidden]', '#stage iframe:not([aria-hidden])', () => page.evaluate(() => window.__vwPlayback.next()));
});

test('导出的放映版（单文件，同一套 playback.js）：预加载的页翻过去才跑 init', { timeout: 120000 }, async t => {
  const out = join(fixture.dataDir, 'exports', 'rt-hold');
  const file = (await exportProject({ projectDir: fixture.projectDir, kind: 'html', outDir: out })).files[0].path;
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => window.vwReady);
  await until(() => page.evaluate(() => document.querySelectorAll('#vw-layer iframe').length === 2), { label: '导出文件预加载第二页' });
  await checkHeldThenStart(page, '#vw-layer iframe[aria-hidden]', '#vw-layer iframe:not([aria-hidden])', () => page.keyboard.press('ArrowRight'));
});
