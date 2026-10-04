// 画布上裁切图片（第 10 轮，Canva 式）：在图片元素节点旁边加一层覆盖层，显示整张源图的「幽灵」、裁切框和 8 个把手。
// 拖边角 = 改元素框（图片在画布上不动）；框内拖 = 移动源图；滚轮或滑条 = 以框中心缩放源图。
// 只改覆盖层并回调 onPreview / onCommit，不碰项目状态；元素节点本身由调用方按 patch 更新。
import { cropGeometry, normalizeCrop, imageSourceOfNode } from './render.js';

const sessions = new WeakMap();
export function isCropping(node) { return !!node && sessions.has(node); }

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
const MIN_BOX = 8;  // 裁切框最小边长（画板像素）
const MAX_ZOOM = 5; // 源图最多放大到「刚好盖住框」的 5 倍
const WHEEL_STEP = 1.1; // 滚轮每格缩放比例
const r4 = v => Math.round(v * 1e4) / 1e4;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 源图在元素框里的位置（框左上角为原点）：有 crop 按 crop 反推，没有按 fit 推
function initialImage(element, image) {
  const w = element.width, h = element.height, iw = image?.width, ih = image?.height;
  const geometry = cropGeometry(element);
  if (geometry) return { x: geometry.left, y: geometry.top, w: geometry.width, h: geometry.height };
  if (!(iw > 0 && ih > 0) || element.fit === 'fill') return { x: 0, y: 0, w, h };
  const s = element.fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  return { x: (w - iw * s) / 2, y: (h - ih * s) / 2, w: iw * s, h: ih * s };
}

export function startCrop(node, element, { image = null, scale = 1, onPreview, onCommit } = {}) {
  sessions.get(node)?.finish();
  const k = 1 / (Number(scale) || 1); // 屏幕 1px 对应的画板像素
  const rot = (Number(element.rotation) || 0) * Math.PI / 180, cos = Math.cos(rot), sin = Math.sin(rot);
  const x0 = Number(element.x) || 0, y0 = Number(element.y) || 0, w0 = Number(element.width) || 1, h0 = Number(element.height) || 1;
  const c0 = { x: x0 + w0 / 2, y: y0 + h0 / 2 };
  const original = { x: x0, y: y0, width: w0, height: h0, crop: normalizeCrop(element.crop) };
  // 局部坐标：原元素框左上角为原点、随元素旋转。框 B、源图 I 在里面都是轴对齐的矩形。
  const I = initialImage({ ...element, width: w0, height: h0 }, image);
  const B = { x: 0, y: 0, w: w0, h: h0 };
  if (I.x > 1e-6 || I.y > 1e-6 || I.x + I.w < w0 - 1e-6 || I.y + I.h < h0 - 1e-6) { // fit:contain：源图比框小，框收进源图
    const l = Math.ceil(Math.max(0, I.x) - 1e-6), t = Math.ceil(Math.max(0, I.y) - 1e-6);
    const r = Math.floor(Math.min(w0, I.x + I.w) + 1e-6), b = Math.floor(Math.min(h0, I.y + I.h) + 1e-6);
    Object.assign(B, { x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) });
  }
  const aspect = I.w / I.h; // 源图在画布上的宽高比不变（旧的拉伸裁切也照原样）
  const tint = typeof element.tint === 'string' && element.tint ? element.tint : null;
  const src = imageSourceOfNode(node) || node.querySelector('img')?.src || '';

  // ---------- 覆盖层：幽灵源图 + 裁切框（超大投影压暗框外）+ 把手 + 滑条 + 完成 ----------
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.dataset.cropFor = node.dataset.elementId || '';
  overlay.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${w0}px;height:${h0}px;transform:rotate(${element.rotation || 0}deg);transform-origin:center center;z-index:2147483000;touch-action:none;user-select:none;-webkit-user-select:none`;
  const ghost = document.createElement(tint ? 'div' : 'img');
  ghost.dataset.cropGhost = '';
  if (!tint) { ghost.src = src; ghost.draggable = false; ghost.alt = ''; ghost.decoding = 'sync'; }
  const frame = document.createElement('div');
  frame.dataset.cropFrame = '';
  for (const edge of Object.keys(HANDLES)) {
    const h = document.createElement('span'), [fx, fy] = HANDLES[edge];
    h.className = 'resize-handle'; h.dataset.cropHandle = edge;
    h.style.cssText = `position:absolute;left:${fx * 100}%;top:${fy * 100}%;right:auto;bottom:auto;width:${12 * k}px;height:${12 * k}px;transform:translate(-50%,-50%);box-sizing:border-box;cursor:${CURSOR[edge]}-resize;z-index:1`;
    frame.append(h);
  }
  const zoom = document.createElement('input');
  Object.assign(zoom, { type: 'range', min: '1', max: String(MAX_ZOOM), step: '0.01' });
  zoom.dataset.cropZoom = ''; zoom.setAttribute('aria-label', '缩放图片');
  zoom.style.cssText = 'position:absolute;left:-70px;top:-9px;width:140px;height:18px;margin:0;transform:rotate(-90deg);cursor:pointer;accent-color:var(--g-accent, #8f71d6)';
  const done = document.createElement('button');
  done.type = 'button'; done.className = 'g-btn'; done.dataset.cropDone = ''; done.textContent = '完成';
  done.style.cssText = 'position:absolute;right:0;top:0;white-space:nowrap';
  const zoomHolder = document.createElement('div'), doneHolder = document.createElement('div');
  zoomHolder.append(zoom); doneHolder.append(done);
  overlay.append(ghost, frame, zoomHolder, doneHolder);
  node.parentElement.append(overlay);

  const minW = () => Math.max(B.w, B.h * aspect); // 源图最小宽度：刚好盖住框
  function layout() {
    ghost.style.cssText = `position:absolute;left:${I.x}px;top:${I.y}px;width:${I.w}px;height:${I.h}px;max-width:none;max-height:none;display:block;pointer-events:none`;
    if (tint) {
      ghost.style.backgroundColor = tint;
      for (const p of ['', '-webkit-']) { ghost.style.setProperty(`${p}mask-image`, `url(${JSON.stringify(src)})`); ghost.style.setProperty(`${p}mask-size`, '100% 100%'); ghost.style.setProperty(`${p}mask-repeat`, 'no-repeat'); }
    }
    frame.style.cssText = `position:absolute;left:${B.x}px;top:${B.y}px;width:${B.w}px;height:${B.h}px;box-sizing:border-box;outline:${1.5 * k}px solid #fff;box-shadow:0 0 0 100000px rgba(18,16,28,0.5);cursor:move`;
    zoomHolder.style.cssText = `position:absolute;left:${B.x + B.w + 22 * k}px;top:${B.y + B.h / 2}px;width:0;height:0;transform:scale(${k});transform-origin:0 0`;
    doneHolder.style.cssText = `position:absolute;left:${B.x + B.w}px;top:${B.y + B.h + 10 * k}px;width:0;height:0;transform:scale(${k});transform-origin:0 0`;
    zoom.value = String(clamp(I.w / minW(), 1, MAX_ZOOM));
  }
  // 源图必须盖住框：先保证尺寸，再把位置夹进范围
  function containBox() {
    if (I.w < B.w || I.h < B.h) { const f = Math.max(B.w / I.w, B.h / I.h); I.w *= f; I.h *= f; }
    I.x = clamp(I.x, B.x + B.w - I.w, B.x); I.y = clamp(I.y, B.y + B.h - I.h, B.y);
  }
  // 当前状态 → 元素补丁：整数像素的框（旋转时按框中心换算回父级坐标）+ 4 位小数的 crop
  function patch() {
    const w = Math.round(B.w), h = Math.round(B.h);
    const lx = B.x + B.w / 2 - w0 / 2, ly = B.y + B.h / 2 - h0 / 2;
    const cx = c0.x + lx * cos - ly * sin, cy = c0.y + lx * sin + ly * cos;
    const x = clamp(r4((B.x - I.x) / I.w), 0, 1), y = clamp(r4((B.y - I.y) / I.h), 0, 1);
    const crop = { x, y, width: Math.min(r4(B.w / I.w), r4(1 - x)), height: Math.min(r4(B.h / I.h), r4(1 - y)) };
    return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h, crop };
  }
  let dirty = false, last = null;
  function preview() {
    layout(); dirty = true;
    const p = patch(), key = JSON.stringify(p);
    if (key === last) return;
    last = key;
    try { onPreview?.(p); } catch (error) { console.error(error); }
  }
  function zoomTo(factor) {
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
    const w = clamp(I.w * factor, minW(), minW() * MAX_ZOOM), f = w / I.w;
    I.x = cx - (cx - I.x) * f; I.y = cy - (cy - I.y) * f; I.w = w; I.h = w / aspect;
    containBox(); preview();
  }
  // 屏幕位移 → 局部位移（除以画板缩放，再转回元素的旋转）
  const toLocal = (dx, dy) => ({ x: (dx * cos + dy * sin) * k, y: (-dx * sin + dy * cos) * k });

  // ---------- 交互 ----------
  const controller = new AbortController(), signal = controller.signal;
  let drag = null;
  // 窗口捕获阶段先处理：覆盖层里的按下不交给画布（选中、框选、拖动）；覆盖层外的按下 = 完成，且照常生效
  window.addEventListener('pointerdown', e => {
    if (!overlay.contains(e.target)) { finish(true); return; }
    e.stopPropagation();
    if (e.button !== 0 || e.target === zoom || done.contains(e.target)) return;
    const edge = e.target.dataset?.cropHandle;
    if (!edge && !frame.contains(e.target)) return;
    e.preventDefault();
    drag = { edge, id: e.pointerId, sx: e.clientX, sy: e.clientY, B: { ...B }, I: { ...I } };
    try { overlay.setPointerCapture(e.pointerId); } catch { /* 没有真实指针时忽略 */ }
  }, { capture: true, signal });
  // 移动、松开在窗口捕获阶段听：指针拖出覆盖层（或指针捕获不可用）时照样跟随
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    const d = toLocal(e.clientX - drag.sx, e.clientY - drag.sy), b = drag.B, im = drag.I;
    if (!drag.edge) { // 移动源图，框不动，不露出空白
      I.x = clamp(im.x + d.x, B.x + B.w - I.w, B.x); I.y = clamp(im.y + d.y, B.y + B.h - I.h, B.y);
    } else { // 拖边角：改框（整数像素），不超出源图
      const [fx, fy] = HANDLES[drag.edge];
      let l = b.x, t = b.y, r = b.x + b.w, btm = b.y + b.h;
      if (fx === 0) l = clamp(Math.round(b.x + d.x), Math.ceil(im.x - 1e-6), r - MIN_BOX);
      if (fx === 1) r = clamp(Math.round(r + d.x), l + MIN_BOX, Math.floor(im.x + im.w + 1e-6));
      if (fy === 0) t = clamp(Math.round(b.y + d.y), Math.ceil(im.y - 1e-6), btm - MIN_BOX);
      if (fy === 1) btm = clamp(Math.round(btm + d.y), t + MIN_BOX, Math.floor(im.y + im.h + 1e-6));
      Object.assign(B, { x: l, y: t, w: r - l, h: btm - t });
    }
    preview();
  }, { capture: true, signal });
  const endDrag = e => { if (drag && e.pointerId === drag.id) { e.stopPropagation(); drag = null; } };
  window.addEventListener('pointerup', endDrag, { capture: true, signal });
  window.addEventListener('pointercancel', endDrag, { capture: true, signal });
  // 滚轮：只看方向，每格固定缩放 10%（不同系统、鼠标、触控板的 deltaY 大小和单位都不一样）
  overlay.addEventListener('wheel', e => { e.preventDefault(); e.stopPropagation(); if (e.deltaY) zoomTo(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP); }, { signal, passive: false });
  overlay.addEventListener('dblclick', e => { e.stopPropagation(); if (e.target !== zoom) finish(true); }, { signal });
  zoom.addEventListener('input', e => { e.stopPropagation(); zoomTo(Number(zoom.value) * minW() / I.w); }, { signal });
  done.addEventListener('click', e => { e.stopPropagation(); finish(true); }, { signal });
  // 键盘：裁切时不触发画布快捷键；Esc 完成
  const onKey = e => { e.stopPropagation(); if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); finish(true); } };
  window.addEventListener('keydown', onKey, { capture: true, signal });
  window.addEventListener('keyup', onKey, { capture: true, signal });

  let finished = false;
  function finish(commit = true) {
    if (finished) return;
    finished = true; controller.abort(); sessions.delete(node); overlay.remove();
    let result = null;
    if (commit && dirty) {
      result = patch();
      const same = original.crop && ['x', 'y', 'width', 'height'].every(key => result[key] === original[key] && Math.abs(result.crop[key] - original.crop[key]) < 5e-5);
      if (same) result = null;
    }
    try { onCommit?.(result); } catch (error) { console.error(error); }
  }
  // 取消：有过预览就先把原来的框与裁切交给 onPreview（调用方据此恢复节点），再 onCommit(null)
  function cancel() {
    if (finished) return;
    if (dirty) try { onPreview?.({ ...original }); } catch (error) { console.error(error); }
    finish(false);
  }

  layout();
  if (B.x !== 0 || B.y !== 0 || B.w !== w0 || B.h !== h0) preview(); // fit:contain 收框
  const session = { finish, cancel, get active() { return !finished; }, overlay };
  sessions.set(node, session);
  return session;
}
