// 第 12 轮修正：图片裁切在 Safari 里不生效（object-view-box 只有 Chromium 支持）。
// 不支持时（或 boot 参数 cropFallback:true 强制）运行时改用背景图显示裁切：画面和 object-view-box + cover 一致，元素框不变、不包裹节点。
// 本容器没有 WebKit，用 cropFallback 强制走兼容分支；VW_BROWSER=webkit 时 launchBrowser 选 WebKit，两种都会走兼容分支，测试照样成立。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, makePng, until } from './round12-runtime-fixture.js';

// 图片框 200×100，源图 400×200（左红右蓝）
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#fff}
#pic{position:absolute;left:100px;top:100px;width:200px;height:100px}
</style></head><body>
<img id="pic" data-vw-id="pic" data-vw="move resize crop" src="../assets/a.png">
</body></html>`;
const RIGHT_HALF = { id: 'ed_crop0001', target: 'pic', kind: 'crop', before: { crop: null }, after: { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } } };
// 比例和框不同（cover 再裁一次）：源图中间那一块 200×200，框里左半红、右半蓝，上下各裁掉 50
const MIDDLE = { id: 'ed_crop0002', target: 'pic', kind: 'crop', before: { crop: null }, after: { crop: { x: 0.25, y: 0, width: 0.5, height: 1 } } };

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({
    id: 'rt-crop', prefix: '我的云端硬盘 测试-',
    pages: [{ id: 'page_one', html: PAGE }],
    assets: [{ id: 'asset_a', kind: 'image', file: 'assets/a.png', width: 400, height: 200 }],
    files: { 'assets/a.png': makePng(400, 200) }
  });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

// 两个 iframe 上下摆：上面 cropFallback:false（Chromium 原生 object-view-box），下面 cropFallback:true
async function open(t, edits) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1150 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  await page.evaluate(async ({ project, edits }) => {
    const { createPageFrame } = await import('/page-frame.js');
    window.__msgs = { native: [], fallback: [] };
    window.__f = {};
    for (const [name, top] of [['native', 0], ['fallback', 580]]) {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:0;top:${top}px`;
      document.body.append(box);
      const f = createPageFrame({ project, page: project.pages[0], mode: 'edit', edits, cropFallback: name === 'fallback', container: box, onMessage: m => window.__msgs[name].push(m) });
      f.iframe.dataset.name = name;
      window.__f[name] = f;
    }
    await Promise.all(Object.values(window.__f).map(f => f.ready));
  }, { project: fixture.project, edits });
  const frames = {};
  for (const name of ['native', 'fallback']) {
    frames[name] = await (await page.$(`iframe[data-name="${name}"]`)).contentFrame();
    await frames[name].waitForFunction(() => document.getElementById('pic').complete);
    await frames[name].evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  return { page, frames };
}
// 截图后在页面里解码，取若干点的颜色（iframe 是跨源的，只能截图）
async function pixels(page, top, points) {
  const png = (await page.screenshot({ clip: { x: 0, y: top, width: 400, height: 300 } })).toString('base64');
  return page.evaluate(async ({ png, points }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    return points.map(([x, y]) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[0] > 150 && d[2] < 100 ? 'red' : d[2] > 150 && d[0] < 100 ? 'blue' : d[0] > 240 && d[1] > 240 && d[2] > 240 ? 'white' : `rgb(${d[0]},${d[1]},${d[2]})`; });
  }, { png, points });
}
const POINTS = [[200, 150], [110, 110], [290, 190], [150, 150], [250, 150], [200, 95], [200, 205]];

test('兼容方案与 object-view-box 画面一致：只取右半 → 全蓝；取中间（比例和框不同）→ 左红右蓝；框外不画', async t => {
  for (const [edit, expected] of [[RIGHT_HALF, ['blue', 'blue', 'blue', 'blue', 'blue', 'white', 'white']], [MIDDLE, ['blue', 'red', 'blue', 'red', 'blue', 'white', 'white']]]) {
    const { page, frames } = await open(t, [edit]);
    const native = await pixels(page, 0, POINTS);
    const fallback = await pixels(page, 580, POINTS);
    assert.deepEqual(fallback, native, `${JSON.stringify(edit.after.crop)}：兼容方案和原生一致`);
    assert.deepEqual(fallback, expected);
    const style = await frames.fallback.evaluate(() => { const el = document.getElementById('pic'); const r = el.getBoundingClientRect(); return { box: [r.left, r.top, r.width, r.height], src: el.getAttribute('src'), bg: el.style.backgroundImage, viewBox: el.style.getPropertyValue('object-view-box') }; });
    assert.deepEqual(style.box, [100, 100, 200, 100], '元素框不变');
    assert.match(style.bg, /a\.png/);
    assert.equal(style.viewBox, '', '兼容方案不写 object-view-box');
    await page.close();
  }
});

test('兼容方案：撤销裁切后 src 和样式全部还原；重做又生效；尺寸变化后跟着重算', async t => {
  const { page, frames } = await open(t, [MIDDLE]);
  const f = frames.fallback;
  const read = () => f.evaluate(() => { const el = document.getElementById('pic'); return { src: el.getAttribute('src'), style: el.getAttribute('style') || '' }; });
  assert.notEqual((await read()).style, '');
  await page.evaluate(() => window.__f.fallback.setEdits([]));
  await until(async () => (await read()).style === '', { label: '样式还原' });
  assert.equal((await read()).src, '../assets/a.png');
  assert.deepEqual(await pixels(page, 580, [[150, 150], [250, 150], [200, 95]]), ['red', 'blue', 'white'], '整张图（左红右蓝）');
  await page.evaluate(edit => window.__f.fallback.setEdits([edit]), RIGHT_HALF);
  await until(async () => (await read()).style !== '', { label: '重做' });
  assert.deepEqual(await pixels(page, 580, [[150, 150], [250, 150]]), ['blue', 'blue']);
  // 拉宽：背景跟着重算（和原生一致）
  const resize = { id: 'ed_size0001', target: 'pic', kind: 'resize', before: { width: 200, height: 100 }, after: { width: 300, height: 100 } };
  await page.evaluate(edits => { window.__f.fallback.setEdits(edits); window.__f.native.setEdits(edits); }, [MIDDLE, resize]);
  await until(() => f.evaluate(() => document.getElementById('pic').getBoundingClientRect().width === 300), { label: '拉宽' });
  await f.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const pts = [[130, 150], [190, 150], [230, 150], [380, 150], [200, 105], [200, 195]];
  assert.deepEqual(await pixels(page, 580, pts), await pixels(page, 0, pts));
});

test('兼容方案：双击仍能进入裁切工具，工具里的图是原图；完成后写 crop 修改', async t => {
  const { page, frames } = await open(t, []);
  const f = frames.fallback;
  await page.mouse.dblclick(200, 580 + 150);
  await until(() => f.evaluate(() => !!document.querySelector('vw-ui').shadowRoot.querySelector('.crop')), { label: '裁切层' });
  const ghost = await f.evaluate(() => document.querySelector('vw-ui').shadowRoot.querySelector('.crop img').getAttribute('src'));
  assert.match(ghost, /a\.png$/);
  await page.mouse.move(200, 580 + 150);
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.press('Escape');
  const crop = await until(() => page.evaluate(() => window.__msgs.fallback.find(m => m.vw === 'edit' && m.kind === 'crop')), { label: '裁切修改' });
  assert.ok(crop.after.crop.width < 1);
  const style = await f.evaluate(() => { const el = document.getElementById('pic'); return { bg: el.style.backgroundImage, viewBox: el.style.getPropertyValue('object-view-box') }; });
  assert.match(style.bg, /a\.png/);
  assert.equal(style.viewBox, '');
  // 再次双击：从当前裁切继续
  await page.mouse.dblclick(200, 580 + 150);
  await until(() => f.evaluate(() => !!document.querySelector('vw-ui').shadowRoot.querySelector('.crop')), { label: '再次进入裁切' });
  await page.keyboard.press('Escape');
});

test('缩略图（DOMParser 文档）：强制兼容方案时按比例写背景（不需要排版信息）', async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const style = await page.evaluate(({ html, edit }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    window.__vwRuntime.applyEditsToDocument(doc, [edit], { cropFallback: true });
    return doc.getElementById('pic').getAttribute('style');
  }, { html: PAGE, edit: RIGHT_HALF });
  assert.match(style, /background-size: 200% 100%/);
  assert.match(style, /background-position: 100% 0%/);
  assert.doesNotMatch(style, /object-view-box/);
});
