export const clone = value => structuredClone(value);
export const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
export function findElement(page, id) {
  function scan(items, parent = null, ancestors = []) {
    for (let index = 0; index < items.length; index++) {
      const element = items[index];
      if (element.id === id) return { element, items, index, parent, ancestors };
      if (element.type === 'group') { const found = scan(element.children, element, [...ancestors, element]); if (found) return found; }
    }
  }
  return scan(page.elements);
}
export function allElements(page) {
  const result = [];
  const scan = items => items.forEach(element => { result.push(element); if (element.type === 'group') scan(element.children); });
  scan(page.elements); return result;
}
export function editable(page, id) {
  const found = findElement(page, id);
  return found && !found.element.locked && !found.ancestors.some(item => item.locked);
}
export function mutateElements(page, ids, change) {
  ids.forEach(id => { if (editable(page, id)) change(findElement(page, id).element); });
}
export function duplicateElements(page, ids) {
  ids = rootSelection(page, ids);
  const copies = [];
  const renew = element => { element.id = uid('el'); if (element.children) element.children.forEach(renew); };
  ids.forEach(id => { const found = findElement(page, id); if (!found || !editable(page, id)) return; const copy = clone(found.element); renew(copy); copy.x += 24; copy.y += 24; found.items.splice(found.index + 1, 0, copy); copies.push(copy.id); });
  return copies;
}
export function deleteElements(page, ids) {
  ids = rootSelection(page, ids);
  const removed = new Set();
  const collect = element => { removed.add(element.id); element.children?.forEach(collect); };
  ids.forEach(id => { const found = findElement(page, id); if (!found || !editable(page, id)) return; collect(found.element); found.items.splice(found.index, 1); });
  return removed;
}
export function reorderPages(project, selectedPageId, from, to) {
  if (from < 0 || from >= project.pages.length || to < 0 || to >= project.pages.length) return selectedPageId;
  project.pages.splice(to, 0, project.pages.splice(from, 1)[0]); return selectedPageId;
}
export function createHistory(initial, limit = 60) {
  let current = clone(initial), past = [], future = [];
  return {
    get value() { return current; },
    commit(next) { past.push(clone(current)); if (past.length > limit) past.shift(); current = clone(next); future = []; },
    undo() { if (!past.length) return current; future.push(clone(current)); current = past.pop(); return clone(current); },
    redo() { if (!future.length) return current; past.push(clone(current)); current = future.pop(); return clone(current); },
    replace(next) { current = clone(next); past = []; future = []; },
    // 连续输入（同一次文字编辑）合并进上一条记录：只更新当前值，不新增撤销步骤
    amend(next) { current = clone(next); future = []; },
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; }
  };
}
export function rootSelection(page, ids) {
  const set = new Set(ids);
  return ids.filter(id => { const found = findElement(page, id); return found && !found.ancestors.some(parent => set.has(parent.id)); });
}
// ---------- 整体等比缩放（第 11 轮）：分组、多选、文字框拖角、「整体缩放 %」共用同一套规则 ----------
// 缩放外观数值：字号、字距、描边粗细、投影偏移 / 模糊、圆角（old 是缩放前的样子，target 写入结果）
const r2 = value => Math.round(value * 100) / 100;
export function scaleStyle(target, old, factor) {
  if (old.fontSize != null) target.fontSize = Math.max(1, r2(old.fontSize * factor));
  if (old.letterSpacing != null) target.letterSpacing = r2(old.letterSpacing * factor);
  if (old.cornerRadius != null) target.cornerRadius = Math.max(0, r2(old.cornerRadius * factor));
  if (old.stroke && typeof old.stroke === "object") target.stroke = { ...old.stroke, width: Math.max(0, r2((old.stroke.width || 0) * factor)) };
  if (old.shadow && typeof old.shadow === "object") target.shadow = { ...old.shadow, x: r2((old.shadow.x || 0) * factor), y: r2((old.shadow.y || 0) * factor), blur: Math.max(0, r2((old.shadow.blur || 0) * factor)) };
}
// 元素本身按比例缩放：宽高、外观数值；分组里的子元素位置（即组内间距）、尺寸、外观一起变。不动 target 自己的 x / y
export function scaleElement(target, old, factor) {
  target.width = Math.max(0, Math.round(old.width * factor));
  target.height = Math.max(0, Math.round(old.height * factor));
  scaleStyle(target, old, factor);
  (old.children || []).forEach((child, index) => {
    const next = target.children?.[index];
    if (!next) return;
    next.x = Math.round(child.x * factor); next.y = Math.round(child.y * factor);
    scaleElement(next, child, factor);
  });
}
// 纯函数：一组同一坐标系里的元素以 origin 为基准整体缩放 factor 倍，返回新的元素（不改传入的）。
// 以元素中心换算位置，旋转过的元素也保持相对位置。
export function scaleElements(elements, factor, origin) {
  return elements.map(old => {
    const next = clone(old), cx = old.x + old.width / 2, cy = old.y + old.height / 2;
    scaleElement(next, old, factor);
    next.x = Math.round(origin.x + (cx - origin.x) * factor - next.width / 2);
    next.y = Math.round(origin.y + (cy - origin.y) * factor - next.height / 2);
    return next;
  });
}
// 分组缩放：factor 给定（拖角、整体缩放）时等比，子元素的字号、描边、投影、圆角、组内间距一起按比例变；
// 不给 factor（拖边）时两个方向各自缩放（旧行为）
export function resizeGroup(target, original, width, height, factor = null) {
  if (factor != null) { scaleElement(target, original, factor); target.width = Math.round(width); target.height = Math.round(height); return; }
  const sx = original.width ? width / original.width : 1;
  const sy = original.height ? height / original.height : 1;
  target.width = Math.round(width); target.height = Math.round(height);
  const resize = (items, oldItems) => items.forEach((item, index) => {
    const old = oldItems[index];
    item.x = Math.round(old.x * sx); item.y = Math.round(old.y * sy);
    item.width = Math.max(0, Math.round(old.width * sx));
    item.height = Math.max(0, Math.round(old.height * sy));
    if (item.type === "text") { item.fontSize = Math.max(1, +(old.fontSize * Math.min(sx, sy)).toFixed(2)); if (old.letterSpacing != null) item.letterSpacing = +(old.letterSpacing * sx).toFixed(2); }
    if (item.children) resize(item.children, old.children);
  });
  resize(target.children, original.children);
}
// 生成给 agent 看的引用文字：每行「项目 <编号> · 第 N 页（<页面编号>）」，选中元素接在当前页那行后面
export function referenceText(project, { checkedPageIds = [], currentPageId, selectedIds = [] } = {}) {
  const pages = project.pages || [];
  const head = `项目 ${project.id}`;
  if (!pages.length) return head;
  const current = pages.find(page => page.id === currentPageId) || pages[0];
  const checked = new Set(checkedPageIds);
  const elementIds = [...new Set(selectedIds)].filter(id => findElement(current, id));
  // 勾选里不存在的页面编号忽略；勾选为空（或全无效）时当前页总要出一行
  const anyChecked = pages.some(page => checked.has(page.id));
  const rows = pages.filter(page => checked.has(page.id) || (page === current && (elementIds.length > 0 || !anyChecked)));
  return rows.map(page => {
    const line = `${head} · 第 ${pages.indexOf(page) + 1} 页（${page.id}）`;
    return page === current && elementIds.length ? `${line} · ${elementIds.join('、')}` : line;
  }).join('\n');
}

// Delta is in parent coordinates; the opposite edge remains fixed under rotation.
export function resizeBounds(old, edge, dx, dy) {
  const angle = (old.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const w = edge.includes('w'), e = edge.includes('e'), n = edge.includes('n'), south = edge.includes('s');
  const width = w || e ? Math.max(0, Math.round(old.width + (w ? -lx : lx))) : old.width;
  const height = n || south ? Math.max(0, Math.round(old.height + (n ? -ly : ly))) : old.height;
  const sx = (width - old.width) * (w ? -1 : e ? 1 : 0) / 2;
  const sy = (height - old.height) * (n ? -1 : south ? 1 : 0) / 2;
  return { width, height, x: old.x + (old.width - width) / 2 + sx*c - sy*s,
    y: old.y + (old.height - height) / 2 + sx*s + sy*c };
}
