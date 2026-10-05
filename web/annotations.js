// 批注（第 13 轮，docs/round13-contract.md §6）：用户在编辑画布上拖一个框、写一句话，交给 agent。
// 批注层在 #artboard-holder 里，和 #artboard 同一个缩放；坐标是页面 CSS 像素，存在 page.annotations。
// 只在编辑画布上显示：缩略图、放映、导出都不读它。像 Word 的「新建批注」：工具条按下「批注」后在画布上拖框。
import { showContextMenu } from './context-menu.js';

const MIN = 8; // 拖出来小于这个的框当作点了一下
const newId = () => `an_${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`;
const round = n => Math.round(n * 10) / 10;

export function createAnnotations({ holder, getProject, getPage, scale = () => 1, changed, notice = () => {}, onMode = () => {} }) {
  let layer = null, mode = false, selected = null, drag = null, editor = null, key = '';
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
  function boxHTML(a) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    return `<div class="vw-annot${a.id === selected ? ' is-selected' : ''}" data-annot-id="${esc(a.id)}" style="left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px" title="${esc(a.text)}"><span class="vw-annot__text">${esc(a.text)}</span><span class="vw-annot__grip" data-annot-grip aria-hidden="true"></span></div>`;
  }
  /** 跟着当前页和数据重画（批注改了、换页、撤销）。正在拖的时候不动。 */
  function sync() {
    const l = ensureLayer();
    if (!l) return;
    l.classList.toggle('is-mode', mode);
    if (selected && !find(selected)) selected = null;
    if (drag) return;
    const next = JSON.stringify([page()?.id, list(), selected]);
    if (next === key) return;
    key = next;
    l.innerHTML = list().map(boxHTML).join('');
    l.dataset.count = String(list().length);
  }
  function write(next) {
    const p = page();
    if (!p) return;
    if (next.length) p.annotations = next; else delete p.annotations;
    key = '';
    changed();
  }
  function select(id) { if (selected === id) return; selected = id; key = ''; sync(); }
  function setMode(on) {
    mode = !!on;
    if (!mode) closeEditor(false);
    sync();
    onMode(mode);
  }
  // 屏幕坐标 → 页面坐标
  function point(e) {
    const r = layer.getBoundingClientRect(), s = scale() || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }
  function onDown(e) {
    if (e.button !== 0) return;
    const box = e.target.closest('.vw-annot');
    if (editor && !e.target.closest('.vw-annot-input')) closeEditor(true);
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
    if (drag.kind === 'draw') {
      const r = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), width: Math.abs(dx), height: Math.abs(dy) };
      drag.rect = r;
      Object.assign(drag.ghost.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      return;
    }
    if (!drag.moved && Math.hypot(dx, dy) * (scale() || 1) < 3) return;
    drag.moved = true;
    const o = drag.orig;
    if (drag.kind === 'move') { drag.next = { ...o, x: round(o.x + dx), y: round(o.y + dy) }; }
    else drag.next = { ...o, width: round(Math.max(MIN, o.width + dx)), height: round(Math.max(MIN, o.height + dy)) };
    Object.assign(drag.node.style, { left: `${drag.next.x}px`, top: `${drag.next.y}px`, width: `${drag.next.width}px`, height: `${drag.next.height}px` });
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    layer?.classList.remove('is-dragging');
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
    const box = e.target.closest('.vw-annot');
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const a = find(box.dataset.annotId);
    if (a) openEditor({ id: a.id, rect: a, text: a.text });
  }
  function onMenu(e) {
    const box = e.target.closest('.vw-annot');
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const id = box.dataset.annotId, a = find(id);
    if (!a) return;
    select(id);
    showContextMenu({ x: e.clientX, y: e.clientY, items: [{ action: 'edit', label: '修改文字' }, { action: 'delete', label: '删除' }], onAction: action => (action === 'delete' ? remove(id) : openEditor({ id, rect: a, text: a.text })) });
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
    }
    return false;
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // 点到批注层外面：取消选中
  document.addEventListener('pointerdown', e => { if (selected && !e.target.closest?.('.vw-annot-layer, .vw-annot-input, .g-context-menu')) select(null); }, true);
  return {
    sync, setMode, remove, handleKey,
    toggle() { setMode(!mode); },
    deselect() { if (!selected) return false; select(null); return true; },
    get mode() { return mode; },
    get selected() { return selected; },
    reset() { selected = null; drag = null; closeEditor(false); mode = false; layer?.remove(); layer = null; key = ''; },
  };
}
