// 页面整理的纯逻辑（第 12 轮）：选择、排序、页面剪贴板。
// 加页、复制页、删页、跨项目复制由服务端做（页面文件和资源一起处理：POST /api/projects/:id/pages）。
const clone = value => structuredClone(value);
export function selectPageIds(pages, selected, id, event = {}, anchorId = null) {
  const ids = pages.map(p => p.id), set = new Set(selected || []);
  if (!ids.includes(id)) return { selectedPageIds: ids.filter(x => set.has(x)), anchorId };
  if (event.shiftKey && ids.includes(anchorId)) {
    if (!event.metaKey && !event.ctrlKey) set.clear();
    const a = ids.indexOf(anchorId), b = ids.indexOf(id);
    ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => set.add(x));
  } else if (event.metaKey || event.ctrlKey || event.toggle) { set.has(id) ? set.delete(id) : set.add(id); anchorId = id; }
  else { set.clear(); set.add(id); anchorId = id; }
  return { selectedPageIds: ids.filter(x => set.has(x)), anchorId };
}
/** 拖动排序：把 ids 挪到 targetId 前面 / 后面（不改入参）。目标就是被拖的页时原地不动。 */
export function movePages(project, ids, targetId, position = 'before') {
  const set = new Set(ids), out = clone(project), moving = out.pages.filter(p => set.has(p.id));
  if (!set.has(targetId)) {
    out.pages = out.pages.filter(p => !set.has(p.id));
    let index = out.pages.findIndex(p => p.id === targetId);
    if (index < 0) index = out.pages.length; else if (position === 'after') index++;
    out.pages.splice(index, 0, ...moving);
  }
  return { project: out, selectedPageIds: moving.map(p => p.id) };
}
// 页面剪贴板只记「哪个项目的哪几页」：粘贴时同一项目走 duplicate，别的项目走 copy-from（服务端带上页面文件和资源）
export const PAGE_CLIPBOARD_TYPE = 'visual-workbench/page-refs';
const KEY = 'visual-workbench.page-clipboard';
export function pageClipboard(project, ids) {
  const order = project.pages.map(p => p.id).filter(id => ids.includes(id));
  return { type: PAGE_CLIPBOARD_TYPE, fromProject: project.id, pageIds: order };
}
export function readPageClipboard(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage?.getItem(KEY) || 'null'); return v?.type === PAGE_CLIPBOARD_TYPE && typeof v.fromProject === 'string' && Array.isArray(v.pageIds) ? v : null; } catch { return null; }
}
export function writePageClipboard(value, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(value)); } catch {}
}
