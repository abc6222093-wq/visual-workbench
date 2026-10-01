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
  page.steps = page.steps.map(step => ({ ...step, tracks: step.tracks.filter(track => !removed.has(track.target)) })).filter(step => step.tracks.length);
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
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; }
  };
}
export function rootSelection(page, ids) {
  const set = new Set(ids);
  return ids.filter(id => { const found = findElement(page, id); return found && !found.ancestors.some(parent => set.has(parent.id)); });
}
export function resizeGroup(target, original, width, height) {
  const sx = original.width ? width / original.width : 1;
  const sy = original.height ? height / original.height : 1;
  target.width = Math.round(width); target.height = Math.round(height);
  const resize = (items, oldItems) => items.forEach((item, index) => {
    const old = oldItems[index];
    item.x = Math.round(old.x * sx); item.y = Math.round(old.y * sy);
    item.width = Math.max(0, Math.round(old.width * sx));
    item.height = Math.max(0, Math.round(old.height * sy));
    if (item.type === 'text') { item.fontSize = Math.max(1, +(old.fontSize * Math.min(sx, sy)).toFixed(2)); if (old.letterSpacing != null) item.letterSpacing = +(old.letterSpacing * sx).toFixed(2); }
    if (item.children) resize(item.children, old.children);
  });
  resize(target.children, original.children);
}
