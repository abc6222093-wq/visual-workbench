// 第 12 轮页面运行时：edit 模式交互（Word / PowerPoint 习惯）、修改单叠加与重放、隔离、「退出编辑不闪」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, makePng, until, pause } from './round12-runtime-fixture.js';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#fafafa;font:20px/1.3 sans-serif}
h1{position:absolute;left:100px;top:60px;margin:0;font-size:40px;color:#112233;width:600px}
#pic{position:absolute;left:100px;top:300px;width:200px;height:100px}
.card{position:absolute;left:500px;top:300px;width:200px;height:120px;background:#f1f5f9}
.badge{position:absolute;left:760px;top:120px;width:80px;height:80px;background:#334455;transform:rotate(10deg)}
#plain{position:absolute;left:100px;top:180px;margin:0}
#probe{color:rgb(9, 9, 9) !important}
</style></head><body>
<h1 data-vw-id="title" data-vw="text move color">Hello <b>World</b> again</h1>
<p id="plain">no marks here</p>
<img id="pic" data-vw-id="pic" data-vw="move resize crop" src="../assets/a.png">
<div class="card" data-vw-id="card" data-vw="move resize background"></div>
<div class="badge" data-vw-id="badge" data-vw="move"></div>
<script>
addEventListener('message', e => {
  const d = e.data || {};
  if (d.vwtest === 'mark') { document.getElementById('pic').__mark = d.token; document.body.__mark = d.token; }
  if (d.vwtest === 'check') parent.postMessage({ vwtestResult: { img: document.getElementById('pic').__mark === d.token, body: document.body.__mark === d.token } }, '*');
});
let parentDoc; try { parentDoc = typeof window.parent.document; } catch (err) { parentDoc = 'blocked:' + err.name; }
fetch('/api/projects/rt-test', { method: 'PUT', body: '{}' }).then(r => r.status, () => 'error').then(put => parent.postMessage({ vwtestIso: { parentDoc, origin: self.origin, put } }, '*'));
</script></body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({
    pages: [{ id: 'page_one', html: PAGE }],
    assets: [{ id: 'asset_a', kind: 'image', file: 'assets/a.png', width: 400, height: 200 }],
    files: { 'assets/a.png': makePng(400, 200) }
  });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

async function open(t, { edits = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const project = structuredClone(fixture.project);
  project.pages[0].edits = edits;
  await page.evaluate(async ({ project }) => {
    const { createPageFrame } = await import('/page-frame.js');
    window.__msgs = []; window.__test = []; window.__loads = 0;
    addEventListener('message', e => { if (e.data && (e.data.vwtestResult || e.data.vwtestIso)) window.__test.push(e.data); });
    const f = createPageFrame({
      project, page: project.pages[0], mode: 'edit', container: document.getElementById('stage'),
      onMessage: m => window.__msgs.push(JSON.parse(JSON.stringify(m, (k, v) => (v instanceof ArrayBuffer ? { byteLength: v.byteLength } : v))))
    });
    f.iframe.addEventListener('load', () => { window.__loads++; });
    window.__f = f; window.__iframe = f.iframe;
    await f.ready;
  }, { project });
  const frame = await until(() => page.frames().find(f => f !== page.mainFrame()), { label: '页面 iframe' });
  await frame.waitForFunction(() => document.getElementById('pic').complete);
  // 跨源 iframe 要先画出第一帧，Chromium 才会把鼠标事件路由进去；刚就绪就点会被丢掉（CI 上尤其明显）。父页面和 iframe 各等两帧
  await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { page, frame };
}
const msgs = (page, type) => page.evaluate(type => window.__msgs.filter(m => m.vw === type), type);
// 第 13 轮选中优先：文字第一下选中整块，隔开双击间隔再点一下才出光标
async function clickIntoText(page, frame, x, y, id = 'title') {
  await page.mouse.click(x, y);
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === id, { label: '第一下选中' });
  await pause(600);
  await page.mouse.click(x, y);
  await until(() => frame.evaluate(id => document.activeElement?.dataset.vwId === id, id), { label: '再点一下进入改字' });
}
const box = (frame, id) => frame.evaluate(id => { const r = document.querySelector(`[data-vw-id="${id}"]`).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, id);

test('applyEditsToDocument：DOMParser 文档叠修改单、对不上的跳过、重放只恢复去掉的；staticDocument 删脚本', async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const result = await page.evaluate(async ({ html, project }) => {
    const { staticDocument } = await import('/page-frame.js');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const edits = [
      { id: 'ed_text', target: 'title', kind: 'text', before: { html: 'Hello <b>World</b> again', text: 'Hello World again' }, after: { html: 'Hi <b>World</b>', text: 'Hi World' } },
      { id: 'ed_move', target: 'card', kind: 'move', before: { x: 500, y: 300, width: 200, height: 120 }, after: { dx: 40, dy: -10 } },
      { id: 'ed_bg', target: 'card', kind: 'background', before: { background: '#f1f5f9' }, after: { background: '#fde68a' } },
      { id: 'ed_size', target: 'pic', kind: 'resize', before: { width: 200, height: 100 }, after: { width: 300, height: 150 } },
      { id: 'ed_crop', target: 'pic', kind: 'crop', before: { crop: null }, after: { crop: { x: 0.25, y: 0, width: 0.5, height: 1 } } },
      { id: 'ed_add', target: 'u_12345678', kind: 'addImage', before: null, after: { asset: 'asset_a', x: 10, y: 20, width: 40, height: 20 } },
      { id: 'ed_stale1', target: 'missing', kind: 'color', before: { color: '#000000' }, after: { color: '#ff0000' } },
      { id: 'ed_stale2', target: 'card', kind: 'color', before: { color: '#000000' }, after: { color: '#ff0000' } }
    ];
    const assets = { asset_a: '../assets/a.png' };
    const first = window.__vwRuntime.applyEditsToDocument(doc, edits, { assets });
    const q = id => doc.querySelector(`[data-vw-id="${id}"]`);
    const titleNode = q('title');
    const snap = () => ({ title: q('title').innerHTML, cardStyle: q('card').getAttribute('style'), pic: q('pic').getAttribute('style'), user: !!q('u_12345678') });
    const applied = snap();
    // 重放：去掉移动和贴图，其余不变（不重建标题节点）
    const second = window.__vwRuntime.applyEditsToDocument(doc, edits.filter(e => e.id !== 'ed_move' && e.id !== 'ed_add'), { assets });
    const replay = { ...snap(), sameTitleNode: q('title') === titleNode, titleChildSame: true };
    window.__vwRuntime.applyEditsToDocument(doc, [], { assets });
    const cleared = snap();
    const thumb = staticDocument({ html, project, page: project.pages[0], edits: edits.slice(0, 2) });
    return { skipped: first.skipped, second: second.skipped, applied, replay, cleared, thumb };
  }, { html: PAGE, project: fixture.project });
  assert.deepEqual(result.skipped.sort(), ['ed_stale1', 'ed_stale2']);
  assert.equal(result.applied.title, 'Hi <b>World</b>');
  assert.match(result.applied.cardStyle, /--vw-dx: 40px/);
  assert.match(result.applied.cardStyle, /translate: var\(--vw-dx, 0px\) var\(--vw-dy, 0px\)/);
  assert.match(result.applied.cardStyle, /background: (rgb\(253, 230, 138\)|#fde68a)/);
  assert.match(result.applied.pic, /width: 300px/);
  assert.match(result.applied.pic, /object-view-box: inset\(0% 25%( 0% 25%)?\)/);
  assert.match(result.applied.pic, /object-fit: cover/);
  assert.equal(result.applied.user, true);
  assert.equal(result.replay.user, false);
  assert.equal(result.replay.sameTitleNode, true);
  assert.equal(result.replay.title, 'Hi <b>World</b>');
  assert.doesNotMatch(result.replay.cardStyle, /vw-dx/);
  assert.match(result.replay.cardStyle, /background/);
  assert.equal(result.cleared.title, 'Hello <b>World</b> again');
  assert.ok(!result.cleared.cardStyle, '全部恢复后卡片没有行内样式');
  assert.ok(!result.cleared.pic);
  assert.doesNotMatch(result.thumb, /<script/i);
  assert.match(result.thumb, /Hi <b>World<\/b>/);
  assert.match(result.thumb, /<base href="http:\/\/127\.0\.0\.1:\d+\/data\/projects\/rt-test\/pages\/">/);
  assert.match(result.thumb, /data-vw-base/);
});

test('文字第一下选中整块、再点一下出光标改字（第 13 轮），保留行内格式；Esc 退出不重建节点、不重载 iframe', async t => {
  const { page, frame } = await open(t);
  const token = `t${Date.now()}`;
  await page.evaluate(token => window.__iframe.contentWindow.postMessage({ vwtest: 'mark', token }, '*'), token);
  const title = await box(frame, 'title');
  // 第一下：只选中（框 + 把手），不出光标
  await page.mouse.click(title.x + 30, title.y + title.height / 2);
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === 'title', { label: '第一下选中标题' });
  await pause(150);
  assert.deepEqual(await frame.evaluate(() => ({ editable: document.querySelector('[data-vw-id=title]').hasAttribute('contenteditable'), focus: document.activeElement?.dataset?.vwId || null })), { editable: false, focus: null }, '第一下不出光标');
  assert.equal((await msgs(page, 'editing')).length, 0);
  await pause(600); // 隔开双击间隔
  // 再点一下：点在 "Hello" 的 H 后面一点
  await page.mouse.click(title.x + 8, title.y + title.height / 2);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '标题获得焦点' });
  const caret = await frame.evaluate(() => { const s = getSelection(); return { collapsed: s.isCollapsed, inside: document.querySelector('[data-vw-id=title]').contains(s.anchorNode), editable: document.querySelector('[data-vw-id=title]').isContentEditable }; });
  assert.deepEqual(caret, { collapsed: true, inside: true, editable: true });
  assert.equal((await until(async () => (await msgs(page, 'editing')).at(-1), { label: '进入改字的消息' })).on, true);
  await page.keyboard.type('X');
  const typed = await frame.evaluate(() => document.querySelector('[data-vw-id=title]').innerHTML);
  assert.match(typed, /^H?X/, '在单击的位置插入');
  assert.match(typed, /<b>World<\/b>/, '行内格式保留');
  await page.keyboard.press('Escape');
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === false, { label: '退出改字' });
  const last = await until(async () => (await msgs(page, 'edit')).filter(e => e.kind === 'text').at(-1), { label: '文字修改' });
  assert.equal(last.target, 'title');
  assert.deepEqual(last.before, { html: 'Hello <b>World</b> again', text: 'Hello World again' });
  assert.equal(last.after.html, typed);
  const after = await frame.evaluate(() => ({ editable: document.querySelector('[data-vw-id=title]').hasAttribute('contenteditable'), sel: getSelection().rangeCount }));
  assert.deepEqual(after, { editable: false, sel: 0 });
  // 点外面也退出
  await page.mouse.click(title.x + 30, title.y + title.height / 2);
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === true);
  await page.mouse.click(900, 500);
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === false, { label: '点外面退出' });
  // 父页面要求取消选中（例如点了 iframe 外面）也退出（点外面后标题没选中：先点一下选中，再点一下进入改字）
  await pause(600);
  await page.mouse.click(title.x + 30, title.y + title.height / 2);
  await until(async () => (await msgs(page, 'select')).at(-1)?.id === 'title');
  await pause(600);
  await page.mouse.click(title.x + 30, title.y + title.height / 2);
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === true);
  await page.evaluate(() => window.__f.select(null));
  await until(async () => (await msgs(page, 'editing')).at(-1)?.on === false, { label: '父页面取消选中' });
  // 同一个 iframe 节点，没有重新加载；里面的 <img> 和 body 节点还是原来那个（页面脚本回报一次性标记）
  await page.evaluate(token => window.__iframe.contentWindow.postMessage({ vwtest: 'check', token }, '*'), token);
  const check = await until(() => page.evaluate(() => window.__test.find(m => m.vwtestResult)?.vwtestResult), { label: '标记回报' });
  assert.deepEqual(check, { img: true, body: true });
  const identity = await page.evaluate(() => ({ same: document.querySelector('#stage iframe') === window.__iframe, loads: window.__loads, ready: window.__msgs.filter(m => m.vw === 'ready').length }));
  assert.deepEqual(identity, { same: true, loads: 1, ready: 1 });
});

test('原生选区：双击选词、三击选段、Shift+方向键、Cmd/Ctrl+A 只选本元素；回车是 <br>；粘贴只取纯文字；加粗被拦下', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  const wordX = await frame.evaluate(() => { const b = document.querySelector('[data-vw-id=title] b').getBoundingClientRect(); return b.left + b.width / 2; });
  await clickIntoText(page, frame, wordX, title.y + title.height / 2);
  await pause(600);
  await page.mouse.dblclick(wordX, title.y + title.height / 2);
  assert.equal((await frame.evaluate(() => getSelection().toString())).trim(), 'World');
  await page.mouse.click(wordX, title.y + title.height / 2, { clickCount: 3 });
  assert.match(await frame.evaluate(() => getSelection().toString()), /Hello World again/);
  await page.mouse.click(wordX, title.y + title.height / 2);
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await frame.evaluate(() => getSelection().toString()), 'He');
  await page.keyboard.press('ControlOrMeta+a');
  assert.equal(await frame.evaluate(() => getSelection().toString()), 'Hello World again', '只选本元素');
  const selColor = await frame.evaluate(() => getComputedStyle(document.querySelector('[data-vw-id=title]'), '::selection').backgroundColor);
  assert.equal(selColor, 'rgba(64, 120, 255, 0.38)');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Z');
  let html = await frame.evaluate(() => document.querySelector('[data-vw-id=title]').innerHTML);
  assert.match(html, /<br>/);
  assert.doesNotMatch(html, /<div|<p/);
  // 粘贴：只取纯文字
  await frame.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<i style="color:red">粘贴</i>');
    dt.setData('text/plain', '粘贴');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  html = await frame.evaluate(() => document.querySelector('[data-vw-id=title]').innerHTML);
  assert.match(html, /粘贴/);
  assert.doesNotMatch(html, /<i/);
  // 快捷键加粗不生效
  const bolds = (html.match(/<b>/g) || []).length;
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+b');
  html = await frame.evaluate(() => document.querySelector('[data-vw-id=title]').innerHTML);
  assert.equal((html.match(/<b>/g) || []).length, bolds);
  assert.doesNotMatch(html, /<strong|font-weight/);
});

test('输入法组合期间不写修改，compositionend 后才写', async t => {
  const { page, frame } = await open(t);
  const title = await box(frame, 'title');
  await clickIntoText(page, frame, title.x + 160, title.y + title.height / 2);
  await frame.evaluate(() => {
    const el = document.querySelector('[data-vw-id=title]');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    document.execCommand('insertText', false, 'ni');
  });
  await pause(700);
  assert.equal((await msgs(page, 'edit')).length, 0, '组合期间没有修改');
  await frame.evaluate(() => document.querySelector('[data-vw-id=title]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' })));
  const edit = await until(async () => (await msgs(page, 'edit')).at(-1), { label: '组合结束后的修改' });
  assert.equal(edit.kind, 'text');
  assert.match(edit.after.text, /ni/);
});

test('拖动：无 text 的元素点哪都能拖、不覆盖原 transform；text 元素第一下按住整块就能拖（第 13 轮），改字中在字上拖是拖选、框线仍能拖', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card');
  await page.mouse.move(card.x + 100, card.y + 60);
  await page.mouse.down();
  await page.mouse.move(card.x + 130, card.y + 80, { steps: 4 });
  await page.mouse.move(card.x + 150, card.y + 90, { steps: 4 });
  await page.mouse.up();
  const move = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move' && e.target === 'card'), { label: '拖动修改' });
  assert.deepEqual(move.before, { x: 500, y: 300, width: 200, height: 120 });
  assert.deepEqual(move.after, { dx: 50, dy: 30 });
  assert.deepEqual(await box(frame, 'card'), { x: 550, y: 330, width: 200, height: 120 });
  const select = (await msgs(page, 'select')).filter(m => m.id === 'card').at(-1);
  assert.deepEqual(select.caps, ['move', 'resize', 'background']);
  assert.deepEqual(select.rect, { x: 550, y: 330, width: 200, height: 120 });
  // 旋转的元素：拖动叠加 translate，原 transform 不变
  const badge = await box(frame, 'badge');
  await page.mouse.move(badge.x + badge.width / 2, badge.y + badge.height / 2);
  await page.mouse.down();
  await page.mouse.move(badge.x + badge.width / 2 + 30, badge.y + badge.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  const styles = await frame.evaluate(() => { const el = document.querySelector('[data-vw-id=badge]'); const cs = getComputedStyle(el); return { transform: cs.transform, translate: cs.translate, inline: el.style.transform }; });
  assert.notEqual(styles.transform, 'none');
  assert.match(styles.transform, /^matrix\(0\.98/);
  assert.equal(styles.translate, '30px 20px');
  assert.equal(styles.inline, '');
  // 标题（没选中）：第一下在字中间按住拖 = 移动整块，不进改字
  const title = await box(frame, 'title');
  await page.mouse.move(title.x + 150, title.y + title.height / 2);
  await page.mouse.down();
  await page.mouse.move(title.x + 250, title.y + title.height / 2, { steps: 5 });
  await page.mouse.up();
  const first = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move' && e.target === 'title'), { label: '在字上拖动标题的修改' });
  assert.deepEqual(first.after, { dx: 100, dy: 0 });
  assert.equal(await frame.evaluate(() => document.querySelector('[data-vw-id=title]').hasAttribute('contenteditable')), false, '拖完不进改字');
  assert.equal((await msgs(page, 'editing')).length, 0);
  // 已选中：双击进入改字，改字中在字上拖是拖选、不移动
  const t2 = await box(frame, 'title');
  await pause(600);
  await page.mouse.dblclick(t2.x + 150, t2.y + t2.height / 2);
  await until(() => frame.evaluate(() => document.activeElement?.dataset.vwId === 'title'), { label: '双击进入改字' });
  await page.mouse.move(t2.x + 50, t2.y + t2.height / 2);
  await page.mouse.down();
  await page.mouse.move(t2.x + 250, t2.y + t2.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await box(frame, 'title'), t2);
  assert.equal(await frame.evaluate(() => getSelection().toString().length > 0), true, '改字中在字上拖是拖选');
  await page.keyboard.press('Escape');
  // 从框线（左边缘 3px 内）拖：移动
  await page.mouse.move(t2.x + 2, t2.y + t2.height / 2);
  await page.mouse.down();
  await page.mouse.move(t2.x + 22, t2.y + t2.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  const moved = await until(async () => { const e = (await msgs(page, 'edit')).filter(e => e.kind === 'move' && e.target === 'title').at(-1); return e && e.after.dx === 120 ? e : null; }, { label: '从框线拖动标题的修改' });
  assert.deepEqual(moved.after, { dx: 120, dy: 40 });
  assert.equal(await frame.evaluate(() => document.querySelector('[data-vw-id=title]').hasAttribute('contenteditable')), false);
  // 方向键微调
  await page.keyboard.press('Shift+ArrowRight');
  const nudged = await until(async () => { const e = (await msgs(page, 'edit')).filter(e => e.kind === 'move' && e.target === 'title').at(-1); return e && e.after.dx === 130 ? e : null; }, { label: '方向键微调的修改' });
  assert.deepEqual(nudged.after, { dx: 130, dy: 40 });
});

test('缩放把手：普通元素自由缩放、左上把手同时移动；图片角上锁比例', async t => {
  const { page, frame } = await open(t);
  const card = await box(frame, 'card');
  await page.mouse.click(card.x + 100, card.y + 60);
  await page.mouse.move(card.x + card.width, card.y + card.height);
  await page.mouse.down();
  await page.mouse.move(card.x + card.width + 40, card.y + card.height + 20, { steps: 4 });
  await page.mouse.up();
  let resize = await until(async () => (await msgs(page, 'edit')).filter(e => e.kind === 'resize' && e.target === 'card').at(-1), { label: '缩放修改' });
  assert.deepEqual(resize.before, { width: 200, height: 120 });
  assert.deepEqual(resize.after, { width: 240, height: 140 });
  // 左上把手：变大并移动
  await page.mouse.move(card.x, card.y);
  await page.mouse.down();
  await page.mouse.move(card.x - 10, card.y - 10, { steps: 3 });
  await page.mouse.up();
  resize = await until(async () => { const e = (await msgs(page, 'edit')).filter(e => e.kind === 'resize' && e.target === 'card').at(-1); return e && e.after.width === 250 ? e : null; }, { label: '左上把手的修改' });
  assert.deepEqual(resize.after, { width: 250, height: 150 });
  assert.deepEqual(await box(frame, 'card'), { x: 490, y: 290, width: 250, height: 150 });
  // 图片：角上锁比例
  const pic = await box(frame, 'pic');
  await page.mouse.click(pic.x + 50, pic.y + 50);
  await page.mouse.move(pic.x + pic.width, pic.y + pic.height);
  await page.mouse.down();
  await page.mouse.move(pic.x + pic.width + 100, pic.y + pic.height + 5, { steps: 4 });
  await page.mouse.up();
  const picResize = await until(async () => (await msgs(page, 'edit')).filter(e => e.kind === 'resize' && e.target === 'pic').at(-1), { label: '图片缩放的修改' });
  assert.deepEqual(picResize.after, { width: 300, height: 150 });
});

test('裁切：双击图片进入，滚轮放大、Esc 完成 → crop 修改与 object-view-box', async t => {
  const { page, frame } = await open(t);
  const pic = await box(frame, 'pic');
  await page.mouse.dblclick(pic.x + 100, pic.y + 50);
  await until(() => frame.evaluate(() => !!document.querySelector('vw-ui').shadowRoot.querySelector('.crop')), { label: '裁切层' });
  await page.mouse.move(pic.x + 100, pic.y + 50);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.press('Escape');
  const crop = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'crop'), { label: '裁切修改' });
  assert.equal(crop.target, 'pic');
  assert.deepEqual(crop.before, { crop: null });
  assert.ok(crop.after.crop.width < 1 && crop.after.crop.width > 0.7, JSON.stringify(crop.after));
  assert.ok(Math.abs(crop.after.crop.x + crop.after.crop.width / 2 - 0.5) < 0.01, '以中心缩放');
  const styles = await frame.evaluate(() => { const el = document.querySelector('[data-vw-id=pic]'); return { fit: getComputedStyle(el).objectFit, box: el.style.getPropertyValue('object-view-box'), overlay: !!document.querySelector('vw-ui').shadowRoot.querySelector('.crop') }; });
  assert.equal(styles.fit, 'cover');
  assert.match(styles.box, /^inset\(/);
  assert.equal(styles.overlay, false);
  assert.deepEqual(await box(frame, 'pic'), pic, '框不变');
});

test('父页面 set、edits 重放、贴图 addImage、右键菜单、Delete 键', async t => {
  const { page, frame } = await open(t, { edits: [{ id: 'ed_aaaa1111', target: 'card', kind: 'move', before: { x: 500, y: 300, width: 200, height: 120 }, after: { dx: 10, dy: 0 } }] });
  assert.equal((await box(frame, 'card')).x, 510, '启动时已叠修改单');
  await page.evaluate(() => window.__f.set('title', 'color', { color: '#ff0000' }));
  const color = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'color'));
  assert.deepEqual(color.before, { color: '#112233' });
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('[data-vw-id=title]')).color), 'rgb(255, 0, 0)');
  await page.evaluate(() => window.__f.set('title', 'fontSize', { fontSize: 50 }));
  const size = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'fontSize'));
  assert.deepEqual(size.before, { fontSize: 40 });
  await page.evaluate(() => window.__f.set('card', 'background', { background: '#fde68a' }));
  const bg = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'background'));
  assert.deepEqual(bg.before, { background: '#f1f5f9' }, '颜色一律转成 #rrggbb');
  // 拖动已有修改的卡片：before 用修改单里的原位置
  const card = await box(frame, 'card');
  await page.mouse.move(card.x + 50, card.y + 50); await page.mouse.down(); await page.mouse.move(card.x + 70, card.y + 50, { steps: 3 }); await page.mouse.up();
  const move = await until(async () => (await msgs(page, 'edit')).find(e => e.kind === 'move'), { label: '拖动修改' });
  assert.deepEqual(move.before, { x: 500, y: 300, width: 200, height: 120 });
  assert.deepEqual(move.after, { dx: 30, dy: 0 });
  // 整份重放：清空 → 全部恢复
  await page.evaluate(() => window.__f.setEdits([]));
  await until(async () => (await box(frame, 'card')).x === 500, { label: '恢复原位' });
  assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector('[data-vw-id=title]')).color), 'rgb(17, 34, 51)');
  // 贴图：页面里粘贴图片 → paste-image（ArrayBuffer）
  await page.mouse.click(900, 500);
  await frame.evaluate(async () => {
    const bytes = await (await fetch('../assets/a.png')).arrayBuffer();
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'shot.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const pasted = await until(async () => (await msgs(page, 'paste-image'))[0], { label: '贴图消息' });
  assert.equal(pasted.type, 'image/png');
  assert.ok(pasted.buffer.byteLength > 100);
  await page.evaluate(() => window.__f.addImage({ id: 'ed_bbbb2222', target: 'u_abcdef12', kind: 'addImage', before: null, after: { asset: 'asset_a', x: 600, y: 40, width: 120, height: 60 } }));
  await until(() => frame.evaluate(() => document.querySelector('[data-vw-id=u_abcdef12]')?.complete), { label: '贴的图' });
  const sel = await until(async () => (await msgs(page, 'select')).find(m => m.id === 'u_abcdef12'), { label: '选中贴的图' });
  assert.deepEqual(sel.caps, ['move', 'resize', 'crop']);
  assert.deepEqual(await box(frame, 'u_abcdef12'), { x: 600, y: 40, width: 120, height: 60 });
  await page.mouse.click(660, 70, { button: 'right' });
  const menu = await until(async () => (await msgs(page, 'menu'))[0], { label: '右键菜单' });
  assert.equal(menu.id, 'u_abcdef12');
  await page.keyboard.press('Delete');
  const key = await until(async () => (await msgs(page, 'key')).find(k => k.key === 'Delete'), { label: 'Delete 键' });
  assert.equal(key.id, 'u_abcdef12');
  await page.evaluate(() => window.__f.removeImage('u_abcdef12'));
  await until(() => frame.evaluate(() => !document.querySelector('[data-vw-id=u_abcdef12]')), { label: '删掉贴的图' });
  // 没有 data-vw 的元素碰不到
  await page.mouse.click(110, 190);
  assert.equal((await msgs(page, 'select')).at(-1).id, null);
});

test('隔离：页面脚本碰不到父页面文档、是 null 源、修改请求带 Origin: null；页面样式不影响父页面', async t => {
  const { page } = await open(t);
  const iso = await until(() => page.evaluate(() => window.__test.find(m => m.vwtestIso)?.vwtestIso), { label: '隔离探测' });
  assert.match(String(iso.parentDoc), /^blocked:SecurityError/);
  assert.equal(iso.origin, 'null');
  assert.equal(iso.put, 'error', '跨源的 PUT 发不出去');
  assert.ok(server.requests.length > 0 && server.requests.every(r => r.origin === 'null'), JSON.stringify(server.requests));
  const parentStyle = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, probe: getComputedStyle(document.getElementById('probe')).color }));
  assert.deepEqual(parentStyle, { bg: 'rgb(1, 2, 3)', probe: 'rgb(0, 0, 0)' });
  const sandbox = await page.evaluate(() => window.__iframe.getAttribute('sandbox'));
  assert.equal(sandbox, 'allow-scripts');
});
