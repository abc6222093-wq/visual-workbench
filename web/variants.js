// 变体与并排对比（第 11 轮）：「多试几版颜色」。
// 复制为变体：元素（或整组多选）/ 页面复制 N 份，副本写 variantOf = 原件 id，名字加「· 变体 n」。
// 并排对比：原件与各变体并排显示，每份下方「选定这一份」——选定的那份内容写回原件（原件 id 不变，动效引用照常），其余变体全部删除。
// 纯数据函数不碰 DOM；界面函数只用调用方给的 modal / render，不碰 app.js 的状态。
import { clone, uid, findElement, allElements, rootSelection, deleteElements } from './editor.js';
import { elementInPage } from './element-operations.js';
import { duplicatePages, remapMotionSource } from './page-operations.js';
import { pageSize } from './project-kinds.js';

const GAP = 24;
const walk = (elements, fn) => { for (const el of elements || []) { fn(el); walk(el.children, fn); } };
const flat = (elements) => { const out = []; walk(elements, (el) => out.push(el)); return out; };
const baseName = (item, fallback) => String(item.name || item.text || fallback || '').replace(/\s*·\s*变体\s*\d+$/, '').slice(0, 60) || fallback;

/** 当前页有没有变体：页里有带 variantOf 的元素，或这一页是变体 / 有变体页。 */
export function hasVariants(project, page) {
  if (!project || !page) return false;
  if (page.variantOf || project.pages.some((p) => p.variantOf === page.id)) return true;
  return allElements(page).some((el) => el.variantOf);
}

/** 选区的外框（页面坐标）。 */
function boundsOf(page, ids) {
  const boxes = ids.map((id) => elementInPage(page, id)).filter(Boolean);
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

/**
 * 元素变体：把选中的（根）元素整组复制 count 份，依次向右排开（页面宽度放不下则向下），相隔 24px。
 * 返回 { ids: 新元素 id（全部）, sets: [[第 1 份的 id…], …] }。
 */
export function makeElementVariants(project, page, ids, count) {
  ids = rootSelection(page, ids).filter((id) => findElement(page, id));
  count = Math.max(1, Math.min(8, Math.round(Number(count) || 0)));
  const box = boundsOf(page, ids);
  if (!ids.length || !box) return { ids: [], sets: [] };
  const width = pageSize(project, page).width;
  const right = box.x + count * (box.width + GAP) + box.width <= width;
  const sets = [];
  const existing = Math.max(0, ...ids.map((id) => allElements(page).filter((el) => el.variantOf === id).length));
  for (let n = 1; n <= count; n++) {
    const dx = right ? n * (box.width + GAP) : 0, dy = right ? 0 : n * (box.height + GAP);
    const set = [];
    for (const id of ids) {
      const found = findElement(page, id);
      const copy = clone(found.element);
      walk([copy], (el) => { el.id = uid('el'); delete el.variantOf; });
      copy.variantOf = id;
      copy.name = `${baseName(found.element, found.element.type)} · 变体 ${existing + n}`;
      copy.x = Math.round(copy.x + dx); copy.y = Math.round(copy.y + dy);
      const z = Math.max(0, ...allElements(page).map((el) => el.zIndex || 0)) + 1;
      if (!found.parent) copy.zIndex = z;
      let at = found.index + 1; // 排在原件和它已有的变体后面
      while (found.items[at]?.variantOf === id) at++;
      found.items.splice(at, 0, copy);
      set.push(copy.id);
    }
    sets.push(set);
  }
  return { ids: sets.flat(), sets };
}

/** 页面变体：复制 count 份，紧跟在原页（及已有变体）后面；返回 { project, ids }。 */
export function makePageVariants(project, pageId, count) {
  count = Math.max(1, Math.min(8, Math.round(Number(count) || 0)));
  const source = project.pages.find((p) => p.id === pageId);
  if (!source) return { project, ids: [] };
  const rootId = source.variantOf && project.pages.some((p) => p.id === source.variantOf) ? source.variantOf : source.id;
  const root = project.pages.find((p) => p.id === rootId);
  let out = project, after = [...project.pages].reverse().find((p) => p.id === rootId || p.variantOf === rootId).id;
  const existing = project.pages.filter((p) => p.variantOf === rootId).length;
  const ids = [];
  for (let n = 1; n <= count; n++) {
    const result = duplicatePages(out, [source.id], after);
    out = result.project;
    const copy = out.pages.find((p) => p.id === result.selectedPageIds[0]);
    copy.variantOf = rootId;
    copy.name = `${baseName(root, '页面')} · 变体 ${existing + n}`;
    after = copy.id; ids.push(copy.id);
  }
  return { project: out, ids };
}

/** 当前页上的元素变体组：sets[0] 是原件，sets[k] 是第 k 份变体（各原件的第 k 个变体）。 */
export function elementVariantSets(page) {
  const all = allElements(page);
  const originals = all.filter((el) => !el.variantOf && all.some((v) => v.variantOf === el.id)).map((el) => el.id);
  const byOriginal = originals.map((id) => all.filter((el) => el.variantOf === id).map((el) => el.id));
  const max = Math.max(0, ...byOriginal.map((list) => list.length));
  const sets = [originals];
  for (let k = 0; k < max; k++) sets.push(byOriginal.map((list) => list[k]).filter(Boolean));
  return { originals, byOriginal, sets };
}

/** 把 from 的子树内容写回 to（to 的 id 保留；子元素按先后顺序且类型相同的保留原 id）。返回 旧 id → 新 id 的映射（给动效源码用）。 */
function adoptElement(to, from, keep = {}) {
  const keepIds = new Map();
  const left = flat(to.children), right = flat(from.children);
  right.forEach((el, i) => { if (left[i] && left[i].type === el.type) keepIds.set(el.id, left[i].id); });
  const next = clone(from);
  walk(next.children, (el) => { if (keepIds.has(el.id)) el.id = keepIds.get(el.id); });
  for (const key of Object.keys(to)) delete to[key];
  Object.assign(to, next, { id: keep.id, name: keep.name, x: keep.x, y: keep.y });
  if (keep.zIndex !== undefined) to.zIndex = keep.zIndex;
  if (keep.origin !== undefined) to.origin = keep.origin;
  if (keep.variantOf !== undefined) to.variantOf = keep.variantOf; else delete to.variantOf;
  return keepIds;
}

/** 选定第 k 份元素变体（0 = 原件）：选定那份的属性写回原件（位置、id、名字、层级不变），删除全部变体。 */
export function chooseElementVariant(page, k) {
  const { originals, byOriginal } = elementVariantSets(page);
  originals.forEach((id, i) => {
    const chosenId = k > 0 ? byOriginal[i][k - 1] : null;
    const original = findElement(page, id)?.element, chosen = chosenId && findElement(page, chosenId)?.element;
    if (original && chosen) {
      const keep = { id: original.id, name: original.name, x: original.x, y: original.y, zIndex: original.zIndex, origin: original.origin, variantOf: original.variantOf };
      adoptElement(original, chosen, keep);
    }
    deleteElements(page, byOriginal[i]);
  });
  return originals;
}

/** 页面变体组：rootId 与各变体页 id（按页面顺序）。 */
export function pageVariantSet(project, page) {
  const rootId = page.variantOf && project.pages.some((p) => p.id === page.variantOf) ? page.variantOf : page.id;
  const variants = project.pages.filter((p) => p.variantOf === rootId).map((p) => p.id);
  return variants.length ? { rootId, ids: [rootId, ...variants] } : null;
}

/** 选定页面变体：选定那页的内容写回原页（原页 id、名字不变，元素尽量保留原 id），删除全部变体页。返回新项目。 */
export function choosePageVariant(project, chosenId) {
  const out = clone(project), chosen = out.pages.find((p) => p.id === chosenId);
  const rootId = chosen?.variantOf && out.pages.some((p) => p.id === chosen.variantOf) ? chosen.variantOf : chosenId;
  const root = out.pages.find((p) => p.id === rootId);
  if (!root || !chosen) return out;
  if (chosen !== root) {
    const left = flat(root.elements), right = flat(chosen.elements), map = new Map();
    right.forEach((el, i) => { if (left[i] && left[i].type === el.type) map.set(el.id, left[i].id); });
    const next = clone(chosen);
    walk(next.elements, (el) => { if (map.has(el.id)) el.id = map.get(el.id); });
    if (next.motion?.source) next.motion.source = remapMotionSource(next.motion.source, map);
    const remapOutline = (v) => { if (!v || typeof v !== 'object') return; if (map.has(v.elementId)) v.elementId = map.get(v.elementId); Object.values(v).forEach(remapOutline); };
    remapOutline(next.outline);
    const keep = { id: root.id, name: root.name, origin: root.origin, variantOf: root.variantOf };
    for (const key of Object.keys(root)) delete root[key];
    Object.assign(root, next, keep);
    if (keep.origin === undefined) delete root.origin;
    if (keep.variantOf === undefined) delete root.variantOf;
  }
  out.pages = out.pages.filter((p) => p.variantOf !== rootId || p === root);
  return out;
}

// ---------- 界面 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 「复制为变体…」小窗：选 2 / 3 / 4 份，确定后调 onPick(n)。 */
export function openVariantDialog({ modal, closeModal, title = '复制为变体', note = '', onPick }) {
  modal(`<h2>${esc(title)}</h2><p class="g-sheet__note">${esc(note || '每份变体都是一份可以单独改颜色、文字、位置的副本；改好后点工具栏的「并排对比」选定一份。')}</p><div class="g-seg vw-variant-count" role="radiogroup" aria-label="变体份数">${[2, 3, 4].map((n) => `<button type="button" role="radio" data-variant-count="${n}" class="${n === 3 ? 'active' : ''}" aria-checked="${n === 3}">${n} 份</button>`).join('')}</div><div class="g-sheet__actions"><button class="g-btn" type="button" data-variant-cancel>取消</button><button class="g-btn g-btn--prism" type="button" data-variant-ok>生成变体</button></div>`);
  const root = document.querySelector('#modal-root');
  let count = 3;
  root.querySelectorAll('[data-variant-count]').forEach((b) => b.onclick = () => {
    count = Number(b.dataset.variantCount);
    root.querySelectorAll('[data-variant-count]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on)); });
  });
  root.querySelector('[data-variant-cancel]').onclick = () => closeModal();
  root.querySelector('[data-variant-ok]').onclick = () => { closeModal(); onPick(count); };
}

/**
 * 并排对比弹层（全屏玻璃）。
 * items：[{ label, page, clip?: {x,y,width,height} }]（clip 为页面坐标；没有 clip 时整页缩放到同一宽度）。
 * render(page) 返回页面节点（renderPage）。onChoose(index) 选定第 index 份。Esc 关闭。
 */
export function openCompare({ project, items, render, onChoose, title = '并排对比' }) {
  closeCompare();
  const layer = document.createElement('div');
  layer.className = 'vw-compare';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', title);
  layer.innerHTML = `<div class="vw-compare__head"><h2>${esc(title)}</h2><p>选定一份后，其余变体会删掉，选定的内容留在原件的位置（可以撤销）</p><div class="vw-compare__spacer"></div><button class="g-btn" type="button" data-compare-close>关闭</button></div><div class="vw-compare__row"></div>`;
  const row = layer.querySelector('.vw-compare__row');
  const count = Math.max(1, items.length);
  const availW = Math.max(160, (window.innerWidth - 48 - (count - 1) * 16) / count - 28);
  const availH = Math.max(160, window.innerHeight - 190);
  // 元素变体：统一尺寸（各份外框的最大宽高）；页面变体：缩放到同一宽度
  const clipW = Math.max(...items.map((it) => it.clip?.width || 0)), clipH = Math.max(...items.map((it) => it.clip?.height || 0));
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'vw-compare__card';
    card.dataset.compareIndex = String(index);
    const frame = document.createElement('div');
    frame.className = 'vw-compare__frame';
    const node = render(item.page);
    node.removeAttribute('id');
    node.style.position = 'absolute'; node.style.left = '0'; node.style.top = '0'; node.style.transformOrigin = 'top left'; node.style.pointerEvents = 'none';
    const size = pageSize(project, item.page);
    if (item.clip) {
      const scale = Math.min(availW / clipW, availH / clipH, 1);
      frame.style.width = `${clipW * scale}px`; frame.style.height = `${clipH * scale}px`;
      const cx = item.clip.x - (clipW - item.clip.width) / 2, cy = item.clip.y - (clipH - item.clip.height) / 2;
      node.style.transform = `scale(${scale}) translate(${-cx}px, ${-cy}px)`;
    } else {
      const scale = Math.min(availW / size.width, 1);
      frame.style.width = `${size.width * scale}px`; frame.style.height = `${size.height * scale}px`;
      frame.classList.add('is-page');
      node.style.transform = `scale(${scale})`;
    }
    frame.append(node);
    const box = document.createElement('div');
    box.className = 'vw-compare__frame-box';
    box.append(frame);
    const foot = document.createElement('div');
    foot.className = 'vw-compare__foot';
    foot.innerHTML = `<span>${esc(item.label)}</span><button class="g-btn g-btn--prism" type="button" data-compare-choose="${index}">选定这一份</button>`;
    card.append(box, foot);
    row.append(card);
  });
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeCompare(); return; }
  };
  layer.addEventListener('click', (e) => {
    const choose = e.target.closest('[data-compare-choose]');
    if (choose) { closeCompare(); onChoose(Number(choose.dataset.compareChoose)); return; }
    if (e.target.closest('[data-compare-close]') || e.target === layer) closeCompare();
  });
  window.addEventListener('keydown', key, true);
  layer._close = () => window.removeEventListener('keydown', key, true);
  document.body.append(layer);
  layer.querySelector('[data-compare-choose]')?.focus();
  return layer;
}
export function closeCompare() {
  const layer = document.querySelector('.vw-compare');
  if (!layer) return false;
  layer._close?.();
  layer.remove();
  return true;
}

/** 元素变体的对比项：每份裁到这一份元素的外框加 24px 边距。 */
export function elementCompareItems(page) {
  const { sets } = elementVariantSets(page);
  return sets.map((ids, k) => {
    const box = boundsOf(page, ids);
    return box && { label: k === 0 ? '原件' : `变体 ${k}`, page, clip: { x: box.x - GAP, y: box.y - GAP, width: box.width + GAP * 2, height: box.height + GAP * 2 } };
  }).filter(Boolean);
}
