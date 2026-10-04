// 第 10 轮图片裁切：格式校验、渲染几何（含增量更新与 tint）、画布裁切工具、「替换图片」选择弹窗。
// 只用临时数据目录和临时 home，浏览器测试都在独立页面里跑。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateProjectData } from '../src/validate.js';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';

const NOW = '2026-10-04T12:00:00.000Z';
const PROJECT_ID = 'crop-demo';
// 源图 400×200：左上红、右上绿、左下蓝、右下黄
async function quadrants() {
  const block = color => sharp({ create: { width: 200, height: 100, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 4, background: '#000000' } }).composite([
    { input: await block('#ff0000'), left: 0, top: 0 }, { input: await block('#00ff00'), left: 200, top: 0 },
    { input: await block('#0000ff'), left: 0, top: 100 }, { input: await block('#ffff00'), left: 200, top: 100 },
  ]).png().toBuffer();
}
function cropProject(crop = { x: 0.5, y: 0, width: 0.5, height: 0.5 }, extra = {}) {
  return {
    format: 'visual-workbench/project', formatVersion: 2, id: PROJECT_ID, name: '裁切', createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'custom', width: 1000, height: 700 },
    assets: [{ id: 'asset_quad01', kind: 'image', file: 'assets/quad.png', name: '四色', width: 400, height: 200, pendingLayout: false, addedAt: NOW }],
    fonts: [],
    pages: [{ id: 'page_crop01', name: '裁切', background: '#ffffff', elements: [
      { id: 'el_photo1', type: 'image', x: 100, y: 100, width: 200, height: 100, zIndex: 1, asset: 'asset_quad01', fit: 'cover', crop, ...extra },
    ] }],
  };
}

// ---------- 1. 校验 ----------
test('round10 crop: 校验接受合法裁切，拒绝越界、负数、零宽和多余字段', () => {
  for (const crop of [null, undefined, { x: 0, y: 0, width: 1, height: 1 }, { x: 0.5, y: 0.25, width: 0.5, height: 0.75 }, { x: 0.3333, y: 0.1, width: 0.6667, height: 0.2 }]) {
    const project = cropProject(crop);
    if (crop === undefined) delete project.pages[0].elements[0].crop;
    const result = validateProjectData(project);
    assert.equal(result.ok, true, `${JSON.stringify(crop)}: ${JSON.stringify(result.errors)}`);
  }
  const range = validateProjectData(cropProject({ x: 0.6, y: 0, width: 0.5, height: 0.5 }));
  assert.equal(range.ok, false);
  assert.deepEqual(range.errors.map(e => [e.code, e.path]), [['CROP_RANGE', '/pages/0/elements/0/crop']]);
  assert.equal(validateProjectData(cropProject({ x: 0, y: 0.7, width: 1, height: 0.4 })).errors[0].code, 'CROP_RANGE');
  for (const crop of [{ x: -0.1, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0, width: 0, height: 0.5 }, { x: 0, y: 0, width: 0.5, height: 1.2 },
    { x: 0, y: 0, width: 0.5 }, { x: 0, y: 0, width: 0.5, height: 0.5, scale: 2 }, '0,0,1,1']) {
    const result = validateProjectData(cropProject(crop));
    assert.equal(result.ok, false, JSON.stringify(crop));
    assert.ok(result.errors.some(e => e.code === 'SCHEMA'), JSON.stringify(result.errors));
  }
  // crop 只属于图片
  const project = cropProject();
  project.pages[0].elements.push({ id: 'el_box1', type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, zIndex: 0, fill: '#000000', crop: { x: 0, y: 0, width: 1, height: 1 } });
  assert.ok(validateProjectData(project).errors.some(e => e.code === 'SCHEMA'));
});

// ---------- 浏览器夹具 ----------
let dir, home, server, browser, url;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-round10-crop-')); home = mkdtempSync(join(tmpdir(), 'vw-round10-home-'));
  const projectDir = join(dir, 'projects', PROJECT_ID);
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  writeFileSync(join(projectDir, 'assets/quad.png'), await quadrants());
  writeFileSync(join(projectDir, 'assets/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="200" height="200" fill="#000"/></svg>');
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(cropProject()));
  server = createServer({ dataDir: dir, configHome: home });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(r => server.close(r));
  rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true });
});
async function blank(t, viewport = { width: 1000, height: 800 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 }); // 与 CI 的 Linux headless 一致：dpr 1
  t.after(() => page.close());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url}/vw-round10-blank`);
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}.resize-handle{position:absolute;background:#38bdf8}</style><div id="holder" style="position:absolute;left:40px;top:40px;transform:scale(0.5);transform-origin:0 0"></div>');
  return { page, errors };
}
// 取屏幕点 (x,y) 的颜色：截 3×3 的小块取中心，与设备像素比无关
const pixel = async (page, x, y) => {
  const { data, info } = await sharp(await page.screenshot({ clip: { x: x - 1, y: y - 1, width: 3, height: 3 } })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;
  return [...data.subarray(at, at + 3)];
};
const near = (a, b, tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// ---------- 2. 渲染 ----------
test('round10 crop: renderPage 按裁切定位内层图片，patchPage 复用同一个 <img>，tint 遮罩同几何', async t => {
  const { page, errors } = await blank(t);
  const project = cropProject();
  const r = await page.evaluate(async project => {
    const { renderPage, patchPage } = await import('/render.js');
    const options = { assetBase: '/data/projects/crop-demo' };
    const root = renderPage(project, project.pages[0], options);
    root.id = 'artboard'; document.getElementById('holder').append(root);
    const node = root.querySelector('[data-element-id="el_photo1"]'), img = node.querySelector('img');
    await img.decode();
    const style = el => ({ position: el.style.position, left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height, clip: el.style.clipPath, objectFit: el.style.objectFit });
    const first = style(img);
    const nodeOverflow = getComputedStyle(node).overflow;
    window.project = project; window.patch = crop => { project.pages[0].elements[0].crop = crop; patchPage(root, project, project.pages[0], options); return root.querySelector('[data-element-id="el_photo1"] img'); };
    const sameNode = window.patch({ x: 0.25, y: 0.5, width: 0.25, height: 0.5 }) === img;
    const second = style(img);
    const noCrop = style(window.patch(null));
    window.patch({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
    // tint + crop
    const tinted = renderPage({ ...project, assets: [...project.assets, { id: 'asset_logo01', kind: 'image', file: 'assets/logo.svg', name: 'logo', width: 400, height: 200, pendingLayout: false, addedAt: project.createdAt }] },
      { ...project.pages[0], elements: [{ ...project.pages[0].elements[0], id: 'el_logo1', asset: 'asset_logo01', tint: '#ff00ff', crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }] }, options);
    const mask = tinted.querySelector('[data-vw-tint]');
    return { first, sameNode, second, noCrop, nodeOverflow, tint: { ...style(mask), maskSize: mask.style.getPropertyValue('mask-size') || mask.style.getPropertyValue('-webkit-mask-size'), color: mask.style.backgroundColor } };
  }, project);
  assert.deepEqual(r.first, { position: 'absolute', left: '-200px', top: '0px', width: '400px', height: '200px', clip: 'inset(0px 0px 100px 200px)', objectFit: '' });
  assert.equal(r.sameNode, true);
  assert.deepEqual(r.second, { position: 'absolute', left: '-200px', top: '-100px', width: '800px', height: '200px', clip: 'inset(100px 400px 0px 200px)', objectFit: '' });
  assert.deepEqual(r.noCrop, { position: '', left: '', top: '', width: '100%', height: '100%', clip: '', objectFit: 'cover' });
  assert.equal(r.nodeOverflow, 'visible', '元素节点本身不剪裁，缩放把手不会被剪掉');
  assert.deepEqual(r.tint, { position: 'absolute', left: '-100px', top: '0px', width: '400px', height: '100px', clip: 'inset(0px 100px)', objectFit: '', maskSize: '100% 100%', color: 'rgb(255, 0, 255)' });
  // 画面：元素框 (100,100)-(300,200) 只显示右上的绿色；屏幕 = 40 + 0.5 × 画板坐标
  assert.ok(near(await pixel(page, 40 + 55, 40 + 55), [0, 255, 0]), '框内是绿色');
  assert.ok(near(await pixel(page, 40 + 145, 40 + 95), [0, 255, 0]), '框内是绿色');
  assert.ok(near(await pixel(page, 40 + 45, 40 + 75), [255, 255, 255]), '框外左边不画图片');
  assert.ok(near(await pixel(page, 40 + 100, 40 + 105), [255, 255, 255]), '框外下边不画图片');
  assert.deepEqual(errors, []);
});

// ---------- 3. 裁切工具 ----------
async function cropFixture(t, { crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, rotation = 0, width = 400, height = 200, noCapture = false } = {}) {
  const { page, errors } = await blank(t);
  await page.evaluate(async ({ project, noCapture }) => {
    // 模拟指针捕获不起作用的环境：拖出覆盖层后仍要跟随
    if (noCapture) Element.prototype.setPointerCapture = () => {};
    const { renderPage, updateElementNode } = await import('/render.js');
    window.mod = await import('/crop-tool.js');
    const root = renderPage(project, project.pages[0], { assetBase: '/data/projects/crop-demo' });
    root.id = 'artboard'; document.getElementById('holder').append(root);
    const node = root.querySelector('[data-element-id="el_photo1"]');
    await node.querySelector('img').decode();
    window.el = project.pages[0].elements[0];
    window.log = { previews: [], commits: [], windowKeys: [] };
    window.addEventListener('keydown', e => log.windowKeys.push(e.key));
    window.imgRect = () => { const r = node.querySelector('img').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    window.state = () => ({ x: el.x, y: el.y, width: el.width, height: el.height, crop: el.crop });
    window.begin = () => { window.session = mod.startCrop(node, el, { image: { width: 400, height: 200 }, scale: 0.5,
      onPreview: p => { log.previews.push(p); el = { ...el, ...p }; updateElementNode(node, el); },
      onCommit: p => log.commits.push(p) }); };
    begin();
  }, { project: cropProject(crop, { x: 100, y: 100, width, height, rotation }), noCapture });
  const center = async selector => { const b = await page.locator(selector).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  // 拖动：分 12 步走完，终点都在视口内（视口外的鼠标事件在部分平台上不送达）
  const drag = async (from, dx, dy) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 }); await page.mouse.up(); };
  return { page, errors, center, drag, log: () => page.evaluate(() => log), state: () => page.evaluate(() => state()), imgRect: () => page.evaluate(() => imgRect()) };
}
const closeRect = (a, b, tol = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('round10 crop tool: 覆盖层结构、把手按缩放补偿；拖右下角把手框变小、图片在画布上不动', async t => {
  const { page, errors, center, drag, log, state, imgRect } = await cropFixture(t);
  const overlay = await page.evaluate(() => {
    const o = document.querySelector('#artboard > .crop-overlay'), h = o.querySelector('[data-crop-handle="se"]');
    return { parent: o.parentElement.id, handles: o.querySelectorAll('.resize-handle[data-crop-handle]').length, done: !!o.querySelector('button.g-btn[data-crop-done]'),
      zoom: o.querySelector('input[type=range][data-crop-zoom]')?.value, size: h.style.width, ghost: o.querySelector('[data-crop-ghost]').style.cssText.match(/left: (-?\d+)px; top: (-?\d+)px; width: (\d+)px; height: (\d+)px/).slice(1).map(Number), cropping: mod.isCropping(document.querySelector('[data-element-id="el_photo1"]')) };
  });
  assert.deepEqual(overlay, { parent: 'artboard', handles: 8, done: true, zoom: '2', size: '24px', ghost: [-200, -100, 800, 400], cropping: true });
  const before = await imgRect();
  await drag(await center('[data-crop-handle="se"]'), -50, -25);
  assert.deepEqual(await state(), { x: 100, y: 100, width: 300, height: 150, crop: { x: 0.25, y: 0.25, width: 0.375, height: 0.375 } });
  assert.ok(closeRect(await imgRect(), before), `${await imgRect()} vs ${before}`);
  // 左上角往里拖：框的位置跟着变，图片仍不动
  await drag(await center('[data-crop-handle="nw"]'), 20, 10);
  assert.deepEqual(await state(), { x: 140, y: 120, width: 260, height: 130, crop: { x: 0.3, y: 0.3, width: 0.325, height: 0.325 } });
  assert.ok(closeRect(await imgRect(), before));
  // 往外拖超过源图：框停在源图边上
  await drag(await center('[data-crop-handle="se"]'), 600, 600);
  const s = await state();
  assert.equal(s.crop.x + s.crop.width, 1); assert.equal(s.crop.y + s.crop.height, 1);
  assert.deepEqual([s.x, s.y, s.width, s.height], [140, 120, 560, 280]);
  assert.ok(closeRect(await imgRect(), before));
  const l = await log();
  assert.ok(l.previews.every(p => [p.x, p.y, p.width, p.height].every(Number.isInteger) && Object.values(p.crop).every(v => Math.round(v * 1e4) / 1e4 === v)));
  assert.equal(l.commits.length, 0);
  assert.deepEqual(errors, []);
});

test('round10 crop tool: 框内拖动移动源图（框不动、不越界），滚轮以框中心放大', async t => {
  const { page, errors, center, drag, state } = await cropFixture(t, { noCapture: true });
  await drag(await center('[data-crop-frame]'), 40, 0); // 屏幕 40px = 画板 80px：源图右移
  assert.deepEqual(await state(), { x: 100, y: 100, width: 400, height: 200, crop: { x: 0.15, y: 0.25, width: 0.5, height: 0.5 } });
  // 远远拖过头（右上，终点仍在视口内）：源图左边、下边被夹在框边上，框不动
  await drag(await center('[data-crop-frame]'), 700, -125);
  const clamped = await state();
  assert.deepEqual([clamped.x, clamped.y, clamped.width, clamped.height], [100, 100, 400, 200]);
  assert.equal(clamped.crop.x, 0, '源图左边夹在框左边'); assert.equal(clamped.crop.y + clamped.crop.height, 1, '源图下边夹在框下边');
  assert.deepEqual(clamped.crop, { x: 0, y: 0.5, width: 0.5, height: 0.5 });
  await drag(await center('[data-crop-frame]'), -100, 50); // 回到中间
  assert.deepEqual((await state()).crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  const c = await center('[data-crop-frame]');
  await page.mouse.move(c.x, c.y); await page.mouse.wheel(0, -3); // 滚轮只看方向：一格放大 1.1 倍
  await page.waitForFunction(() => log.previews.at(-1)?.crop.width < 0.5);
  const zoomed = await state();
  assert.deepEqual([zoomed.x, zoomed.y, zoomed.width, zoomed.height], [100, 100, 400, 200]);
  assert.ok(Math.abs(zoomed.crop.width - 0.5 / 1.1) < 2e-4, JSON.stringify(zoomed.crop));
  assert.ok(Math.abs(zoomed.crop.x + zoomed.crop.width / 2 - 0.5) < 2e-4 && Math.abs(zoomed.crop.y + zoomed.crop.height / 2 - 0.5) < 2e-4, '以框中心缩放');
  assert.ok(Number(await page.locator('[data-crop-zoom]').inputValue()) > 1);
  // 缩小到底：源图刚好盖住框
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120); // 一格缩小 1/1.1，8 格后到底
  await page.waitForFunction(() => log.previews.at(-1)?.crop.width === 1);
  assert.deepEqual((await state()).crop, { x: 0, y: 0, width: 1, height: 1 });
  // 滑条放大
  await page.evaluate(() => { const z = document.querySelector('[data-crop-zoom]'); z.value = '2'; z.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.deepEqual((await state()).crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  assert.deepEqual(errors, []);
});

test('round10 crop tool: Esc 提交一次，键盘不冒泡到 window；cancel 恢复原状并 onCommit(null)', async t => {
  const { page, errors, center, drag, log, state, imgRect } = await cropFixture(t);
  await drag(await center('[data-crop-handle="e"]'), -50, 0);
  await page.keyboard.press('Delete'); await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  let l = await log();
  assert.deepEqual(l.commits, [{ x: 100, y: 100, width: 300, height: 200, crop: { x: 0.25, y: 0.25, width: 0.375, height: 0.5 } }]);
  assert.deepEqual(l.windowKeys, []);
  assert.equal(await page.locator('.crop-overlay').count(), 0);
  assert.equal(await page.evaluate(() => session.active || mod.isCropping(document.querySelector('[data-element-id="el_photo1"]'))), false);
  await page.keyboard.press('Escape'); await page.evaluate(() => session.finish());
  l = await log(); assert.equal(l.commits.length, 1); assert.deepEqual(l.windowKeys, ['Escape']);

  // 没改就完成：null；改了再取消：节点恢复、null
  await page.evaluate(() => begin()); await page.keyboard.press('Escape');
  assert.equal((await log()).commits.at(-1), null);
  const original = await state(), rect = await imgRect();
  await page.evaluate(() => begin());
  await drag(await center('[data-crop-frame]'), 30, 20); await drag(await center('[data-crop-handle="s"]'), 0, -20);
  assert.notDeepEqual(await state(), original);
  await page.evaluate(() => session.cancel());
  assert.deepEqual(await state(), original);
  assert.ok(closeRect(await imgRect(), rect, 0.01));
  assert.equal((await log()).commits.at(-1), null); assert.equal((await log()).commits.length, 3);
  assert.equal(await page.locator('.crop-overlay').count(), 0);
  // 点覆盖层外 = 完成；「完成」按钮也提交
  await page.evaluate(() => begin()); await drag(await center('[data-crop-frame]'), 10, 0);
  await page.mouse.click(990, 790);
  assert.equal((await log()).commits.length, 4); assert.ok((await log()).commits[3].crop.x < original.crop.x);
  await page.evaluate(() => begin()); await drag(await center('[data-crop-frame]'), -10, 0);
  await page.locator('[data-crop-done]').click();
  assert.equal((await log()).commits.length, 5); assert.deepEqual((await log()).commits[4].crop, original.crop);
  assert.deepEqual(errors, []);
});

test('round10 crop tool: 旋转的元素覆盖层跟着旋转，拖把手后图片仍不动', async t => {
  const { page, errors, center, drag, state, imgRect } = await cropFixture(t, { rotation: 90, noCapture: true });
  assert.equal(await page.evaluate(() => document.querySelector('.crop-overlay').style.transform), 'rotate(90deg)');
  const before = await imgRect();
  await drag(await center('[data-crop-handle="e"]'), 0, -40); // 旋转 90° 后「右边」朝下
  const s = await state();
  assert.equal(s.width, 320); assert.equal(s.height, 200);
  assert.deepEqual(s.crop, { x: 0.25, y: 0.25, width: 0.4, height: 0.5 });
  assert.deepEqual([s.x, s.y], [140, 60]);
  assert.ok(closeRect(await imgRect(), before), `${await imgRect()} vs ${before}`);
  assert.deepEqual(errors, []);
});

// ---------- 4. 替换图片弹窗 ----------
test('round10 image picker: 本项目素材、公共素材库、上传各自返回正确结果，取消与点遮罩返回 null', async t => {
  const { page, errors } = await blank(t);
  await page.evaluate(async () => {
    const { pickImage } = await import('/image-picker.js');
    const root = document.createElement('div'); root.id = 'modal-root'; document.body.append(root);
    const closeModal = () => root.replaceChildren();
    const modal = html => {
      root.innerHTML = `<div class="modal-backdrop g-backdrop" style="position:fixed;inset:0"><div class="g-sheet" role="dialog">${html}</div></div>`;
      root.querySelector('.modal-backdrop').onpointerdown = e => { if (e.target === e.currentTarget) closeModal(); };
    };
    window.apiCalls = [];
    const api = async path => { apiCalls.push(path); return [{ name: '库图', file: 'lib-a.png', url: '/data/projects/crop-demo/assets/quad.png', width: 400, height: 200, mime: 'image/png' }, { name: '文档', file: 'x.txt', url: '/x.txt', mime: 'text/plain' }]; };
    const projectAssets = [{ id: 'asset_quad01', kind: 'image', file: 'assets/quad.png', name: '四色', width: 400, height: 200 }, { id: 'asset_font', file: 'assets/a.ttf', name: '字体' }];
    window.open = () => { window.result = undefined; pickImage({ modal, closeModal, api, projectAssets, assetBase: '/data/projects/crop-demo' }).then(r => { window.result = r?.kind === 'upload' ? { kind: 'upload', name: r.file.name, isFile: r.file instanceof File } : r; }); };
  });
  const result = () => page.waitForFunction(() => window.result !== undefined).then(() => page.evaluate(() => window.result));
  const open = () => page.evaluate(() => window.open());
  // 本项目素材：只列图片
  await open();
  assert.equal(await page.locator('[data-pick]').count(), 1);
  assert.equal(await page.locator('.g-seg [data-picker-tab].active').textContent(), '本项目素材');
  await page.locator('[data-pick="asset:asset_quad01"]').click();
  assert.deepEqual(await result(), { kind: 'asset', id: 'asset_quad01' });
  assert.equal(await page.locator('[data-image-picker]').count(), 0);
  // 公共素材库
  await open();
  await page.locator('[data-picker-tab="library"]').click();
  await page.locator('[data-pick="library:lib-a.png"]').click();
  assert.deepEqual(await result(), { kind: 'library', file: 'lib-a.png', width: 400, height: 200 });
  assert.deepEqual(await page.evaluate(() => apiCalls), ['/api/library']);
  // 上传
  await open();
  assert.equal(await page.locator('[data-picker-file]').getAttribute('accept'), 'image/*');
  await page.locator('[data-picker-file]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: await quadrants() });
  assert.deepEqual(await result(), { kind: 'upload', name: 'new.png', isFile: true });
  // 取消 / 点遮罩
  await open(); await page.locator('[data-picker-cancel]').click();
  assert.equal(await result(), null); assert.equal(await page.locator('[data-image-picker]').count(), 0);
  await open(); await page.mouse.click(5, 5);
  assert.equal(await result(), null);
  assert.deepEqual(errors, []);
});
