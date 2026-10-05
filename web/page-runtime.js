/* 视觉工作台 · 页面运行时（第 12 轮）
 * 自包含的经典脚本：不 import、不 export。两种用法：
 * 1) 注入每页 iframe 的 <head> 最前（<script data-vw-runtime>），提供 window.vw；由 vw.__boot(cfg) 启动。
 * 2) 父页面以 <script src="/page-runtime.js"> 加载一次，暴露 window.__vwRuntime = { applyEditsToDocument, VERSION }（缩略图用）。
 * 约定见 docs/round12-contract.md §1–§4，修改单格式见 docs/format.md §7。
 * 父页面只用 postMessage 和页面说话（{ vw: '<type>', … }）。
 */
(function () {
  'use strict';
  const VERSION = '12.0.0';
  const CAPS = ['text', 'move', 'resize', 'color', 'background', 'crop'];
  const USER_PREFIX = 'u_';
  const USER_CAPS = ['move', 'resize', 'crop'];
  const KIND_CAP = { text: 'text', fontSize: 'text', move: 'move', resize: 'resize', color: 'color', background: 'background', crop: 'crop' };
  const r2 = v => Math.round(Number(v) * 100) / 100;
  const r4 = v => Math.round(v * 1e4) / 1e4;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isUser = id => typeof id === 'string' && id.startsWith(USER_PREFIX);
  const num = v => typeof v === 'number' && Number.isFinite(v);

  // ---------- 标记与能力 ----------
  function capsOf(el) {
    if (!el || el.nodeType !== 1) return [];
    const id = el.getAttribute('data-vw-id');
    if (!id) return [];
    if (isUser(id) && el.hasAttribute('data-vw-user')) return USER_CAPS.slice();
    return String(el.getAttribute('data-vw') || '').split(/[\s,]+/).filter(c => CAPS.includes(c));
  }
  function findTarget(doc, id) {
    for (const el of doc.querySelectorAll('[data-vw-id]')) if (el.getAttribute('data-vw-id') === id) return el;
    return null;
  }
  function listMarks(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('[data-vw-id]')) { const caps = capsOf(el); if (caps.length) out.push({ id: el.getAttribute('data-vw-id'), caps }); }
    return out;
  }

  // ---------- 修改单：记原样、叠加、恢复 ----------
  // 每个文档一份状态：originals（每目标每种修改叠加前的行内原样）、applied（当前叠上的 after）、befores（修改单里的 before）、users（用户贴的图）
  const STATES = new WeakMap();
  function stateOf(doc) {
    let s = STATES.get(doc);
    if (!s) { s = { originals: new Map(), applied: new Map(), befores: new Map(), users: new Map() }; STATES.set(doc, s); }
    return s;
  }
  const slot = (map, el) => { let m = map.get(el); if (!m) { m = {}; map.set(el, m); } return m; };
  const BG = ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'];
  // 裁切：原生用 object-view-box；兼容方案（Safari 等）用同一张图做背景、把 <img> 自己的画面挪出框外（见 applyCrop）
  const CROP_FALLBACK_PROPS = ['object-position', 'background-image', 'background-repeat', 'background-size', 'background-position', 'background-origin', 'background-clip'];
  const STYLE_PROPS = { fontSize: ['font-size'], move: ['translate', '--vw-dx', '--vw-dy'], resize: ['width', 'height'], color: ['color'], background: BG, crop: ['object-fit', 'object-view-box'].concat(CROP_FALLBACK_PROPS) };
  function snapshot(el, kind) {
    if (kind === 'text') return { html: el.innerHTML };
    const out = {};
    for (const p of STYLE_PROPS[kind] || []) out[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    return out;
  }
  function restoreSnapshot(el, kind, snap) {
    if (!snap) return;
    if (kind === 'text') { if (el.innerHTML !== snap.html) el.innerHTML = snap.html; return; }
    if (kind === 'background') el.style.removeProperty('background');
    if (kind === 'crop') dropCropFallback(el);
    for (const p of Object.keys(snap)) { const [v, pr] = snap[p]; if (v) el.style.setProperty(p, v, pr); else el.style.removeProperty(p); }
  }
  function saveOriginal(st, el, kind) { const o = slot(st.originals, el); if (!(kind in o)) o[kind] = snapshot(el, kind); }
  function validAfter(kind, a) {
    if (!a || typeof a !== 'object') return false;
    switch (kind) {
      case 'text': return typeof a.html === 'string' || typeof a.text === 'string';
      case 'fontSize': return num(a.fontSize) && a.fontSize > 0;
      case 'move': return num(a.dx ?? 0) && num(a.dy ?? 0);
      case 'resize': return (a.width == null || (num(a.width) && a.width >= 0)) && (a.height == null || (num(a.height) && a.height >= 0));
      case 'color': return typeof a.color === 'string' && !!a.color;
      case 'background': return typeof a.background === 'string' && !!a.background;
      case 'crop': return a.crop === null || (a.crop && ['x', 'y', 'width', 'height'].every(k => num(a.crop[k])) && a.crop.width > 0 && a.crop.height > 0);
      default: return false;
    }
  }
  const pct = v => `${r4(v * 100)}%`;
  const insetOf = c => `inset(${pct(c.y)} ${pct(Math.max(0, 1 - c.x - c.width))} ${pct(Math.max(0, 1 - c.y - c.height))} ${pct(c.x)})`;
  function applyKind(el, kind, a) {
    const s = el.style;
    switch (kind) {
      case 'text': if (typeof a.html === 'string') { if (el.innerHTML !== a.html) el.innerHTML = a.html; } else el.textContent = String(a.text ?? ''); break;
      case 'fontSize': s.setProperty('font-size', `${a.fontSize}px`); break;
      case 'move': s.setProperty('--vw-dx', `${a.dx || 0}px`); s.setProperty('--vw-dy', `${a.dy || 0}px`); s.setProperty('translate', 'var(--vw-dx, 0px) var(--vw-dy, 0px)'); break;
      case 'resize': if (a.width != null) s.setProperty('width', `${a.width}px`); if (a.height != null) s.setProperty('height', `${a.height}px`); break;
      case 'color': s.setProperty('color', a.color); break;
      case 'background': s.setProperty('background', a.background); break;
      case 'crop': if (a.crop) applyCrop(el, a.crop); else { s.removeProperty('object-view-box'); dropCropFallback(el); } break;
    }
  }

  // ---------- 裁切的兼容方案（不支持 object-view-box 的浏览器，例如 Safari；或 cropFallback:true 强制） ----------
  // 不包裹节点、不换 src、不改元素框：<img> 照常加载原图（固有尺寸、布局都不变），用 object-position 把它自己的画面挪出框外（替换元素的内容按框裁掉），
  // 再把同一张图作为背景，按 object-view-box + object-fit:cover 的算法摆好：裁切区域按 cover 缩放、居中。
  // 尺寸变化（拉宽、动效改 width）时由 ResizeObserver 重算；图还没加载完（不知道原图尺寸）或在 DOMParser 文档里（缩略图，没有排版）时，
  // 先按比例写（框和裁切区域比例相同时与原生完全一致）。
  const BLANK_POSITION = '-100000px -100000px';
  const CROPS = new WeakMap(); // el → crop
  const nativeCrop = () => { try { return typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('object-view-box', 'inset(0%)'); } catch (error) { return false; } };
  const useCropFallback = el => !!stateOf(el.ownerDocument).cropFallback || !nativeCrop();
  const cssUrl = url => `url("${String(url).replace(/["\\\n]/g, c => (c === '\n' ? '' : `\\${c}`))}")`;
  function applyCrop(el, crop) {
    const s = el.style;
    s.setProperty('object-fit', 'cover');
    if (!useCropFallback(el)) { s.setProperty('object-view-box', insetOf(crop)); return; }
    s.removeProperty('object-view-box');
    CROPS.set(el, crop);
    const src = el.currentSrc || el.getAttribute('src') || '';
    s.setProperty('object-position', BLANK_POSITION);
    s.setProperty('background-image', cssUrl(src));
    s.setProperty('background-repeat', 'no-repeat');
    s.setProperty('background-origin', 'content-box');
    s.setProperty('background-clip', 'content-box');
    layoutCrop(el);
    watchCrop(el);
  }
  function layoutCrop(el) {
    const c = CROPS.get(el);
    if (!c) return;
    const view = el.ownerDocument.defaultView;
    const nw = el.naturalWidth, nh = el.naturalHeight;
    let size = '', position = '';
    if (view && nw > 0 && nh > 0 && el.isConnected) {
      const cs = view.getComputedStyle(el);
      const W = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const H = el.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      if (W > 0 && H > 0) {
        const vw = c.width * nw, vh = c.height * nh, k = Math.max(W / vw, H / vh);
        const bw = nw * k, bh = nh * k;
        size = `${r4(bw)}px ${r4(bh)}px`;
        position = `${r4((W - vw * k) / 2 - c.x * bw)}px ${r4((H - vh * k) / 2 - c.y * bh)}px`;
      }
    }
    if (!size) {
      const along = (o, w) => (w < 1 ? pct(clamp(o / (1 - w), 0, 1)) : '0%');
      size = `${pct(1 / c.width)} ${pct(1 / c.height)}`;
      position = `${along(c.x, c.width)} ${along(c.y, c.height)}`;
    }
    if (el.style.getPropertyValue('background-size') !== size) el.style.setProperty('background-size', size);
    if (el.style.getPropertyValue('background-position') !== position) el.style.setProperty('background-position', position);
  }
  function watchCrop(el) {
    const view = el.ownerDocument.defaultView;
    if (!view) return;
    const st = stateOf(el.ownerDocument);
    if (!st.cropObserver && typeof view.ResizeObserver === 'function') st.cropObserver = new view.ResizeObserver(entries => { for (const entry of entries) layoutCrop(entry.target); });
    if (st.cropObserver) st.cropObserver.observe(el);
    if (!el.__vwCropLoad) { el.__vwCropLoad = () => { if (CROPS.has(el)) { el.style.setProperty('background-image', cssUrl(el.currentSrc || el.getAttribute('src') || '')); layoutCrop(el); } }; el.addEventListener('load', el.__vwCropLoad); }
  }
  function dropCropFallback(el) {
    if (!CROPS.has(el)) return;
    CROPS.delete(el);
    const st = stateOf(el.ownerDocument);
    if (st.cropObserver) st.cropObserver.unobserve(el);
    if (el.__vwCropLoad) { el.removeEventListener('load', el.__vwCropLoad); delete el.__vwCropLoad; }
  }
  function createUserImage(doc, id) {
    const img = doc.createElement('img');
    img.setAttribute('data-vw-id', id);
    img.setAttribute('data-vw-user', '');
    img.setAttribute('data-vw', USER_CAPS.join(' '));
    img.setAttribute('alt', '');
    img.setAttribute('draggable', 'false');
    (doc.body || doc.documentElement).appendChild(img);
    return img;
  }
  function placeUserImage(img, a, url) {
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    img.style.cssText = `position:absolute;left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px;margin:0;padding:0;border:0;max-width:none;max-height:none;display:block;box-sizing:border-box;z-index:2147483000`;
  }

  /**
   * 把整份修改单叠到文档上（DOMParser 文档和真文档都能用）。可重复调用：先恢复不再需要的，再叠新的；没变的不碰（不重建节点）。
   * opts.assets：素材编号 → 图片地址（用户贴的图用）。对不上的条目跳过不报错，返回 { skipped: [条目编号] }。
   */
  function applyEditsToDocument(doc, edits, opts) {
    opts = opts || {};
    const st = stateOf(doc);
    if (opts.cropFallback !== undefined) st.cropFallback = !!opts.cropFallback;
    const assets = opts.assets || {};
    const list = Array.isArray(edits) ? edits.filter(e => e && typeof e === 'object' && typeof e.target === 'string') : [];
    const skipped = [];
    const wanted = new Map();
    for (const e of list) {
      if (e.kind !== 'addImage') continue;
      const a = e.after;
      if (isUser(e.target) && a && assets[a.asset] && ['x', 'y', 'width', 'height'].every(k => num(a[k]))) wanted.set(e.target, e); else skipped.push(e.id);
    }
    for (const [id, el] of [...st.users]) if (!wanted.has(id)) { el.remove(); st.users.delete(id); st.applied.delete(el); st.originals.delete(el); st.befores.delete(el); }
    for (const [id, e] of wanted) {
      let el = st.users.get(id);
      if (el && !same(st.applied.get(el)?.addImage, e.after)) { st.applied.delete(el); st.originals.delete(el); st.befores.delete(el); }
      if (!el || !el.isConnected) { el = createUserImage(doc, id); st.users.set(id, el); }
      if (!st.applied.get(el)?.addImage) { placeUserImage(el, e.after, assets[e.after.asset]); slot(st.applied, el).addImage = e.after; }
    }
    const desired = new Map();
    for (const e of list) {
      if (e.kind === 'addImage') continue;
      if (!(e.kind in KIND_CAP)) { skipped.push(e.id); continue; }
      const el = isUser(e.target) ? st.users.get(e.target) : findTarget(doc, e.target);
      if (!el || !capsOf(el).includes(KIND_CAP[e.kind]) || !validAfter(e.kind, e.after)) { skipped.push(e.id); continue; }
      if (e.kind === 'crop' && String(el.tagName).toLowerCase() !== 'img') { skipped.push(e.id); continue; }
      slot(desired, el)[e.kind] = e;
    }
    for (const [el, kinds] of st.applied) for (const kind of Object.keys(kinds)) {
      if (kind === 'addImage' || desired.get(el)?.[kind]) continue;
      restoreSnapshot(el, kind, st.originals.get(el)?.[kind]);
      delete kinds[kind];
      const b = st.befores.get(el); if (b) delete b[kind];
    }
    for (const [el, kinds] of desired) for (const kind of Object.keys(kinds)) {
      const e = kinds[kind];
      const applied = slot(st.applied, el);
      if (e.before !== undefined && e.before !== null) slot(st.befores, el)[kind] = e.before;
      if (kind in applied && same(applied[kind], e.after)) continue;
      saveOriginal(st, el, kind);
      if (kind === 'crop' && !e.after.crop) restoreSnapshot(el, kind, st.originals.get(el)[kind]);
      else applyKind(el, kind, e.after);
      applied[kind] = e.after;
    }
    return { skipped };
  }

  const api = { applyEditsToDocument, VERSION };
  const script = document.currentScript;
  const injected = !!(script && script.hasAttribute('data-vw-runtime'));
  if (!injected) { window.__vwRuntime = api; return; }

  // =====================================================================
  // 以下只在页面 iframe 里运行
  // =====================================================================
  const doc = document;
  const STATE = stateOf(doc);
  let cfg = null;
  let mode = null;
  let applied = false;
  const post = (msg, transfer) => {
    if (window.parent === window) return;
    try { window.parent.postMessage(msg, '*', transfer || []); } catch (error) { /* 父页面已关闭 */ }
  };
  function describe(error) {
    if (error && typeof error === 'object') return { message: `${error.name || 'Error'}: ${error.message}`, stack: String(error.stack || '') };
    return { message: String(error), stack: '' };
  }
  const postError = (error, phase) => post(Object.assign({ vw: 'error', phase }, describe(error)));
  const contentHeight = () => Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
  const assetsMap = () => (cfg && cfg.assets) || {};

  function applyNow() {
    if (applied || !cfg) return;
    applied = true;
    try { applyEditsToDocument(doc, cfg.edits || [], { assets: assetsMap() }); }
    catch (error) { postError(error, 'edits'); }
  }

  // 页面坐标里的框
  function pageRect(el) { const r = el.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; }
  const moveOf = el => STATE.applied.get(el)?.move || { dx: 0, dy: 0 };
  const cropOf = el => STATE.applied.get(el)?.crop?.crop || null;
  function toHex(value) {
    const m = String(value || '').match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/i);
    // 修改单里的颜色只接受 #rrggbb / #rrggbbaa（schema）：getComputedStyle 的 rgb()/rgba()/transparent 一律转过来
    if (/^\s*transparent\s*$/i.test(String(value || ''))) return '#00000000';
    if (!m) return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : '#000000';
    const h = v => clamp(Math.round(Number(v)), 0, 255).toString(16).padStart(2, '0');
    let hex = `#${h(m[1])}${h(m[2])}${h(m[3])}`;
    if (m[4] !== undefined) { const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]); if (a < 1) hex += h(a * 255); }
    return hex;
  }
  function cssSize(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const w = parseFloat(cs.width), h = parseFloat(cs.height);
    return { width: Number.isFinite(w) ? w : r.width, height: Number.isFinite(h) ? h : r.height };
  }
  function currentValue(el, kind) {
    const cs = getComputedStyle(el);
    switch (kind) {
      case 'text': return { html: el.innerHTML, text: el.textContent };
      case 'fontSize': return { fontSize: r2(parseFloat(cs.fontSize) || 0) };
      case 'move': { const m = moveOf(el), r = pageRect(el); return { x: r2(r.x - m.dx), y: r2(r.y - m.dy), width: r2(r.width), height: r2(r.height) }; }
      case 'resize': { const s = cssSize(el); return { width: r2(s.width), height: r2(s.height) }; }
      case 'color': return { color: toHex(cs.color) };
      case 'background': return { background: toHex(cs.backgroundColor) };
      case 'crop': return { crop: cropOf(el) };
    }
    return null;
  }
  // 第一次改之前的原样：已有修改单条目时用条目里的 before
  function beforeOf(el, kind) {
    const b = slot(STATE.befores, el);
    if (!(kind in b)) b[kind] = currentValue(el, kind);
    return b[kind];
  }
  function isNoop(kind, before, after) {
    if (kind === 'move') return r2(after.dx) === 0 && r2(after.dy) === 0;
    if (kind === 'crop') return !after.crop;
    return same(before, after);
  }
  // 运行时自己叠一个修改（拖动中也调用：live=true 只叠不发）
  function setLive(el, kind, after) {
    saveOriginal(STATE, el, kind);
    if (kind === 'crop' && !after.crop) restoreSnapshot(el, kind, STATE.originals.get(el)[kind]);
    else if (kind !== 'text') applyKind(el, kind, after);
    slot(STATE.applied, el)[kind] = after;
  }
  // 记一个修改并告诉父页面
  function commit(el, kind, after) {
    const target = el.getAttribute('data-vw-id');
    const before = beforeOf(el, kind);
    setLive(el, kind, after);
    post({ vw: 'edit', target, kind, before, after });
    if (isNoop(kind, before, after)) { delete slot(STATE.applied, el)[kind]; delete slot(STATE.befores, el)[kind]; }
  }

  // ---------- 动效（play 模式） ----------
  let handlers = null;
  let registeredResolve;
  const registered = new Promise(resolve => { registeredResolve = resolve; });
  let motion = null; // { controller, ctx, nextStep, total, fast, busy, current, ready }
  const ANIME_FACTORIES = ['animate', 'createTimeline', 'createTimer'];
  const isAnime = m => !!m && typeof m === 'object' && !!m.engine && ANIME_FACTORIES.every(n => typeof m[n] === 'function');
  function finite(animation) { const end = animation.effect?.getComputedTiming?.().endTime; return Number.isFinite(end); }
  function completeAnime(instance) {
    if (!instance || instance.completed || typeof instance.complete !== 'function') return;
    if (!Number.isFinite(instance.iterationCount) || !Number.isFinite(instance.duration)) return;
    try { instance.complete(); } catch (error) { /* 已结束 */ }
  }
  function finishAnimations() {
    if (typeof doc.getAnimations !== 'function') return;
    for (const a of doc.getAnimations()) { if (a.playState === 'finished' || !finite(a)) continue; try { a.finish(); } catch (error) { /* 无法结束 */ } }
  }
  function createContext(state) {
    const controller = state.controller, signal = controller.signal;
    const animations = new Set(), animeInstances = new Set(), wrapped = new WeakMap();
    const abortError = () => signal.reason || new DOMException('已取消', 'AbortError');
    const trackAnime = instance => {
      if (!state.fast || !instance || typeof instance.complete !== 'function') return instance;
      animeInstances.add(instance);
      queueMicrotask(() => completeAnime(instance));
      setTimeout(() => { completeAnime(instance); animeInstances.delete(instance); }, 0);
      return instance;
    };
    const wrapModule = mod => {
      if (!isAnime(mod)) return mod;
      if (!wrapped.has(mod)) {
        const w = Object.assign({}, mod);
        for (const name of ANIME_FACTORIES) w[name] = (...args) => trackAnime(mod[name](...args));
        if (mod.waapi && typeof mod.waapi.animate === 'function') w.waapi = Object.assign({}, mod.waapi, { animate: (...args) => trackAnime(mod.waapi.animate(...args)) });
        wrapped.set(mod, Object.freeze(w));
      }
      return wrapped.get(mod);
    };
    signal.addEventListener('abort', () => { for (const a of animations) { try { a.cancel(); } catch (error) { /* 忽略 */ } } animations.clear(); animeInstances.clear(); }, { once: true });
    state.finishAll = () => { finishAnimations(); for (const i of animeInstances) completeAnime(i); animeInstances.clear(); };
    return {
      root: doc.body, signal,
      get step() { return state.ctxStep; },
      get fast() { return state.fast; },
      animate(node, keyframes, options) {
        if (signal.aborted) return Promise.reject(abortError());
        if (!node || typeof node.animate !== 'function') throw new Error('animate 需要可动画的 DOM 节点');
        const animation = node.animate(keyframes, options);
        animations.add(animation);
        if (state.fast) { if (!finite(animation)) return Promise.resolve(animation); try { animation.finish(); } catch (error) { /* 忽略 */ } }
        return animation.finished;
      },
      timer(ms) {
        if (!Number.isFinite(ms) || ms < 0) throw new Error('timer(ms) 必须是非负有限数');
        return new Promise((resolve, reject) => {
          if (signal.aborted) return reject(abortError());
          if (state.fast) return resolve();
          const id = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
          function cancel() { clearTimeout(id); reject(abortError()); }
          signal.addEventListener('abort', cancel, { once: true });
        });
      },
      async importModule(path) {
        if (typeof path !== 'string' || !path) throw new Error('importModule 需要模块路径');
        const exported = window.__VW_EXPORT__;
        if (exported && typeof exported.importModule === 'function') return wrapModule(await exported.importModule(path));
        return wrapModule(await import(new URL(path, doc.baseURI).href));
      }
    };
  }
  // 页面脚本里写了 vw.motion，或有外部模块脚本：多等一会儿它登记
  const pageMentionsMotion = () => [...doc.scripts].some(s => !s.hasAttribute('data-vw-runtime') && !s.hasAttribute('data-vw-boot') && (/\bvw\s*\??\.\s*motion\b/.test(s.textContent || '') || (!!s.src && s.type === 'module')));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const loaded = new Promise(resolve => { if (doc.readyState === 'complete') resolve(); else window.addEventListener('load', () => resolve(), { once: true }); });

  // opts.edit：编辑画布的「第 N 屏」——快进跑 init 和 step 0 … target-1 后停住（不 dispose，不报「没登记 step」，快进一直开着）
  function startPlay(opts) {
    opts = opts || {};
    const total = Math.max(0, Number(cfg.steps) || 0);
    const state = { controller: new AbortController(), nextStep: 0, total, fast: !!cfg.fast || !!opts.edit, edit: !!opts.edit, target: opts.edit ? clamp(Number(opts.target) || 0, 0, total) : total, busy: false, current: Promise.resolve(), ctxStep: -1, inited: false, finishAll: () => {} };
    motion = state;
    state.ctx = createContext(state);
    const runStep = async index => {
      state.ctxStep = index;
      try { await handlers.step(index, state.ctx); }
      catch (error) { if (!state.controller.signal.aborted) postError(error, `step ${index + 1}`); }
      if (state.fast) state.finishAll();
      state.nextStep = index + 1;
    };
    state.runStep = runStep;
    state.ready = (async () => {
      await loaded;
      if (!handlers) {
        const wait = state.total > 0 && !state.edit ? (Number(cfg.timeout) || 5000) : (pageMentionsMotion() ? Math.min(Number(cfg.timeout) || 5000, 2000) : 0);
        if (wait) await Promise.race([registered, delay(wait)]);
      }
      if (state.controller.signal.aborted) return;
      if (handlers) {
        for (const name of ['init', 'step', 'leave', 'dispose']) if (handlers[name] !== undefined && typeof handlers[name] !== 'function') postError(new Error(`vw.motion 的 ${name} 必须是函数`), 'init');
      }
      if (state.total > 0 && (!handlers || typeof handlers.step !== 'function')) {
        if (state.edit) { state.nextStep = state.total; return; }
        postError(new Error(`这一页的 motion.steps 是 ${state.total}，但页面没有用 vw.motion 登记 step`), 'init');
        state.nextStep = state.total;
      }
      if (handlers && typeof handlers.init === 'function') {
        state.inited = true;
        try { await handlers.init(state.ctx); } catch (error) { if (!state.controller.signal.aborted) postError(error, 'init'); }
      }
      if (state.fast) {
        state.finishAll();
        while (state.nextStep < state.target && !state.controller.signal.aborted) await runStep(state.nextStep);
        state.finishAll();
        if (!state.edit) state.fast = false;
      }
    })();
    // 登记晚于等待时限：补跑 init
    registered.then(async () => {
      await state.ready;
      if (state.edit) return; // 编辑画布：屏已经定了，不再改画面
      if (!state.inited && handlers && typeof handlers.init === 'function' && !state.controller.signal.aborted) {
        state.inited = true;
        try { await handlers.init(state.ctx); } catch (error) { postError(error, 'init'); }
      }
    });
    return state.ready;
  }
  function stopPlay() {
    if (!motion) return;
    const state = motion; motion = null;
    state.controller.abort(new DOMException('已离开', 'AbortError'));
    try { const r = handlers && typeof handlers.dispose === 'function' ? handlers.dispose() : null; if (r && typeof r.then === 'function') r.catch(error => postError(error, 'dispose')); }
    catch (error) { postError(error, 'dispose'); }
  }
  function queue(state, fn) {
    const run = state.current.then(fn, fn);
    state.current = run.catch(() => {});
    return run;
  }
  // 编辑画布里的动效停在某一屏：不响应 step / toEnd / leave（直接回复，免得父页面一直等）
  const frozen = () => !motion || motion.edit || mode !== 'play';
  async function playStep() {
    const state = motion;
    if (frozen()) { post({ vw: 'step-done', nextStep: state ? state.nextStep : 0, total: state ? state.total : Math.max(0, Number(cfg.steps) || 0), frozen: true }); return; }
    await state.ready;
    await queue(state, async () => { if (state.nextStep < state.total) await state.runStep(state.nextStep); });
    post({ vw: 'step-done', nextStep: state.nextStep, total: state.total });
  }
  async function playToEnd() {
    const state = motion;
    if (frozen()) { post({ vw: 'step-done', nextStep: state ? state.nextStep : 0, total: state ? state.total : Math.max(0, Number(cfg.steps) || 0), frozen: true }); return; }
    state.fast = true; state.finishAll();
    await state.ready;
    await queue(state, async () => {
      state.fast = true; state.finishAll();
      while (state.nextStep < state.total && !state.controller.signal.aborted) await state.runStep(state.nextStep);
      state.finishAll(); state.fast = false;
    });
    post({ vw: 'step-done', nextStep: state.nextStep, total: state.total });
  }
  async function playLeave(direction) {
    const state = frozen() ? null : motion;
    if (state) {
      await state.ready;
      await queue(state, async () => {
        if (handlers && typeof handlers.leave === 'function') {
          try { await handlers.leave(state.ctx, { direction: direction < 0 ? -1 : 1 }); } catch (error) { postError(error, 'leave'); }
        }
      });
    }
    post({ vw: 'left', direction });
  }
  // 截图前等画面静止：字体、图片、有限动画；无限循环的动画停在当前帧
  async function settle(timeout) {
    const limit = Number(timeout) || 5000, deadline = Date.now() + limit;
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const left = () => Math.max(0, deadline - Date.now());
    const bounded = p => Promise.race([p, delay(left()).then(() => { throw new Error(`等待画面静止超过 ${limit} ms`); })]);
    if (motion) await bounded(motion.ready.then(() => motion.current));
    if (doc.fonts && doc.fonts.ready) await bounded(doc.fonts.ready);
    await bounded(Promise.all([...doc.images].map(img => (img.complete ? Promise.resolve() : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); })).then(() => (img.decode ? img.decode().catch(() => {}) : null)))));
    for (let round = 0; round < 20; round++) {
      const running = [];
      for (const a of (doc.getAnimations ? doc.getAnimations() : [])) {
        if (a.playState !== 'running' && a.playState !== 'pending') continue;
        if (!finite(a)) { a.pause(); continue; }
        running.push(a.finished.catch(() => {}));
      }
      if (!running.length) break;
      await bounded(Promise.all(running));
      await frame();
    }
    await frame(); await frame();
  }

  // ---------- 编辑（edit 模式） ----------
  const EDIT_CSS = `
html[data-vw-cursor="text"], html[data-vw-cursor="text"] * { cursor: text !important; }
html[data-vw-cursor="move"], html[data-vw-cursor="move"] * { cursor: move !important; }
html[data-vw-cursor] [data-vw-editing], html[data-vw-cursor] [data-vw-editing] * { cursor: text !important; }
[data-vw-editing] { outline: none !important; user-select: text !important; -webkit-user-select: text !important; caret-color: auto; }
[data-vw-editing] * { user-select: text !important; -webkit-user-select: text !important; }
[data-vw-editing]::selection, [data-vw-editing] *::selection { background: rgba(64, 120, 255, 0.38) !important; }
img[data-vw-id] { -webkit-user-drag: none; }`;
  const UI_CSS = `
:host { all: initial; }
.box { position: absolute; box-sizing: border-box; pointer-events: none; }
.hover { border: calc(var(--lw) * 2) solid rgba(79, 124, 255, 0.95); }
.sel { border: calc(var(--lw) * 2) solid #4f7cff; }
.sel.editing { border-style: dashed; }
.h { position: absolute; width: var(--hs); height: var(--hs); background: #fff; border: calc(var(--lw) * 2) solid #4f7cff; border-radius: calc(var(--lw) * 2); box-sizing: border-box; box-shadow: 0 0 0 var(--lw) rgba(255, 255, 255, 0.9), 0 calc(var(--lw) * 1) calc(var(--lw) * 3) rgba(0, 0, 0, 0.25); transform: translate(-50%, -50%); pointer-events: auto; }
.crop { position: absolute; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; }
.crop img { position: absolute; max-width: none; max-height: none; display: block; pointer-events: none; }
.crop .frame { position: absolute; box-sizing: border-box; outline: calc(var(--lw) * 1.5) solid #fff; box-shadow: 0 0 0 100000px rgba(18, 16, 28, 0.5); cursor: move; }
.crop button { position: absolute; font: 600 calc(var(--lw) * 13px) / 1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: calc(var(--lw) * 6px) calc(var(--lw) * 12px); border-radius: calc(var(--lw) * 8px); border: 0; background: #fff; color: #222; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,.25); }`;
  const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
  const CURSOR = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
  const MIN_BOX = 8, MAX_ZOOM = 5, WHEEL_STEP = 1.1;
  let edit = null; // 编辑状态

  // 编辑画布上的用户输入：在 window 捕获阶段最先拦住（运行时的脚本在页面脚本之前注入，这个监听排在最前），
  // 交给运行时自己的处理后 stopImmediatePropagation——页面自己的脚本（动效、点击翻转之类）收不到。
  // 不 preventDefault：光标放置、拖选、输入法这些浏览器默认行为照旧。play 模式不拦。
  const GUARDED = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
    'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'keydown', 'keyup', 'keypress'];
  function setupInputGuard() {
    for (const type of GUARDED) {
      window.addEventListener(type, e => {
        if (mode !== 'edit') return;
        const fn = edit && edit.handlers[type];
        if (fn) { try { fn(e); } catch (error) { postError(error, type); } }
        e.stopImmediatePropagation();
      }, { capture: true, passive: false });
    }
  }

  function setupEdit() {
    const style = doc.createElement('style');
    style.setAttribute('data-vw-edit', '');
    style.textContent = EDIT_CSS;
    (doc.head || doc.documentElement).appendChild(style);
    const host = doc.createElement('vw-ui');
    host.setAttribute('data-vw-ui', '');
    host.style.cssText = 'all:initial !important;position:absolute !important;left:0 !important;top:0 !important;width:0 !important;height:0 !important;overflow:visible !important;z-index:2147483647 !important;pointer-events:none !important;display:block !important';
    const ui = host.attachShadow({ mode: 'open' });
    ui.innerHTML = `<style>${UI_CSS}</style><div class="box hover" hidden></div><div class="box sel" hidden>${Object.keys(HANDLES).map(h => `<i class="h" data-h="${h}" style="left:${HANDLES[h][0] * 100}%;top:${HANDLES[h][1] * 100}%;cursor:${CURSOR[h]}-resize"></i>`).join('')}</div>`;
    doc.documentElement.appendChild(host);
    const E = edit = {
      style, host, ui, hoverBox: ui.querySelector('.hover'), selBox: ui.querySelector('.sel'),
      selected: null, hovered: null, editing: null, editStart: null, composing: false, textTimer: 0,
      drag: null, crop: null, lastRect: '', raf: 0, scale: Number(cfg.uiScale) || 1, listeners: new AbortController()
    };
    applyScale();
    E.handlers = {};
    const on = (type, fn, opts) => {
      if (GUARDED.includes(type)) { E.handlers[type] = fn; return; } // 由输入守卫转交
      window.addEventListener(type, fn, Object.assign({ capture: true, signal: E.listeners.signal }, opts || {}));
    };
    on('pointerdown', onDown);
    on('pointermove', onMove);
    on('pointerup', onUp);
    on('pointercancel', onUp);
    on('dblclick', onDblClick);
    on('click', onClick);
    on('contextmenu', onContextMenu);
    on('keydown', onKey);
    on('beforeinput', onBeforeInput);
    on('input', onInput);
    on('compositionstart', () => { E.composing = true; });
    on('compositionend', () => { E.composing = false; if (E.editing) flushText(); });
    on('paste', onPaste);
    on('drop', e => { if (!E.editing || !E.editing.contains(e.target)) return; e.preventDefault(); });
    on('dragstart', e => { if (!E.editing) e.preventDefault(); });
    on('wheel', e => { if (E.crop) E.crop.wheel(e); }, { passive: false });
    const loop = () => { if (edit !== E) return; refreshUi(); E.raf = requestAnimationFrame(loop); };
    E.raf = requestAnimationFrame(loop);
  }
  function teardownEdit() {
    if (!edit) return;
    exitEditing();
    if (edit.crop) edit.crop.finish(true);
    edit.listeners.abort();
    cancelAnimationFrame(edit.raf);
    edit.host.remove(); edit.style.remove();
    doc.documentElement.removeAttribute('data-vw-cursor');
    edit = null;
  }
  function applyScale() {
    const s = edit.scale > 0 ? edit.scale : 1;
    edit.host.style.setProperty('--lw', `${1 / s}px`, 'important');
    edit.host.style.setProperty('--hs', `${12 / s}px`, 'important');
  }
  function markFrom(node) {
    for (let el = node && node.nodeType === 1 ? node : node && node.parentElement; el && el !== doc.documentElement; el = el.parentElement) {
      if (el === edit.host) return null;
      if (el.hasAttribute('data-vw-id') && capsOf(el).length) return el;
    }
    return null;
  }
  // 框线附近（参照 PowerPoint 文本框）：内侧 10px、外侧 6px（屏幕像素，按 uiScale 换算成页面像素）
  const EDGE_IN = 10, EDGE_OUT = 6;
  function nearEdge(el, e) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const s = edit.scale || 1;
    const inner = Math.min(EDGE_IN / s, r.width / 4, r.height / 4), outer = EDGE_OUT / s;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < -outer || y < -outer || x > r.width + outer || y > r.height + outer) return false;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return true; // 框外那一圈
    const d = Math.min(x, y, r.width - x, r.height - y);
    if (d >= inner) return false;
    // 框内那一圈：空白处都算框线；压在字上时只算最外 EDGE_TIGHT px（点在字上仍是改字）
    return d < EDGE_TIGHT / s || !overGlyph(el, e.clientX, e.clientY);
  }
  const EDGE_TIGHT = 4;
  function overGlyph(el, cx, cy) {
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const q of range.getClientRects()) if (cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom) return true;
    }
    return false;
  }
  const movable = caps => caps.includes('move') || caps.includes('resize') || caps.includes('text');
  // 带 text 又带 move 的元素：鼠标离框线很近时（含框外 6px，e.target 不是它）按几何位置找到它。先看选中的、悬停的，再看其余（后面的盖在上面）
  function edgeTarget(e) {
    const E = edit;
    const list = [E.selected, E.hovered];
    const marks = [...doc.querySelectorAll('[data-vw-id]')];
    for (let i = marks.length - 1; i >= 0; i--) list.push(marks[i]);
    const seen = new Set();
    for (const el of list) {
      if (!el || seen.has(el) || !el.isConnected) continue;
      seen.add(el);
      if (el === E.editing) { // 改字中：框里是放光标，只有框外那一圈能拖
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) continue;
      }
      const caps = capsOf(el);
      if (caps.includes('text') && caps.includes('move') && nearEdge(el, e)) return el;
    }
    return null;
  }
  function setBox(box, r) { box.style.left = `${r.x}px`; box.style.top = `${r.y}px`; box.style.width = `${r.width}px`; box.style.height = `${r.height}px`; }
  function refreshUi() {
    const E = edit;
    if (E.hovered && E.hovered !== E.selected && E.hovered.isConnected && !E.drag && !E.crop) { E.hoverBox.hidden = false; setBox(E.hoverBox, pageRect(E.hovered)); }
    else E.hoverBox.hidden = true;
    const el = E.selected;
    if (!el || !el.isConnected || E.crop) { E.selBox.hidden = true; if (el && !el.isConnected) select(null); return; }
    const r = pageRect(el);
    E.selBox.hidden = false;
    setBox(E.selBox, r);
    E.selBox.classList.toggle('editing', !!E.editing);
    const caps = capsOf(el);
    const free = caps.includes('resize') && !E.editing;
    for (const h of E.selBox.querySelectorAll('.h')) {
      const name = h.dataset.h;
      const show = free && (caps.includes('move') || !/[nw]/.test(name));
      h.style.display = show ? '' : 'none';
    }
    const key = `${r.x},${r.y},${r.width},${r.height}`;
    if (key !== E.lastRect) {
      E.lastRect = key;
      // 当前值给父页面的工具条回显（字号 / 文字颜色 / 底色）
      const cs = getComputedStyle(el);
      const values = { fontSize: r2(parseFloat(cs.fontSize)) || null, color: toHex(cs.color), background: toHex(cs.backgroundColor) };
      post({ vw: 'select', id: el.getAttribute('data-vw-id'), caps, rect: { x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) }, values });
    }
  }
  function select(el) {
    const E = edit;
    if (E.selected === el) return;
    if (E.editing && E.editing !== el) exitEditing();
    E.selected = el; E.lastRect = '';
    if (!el) { post({ vw: 'select', id: null, caps: [], rect: null }); E.selBox.hidden = true; }
    else refreshUi();
  }

  // 改字
  function enterEditing(el, e) {
    const E = edit;
    if (E.editing === el) return;
    exitEditing();
    select(el);
    E.editing = el;
    E.savedCE = el.getAttribute('contenteditable');
    beforeOf(el, 'text');
    saveOriginal(STATE, el, 'text');
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-vw-editing', '');
    E.lastRect = '';
    post({ vw: 'editing', on: true, id: el.getAttribute('data-vw-id') });
    // 单击：浏览器在按下的位置放光标；没放上（例如按下早于可编辑）就补一次
    setTimeout(() => {
      if (E.editing !== el || doc.activeElement === el) return;
      el.focus({ preventScroll: true });
      if (e) placeCaret(el, e.clientX, e.clientY);
    }, 0);
  }
  function placeCaret(el, x, y) {
    let range = null;
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
    else if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { range = doc.createRange(); range.setStart(p.offsetNode, p.offset); } }
    if (!range || !el.contains(range.startContainer)) { range = doc.createRange(); range.selectNodeContents(el); range.collapse(false); }
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function flushText() {
    const E = edit; const el = E && E.editing;
    clearTimeout(E.textTimer);
    if (!el || E.composing) return;
    const after = { html: el.innerHTML, text: el.textContent };
    const prev = STATE.applied.get(el)?.text || { html: STATE.originals.get(el)?.text?.html, text: beforeOf(el, 'text').text };
    if (same(prev.html, after.html)) return;
    commit(el, 'text', after);
  }
  function exitEditing() {
    const E = edit; if (!E || !E.editing) return;
    flushText();
    const el = E.editing;
    E.editing = null;
    if (E.savedCE === null || E.savedCE === undefined) el.removeAttribute('contenteditable'); else el.setAttribute('contenteditable', E.savedCE);
    el.removeAttribute('data-vw-editing');
    const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    if (doc.activeElement === el) el.blur();
    E.lastRect = '';
    post({ vw: 'editing', on: false, id: el.getAttribute('data-vw-id') });
  }
  function insertPlain(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, i) => { if (i) doc.execCommand('insertLineBreak'); if (line) doc.execCommand('insertText', false, line); });
  }
  const ALLOWED_INPUT = /^(insertText|insertReplacementText|insertCompositionText|insertFromComposition|deleteCompositionText|deleteByComposition|insertLineBreak|delete(Content|Word|SoftLine|HardLine|EntireSoftLine)(Backward|Forward)?|deleteByCut|deleteContent|historyUndo|historyRedo)$/;
  function onBeforeInput(e) {
    const E = edit;
    if (!E.editing || !(E.editing === e.target || E.editing.contains(e.target))) { if (E.editing) e.preventDefault(); return; }
    const t = e.inputType;
    if (ALLOWED_INPUT.test(t)) return;
    e.preventDefault();
    if (t === 'insertParagraph') doc.execCommand('insertLineBreak');
    else if (t === 'insertFromPaste' || t === 'insertFromPasteAsQuotation' || t === 'insertFromDrop') { const text = e.dataTransfer && e.dataTransfer.getData('text/plain'); if (text && t !== 'insertFromDrop') insertPlain(text); }
  }
  function onInput() {
    const E = edit;
    if (!E.editing || E.composing) return;
    clearTimeout(E.textTimer);
    E.textTimer = setTimeout(flushText, 400);
  }
  function onPaste(e) {
    const E = edit;
    const data = e.clipboardData;
    if (E.editing) {
      e.preventDefault();
      const text = data ? data.getData('text/plain') : '';
      if (text) insertPlain(text);
      return;
    }
    const file = data && [...data.items].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).find(Boolean);
    if (!file) return;
    e.preventDefault();
    file.arrayBuffer().then(buffer => post({ vw: 'paste-image', name: file.name || 'paste', type: file.type, buffer }, [buffer]), error => postError(error, 'paste'));
  }

  // 鼠标
  function onDown(e) {
    const E = edit;
    if (E.crop) { E.crop.down(e); return; }
    const path = e.composedPath ? e.composedPath() : [];
    const handle = path[0] && path[0].dataset && path[0].dataset.h;
    if (e.button !== 0) return;
    if (handle && E.selected) { e.preventDefault(); e.stopPropagation(); takeFocus(); startResize(e, handle); return; }
    if (E.editing && (E.editing === e.target || E.editing.contains(e.target))) return; // 浏览器自己放光标、拖选
    if (E.editing) exitEditing();
    const edge = edgeTarget(e);
    const el = edge || markFrom(e.target);
    if (!el) { e.preventDefault(); takeFocus(); select(null); return; }
    const caps = capsOf(el);
    if (caps.includes('text') && !edge) { enterEditing(el, e); return; }
    e.preventDefault();
    takeFocus();
    select(el);
    if (caps.includes('move')) {
      E.drag = { type: 'move', el, id: e.pointerId, sx: e.clientX, sy: e.clientY, scrollX: window.scrollX, scrollY: window.scrollY, base: Object.assign({ dx: 0, dy: 0 }, moveOf(el)), moved: false, before: beforeOf(el, 'move') };
    }
  }
  // 按下时 preventDefault 会让浏览器不把焦点给 iframe；手动拿一下，键盘（Delete、方向键、Esc）才能到这里
  function takeFocus() {
    if (doc.activeElement && doc.activeElement !== doc.body && doc.activeElement.blur) doc.activeElement.blur();
    if (!doc.hasFocus()) try { window.focus(); } catch (error) { /* 忽略 */ }
  }
  function onMove(e) {
    const E = edit;
    if (E.crop) { E.crop.move(e); return; }
    const d = E.drag;
    if (d && e.pointerId === d.id) {
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (d.type === 'move') dragMove(d, e.clientX, e.clientY);
      else dragResize(d, e);
      return;
    }
    if (e.buttons) return;
    const edge = edgeTarget(e);
    const under = markFrom(e.target);
    const el = edge || under;
    E.hovered = el && movable(capsOf(el)) ? el : null;
    let cursor = '';
    if (edge) cursor = 'move';
    else if (el && el !== E.editing) {
      const caps = capsOf(el);
      if (caps.includes('text')) cursor = 'text';
      else if (caps.includes('move')) cursor = 'move';
    }
    if (cursor) doc.documentElement.setAttribute('data-vw-cursor', cursor); else doc.documentElement.removeAttribute('data-vw-cursor');
  }
  function dragMove(d, cx, cy) {
    const dx = d.base.dx + (cx - d.sx) + (window.scrollX - d.scrollX);
    const dy = d.base.dy + (cy - d.sy) + (window.scrollY - d.scrollY);
    if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) < 3) return;
    if (!d.moved) {
      d.moved = true; startAutoScroll(d);
      // 真拖起来才捕获指针（拖出窗口也跟随）；只是点一下时不捕获，双击等事件的目标仍是元素本身
      try { doc.documentElement.setPointerCapture(d.id); } catch (error) { /* 没有真实指针 */ }
    }
    setLive(d.el, 'move', { dx: r2(dx), dy: r2(dy) });
  }
  // 网页页面：拖到窗口上下边缘自动滚动
  function startAutoScroll(d) {
    const tick = () => {
      if (edit.drag !== d) return;
      const edgeY = d.lastY == null ? 0 : d.lastY < 30 ? -12 : d.lastY > window.innerHeight - 30 ? 12 : 0;
      if (edgeY && doc.documentElement.scrollHeight > window.innerHeight) {
        window.scrollBy(0, edgeY);
        if (d.type === 'move') dragMove(d, d.lastX, d.lastY);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function onUp(e) {
    const E = edit;
    if (E.crop) { E.crop.up(e); return; }
    const d = E.drag;
    if (!d || e.pointerId !== d.id) return;
    E.drag = null;
    try { doc.documentElement.releasePointerCapture(e.pointerId); } catch (error) { /* 忽略 */ }
    if (d.type === 'move' && d.moved) commit(d.el, 'move', STATE.applied.get(d.el).move);
    if (d.type === 'resize' && d.changed) {
      commit(d.el, 'resize', STATE.applied.get(d.el).resize);
      if (d.moves) commit(d.el, 'move', STATE.applied.get(d.el).move);
    }
    E.lastRect = '';
  }
  function startResize(e, handle) {
    const el = edit.selected;
    const caps = capsOf(el);
    if (!caps.includes('resize')) return;
    const r = el.getBoundingClientRect();
    const size = cssSize(el);
    const kx = r.width && el.offsetWidth ? el.offsetWidth / r.width : 1, ky = r.height && el.offsetHeight ? el.offsetHeight / r.height : 1;
    beforeOf(el, 'resize'); if (caps.includes('move')) beforeOf(el, 'move');
    edit.drag = { type: 'resize', el, handle, id: e.pointerId, sx: e.clientX, sy: e.clientY, r, size, kx, ky, base: Object.assign({ dx: 0, dy: 0 }, moveOf(el)), image: String(el.tagName).toLowerCase() === 'img', changed: false, moves: false };
    try { doc.documentElement.setPointerCapture(e.pointerId); } catch (error) { /* 忽略 */ }
  }
  function dragResize(d, e) {
    const [fx, fy] = HANDLES[d.handle];
    const px = e.clientX - d.sx, py = e.clientY - d.sy;
    let w = d.r.width + (fx === 1 ? px : fx === 0 ? -px : 0);
    let h = d.r.height + (fy === 1 ? py : fy === 0 ? -py : 0);
    w = Math.max(MIN_BOX, w); h = Math.max(MIN_BOX, h);
    const corner = fx !== 0.5 && fy !== 0.5;
    if (d.image && corner && !e.shiftKey && d.r.height > 0) {
      const ratio = d.r.width / d.r.height;
      if (Math.abs(w - d.r.width) / d.r.width >= Math.abs(h - d.r.height) / d.r.height) h = w / ratio; else w = h * ratio;
    }
    const cw = fx === 0.5 ? d.size.width : Math.max(1, d.size.width + (w - d.r.width) * d.kx);
    const ch = fy === 0.5 ? d.size.height : Math.max(1, d.size.height + (h - d.r.height) * d.ky);
    const after = {};
    if (fx !== 0.5 || corner) after.width = r2(cw); else after.width = r2(d.size.width);
    after.height = r2(fy === 0.5 && !corner ? d.size.height : ch);
    setLive(d.el, 'resize', after);
    d.changed = true;
    const shiftX = fx === 0 ? d.r.width - w : 0, shiftY = fy === 0 ? d.r.height - h : 0;
    if ((shiftX || shiftY || d.moves) && capsOf(d.el).includes('move')) { d.moves = true; setLive(d.el, 'move', { dx: r2(d.base.dx + shiftX), dy: r2(d.base.dy + shiftY) }); }
  }
  function onClick(e) {
    const E = edit;
    if (E.editing && E.editing.contains(e.target)) return;
    if (e.target && e.target.closest && e.target.closest('a,button,input,select,textarea,label,summary')) e.preventDefault();
  }
  function onDblClick(e) {
    const E = edit;
    if (E.crop || E.editing) return;
    const hit = e.target === doc.documentElement || e.target === doc.body ? doc.elementFromPoint(e.clientX, e.clientY) : e.target;
    const el = markFrom(hit);
    if (el && String(el.tagName).toLowerCase() === 'img' && capsOf(el).includes('crop')) { e.preventDefault(); startCrop(el); }
  }
  function onContextMenu(e) {
    const E = edit;
    if (E.editing && E.editing.contains(e.target)) return; // 改字时用浏览器 / 桌面应用的原生菜单
    const el = markFrom(e.target);
    if (el && isUser(el.getAttribute('data-vw-id')) && el.hasAttribute('data-vw-user')) {
      e.preventDefault();
      select(el);
      post({ vw: 'menu', id: el.getAttribute('data-vw-id'), x: e.clientX, y: e.clientY });
    }
  }
  function onKey(e) {
    const E = edit;
    if (E.crop) { E.crop.key(e); return; }
    const mod = e.metaKey || e.ctrlKey;
    if (E.editing) {
      if (e.key === 'Escape') { e.preventDefault(); exitEditing(); return; }
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const range = doc.createRange(); range.selectNodeContents(E.editing);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      }
      return; // 其余按键交给浏览器（光标、选区、撤销）
    }
    const el = E.selected;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (el && arrows[e.key] && !mod && capsOf(el).includes('move')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1, m = moveOf(el);
      beforeOf(el, 'move');
      commit(el, 'move', { dx: r2((m.dx || 0) + arrows[e.key][0] * step), dy: r2((m.dy || 0) + arrows[e.key][1] * step) });
      E.lastRect = '';
      return;
    }
    if (el && e.key === 'Enter' && capsOf(el).includes('text')) { e.preventDefault(); enterEditing(el, null); selectAllIn(el); return; }
    if (e.key === 'Escape' && el) { select(null); }
    if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    post({ vw: 'key', key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, id: el ? el.getAttribute('data-vw-id') : null });
    if (mod && /^[zZyY]$/.test(e.key)) e.preventDefault();
    if ((e.key === 'Delete' || e.key === 'Backspace') && el) e.preventDefault();
  }
  function selectAllIn(el) {
    setTimeout(() => { el.focus({ preventScroll: true }); const range = doc.createRange(); range.selectNodeContents(el); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }, 0);
  }

  // 裁切（第 10 轮 web/crop-tool.js 的交互搬进来）：拖边角改框、框内拖图、滚轮缩放；Esc / 点外面 / 双击 / 完成 都是完成
  function startCrop(el) {
    const E = edit;
    exitEditing(); select(el);
    const nw = el.naturalWidth, nh = el.naturalHeight;
    if (!(nw > 0 && nh > 0)) return;
    const caps = capsOf(el);
    const R = pageRect(el);
    const size = cssSize(el);
    const kx = R.width && el.offsetWidth ? el.offsetWidth / R.width : 1, ky = R.height && el.offsetHeight ? el.offsetHeight / R.height : 1;
    const m0 = Object.assign({ dx: 0, dy: 0 }, moveOf(el));
    const cur = cropOf(el);
    let I;
    if (cur) { const w = R.width / cur.width, h = R.height / cur.height; I = { x: -cur.x * w, y: -cur.y * h, w, h }; }
    else {
      const fit = getComputedStyle(el).objectFit;
      const s = fit === 'contain' || fit === 'scale-down' ? Math.min(R.width / nw, R.height / nh) : Math.max(R.width / nw, R.height / nh);
      I = { w: nw * s, h: nh * s }; I.x = (R.width - I.w) / 2; I.y = (R.height - I.h) / 2;
    }
    const aspect = I.w / I.h;
    const B = { x: 0, y: 0, w: R.width, h: R.height };
    const canResize = caps.includes('resize'), canMove = caps.includes('move');
    if (canResize && (I.x > 1e-6 || I.y > 1e-6)) { // contain：源图比框小，框收进源图
      const l = Math.max(0, I.x), t = Math.max(0, I.y), r = Math.min(R.width, I.x + I.w), b = Math.min(R.height, I.y + I.h);
      Object.assign(B, { x: canMove ? l : 0, y: canMove ? t : 0, w: Math.max(1, r - (canMove ? l : 0)), h: Math.max(1, b - (canMove ? t : 0)) });
    }
    beforeOf(el, 'crop'); if (canResize) beforeOf(el, 'resize'); if (canMove) beforeOf(el, 'move');
    const wrap = doc.createElement('div');
    wrap.className = 'crop';
    wrap.style.cssText = `left:${R.x}px;top:${R.y}px;width:${R.width}px;height:${R.height}px`;
    const ghost = doc.createElement('img'); ghost.src = el.currentSrc || el.src; ghost.alt = ''; ghost.draggable = false;
    const frame = doc.createElement('div'); frame.className = 'frame';
    const handles = canResize ? Object.keys(HANDLES).filter(h => canMove || !/[nw]/.test(h)) : [];
    for (const name of handles) { const h = doc.createElement('i'); h.className = 'h'; h.dataset.ch = name; h.style.cssText = `left:${HANDLES[name][0] * 100}%;top:${HANDLES[name][1] * 100}%;cursor:${CURSOR[name]}-resize`; frame.append(h); }
    const done = doc.createElement('button'); done.type = 'button'; done.textContent = '完成';
    wrap.append(ghost, frame, done);
    E.ui.append(wrap);
    const minW = () => Math.max(B.w, B.h * aspect);
    function layout() {
      ghost.style.cssText = `left:${I.x}px;top:${I.y}px;width:${I.w}px;height:${I.h}px`;
      frame.style.left = `${B.x}px`; frame.style.top = `${B.y}px`; frame.style.width = `${B.w}px`; frame.style.height = `${B.h}px`;
      done.style.left = `${B.x + B.w}px`; done.style.top = `${B.y + B.h + 10 / (E.scale || 1)}px`; done.style.transform = 'translateX(-100%)';
    }
    function containBox() {
      if (I.w < B.w || I.h < B.h) { const f = Math.max(B.w / I.w, B.h / I.h); I.w *= f; I.h *= f; }
      I.x = clamp(I.x, B.x + B.w - I.w, B.x); I.y = clamp(I.y, B.y + B.h - I.h, B.y);
    }
    function zoomTo(factor) {
      const cx = B.x + B.w / 2, cy = B.y + B.h / 2;
      const w = clamp(I.w * factor, minW(), minW() * MAX_ZOOM), f = w / I.w;
      I.x = cx - (cx - I.x) * f; I.y = cy - (cy - I.y) * f; I.w = w; I.h = w / aspect;
      containBox(); layout(); dirty = true;
    }
    let drag = null, dirty = false, finished = false;
    const session = {
      down(e) {
        const path = e.composedPath ? e.composedPath() : [];
        if (!path.includes(wrap)) { finish(true); return; }
        e.preventDefault();
        takeFocus();
        if (e.button !== 0) return;
        if (path[0] === done) { finish(true); return; }
        const edge = path[0] && path[0].dataset ? path[0].dataset.ch : null;
        if (!edge && !path.includes(frame)) return;
        drag = { edge, id: e.pointerId, sx: e.clientX, sy: e.clientY, B: Object.assign({}, B), I: Object.assign({}, I) };
        try { doc.documentElement.setPointerCapture(e.pointerId); } catch (error) { /* 忽略 */ }
      },
      move(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, b = drag.B, im = drag.I;
        if (!drag.edge) { I.x = clamp(im.x + dx, B.x + B.w - I.w, B.x); I.y = clamp(im.y + dy, B.y + B.h - I.h, B.y); }
        else {
          const [fx, fy] = HANDLES[drag.edge];
          let l = b.x, t = b.y, r = b.x + b.w, btm = b.y + b.h;
          if (fx === 0) l = clamp(Math.round(b.x + dx), Math.ceil(im.x - 1e-6), r - MIN_BOX);
          if (fx === 1) r = clamp(Math.round(r + dx), l + MIN_BOX, Math.floor(im.x + im.w + 1e-6));
          if (fy === 0) t = clamp(Math.round(b.y + dy), Math.ceil(im.y - 1e-6), btm - MIN_BOX);
          if (fy === 1) btm = clamp(Math.round(btm + dy), t + MIN_BOX, Math.floor(im.y + im.h + 1e-6));
          Object.assign(B, { x: l, y: t, w: r - l, h: btm - t });
        }
        dirty = true; layout();
      },
      up(e) { if (drag && e.pointerId === drag.id) drag = null; },
      wheel(e) { e.preventDefault(); if (e.deltaY) zoomTo(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP); },
      key(e) { e.preventDefault(); if (e.key === 'Escape' || e.key === 'Enter') finish(true); },
      finish
    };
    function finish(commitIt) {
      if (finished) return;
      finished = true; wrap.remove(); E.crop = null; E.lastRect = '';
      if (!commitIt || !dirty) return;
      const x = clamp(r4((B.x - I.x) / I.w), 0, 1), y = clamp(r4((B.y - I.y) / I.h), 0, 1);
      const crop = { x, y, width: Math.min(r4(B.w / I.w), r4(1 - x)), height: Math.min(r4(B.h / I.h), r4(1 - y)) };
      if (canResize && (Math.abs(B.w - R.width) > 0.5 || Math.abs(B.h - R.height) > 0.5)) commit(el, 'resize', { width: r2(size.width + (B.w - R.width) * kx), height: r2(size.height + (B.h - R.height) * ky) });
      if (canMove && (B.x || B.y)) commit(el, 'move', { dx: r2(m0.dx + B.x), dy: r2(m0.dy + B.y) });
      commit(el, 'crop', { crop });
    }
    E.crop = session;
    layout();
    if (!canResize) containBox(), layout();
  }

  // ---------- 父页面的消息 ----------
  function onMessage(event) {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (!m || typeof m !== 'object' || typeof m.vw !== 'string') return;
    try {
      switch (m.vw) {
        case 'edits': {
          if (edit) { exitEditing(); if (edit.crop) edit.crop.finish(false); }
          cfg.edits = Array.isArray(m.edits) ? m.edits : [];
          applyEditsToDocument(doc, cfg.edits, { assets: assetsMap() });
          if (edit) edit.lastRect = '';
          break;
        }
        case 'select': {
          if (!edit) break;
          if (m.id == null) { exitEditing(); select(null); break; }
          const el = isUser(m.id) ? STATE.users.get(m.id) : findTarget(doc, m.id);
          if (el && capsOf(el).length) { select(el); if (!el.getBoundingClientRect().height) break; const r = pageRect(el); if (r.y < window.scrollY || r.y + r.height > window.scrollY + window.innerHeight) window.scrollTo(window.scrollX, Math.max(0, r.y - 40)); }
          break;
        }
        case 'set': {
          const el = isUser(m.target) ? STATE.users.get(m.target) : findTarget(doc, m.target);
          if (!el || !capsOf(el).includes(KIND_CAP[m.kind]) || !validAfter(m.kind, m.after)) break;
          if (m.kind === 'text') { saveOriginal(STATE, el, 'text'); beforeOf(el, 'text'); applyKind(el, 'text', m.after); }
          commit(el, m.kind, m.after);
          if (edit) edit.lastRect = '';
          break;
        }
        case 'addImage': {
          const entry = m.entry;
          if (!entry || !isUser(entry.target)) break;
          const list = (cfg.edits || []).filter(e => !(e.target === entry.target && e.kind === 'addImage'));
          list.push(Object.assign({ kind: 'addImage' }, entry));
          cfg.edits = list;
          applyEditsToDocument(doc, cfg.edits, { assets: Object.assign({}, assetsMap(), m.assets || {}) });
          if (m.assets) cfg.assets = Object.assign({}, assetsMap(), m.assets);
          if (edit) { const el = STATE.users.get(entry.target); if (el) select(el); }
          break;
        }
        case 'removeImage': {
          const id = m.target || m.id;
          cfg.edits = (cfg.edits || []).filter(e => e.target !== id);
          if (edit && edit.selected === STATE.users.get(id)) select(null);
          applyEditsToDocument(doc, cfg.edits, { assets: assetsMap() });
          break;
        }
        case 'step': playStep().catch(error => postError(error, 'step')); break;
        case 'toEnd': playToEnd().catch(error => postError(error, 'toEnd')); break;
        case 'leave': playLeave(m.direction).catch(error => postError(error, 'leave')); break;
        case 'screen': gotoScreenMessage(m.screen); break;
        case 'settle': settle(m.timeout).then(() => post({ vw: 'settled', ok: true, height: contentHeight() }), error => post({ vw: 'settled', ok: false, error: describe(error).message, height: contentHeight() })); break;
        case 'mode': switchMode(m.mode); break;
        case 'scroll': window.scrollTo(window.scrollX, Number(m.top) || 0); break;
        case 'uiScale': if (edit) { edit.scale = Number(m.scale) || 1; applyScale(); } cfg.uiScale = m.scale; break;
      }
    } catch (error) { postError(error, m.vw); }
  }
  // ---------- 编辑画布的「第 N 屏」 ----------
  const screenNum = v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : null);
  let currentScreen = null; // null = 全部显示（没跑 init）
  async function gotoScreen(k) {
    if (!motion) await startPlay({ edit: true, target: k - 1 });
    else {
      const state = motion;
      await state.ready;
      await queue(state, async () => {
        state.fast = true; state.finishAll();
        const target = Math.min(k - 1, state.total);
        while (state.nextStep < target && !state.controller.signal.aborted) await state.runStep(state.nextStep);
        state.finishAll();
      });
    }
    currentScreen = k;
    if (edit) edit.lastRect = '';
  }
  async function gotoScreenMessage(value) {
    const k = screenNum(value);
    if (mode !== 'edit' || !k || (currentScreen !== null && k < currentScreen)) { post({ vw: 'screen-done', screen: value, applied: false }); return; }
    if (edit) { exitEditing(); if (edit.crop) edit.crop.finish(true); }
    try { await gotoScreen(k); } catch (error) { postError(error, 'screen'); }
    post({ vw: 'screen-done', screen: k, applied: true, nextStep: motion ? motion.nextStep : 0, steps: Math.max(0, Number(cfg.steps) || 0) });
  }

  function switchMode(next) {
    if (next === mode || (next !== 'edit' && next !== 'play')) return;
    if (mode === 'edit') { teardownEdit(); stopPlay(); currentScreen = null; }
    if (mode === 'play') stopPlay();
    mode = next;
    if (mode === 'edit') setupEdit();
    else { cfg.fast = false; startPlay().then(() => post({ vw: 'ready', pageId: cfg.pageId, mode, height: contentHeight(), marks: listMarks(doc), steps: motion ? motion.total : 0, nextStep: motion ? motion.nextStep : 0 })); }
  }

  // play 模式：点击 / 右键 / 按键交给父页面翻页（页面自己处理过的不算）
  function setupPlayInput() {
    window.addEventListener('click', e => {
      if (mode !== 'play' || e.defaultPrevented || e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('a,button,input,select,textarea,label,summary,video,audio,[contenteditable]')) return;
      post({ vw: 'nav', dir: 1 });
    });
    window.addEventListener('contextmenu', e => { if (mode !== 'play' || e.defaultPrevented) return; e.preventDefault(); post({ vw: 'nav', dir: 1, button: 'right' }); });
    window.addEventListener('keydown', e => {
      if (mode !== 'play' || e.defaultPrevented) return;
      if (e.target && e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      post({ vw: 'key', key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
    });
  }

  function boot(config) {
    if (cfg) return;
    cfg = Object.assign({ mode: 'edit', edits: [], steps: 0, fast: false, assets: {}, screen: null, cropFallback: false }, config || {});
    STATE.cropFallback = !!cfg.cropFallback;
    mode = cfg.mode === 'play' ? 'play' : 'edit';
    setupInputGuard();
    window.addEventListener('message', onMessage);
    window.addEventListener('error', event => { postError(event.error || event.message, 'page'); });
    window.addEventListener('unhandledrejection', event => { postError(event.reason || new Error('未处理的 Promise 拒绝'), 'page'); });
    if (cfg.mode === 'play') {
      const original = console.error;
      console.error = function (...args) { postError(new Error(args.map(a => (a && a.message) || String(a)).join(' ')), 'console'); return original.apply(console, args); };
    }
    setupPlayInput();
    let lastHeight = 0, scrollRaf = 0;
    const reportHeight = () => { const h = contentHeight(); if (h !== lastHeight) { lastHeight = h; post({ vw: 'height', height: h }); } };
    window.addEventListener('scroll', () => { if (scrollRaf) return; scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; post({ vw: 'scroll', top: window.scrollY, left: window.scrollX }); }); }, { passive: true });
    const start = () => {
      applyNow();
      mode = cfg.mode === 'play' ? 'play' : 'edit';
      lastHeight = contentHeight();
      if (typeof ResizeObserver === 'function') new ResizeObserver(reportHeight).observe(doc.documentElement);
      window.addEventListener('load', reportHeight);
      if (mode === 'edit') {
        const k = screenNum(cfg.screen);
        const go = () => {
          if (mode !== 'edit') return;
          setupEdit();
          post({ vw: 'ready', pageId: cfg.pageId, mode, height: contentHeight(), marks: listMarks(doc), steps: Math.max(0, Number(cfg.steps) || 0), nextStep: motion ? motion.nextStep : 0, screen: k });
        };
        if (k) gotoScreen(k).then(go, error => { postError(error, 'screen'); go(); });
        else go();
      } else {
        startPlay().then(() => { if (!motion) return; post({ vw: 'ready', pageId: cfg.pageId, mode, height: contentHeight(), marks: listMarks(doc), steps: motion.total, nextStep: motion.nextStep }); });
      }
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true }); else start();
    window.addEventListener('pagehide', () => stopPlay());
  }

  window.vw = Object.freeze({
    version: VERSION,
    get mode() { return mode; },
    motion(h) {
      if (!h || typeof h !== 'object') throw new Error('vw.motion(...) 需要一个对象：{ init, step, leave, dispose }');
      handlers = h;
      registeredResolve(h);
    },
    __boot: boot,
    __apply: applyNow,
    __runtime: api
  });
  window.__vwRuntime = api;
})();
