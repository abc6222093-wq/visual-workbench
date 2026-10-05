// 第 12 轮修正：编辑画布的「第 N 屏」（快进跑 init 和前面的步骤后停住再编辑），以及编辑画布上的点击 / 按键永远不触发页面自己的脚本（动效）。
// 约定见第 12 轮修正共用说明「约定 1」。临时数据目录路径含中文和空格。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until } from './round12-runtime-fixture.js';

// init 把两个元素藏起来，step i 显示第 i 个；页面自己在 document 上数点击和按键
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:20px/1.3 sans-serif;background:#fff}
.item{position:absolute;left:100px;width:300px;height:60px;margin:0;font-size:32px;background:#e2e8f0}
</style></head><body>
<h2 id="s0" class="item" style="top:100px" data-vw-id="s0" data-vw="text move">第一条</h2>
<div id="s1" class="item" style="top:260px" data-vw-id="s1" data-vw="move resize"></div>
<script>
window.__count = { click: 0, keydown: 0, pointerdown: 0, winClick: 0 };
document.addEventListener('click', () => { __count.click++; });
document.addEventListener('keydown', () => { __count.keydown++; });
document.addEventListener('pointerdown', () => { __count.pointerdown++; }, true);
window.addEventListener('click', () => { __count.winClick++; }, true);
window.__log = [];
vw.motion({
  init(ctx) { __log.push('init:' + ctx.fast); for (const el of document.querySelectorAll('.item')) el.style.opacity = '0'; },
  async step(i, ctx) { __log.push('step' + i); const el = document.querySelectorAll('.item')[i]; await ctx.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' }); await ctx.timer(300); el.style.opacity = '1'; }
});
</script></body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({ id: 'rt-screens', prefix: '我的云端硬盘 测试-', pages: [{ id: 'page_one', html: PAGE, steps: 2 }] });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

async function open(t, { mode = 'edit', screen } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const ready = await page.evaluate(async ({ project, mode, screen }) => {
    const { createPageFrame } = await import('/page-frame.js');
    window.__msgs = [];
    const f = createPageFrame({ project, page: project.pages[0], mode, screen, container: document.getElementById('stage'), onMessage: m => window.__msgs.push(m) });
    window.__f = f;
    return f.ready;
  }, { project: fixture.project, mode, screen });
  const frame = await until(() => page.frames().find(f => f !== page.mainFrame()), { label: '页面 iframe' });
  await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, frame, ready };
}
const opacities = frame => frame.evaluate(() => [...document.querySelectorAll('.item')].map(el => getComputedStyle(el).opacity));
const msgs = (page, type) => page.evaluate(type => window.__msgs.filter(m => m.vw === type), type);
const box = (frame, id) => frame.evaluate(id => { const r = document.querySelector(`[data-vw-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, id);

for (const [screen, expected, log] of [[1, ['0', '0'], ['init:true']], [2, ['1', '0'], ['init:true', 'step0']], [3, ['1', '1'], ['init:true', 'step0', 'step1']]]) {
  test(`第 ${screen} 屏：快进到该屏后停住，元素的样子正好是这一屏；还能选中、拖动、改字`, async t => {
    const started = Date.now();
    const { page, frame, ready } = await open(t, { screen });
    assert.ok(Date.now() - started < 4000, '快进，不按真实时长等');
    assert.equal(ready.screen, screen);
    assert.equal(ready.steps, 2);
    assert.deepEqual(await opacities(frame), expected);
    assert.deepEqual(await frame.evaluate(() => window.__log), log);
    // 拖动 s1（色块）
    const s1 = await box(frame, 's1');
    await page.mouse.move(s1.x + 150, s1.y + 30);
    await page.mouse.down();
    await page.mouse.move(s1.x + 170, s1.y + 40, { steps: 4 });
    await page.mouse.move(s1.x + 190, s1.y + 50, { steps: 4 });
    await page.mouse.up();
    const move = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move' && e.target === 's1'), { label: '拖动修改' });
    assert.deepEqual(move.after, { dx: 40, dy: 20 });
    // 改字 s0
    const s0 = await box(frame, 's0');
    await page.mouse.click(s0.x + 60, s0.y + s0.height / 2);
    await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 's0'), { label: '进入改字' });
    await page.keyboard.type('X');
    await page.keyboard.press('Escape');
    const text = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'text' && e.target === 's0'), { label: '文字修改' });
    assert.match(text.after.text, /X/);
    // 页面自己的脚本收不到编辑画布上的点击和按键
    assert.deepEqual(await frame.evaluate(() => window.__count), { click: 0, keydown: 0, pointerdown: 0, winClick: 0 });
    // 不响应 step：页面停在这一屏
    await page.evaluate(() => window.__f.step());
    assert.deepEqual(await frame.evaluate(() => window.__log), log, '编辑画布不推进动效');
  });
}

test('screen(k)：往后原地快进（applied:true，不重载）；往前回 applied:false', async t => {
  const { page, frame } = await open(t, { screen: 2 });
  await frame.evaluate(() => { window.__mark = 'same'; });
  const forward = await page.evaluate(() => window.__f.screen(3));
  assert.deepEqual({ vw: forward.vw, screen: forward.screen, applied: forward.applied }, { vw: 'screen-done', screen: 3, applied: true });
  assert.deepEqual(await opacities(frame), ['1', '1']);
  assert.equal(await frame.evaluate(() => window.__mark), 'same', '同一个文档，没有重载');
  const back = await page.evaluate(() => window.__f.screen(1));
  assert.deepEqual({ screen: back.screen, applied: back.applied }, { screen: 1, applied: false });
  assert.deepEqual(await opacities(frame), ['1', '1'], '没法原地回退，画面不动');
  // 重新建（父页面负责）：reload({ screen: 1 })
  const ready = await page.evaluate(() => window.__f.reload({ screen: 1 }));
  assert.equal(ready.screen, 1);
  const again = await until(() => page.frames().find(f => f !== page.mainFrame()));
  assert.deepEqual(await opacities(again), ['0', '0']);
});

test('不给 screen：编辑画布全部显示（不跑 init）；之后 screen(2) 原地跑 init 和第 1 步', async t => {
  const { page, frame, ready } = await open(t);
  assert.equal(ready.screen, null);
  assert.deepEqual(await opacities(frame), ['1', '1']);
  assert.deepEqual(await frame.evaluate(() => window.__log), []);
  const done = await page.evaluate(() => window.__f.screen(2));
  assert.equal(done.applied, true);
  assert.deepEqual(await opacities(frame), ['1', '0']);
});

test('play 模式：页面自己的点击 / 按键照常收到', async t => {
  const { page, frame } = await open(t, { mode: 'play' });
  await page.mouse.click(700, 500);
  await page.keyboard.press('a');
  await until(() => frame.evaluate(() => window.__count.click === 1 && window.__count.keydown === 1 && window.__count.pointerdown === 1), { label: '页面收到点击和按键' });
});
