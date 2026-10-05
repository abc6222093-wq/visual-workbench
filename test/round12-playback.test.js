// 第 12 轮放映：play 模式（vw.motion、快进、anime 包装、leave）、放映页 player.html、动效检查、check-motion 命令行、导出渲染页。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until } from './round12-runtime-fixture.js';

const STEPS_PAGE = `<!doctype html><html><head><style>.item{position:absolute;left:100px;width:100px;height:50px;background:#c00}</style></head><body>
<div id="a" class="item" style="top:100px" data-vw-id="a" data-vw="move"></div>
<div id="b" class="item" style="top:200px"></div>
<script>
window.__log = [];
vw.motion({
  init(ctx) { __log.push('init:' + ctx.fast + ':' + ctx.step + ':x' + document.getElementById('a').getBoundingClientRect().left); for (const el of document.querySelectorAll('.item')) el.style.opacity = '0'; },
  async step(i, ctx) { __log.push('step' + i); const el = document.querySelectorAll('.item')[i]; await ctx.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }); await ctx.timer(200); el.style.opacity = '1'; },
  async leave(ctx, { direction }) { __log.push('leave' + direction); }
});
</script></body></html>`;
const ANIME_PAGE = `<!doctype html><html><head></head><body><div id="box" style="position:absolute;left:0;top:0;width:50px;height:50px;background:#09c"></div>
<script type="module">
vw.motion({
  async init(ctx) { window.__anime = await ctx.importModule('/vendor/anime.esm.min.js'); },
  async step(i, ctx) { await window.__anime.animate('#box', { translateX: 300, duration: 3500 }); window.__done = true; }
});
</script></body></html>`;
const STATIC_PAGE = '<!doctype html><html><head></head><body><h1 data-vw-id="t" data-vw="text">第三页</h1></body></html>';

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({
    pages: [
      { id: 'page_one', html: STEPS_PAGE, steps: 2, edits: [{ id: 'ed_move0001', target: 'a', kind: 'move', before: { x: 100, y: 100, width: 100, height: 50 }, after: { dx: 50, dy: 0 } }] },
      { id: 'page_two', html: ANIME_PAGE, steps: 1 },
      { id: 'page_three', html: STATIC_PAGE }
    ]
  });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

async function newPage(t, viewport = { width: 1200, height: 800 }) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  return context.newPage();
}
const visibleFrame = async page => (await page.$('#stage iframe:not([aria-hidden])')).contentFrame();

test('放映页：点击 / 方向键推进，最后一步后翻页；← 回上一页停在最后一步；右键也推进；预加载下一页', async t => {
  const page = await newPage(t);
  await page.goto(`${server.origin}/player.html?project=rt-test`);
  await until(() => page.evaluate(() => window.__vwPlayback?.getState().pageId === 'page_one' && document.getElementById('message').hidden), { label: '放映开始' });
  const state = () => page.evaluate(() => { const s = window.__vwPlayback.getState(); return { index: s.index, nextStep: s.nextStep, total: s.total }; });
  const idle = () => until(() => page.evaluate(() => !window.__vwPlayback.isBusy()), { label: '空闲' });
  assert.deepEqual(await state(), { index: 0, nextStep: 0, total: 2 });
  let frame = await visibleFrame(page);
  assert.deepEqual(await frame.evaluate(() => window.__log), ['init:false:-1:x150'], '修改单在 init 之前已叠上');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#stage iframe').length), 2, '预加载了下一页');
  await page.mouse.click(600, 400);
  await until(async () => (await state()).nextStep === 1, { label: '点击走一步' });
  await idle();
  await page.keyboard.press('ArrowRight');
  await until(async () => (await state()).nextStep === 2, { label: '方向键走一步' });
  await idle();
  await page.keyboard.press('ArrowRight');
  await until(async () => (await state()).index === 1, { label: '翻到第 2 页' });
  await idle();
  assert.deepEqual(await state(), { index: 1, nextStep: 0, total: 1 });
  await page.keyboard.press('ArrowLeft');
  await until(async () => (await state()).index === 0, { label: '回到第 1 页' });
  await idle();
  assert.deepEqual(await state(), { index: 0, nextStep: 2, total: 2 }, '回上一页停在最后一步');
  frame = await visibleFrame(page);
  const back = await frame.evaluate(() => ({ log: window.__log, a: getComputedStyle(document.getElementById('a')).opacity, b: getComputedStyle(document.getElementById('b')).opacity }));
  assert.deepEqual(back.log, ['init:true:-1:x150', 'step0', 'step1']);
  assert.deepEqual([back.a, back.b], ['1', '1']);
  await page.mouse.click(600, 400, { button: 'right' });
  await until(async () => (await state()).index === 1, { label: '右键推进' });
  await idle();
  // 放映的页面在 iframe 里按窗口缩放
  const scale = await page.evaluate(() => document.getElementById('stage').style.transform);
  assert.match(scale, /scale\(1\.25\)/);
});

test('play 模式：fast 启动把 anime.js 的长动画也快进完；ctx 字段齐全', async t => {
  const page = await newPage(t);
  await page.goto(`${server.origin}/harness.html`);
  const started = Date.now();
  const ready = await page.evaluate(async project => {
    const { createPageFrame } = await import('/page-frame.js');
    const f = createPageFrame({ project, page: project.pages[1], mode: 'play', container: document.getElementById('stage'), fast: true });
    window.__f = f;
    return f.ready;
  }, fixture.project);
  assert.ok(Date.now() - started < 3000, 'anime 的 3.5 秒动画被快进');
  assert.equal(ready.nextStep, 1);
  assert.equal(ready.steps, 1);
  const frame = page.frames().find(f => f !== page.mainFrame());
  assert.equal(await frame.evaluate(() => window.__done), true);
  assert.match(await frame.evaluate(() => getComputedStyle(document.getElementById('box')).transform), /matrix\(1, 0, 0, 1, 300, 0\)/);
  const left = await page.evaluate(() => window.__f.leave(-1));
  assert.equal(left.vw, 'left');
});

test('动效检查：好页面通过；steps>0 没登记 step、步骤抛错、init 抛错都报出来', async t => {
  const bad = writeProject({
    id: 'rt-bad',
    pages: [
      { id: 'page_nostep', html: '<!doctype html><html><head></head><body>没有动效</body></html>', steps: 1 },
      { id: 'page_throw', html: '<!doctype html><html><head></head><body><script>vw.motion({ step(i) { throw new Error("第" + i + "步坏了"); } });</script></body></html>', steps: 1 },
      { id: 'page_init', html: '<!doctype html><html><head></head><body><script>vw.motion({ init() { return Promise.reject(new Error("初始化坏了")); } });</script></body></html>' }
    ]
  });
  t.after(() => bad.cleanup());
  const badServer = await startServer(bad.dataDir);
  t.after(() => badServer.close());
  const page = await newPage(t);
  await page.goto(`${server.origin}/motion-check.html`);
  const good = await page.evaluate(async project => (await import('/motion-check.js')).checkMotion(project, { timeout: 5000 }), fixture.project);
  assert.equal(good.ok, true, JSON.stringify(good.results));
  assert.deepEqual(good.results.map(r => `${r.page}/${r.phase}`), ['page_one/放映', 'page_one/快进后退', 'page_one/中途快进', 'page_two/放映', 'page_two/快进后退', 'page_two/中途快进', 'page_three/放映', 'page_three/快进后退']);
  await page.goto(`${badServer.origin}/motion-check.html`);
  const result = await page.evaluate(async project => (await import('/motion-check.js')).checkMotion(project, { timeout: 3000 }), bad.project);
  assert.equal(result.ok, false);
  const byPage = id => result.results.filter(r => r.page === id && !r.ok).map(r => r.error).join('\n');
  assert.match(byPage('page_nostep'), /motion\.steps 是 1，但页面没有用 vw\.motion 登记 step/);
  assert.match(byPage('page_throw'), /第0步坏了/);
  assert.match(byPage('page_init'), /初始化坏了/);
});

const cli = fileURLToPath(new URL('../src/cli/check-motion.js', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
const runAsync = args => new Promise(resolve => {
  const child = spawn(process.execPath, [cli, ...args]);
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  child.on('close', status => resolve({ status, stdout, stderr }));
});

test('check-motion 命令行：参数与项目文件错误在启动浏览器前报出', () => {
  assert.match(run(['--unknown']).stderr, /未知参数/);
  assert.match(run(['--timeout-ms', '0']).stderr, /正整数/);
  assert.match(run(['--total-timeout-ms']).stderr, /正整数/);
  const dir = mkdtempSync(join(tmpdir(), 'vw-check-args-'));
  try {
    const absent = run([join(dir, 'missing')]);
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /无法读取项目/);
    writeFileSync(join(dir, 'project.json'), '{broken');
    assert.match(run([join(dir, 'project.json')]).stderr, /无法读取项目/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check-motion 命令行：v3 项目逐页检查通过；卡死的页面按总时限结束并继续检查后面的页', async () => {
  const ok = await runAsync([fixture.projectDir]);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /✓ page_one \[放映\]/);
  assert.match(ok.stdout, /动效检查通过/);
  const stuck = writeProject({
    id: 'rt-stuck',
    pages: [
      { id: 'page_stuck', html: '<!doctype html><html><head></head><body><script>vw.motion({ init() { while (true) {} } });</script></body></html>' },
      { id: 'page_fine', html: STATIC_PAGE }
    ]
  });
  try {
    const result = await runAsync([stuck.projectDir, '--timeout-ms', '500', '--total-timeout-ms', '4000']);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /page_stuck.*(总时限|超过)/);
    assert.match(result.stdout, /✓ page_fine \[放映\]/);
  } finally { stuck.cleanup(); }
});

test('导出渲染页：vwExportPage 快进到最后一步、返回尺寸；网页页面按整页高度', async t => {
  const web = writeProject({
    id: 'rt-web', kind: 'web', artboard: { preset: 'web-desktop', width: 1440, height: 900 },
    pages: [{ id: 'page_long', device: 'desktop', size: { width: 1440, height: 1600 }, html: '<!doctype html><html><head></head><body><div style="height:2100px;background:linear-gradient(#fff,#09c)">长页面</div></body></html>' }]
  });
  t.after(() => web.cleanup());
  const page = await newPage(t, { width: 960, height: 540 });
  await page.goto(`${server.origin}/export-render.html`);
  await page.waitForFunction(() => window.vwExportReady);
  const deck = await page.evaluate(project => window.vwExportPage(project, 'page_one', { assetBase: '/data/projects/rt-test', timeout: 3000 }), fixture.project);
  assert.deepEqual(deck, { ok: true, width: 960, height: 540 });
  const frame = page.frames().find(f => f !== page.mainFrame());
  assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('.item')].map(el => getComputedStyle(el).opacity)), ['1', '1']);
  const missing = await page.evaluate(project => window.vwExportPage(project, 'nope'), fixture.project);
  assert.equal(missing.ok, false);
  const webServer = await startServer(web.dataDir);
  t.after(() => webServer.close());
  await page.goto(`${webServer.origin}/export-render.html`);
  await page.waitForFunction(() => window.vwExportReady);
  const long = await page.evaluate(project => window.vwExportPage(project, 'page_long', { assetBase: '/data/projects/rt-web' }), web.project);
  assert.equal(long.ok, true, long.error);
  assert.equal(long.width, 1440);
  assert.equal(long.height, 2100);
});
