// 第 16 轮：页面运行时编辑交互的基本路径（运行时夹具，不经过工作台界面）：
// 点选与 8 个把手、悬停框、整页背景层当空白、Shift / Cmd 加选减选、页内框选（完全框住才选）、Cmd+A、多选一起拖（一条 edit-batch）、
// 方向键 1 / 10px、拖角等比（文字字号一起变）、改字时 Backspace 只删字、多选对齐 6 种、拖动中父页面转来松开（框不留在页面上）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, makePng, until, pause } from './round12-runtime-fixture.js';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#fafafa;font:20px/1.3 sans-serif}
#bg{position:absolute;left:0;top:0;width:960px;height:540px;background:#eef2ff}
h1{position:absolute;left:100px;top:60px;margin:0;font-size:40px;line-height:50px;color:#112233;width:400px}
#pic{position:absolute;left:100px;top:300px;width:200px;height:100px}
.card{position:absolute;left:500px;top:300px;width:200px;height:120px;background:#f1f5f9}
.badge{position:absolute;left:760px;top:120px;width:80px;height:80px;background:#334455}
</style></head><body>
<div id="bg" data-vw-id="bg" data-vw="background"></div>
<h1 data-vw-id="title" data-vw="text move resize color">Hello again</h1>
<img id="pic" data-vw-id="pic" data-vw="move resize crop" src="../assets/a.png">
<div class="card" data-vw-id="card" data-vw="move resize background"></div>
<div class="badge" data-vw-id="badge" data-vw="move resize background"></div>
</body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({
    id: 'rt-r16', prefix: 'vw-r16-runtime-',
    pages: [{ id: 'page_one', html: PAGE }],
    assets: [{ id: 'asset_a', kind: 'image', file: 'assets/a.png', width: 400, height: 200 }],
    files: { 'assets/a.png': makePng(400, 200) }
  });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  await page.evaluate(async ({ project }) => {
    const { createPageFrame } = await import('/page-frame.js');
    window.__msgs = [];
    const f = createPageFrame({ project, page: project.pages[0], mode: 'edit', container: document.getElementById('stage'), onMessage: m => window.__msgs.push(JSON.parse(JSON.stringify(m))) });
    window.__f = f;
    await f.ready;
  }, { project: structuredClone(fixture.project) });
  const frame = await until(() => page.frames().find(f => f !== page.mainFrame()), { label: '页面 iframe' });
  await frame.waitForFunction(() => document.getElementById('pic').complete);
  await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, frame };
}
const msgs = (page, type) => page.evaluate(type => window.__msgs.filter(m => m.vw === type), type);
const edits = page => page.evaluate(() => window.__msgs.filter(m => m.vw === 'edit' || m.vw === 'edit-batch'));
const lastSel = async page => (await msgs(page, 'select')).at(-1);
const selIs = (page, ids, label) => until(async () => { const s = await lastSel(page); return s && JSON.stringify([...(s.ids || [])].sort()) === JSON.stringify([...ids].sort()); }, { label });
const box = (frame, id) => frame.evaluate(id => { const r = document.querySelector(`[data-vw-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, id);
const ui = frame => frame.evaluate(() => {
  const root = document.querySelector('vw-ui').shadowRoot;
  const sel = root.querySelector('.sel');
  return {
    hover: root.querySelector('.hover').hidden, sel: sel.hidden, marquee: root.querySelector('.marquee').hidden,
    handles: [...sel.querySelectorAll('.h')].filter(h => getComputedStyle(h).display !== 'none').map(h => h.dataset.h).sort()
  };
});
async function drag(page, from, to, steps = 5) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up();
}

test('点选：悬停框、选中后 8 个把手；点整页背景层 = 点空白（取消选中）', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card');
  await page.mouse.move(card.x + 50, card.y + 50);
  await until(async () => !(await ui(frame)).hover, { label: '悬停框' });
  await page.mouse.click(card.x + 50, card.y + 50);
  await selIs(page, ['card'], '选中卡片');
  const state = await until(async () => { const s = await ui(frame); return !s.sel && s.handles.length === 8 ? s : null; }, { label: '8 个把手' });
  assert.deepEqual(state.handles, ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  assert.equal(state.hover, true, '选中的元素不再显示悬停框');
  // 整页背景层（只有 background 能力、铺满页面）：点它 = 点空白
  await page.mouse.click(400, 220);
  await until(async () => (await lastSel(page)).id === null, { label: '取消选中' });
  assert.equal((await msgs(page, 'select')).some(m => m.id === 'bg'), false, '背景层不会被选中');
});

test('Shift / Cmd 点：加选、减选', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card'), pic = await box(frame, 'pic'), badge = await box(frame, 'badge');
  await page.mouse.click(card.x + 50, card.y + 50);
  await selIs(page, ['card'], '选中卡片');
  await page.keyboard.down('Shift'); await page.mouse.click(pic.x + 50, pic.y + 50); await page.keyboard.up('Shift');
  await selIs(page, ['card', 'pic'], 'Shift 加选');
  await page.keyboard.down('Meta'); await page.mouse.click(badge.x + 20, badge.y + 20); await page.keyboard.up('Meta');
  await selIs(page, ['card', 'pic', 'badge'], 'Cmd 加选');
  await page.keyboard.down('Meta'); await page.mouse.click(card.x + 50, card.y + 50); await page.keyboard.up('Meta');
  await selIs(page, ['pic', 'badge'], 'Cmd 减选');
  // 多选：整体框只有 4 个角把手
  assert.deepEqual((await ui(frame)).handles, ['ne', 'nw', 'se', 'sw']);
});

test('页内空白（背景层上）拖出框选：完全框住的才选中；松开后框消失', async t => {
  const { page, frame } = await open(t);
  // 从 (80,280) 拖到 (320,420)：框住图片（100..300 × 300..400），标题、卡片只碰到或不在里面
  await page.mouse.move(80, 280); await page.mouse.down();
  await page.mouse.move(200, 350, { steps: 4 });
  await until(async () => !(await ui(frame)).marquee, { label: '框选框' });
  await page.mouse.move(320, 420, { steps: 4 });
  await page.mouse.up();
  await selIs(page, ['pic'], '框住图片');
  assert.equal((await ui(frame)).marquee, true, '松开后框消失');
  // 只框住一半的不选
  await drag(page, { x: 450, y: 280 }, { x: 650, y: 440 });
  await until(async () => (await lastSel(page)).id === null, { label: '只框住一半的卡片不选' });
});

test('Cmd+A 全选（不含整页背景层）；多选一起拖 = 一条 edit-batch', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card');
  await page.mouse.click(card.x + 50, card.y + 50);
  await selIs(page, ['card'], '选中卡片');
  await page.keyboard.press('Meta+a');
  await selIs(page, ['title', 'pic', 'card', 'badge'], '全选');
  const before = (await edits(page)).length;
  await drag(page, { x: card.x + 50, y: card.y + 50 }, { x: card.x + 80, y: card.y + 60 });
  const batch = await until(async () => (await msgs(page, 'edit-batch')).at(-1), { label: '一起拖的 edit-batch' });
  assert.equal((await edits(page)).length, before + 1, '只发一条');
  assert.deepEqual(batch.edits.map(e => e.target).sort(), ['badge', 'card', 'pic', 'title']);
  for (const e of batch.edits) { assert.equal(e.kind, 'move'); assert.deepEqual(e.after, { dx: 30, dy: 10 }); }
  assert.deepEqual(await box(frame, 'badge'), { x: 790, y: 130, width: 80, height: 80 });
});

test('方向键：1px，Shift 10px', async t => {
  const { page, frame } = await open(t);
  const badge = await box(frame, 'badge');
  await page.mouse.click(badge.x + 20, badge.y + 20);
  await selIs(page, ['badge'], '选中');
  await page.keyboard.press('ArrowRight');
  await until(async () => (await msgs(page, 'edit')).at(-1)?.after?.dx === 1, { label: '右移 1px' });
  await page.keyboard.press('Shift+ArrowDown');
  const e = await until(async () => { const x = (await msgs(page, 'edit')).at(-1); return x?.after?.dy === 10 ? x : null; }, { label: '下移 10px' });
  assert.deepEqual(e.after, { dx: 1, dy: 10 });
  assert.deepEqual(await box(frame, 'badge'), { x: 761, y: 130, width: 80, height: 80 });
});

test('文字拖角：等比缩放，字号一起变（一条 edit-batch：resize + fontSize）', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  await page.mouse.click(title.x + 30, title.y + 20);
  await selIs(page, ['title'], '选中标题');
  await until(async () => (await ui(frame)).handles.length === 8, { label: '文字的 8 个把手' });
  await drag(page, { x: title.x + title.width, y: title.y + title.height }, { x: title.x + title.width + 80, y: title.y + title.height + 2 });
  const batch = await until(async () => (await msgs(page, 'edit-batch')).at(-1), { label: '缩放的 edit-batch' });
  const by = k => batch.edits.find(e => e.kind === k);
  assert.ok(by('resize') && by('fontSize'), JSON.stringify(batch.edits));
  assert.equal(by('resize').after.width, 480);
  assert.deepEqual(by('fontSize').before, { fontSize: 40 });
  assert.deepEqual(by('fontSize').after, { fontSize: 48 });
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize), '48px');
  assert.equal((await msgs(page, 'editing')).length, 0, '没有进入改字');
});

test('改字时 Backspace 只删字，不删元素', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  await page.mouse.click(title.x + 30, title.y + 25);
  await selIs(page, ['title'], '第一下选中');
  await pause(600);
  await page.mouse.click(title.x + 30, title.y + 25);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '进入改字' });
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  const text = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'text'), { label: '改字的修改' });
  assert.equal(text.after.text, 'Hello agai');
  assert.equal((await edits(page)).some(e => e.kind === 'remove' || (e.edits || []).some(x => x.kind === 'remove')), false, '没有删除元素');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('h1')).visibility), 'visible');
});

test('多选对齐 6 种：按选中范围对齐，每次只发一条', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card'), badge = await box(frame, 'badge');
  await page.mouse.click(card.x + 50, card.y + 50);
  await page.keyboard.down('Shift'); await page.mouse.click(badge.x + 20, badge.y + 20); await page.keyboard.up('Shift');
  await selIs(page, ['card', 'badge'], '选中两个');
  // 范围：x 500..840，y 120..420
  const expect = {
    left: [{ x: 500 }, { x: 500 }], centerX: [{ x: 570 }, { x: 630 }], right: [{ x: 640 }, { x: 760 }],
    top: [{ y: 120 }, { y: 120 }], centerY: [{ y: 210 }, { y: 230 }], bottom: [{ y: 300 }, { y: 340 }]
  };
  for (const [mode, [c, b]] of Object.entries(expect)) {
    await page.evaluate(() => window.__f.setEdits([]));
    await until(async () => (await box(frame, 'badge')).x === 760 && (await box(frame, 'card')).x === 500, { label: '回到原位' });
    const before = (await edits(page)).length;
    await page.evaluate(mode => window.__f.send({ vw: 'align', mode }), mode);
    await until(async () => (await edits(page)).length > before, { label: `对齐 ${mode}` });
    await pause(50);
    assert.equal((await edits(page)).length, before + 1, `${mode} 只发一条`);
    const nc = await box(frame, 'card'), nb = await box(frame, 'badge');
    for (const [k, v] of Object.entries(c)) assert.equal(nc[k], v, `${mode} 卡片 ${k}`);
    for (const [k, v] of Object.entries(b)) assert.equal(nb[k], v, `${mode} 色块 ${k}`);
  }
});

test('拖动中鼠标出了页面：父页面转来松开 → 拖动结束、修改提交、框不留在页面上', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card');
  await page.mouse.move(card.x + 50, card.y + 50); await page.mouse.down();
  await page.mouse.move(card.x + 70, card.y + 50, { steps: 4 });
  await until(async () => (await msgs(page, 'drag')).at(-1)?.on === true, { label: '开始拖动' });
  // 父页面（app.js frameDrag）把外面的移动、松开换成页面坐标转进来
  await page.evaluate(({ x, y }) => { window.__f.send({ vw: 'pointer', kind: 'move', x, y }); window.__f.send({ vw: 'pointer', kind: 'up', x, y }); }, { x: card.x + 90, y: card.y + 60 });
  await until(async () => (await msgs(page, 'drag')).at(-1)?.on === false, { label: '拖动结束' });
  const move = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move'), { label: '移动修改' });
  assert.deepEqual(move.after, { dx: 40, dy: 10 });
  await page.mouse.up();
  // 框选同理：转来松开后框消失
  await page.mouse.move(60, 250); await page.mouse.down();
  await page.mouse.move(150, 330, { steps: 4 });
  await until(async () => !(await ui(frame)).marquee, { label: '框选框' });
  await page.evaluate(() => window.__f.send({ vw: 'pointer', kind: 'up', x: 150, y: 330 }));
  await until(async () => (await ui(frame)).marquee, { label: '框消失' });
  await page.mouse.up();
  // 之后鼠标移动不再拖东西
  const n = (await edits(page)).length;
  await page.mouse.move(300, 300, { steps: 3 });
  await pause(100);
  assert.equal((await edits(page)).length, n);
});
