// 第 9 轮：项目总览的选择习惯（日常办公软件的选择习惯）。独立模块，不读 app.js 的内部状态。
// 普通单击照常打开；Cmd / Ctrl 单击或勾选框切换选中并记为锚点；Shift 单击从锚点选到当前卡片（没有锚点时切换单张）；
// 空白处拖框多选（拖到滚动区上下边缘自动滚动）；点空白、Esc 取消；Delete / Backspace 删除；右键卡片出上下文菜单；有选中时底部浮出选择条。
import { showContextMenu } from './context-menu.js';

const CELL = '.hm-cell[data-project-id]';
const DRAG_MIN = 3;
const EDGE = 40; // 拖框时离滚动区上下边缘这么近就自动滚动
const EDGE_SPEED = 24; // 贴到边缘（或拖出去）时每帧最多滚动的像素
// 焦点在可输入的控件里时不接管 Delete / Backspace（勾选框、按钮不算输入）
const typing = (el) => !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset)$/i.test(el.type)));

// canMove：右键菜单多一项「移到…」（第 13 轮文件夹），选了调用 onAction('move', ids, { x, y })
export function mountHomeSelection(root, { onOpen = () => {}, onAction = () => {}, onChange, canMove = false } = {}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const host = root.parentElement || root; // 选择条放在 .hm-panel 里
  const selected = new Set();
  let drag = null, closeMenu = null, anchor = null;
  const cells = () => [...root.querySelectorAll(CELL)];
  const cellOf = (el) => el?.closest?.(CELL);
  const ids = () => cells().map((c) => c.dataset.projectId).filter((id) => selected.has(id));

  // 勾选框：每张卡片左上角一个 g-check，不进卡片按钮（避免触发打开）
  for (const cell of cells()) {
    const box = doc.createElement('input');
    box.type = 'checkbox'; box.className = 'g-check hm-check'; box.dataset.hmCheck = cell.dataset.projectId;
    box.setAttribute('aria-label', `选择项目 ${cell.querySelector('.hm-card__info strong')?.textContent || cell.dataset.projectId}`);
    cell.prepend(box);
  }
  const bar = doc.createElement('div');
  bar.className = 'hm-selbar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '已选项目');
  bar.innerHTML = '<span class="hm-selbar__count">已选 <b>0</b> 个项目</span><button type="button" class="g-btn" data-hm-sel="delete">删除</button><button type="button" class="g-btn" data-hm-sel="clear">取消选择</button>';
  host.append(bar);
  host.classList.add('hm-sel-host'); root.classList.add('hm-sel-root');

  function render() {
    for (const id of [...selected]) if (!root.querySelector(`${CELL}[data-project-id="${CSS.escape(id)}"]`)) selected.delete(id);
    for (const cell of cells()) {
      const on = selected.has(cell.dataset.projectId);
      cell.classList.toggle('is-selected', on);
      const box = cell.querySelector(':scope > .hm-check'); if (box) box.checked = on;
    }
    root.classList.toggle('has-selection', selected.size > 0);
    bar.hidden = !selected.size;
    bar.querySelector('b').textContent = String(selected.size);
    onChange?.(ids());
  }
  const set = (next) => { selected.clear(); for (const id of next) selected.add(id); render(); };
  const toggle = (id) => { selected.has(id) ? selected.delete(id) : selected.add(id); render(); };
  const clear = () => { anchor = null; if (selected.size) set([]); };
  // Shift 单击：按卡片顺序把锚点到当前卡片的整段加进选中；锚点不在了（或没有）就只切换这一张，且不设锚点
  function range(id) {
    const order = cells().map((c) => c.dataset.projectId);
    const a = order.indexOf(anchor), b = order.indexOf(id);
    if (a < 0 || b < 0) { anchor = null; toggle(id); return; }
    set(new Set([...selected, ...order.slice(Math.min(a, b), Math.max(a, b) + 1)]));
  }

  // 捕获阶段：修饰键单击卡片只切换选中，挡住 app 的「打开」
  function click(e) {
    const cell = cellOf(e.target);
    if (!cell || !e.target.closest('[data-action="open"]')) return;
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return;
    e.preventDefault(); e.stopPropagation();
    const id = cell.dataset.projectId;
    if (e.shiftKey && !(e.metaKey || e.ctrlKey)) range(id);
    else { anchor = id; toggle(id); }
  }
  function change(e) {
    const box = e.target.closest?.('.hm-check'); if (!box) return;
    e.stopPropagation(); anchor = box.dataset.hmCheck; toggle(anchor);
  }
  function checkClick(e) { if (e.target.closest?.('.hm-check')) e.stopPropagation(); }

  // 空白处按下：拖过 3px 才算框选；没拖动就是「点空白」→ 取消选择
  // 框选坐标一律用滚动内容坐标，滚动时起点跟着内容走
  const content = (x, y) => { const r = root.getBoundingClientRect(); return { x: x - r.left - root.clientLeft + root.scrollLeft, y: y - r.top - root.clientTop + root.scrollTop }; };
  function down(e) {
    if (e.button !== 0 || e.target.closest('.hm-cell, button, input, a, select, textarea, [data-action]')) return;
    const r = root.getBoundingClientRect();
    if (e.clientX - r.left >= root.clientLeft + root.clientWidth || e.clientY - r.top >= root.clientTop + root.clientHeight) return; // 滚动条
    drag = { x: e.clientX, y: e.clientY, start: content(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY, add: e.shiftKey, base: e.shiftKey ? [...selected] : [], box: null, raf: 0 };
    win.addEventListener('pointermove', move, true); win.addEventListener('pointerup', up, true); win.addEventListener('pointercancel', up, true);
  }
  function move(e) {
    if (!drag) return;
    if (!drag.box && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_MIN) return;
    e.preventDefault();
    drag.cx = e.clientX; drag.cy = e.clientY;
    if (!drag.box) { drag.box = doc.createElement('div'); drag.box.className = 'hm-marquee'; root.append(drag.box); root.classList.add('is-marquee'); }
    update(); autoScroll();
  }
  function update() {
    // 当前点限制在可见区域内：框不会撑大滚动内容，自动滚动到底就停
    const s = drag.start, q = content(drag.cx, drag.cy);
    const p = { x: Math.max(root.scrollLeft, Math.min(q.x, root.scrollLeft + root.clientWidth)), y: Math.max(root.scrollTop, Math.min(q.y, root.scrollTop + root.clientHeight)) };
    const l = Math.min(s.x, p.x), t = Math.min(s.y, p.y), rr = Math.max(s.x, p.x), b = Math.max(s.y, p.y);
    Object.assign(drag.box.style, { left: `${l}px`, top: `${t}px`, width: `${rr - l}px`, height: `${b - t}px` });
    const r = root.getBoundingClientRect(), ox = r.left + root.clientLeft - root.scrollLeft, oy = r.top + root.clientTop - root.scrollTop;
    const hits = cells().filter((c) => { const k = c.getBoundingClientRect(); return k.left - ox < rr && k.right - ox > l && k.top - oy < b && k.bottom - oy > t; }).map((c) => c.dataset.projectId);
    set(new Set([...drag.base, ...hits]));
  }
  // 指针离上 / 下边缘 40px 以内时逐帧滚动，越靠边越快；滚到头或离开边缘就停
  function edgeSpeed() {
    const r = root.getBoundingClientRect(), top = r.top + root.clientTop, bottom = top + root.clientHeight;
    const k = (d) => Math.ceil(EDGE_SPEED * Math.min(1, (EDGE - d) / EDGE));
    if (drag.cy < top + EDGE) return -k(drag.cy - top);
    if (drag.cy > bottom - EDGE) return k(bottom - drag.cy);
    return 0;
  }
  function autoScroll() {
    if (!drag?.box || drag.raf) return;
    const tick = () => {
      if (!drag?.box) return;
      drag.raf = 0;
      const v = edgeSpeed(); if (!v) return;
      const before = root.scrollTop;
      root.scrollTop = before + v;
      if (root.scrollTop === before) return;
      update();
      drag.raf = win.requestAnimationFrame(tick);
    };
    drag.raf = win.requestAnimationFrame(tick);
  }
  function up() {
    const d = drag; stopDrag();
    if (d && !d.box && !d.add) clear();
  }
  function stopDrag() {
    win.removeEventListener('pointermove', move, true); win.removeEventListener('pointerup', up, true); win.removeEventListener('pointercancel', up, true);
    if (drag?.raf) win.cancelAnimationFrame(drag.raf);
    drag?.box?.remove(); root.classList.remove('is-marquee'); drag = null;
  }

  // window 捕获阶段：Esc 取消、Delete 删除；菜单或弹窗开着时让它们自己处理
  function key(e) {
    if (!selected.size || !root.isConnected || doc.querySelector('.g-context-menu, .g-backdrop')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clear(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing(doc.activeElement)) { e.preventDefault(); e.stopPropagation(); onAction('delete', ids()); }
  }

  function menu(e) {
    const cell = cellOf(e.target); if (!cell) return;
    e.preventDefault();
    const id = cell.dataset.projectId, many = selected.has(id) && selected.size > 1, list = ids();
    const move = canMove ? [{ label: many ? `把 ${list.length} 个项目移到…` : '移到…', action: 'move' }] : [];
    const items = many
      ? [...move, { label: `删除 ${list.length} 个项目`, action: 'delete-selected' }, { separator: true }, { label: '取消选择', action: 'clear' }]
      : [{ label: '打开', action: 'open' }, { separator: true }, { label: '重命名', action: 'rename' }, { label: '复制项目', action: 'duplicate' }, ...move, { label: '删除项目', action: 'delete' }];
    const at = { x: e.clientX, y: e.clientY };
    closeMenu = showContextMenu({ x: e.clientX, y: e.clientY, items, document: doc, onAction: (a) => {
      closeMenu = null;
      if (a === 'open') onOpen(id);
      else if (a === 'move') onAction('move', many ? list : [id], at);
      else if (a === 'delete-selected') onAction('delete', list);
      else if (a === 'clear') clear();
      else onAction(a, [id]);
    } });
  }

  function barClick(e) {
    const b = e.target.closest('[data-hm-sel]'); if (!b) return;
    e.stopPropagation();
    if (b.dataset.hmSel === 'delete') onAction('delete', ids()); else clear();
  }

  root.addEventListener('click', click, true);
  root.addEventListener('click', checkClick);
  root.addEventListener('change', change);
  root.addEventListener('pointerdown', down);
  root.addEventListener('contextmenu', menu);
  bar.addEventListener('click', barClick);
  win.addEventListener('keydown', key, true);

  return {
    get selected() { return ids(); },
    clear,
    dispose() {
      stopDrag(); closeMenu?.(); closeMenu = null;
      root.removeEventListener('click', click, true); root.removeEventListener('click', checkClick); root.removeEventListener('change', change);
      root.removeEventListener('pointerdown', down); root.removeEventListener('contextmenu', menu); win.removeEventListener('keydown', key, true);
      root.querySelectorAll('.hm-check').forEach((b) => b.remove());
      for (const c of cells()) c.classList.remove('is-selected');
      bar.remove(); host.classList.remove('hm-sel-host'); root.classList.remove('hm-sel-root', 'has-selection', 'is-marquee');
      selected.clear(); anchor = null;
    },
  };
}
