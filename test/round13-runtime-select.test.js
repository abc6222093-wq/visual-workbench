// 第 13 轮 0b（docs/round13-contract.md §4.1）：文字选中优先。
// 带 text 的元素：第一下按下选中整块（框 + 把手、有 move 时按住即拖、方向键微调、指针 move）；已选中再点一下（没拖动）在点的位置出光标；
// 双击未选中的文字：选中并进入改字（浏览器照常选词）；改字中 Esc 回到「选中」，再 Esc 取消选中。没有 move 的文字悬停是默认箭头、拖不动。
// 只用临时数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until, pause } from './round12-runtime-fixture.js';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#fafafa;font:20px/1.3 sans-serif}
h1{position:absolute;left:100px;top:60px;margin:0;font-size:40px;width:600px}
#fixed{position:absolute;left:100px;top:300px;margin:0;font-size:30px;width:500px}
</style></head><body>
<h1 data-vw-id="title" data-vw="text move color">Hello World again</h1>
<p id="fixed" data-vw-id="fixed" data-vw="text color">Only text here</p>
</body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({ id: 'rt-select', prefix: '我的云端硬盘 选中-', pages: [{ id: 'page_one', html: PAGE }] });
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
    window.__f = createPageFrame({ project, page: project.pages[0], mode: 'edit', container: document.getElementById('stage'), onMessage: m => window.__msgs.push(m) });
    await window.__f.ready;
  }, { project: fixture.project });
  const frame = await (await page.$('#stage iframe')).contentFrame();
  await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, frame };
}
const msgs = (page, type) => page.evaluate(type => window.__msgs.filter(m => m.vw === type), type);
const box = (frame, id) => frame.evaluate(id => { const r = document.querySelector(`[data-vw-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, id);
const state = (frame, id) => frame.evaluate(id => {
  const el = document.querySelector(`[data-vw-id="${id}"]`);
  const sel = document.querySelector('vw-ui').shadowRoot.querySelector('.sel');
  const handles = [...sel.querySelectorAll('.h')].filter(h => getComputedStyle(h).display !== 'none').length;
  return { editable: el.hasAttribute('contenteditable'), focused: document.activeElement === el, selBox: !sel.hidden, handles, cursor: document.documentElement.getAttribute('data-vw-cursor') };
}, id);

test('带 move 的文字：悬停是移动光标；第一下只选中（框、不出光标），方向键微调；再点一下在点的位置出光标', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  const y = title.y + title.height / 2;
  await page.mouse.move(title.x + 150, y);
  await until(async () => (await state(frame, 'title')).cursor === 'move', { label: '字上悬停是移动光标' });
  await page.mouse.click(title.x + 150, y);
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === 'title', { label: '第一下选中' });
  await pause(150);
  let s = await state(frame, 'title');
  assert.deepEqual({ editable: s.editable, focused: s.focused, selBox: s.selBox }, { editable: false, focused: false, selBox: true });
  assert.equal((await msgs(page, 'editing')).length, 0, '第一下不进改字');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const nudged = await until(async () => { const e = (await msgs(page, 'edit')).filter(e => e.kind === 'move').at(-1); return e?.after.dy === 10 ? e : null; }, { label: '方向键微调' });
  assert.deepEqual(nudged.after, { dx: 1, dy: 10 });
  // 再点一下（隔开双击间隔）：点在 "Hello" 的 H 后面
  await pause(600);
  const t2 = await box(frame, 'title');
  const afterH = await frame.evaluate(() => { const n = document.querySelector('[data-vw-id=title]').firstChild; const r = document.createRange(); r.setStart(n, 0); r.setEnd(n, 1); return r.getBoundingClientRect().right + 2; });
  await page.mouse.click(afterH, t2.y + t2.height / 2);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '再点一下进入改字' });
  assert.equal((await msgs(page, 'editing')).at(-1).on, true);
  await page.keyboard.type('X');
  assert.match(await frame.evaluate(() => document.querySelector('[data-vw-id=title]').textContent), /^HXello World again$/, '在点的位置插入');
  // Esc：退出改字，仍选中；再 Esc：取消选中
  await page.keyboard.press('Escape');
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === false, { label: '退出改字' });
  s = await state(frame, 'title');
  assert.deepEqual({ editable: s.editable, selBox: s.selBox }, { editable: false, selBox: true }, '退出改字后仍是选中');
  await page.keyboard.press('Escape');
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === null, { label: '再 Esc 取消选中' });
});

test('双击未选中的文字：选中并进入改字，浏览器照常选词；按住拖动只移动不进改字', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  const wordX = await frame.evaluate(() => { const el = document.querySelector('[data-vw-id=title]'); const r = document.createRange(); const n = el.firstChild; r.setStart(n, 6); r.setEnd(n, 11); const b = r.getBoundingClientRect(); return b.left + b.width / 2; });
  await page.mouse.dblclick(wordX, title.y + title.height / 2);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '双击进入改字' });
  assert.equal((await frame.evaluate(() => getSelection().toString())).trim(), 'World', '双击选词');
  assert.equal((await msgs(page, 'select')).at(-1).id, 'title');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === null);
  // 没选中时在字上按住拖：整块移动，不进改字
  await pause(600);
  await page.mouse.move(title.x + 200, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 230, title.y + title.height / 2 + 15, { steps: 5 });
  await page.mouse.up();
  const moved = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move'), { label: '拖动整块' });
  assert.deepEqual(moved.after, { dx: 30, dy: 15 });
  assert.equal((await msgs(page, 'editing')).filter(m => m.on).length, 1, '拖动没有进改字（只有前面双击那一次）');
  // 拖完是选中状态：再点一下进入改字
  await pause(600);
  const t2 = await box(frame, 'title');
  await page.mouse.click(t2.x + 100, t2.y + t2.height / 2);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '拖完再点一下进入改字' });
});

test('没有 move 的文字：悬停是默认箭头；第一下选中、拖不动；再点一下进入改字', async t => {
  const { page, frame } = await open(t);
  const fixed = await box(frame, 'fixed');
  const y = fixed.y + fixed.height / 2;
  await page.mouse.move(fixed.x + 60, y);
  await until(async () => !(await frame.evaluate(() => document.querySelector('vw-ui').shadowRoot.querySelector('.hover').hidden)), { label: '悬停框' });
  assert.equal((await state(frame, 'fixed')).cursor, null, '默认箭头');
  await page.mouse.down();
  await page.mouse.move(fixed.x + 120, y + 30, { steps: 5 });
  await page.mouse.up();
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === 'fixed', { label: '选中' });
  assert.deepEqual(await box(frame, 'fixed'), fixed, '拖不动');
  assert.equal((await msgs(page, 'edit')).length, 0);
  assert.equal((await state(frame, 'fixed')).editable, false, '拖过（不算点击）不进改字');
  await pause(600);
  await page.mouse.click(fixed.x + 60, y);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'fixed'), { label: '再点一下进入改字' });
});
