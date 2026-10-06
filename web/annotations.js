// 批注（第 13 轮，docs/round13-contract.md §6）：用户在编辑画布上拖一个框、写一句话，交给 agent。
// 批注层在 #artboard-holder 里，和 #artboard 同一个缩放；坐标是页面 CSS 像素，存在 page.annotations。
// 只在编辑画布上显示：缩略图、放映、导出都不读它。像 Word 的「新建批注」：工具条按下「批注」后在画布上拖框。
// 画笔（第 15 轮）：按下「画笔」后随手画线 / 箭头，存成 { kind:'stroke', points, color, width, arrow, text }；没有 kind 的条目是画框。
import { showContextMenu } from './context-menu.js';

const MIN = 8; // 拖出来小于这个的框当作点了一下
const newId = () => `an_${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`;
const round = n => Math.round(n * 10) / 10;
export const PEN_COLORS = [['#e5484d', '红'], ['#2f6bff', '蓝'], ['#1f1f1f', '黑'], ['#2e9e5b', '绿'], ['#f08c00', '橙']];
const PEN_WIDTH = 4, MAX_POINTS = 240;
const isStroke = a => a?.kind === 'stroke';
const escA = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 抽稀（Douglas-Peucker），点数仍太多时放宽
function simplify(pts, eps = 1.2) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(), [ax, ay] = pts[i], [bx, by] = pts[j], L = Math.hypot(bx - ax, by - ay);
    let far = -1, dmax = 0;
    // 首尾重合（圈一个地方）时没有「线段」，按到起点的距离算，不然整圈会被抽成两个点
    for (let k = i + 1; k < j; k++) { const d = L < 1e-6 ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay) : Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L; if (d > dmax) { dmax = d; far = k; } }
    if (far > 0 && dmax > eps) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  const out = pts.filter((_, k) => keep[k]);
  return out.length > MAX_POINTS ? simplify(out, eps * 2) : out;
}
/** 箭头三角（页面坐标），按线尾方向；线太短返回 null。Node 截图也用。 */
export function arrowHead(points, width = PEN_WIDTH) {
  if (!points || points.length < 2) return null;
  const [ex, ey] = points[points.length - 1], size = Math.max(14, width * 4);
  let k = points.length - 2;
  while (k > 0 && Math.hypot(ex - points[k][0], ey - points[k][1]) < size) k--;
  const [sx, sy] = points[k], len = Math.hypot(ex - sx, ey - sy);
  if (len < 1) return null;
  const ux = (ex - sx) / len, uy = (ey - sy) / len, bx = ex - ux * size, by = ey - uy * size, h = size * 0.55;
  return [[ex + ux * width * 0.5, ey + uy * width * 0.5], [bx - uy * h, by + ux * h], [bx + uy * h, by - ux * h]];
}
export const strokePath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
export function strokeBox(a) {
  const xs = a.points.map(p => p[0]), ys = a.points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function createAnnotations({ holder, getProject, getPage, scale = () => 1, changed, notice = () => {}, onMode = () => {} }) {
  let layer = null, mode = false, pen = false, penColor = PEN_COLORS[0][0], penArrow = false, selected = null, drag = null, editor = null, key = '';
  const page = () => getPage();
  const list = () => page()?.annotations || [];
  const find = id => list().find(a => a.id === id);

  function ensureLayer() {
    const host = holder();
    if (!host) return null;
    if (layer && layer.parentNode === host) return layer;
    layer?.remove();
    layer = host.ownerDocument.createElement('div');
    layer.className = 'vw-layer vw-annot-layer';
    layer.setAttribute('aria-label', '批注');
    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('dblclick', onDblClick);
    layer.addEventListener('contextmenu', onMenu);
    host.append(layer);
    key = '';
    return layer;
  }
  function strokeHTML(a) {
    const esc = escA, d = strokePath(a.points), w = a.width || PEN_WIDTH, head = a.arrow ? arrowHead(a.points, w) : null, sel = a.id === selected;
    const tri = head ? `<polygon points="${head.map(p => p.join(',')).join(' ')}" fill="${esc(a.color)}"/>` : '';
    const end = a.points[a.points.length - 1];
    return `<g class="vw-stroke${sel ? ' is-selected' : ''}" data-annot-id="${esc(a.id)}">${sel ? `<path class="vw-stroke__halo" d="${d}" style="stroke-width:calc(${w}px + 8px * var(--vw-inv,1))"/>` : ''}<path class="vw-stroke__line" d="${d}" stroke="${esc(a.color)}" stroke-width="${w}"/>${tri}<path class="vw-stroke__hit" d="${d}"/><title>${esc(a.text)}</title></g>${a.text ? `<foreignObject x="${end[0]}" y="${end[1]}" width="1" height="1" style="overflow:visible"><div xmlns="http://www.w3.org/1999/xhtml" class="vw-stroke__text">${esc(a.text)}</div></foreignObject>` : ''}`;
  }
  function boxHTML(a) {
    const esc = escA;
    return `<div class="vw-annot${a.id === selected ? ' is-selected' : ''}" data-annot-id="${esc(a.id)}" style="left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px" title="${esc(a.text)}"><span class="vw-annot__text">${esc(a.text)}</span><span class="vw-annot__grip" data-annot-grip aria-hidden="true"></span></div>`;
  }
  /** 跟着当前页和数据重画（批注改了、换页、撤销）。正在拖的时候不动。 */
  function sync() {
    const l = ensureLayer();
    if (!l) return;
    l.classList.toggle('is-mode', mode);
    l.classList.toggle('is-pen', pen);
    if (selected && !find(selected)) selected = null;
    if (drag) return;
    const next = JSON.stringify([page()?.id, list(), selected]);
    if (next === key) return;
    key = next;
    const boxes = list().filter(a => !isStroke(a)), strokes = list().filter(isStroke);
    l.innerHTML = boxes.map(boxHTML).join('') + `<svg class="vw-annot-svg" xmlns="http://www.w3.org/2000/svg">${strokes.map(strokeHTML).join('')}</svg>`;
    l.dataset.count = String(list().length);
  }
  function write(next) {
    const p = page();
    if (!p) return;
    if (next.length) p.annotations = next; else delete p.annotations;
    key = '';
    changed();
  }
  function select(id) { if (selected === id) return; const was = isStroke(find(selected)); selected = id; key = ''; sync(); if (was || isStroke(find(id))) onMode(mode); }
  function setMode(on) {
    mode = !!on;
    if (mode) pen = false;
    if (!mode) closeEditor(false);
    sync();
    onMode(mode);
  }
  function setPen(on) {
    pen = !!on;
    if (pen) { mode = false; closeEditor(false); }
    sync();
    onMode(mode);
  }
  // 选中的线改颜色 / 箭头；同时记成画笔接下来的默认
  function patchStroke(patch) {
    const a = find(selected);
    if (!isStroke(a)) return;
    write(list().map(x => (x.id === a.id ? { ...x, ...patch, at: new Date().toISOString() } : x)));
    onMode(mode);
  }
  function toolbarHTML(esc = escA) {
    const a = find(selected), st = isStroke(a) ? a : null;
    if (!pen && !st) return '';
    const color = st ? st.color : penColor, arrow = st ? !!st.arrow : penArrow;
    const colors = PEN_COLORS.map(([c, n]) => `<button class="ed-tbtn qt-btn vw-pen-color${c.toLowerCase() === String(color).toLowerCase() ? ' is-on' : ''}" data-annot-color="${c}" title="${esc(n)}" aria-label="${esc(n)}" aria-pressed="${c.toLowerCase() === String(color).toLowerCase()}" style="--pen:${c}"><i></i></button>`).join('');
    const extra = st ? `<button class="ed-tbtn qt-btn" data-action="annot-text" title="给这条线配一句话"><span>写一句话</span></button><button class="ed-tbtn qt-btn" data-action="annot-delete" title="删除这条线（Delete）"><span>删除</span></button>` : '';
    return `<div class="qt-inner qt-pen" data-mark="pen:${esc(st ? st.id : 'new')}">${colors}<button class="ed-tbtn qt-btn${arrow ? ' is-on' : ''}" data-action="annot-arrow" aria-pressed="${arrow}" title="线尾带箭头"><span>箭头</span></button>${extra}</div>`;
  }
  function toolbarAction(el) {
    const a = find(selected), st = isStroke(a) ? a : null;
    const color = el?.closest?.('[data-annot-color]')?.dataset.annotColor;
    if (color) { penColor = color; if (st) patchStroke({ color }); else onMode(mode); return true; }
    const act = el?.closest?.('[data-action]')?.dataset.action;
    if (act === 'annot-arrow') { const next = !(st ? st.arrow : penArrow); penArrow = next; if (st) patchStroke({ arrow: next }); else onMode(mode); return true; }
    if (act === 'annot-text' && st) { openEditor({ id: st.id, rect: strokeBox(st), text: st.text }); return true; }
    if (act === 'annot-delete' && st) { remove(st.id); return true; }
    return false;
  }
  // 屏幕坐标 → 页面坐标
  function point(e) {
    const r = layer.getBoundingClientRect(), s = scale() || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  function onDown(e) {
    if (e.button !== 0) return;
    const box = e.target.closest('.vw-annot, .vw-stroke');
    if (editor && !e.target.closest('.vw-annot-input')) closeEditor(true);
    if (box?.classList.contains('vw-stroke')) {
      e.preventDefault();
      e.stopPropagation();
      const id = box.dataset.annotId, a = find(id);
      if (!a) return;
      select(id);
      const node = layer.querySelector(`.vw-stroke[data-annot-id="${CSS.escape(id)}"]`);
      drag = { kind: 'smove', id, node, start: point(e), orig: a, moved: false, pointerId: e.pointerId };
      try { layer.setPointerCapture(e.pointerId); } catch {}
      layer.classList.add('is-dragging');
      return;
    }
    if (pen) {
      e.preventDefault();
      e.stopPropagation();
      select(null);
      const p = point(e), svg = layer.querySelector('.vw-annot-svg'), ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ghost.setAttribute('class', 'vw-stroke__line');
      ghost.setAttribute('stroke', penColor);
      ghost.setAttribute('stroke-width', PEN_WIDTH);
      svg?.append(ghost);
      drag = { kind: 'pen', start: p, pts: [[round(p.x), round(p.y)]], ghost, pointerId: e.pointerId };
      try { layer.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (box) {
      e.preventDefault();
      e.stopPropagation();
      const id = box.dataset.annotId, a = find(id);
      if (!a) return;
      select(id);
      const node = layer.querySelector(`[data-annot-id="${CSS.escape(id)}"]`);
      drag = { kind: e.target.closest('[data-annot-grip]') ? 'resize' : 'move', id, node, start: point(e), orig: { ...a }, moved: false, pointerId: e.pointerId };
      // 拖到框外（下面是隔离 iframe）也要收到移动：捕获在框上，拖动期间整层接鼠标
      try { node.setPointerCapture(e.pointerId); } catch {}
      layer.classList.add('is-dragging');
      return;
    }
    if (!mode) return;
    e.preventDefault();
    e.stopPropagation();
    select(null);
    const start = point(e), ghost = layer.ownerDocument.createElement('div');
    ghost.className = 'vw-annot vw-annot--draft';
    layer.append(ghost);
    drag = { kind: 'draw', start, ghost, rect: null, pointerId: e.pointerId };
    layer.setPointerCapture?.(e.pointerId);
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = point(e), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.kind === 'pen') {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * (scale() || 1) < 1.5) return;
      drag.pts.push([round(p.x), round(p.y)]);
      drag.ghost.setAttribute('d', strokePath(drag.pts));
      return;
    }
    if (drag.kind === 'draw') {
      const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), width: Math.abs(dx), height: Math.abs(dy) };
      drag.rect = r;
      Object.assign(drag.ghost.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      return;
    }
    if (!drag.moved && Math.hypot(dx, dy) * (scale() || 1) < 3) return;
    drag.moved = true;
    const o = drag.orig;
    if (drag.kind === 'smove') { drag.next = { ...o, points: o.points.map(q => [round(q[0] + dx), round(q[1] + dy)]) }; drag.node.setAttribute('transform', `translate(${dx} ${dy})`); return; }
    if (drag.kind === 'move') { drag.next = { ...o, x: round(o.x + dx), y: round(o.y + dy) }; }
    else drag.next = { ...o, width: round(Math.max(MIN, o.width + dx)), height: round(Math.max(MIN, o.height + dy)) };
    Object.assign(drag.node.style, { left: `${drag.next.x}px`, top: `${drag.next.y}px`, width: `${drag.next.width}px`, height: `${drag.next.height}px` });
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    layer?.classList.remove('is-dragging');
    if (d.kind === 'pen') {
      d.ghost.remove();
      const pts = simplify(d.pts), b = strokeBox({ points: pts });
      if (pts.length < 2 || Math.max(b.width, b.height) * (scale() || 1) < 4) { sync(); return; }
      const a = { id: newId(), kind: 'stroke', points: pts, color: penColor, width: PEN_WIDTH, arrow: penArrow, text: '', at: new Date().toISOString() };
      write([...list(), a]);
      return;
    }
    if (d.kind === 'draw') {
      d.ghost.remove();
      const r = d.rect;
      if (!r || r.width < MIN || r.height < MIN) { sync(); return; }
      openEditor({ rect: { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) }, text: '' });
      return;
    }
    if (d.moved && d.next) write(list().map(a => (a.id === d.id ? d.next : a)));
    else sync();
  }
  function onDblClick(e) {
    const box = e.target.closest('.vw-annot, .vw-stroke');
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const a = find(box.dataset.annotId);
    if (a) openEditor({ id: a.id, rect: isStroke(a) ? strokeBox(a) : a, text: a.text });
  }
  function onMenu(e) {
    const box = e.target.closest('.vw-annot, .vw-stroke');
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const id = box.dataset.annotId, a = find(id);
    if (!a) return;
    select(id);
    const st = isStroke(a);
    showContextMenu({ x: e.clientX, y: e.clientY, items: [{ action: 'edit', label: st ? '写一句话' : '修改文字' }, { action: 'delete', label: '删除' }], onAction: action => (action === 'delete' ? remove(id) : openEditor({ id, rect: st ? strokeBox(a) : a, text: a.text })) });
  }
  function remove(id = selected) {
    if (!id || !find(id)) return false;
    if (selected === id) selected = null;
    write(list().filter(a => a.id !== id));
    return true;
  }
  // 写字的小输入框：放在框下面（屏幕像素，不跟着缩放变小）。回车保存，Esc 取消，点别处也保存（有字时）
  function openEditor({ id = null, rect, text }) {
    closeEditor(false);
    const host = holder();
    if (!host) return;
    const s = scale() || 1, wrap = host.ownerDocument.createElement('label');
    wrap.className = 'g-field vw-annot-input';
    wrap.innerHTML = '<span>批注</span><input type="text" maxlength="2000" aria-label="批注内容" placeholder="写一句给 agent 的话，回车保存">';
    wrap.style.left = `${Math.max(0, rect.x * s)}px`;
    wrap.style.top = `${(rect.y + rect.height) * s + 6}px`;
    host.append(wrap);
    const input = wrap.querySelector('input');
    input.value = text || '';
    editor = { id, rect, wrap, input };
    if (!id) { const ghost = host.ownerDocument.createElement('div'); ghost.className = 'vw-annot vw-annot--draft'; Object.assign(ghost.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` }); layer.append(ghost); editor.ghost = ghost; }
    input.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeEditor(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditor(false); }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (editor?.input === input) closeEditor(true); }, 0));
    input.focus();
    input.select();
  }
  function closeEditor(save) {
    const ed = editor;
    if (!ed) return;
    editor = null;
    ed.wrap.remove();
    ed.ghost?.remove();
    const text = ed.input.value.trim();
    if (save && ed.id && isStroke(find(ed.id))) { // 线可以不配字：清空也保存
      if (find(ed.id).text === text) return sync();
      return write(list().map(a => (a.id === ed.id ? { ...a, text, at: new Date().toISOString() } : a)));
    }
    if (!save || !text) { sync(); return; }
    if (ed.id) {
      if (find(ed.id)?.text === text) return sync();
      write(list().map(a => (a.id === ed.id ? { ...a, text, at: new Date().toISOString() } : a)));
    } else {
      const a = { id: newId(), ...ed.rect, text, at: new Date().toISOString() };
      selected = a.id;
      write([...list(), a]);
      notice('批注已添加');
    }
  }
  /** 父页面的按键（不在输入框里时）：Delete 删选中的批注，Esc 先取消选中再退出批注模式。处理了返回 true。 */
  function handleKey(e) {
    if (editor) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(); return true; }
    if (e.key === 'Escape') {
      if (selected) { e.preventDefault(); select(null); return true; }
      if (mode) { e.preventDefault(); setMode(false); return true; }
      if (pen) { e.preventDefault(); setPen(false); return true; }
    }
    return false;
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // 点到批注层外面：取消选中
  document.addEventListener('pointerdown', e => { if (selected && !e.target.closest?.('.vw-annot-layer, .vw-annot-input, .g-context-menu, .qt-pen')) select(null); }, true);
  return {
    sync, setMode, setPen, remove, handleKey, toolbarHTML, toolbarAction,
    toggle() { setMode(!mode); },
    togglePen() { setPen(!pen); },
    get pen() { return pen; },
    deselect() { if (!selected) return false; select(null); return true; },
    get mode() { return mode; },
    get selected() { return selected; },
    reset() { selected = null; drag = null; closeEditor(false); mode = false; pen = false; layer?.remove(); layer = null; key = ''; },
  };
}
