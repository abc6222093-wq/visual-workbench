const clone = value => structuredClone(value);
const walk = (elements, fn) => { for (const el of elements || []) { fn(el); walk(el.children, fn); } };
function allocator(project) {
  const used = new Set();
  function collect(v) { if (!v || typeof v !== 'object') return; if (typeof v.id === 'string') used.add(v.id); Object.values(v).forEach(collect); }
  collect(project); let n = 0;
  return prefix => { let id; do { id = prefix + (++n).toString(36).padStart(8, '0'); } while (used.has(id)); used.add(id); return id; };
}
export function selectPageIds(pages, selected, id, event = {}, anchorId = null) {
  const ids = pages.map(p => p.id), set = new Set(selected || []);
  if (!ids.includes(id)) return { selectedPageIds: ids.filter(x => set.has(x)), anchorId };
  if (event.shiftKey && ids.includes(anchorId)) {
    if (!event.metaKey && !event.ctrlKey) set.clear();
    const a = ids.indexOf(anchorId), b = ids.indexOf(id);
    ids.slice(Math.min(a,b), Math.max(a,b)+1).forEach(x => set.add(x));
  } else if (event.metaKey || event.ctrlKey || event.toggle) { set.has(id) ? set.delete(id) : set.add(id); anchorId = id; }
  else { set.clear(); set.add(id); anchorId = id; }
  return { selectedPageIds: ids.filter(x => set.has(x)), anchorId };
}
export function copyPages(project, ids) { const set = new Set(ids); return { type:'visual-workbench/pages', projectId:project.id, pages:clone(project.pages.filter(p => set.has(p.id))) }; }
export function remapMotionSource(source, map) { return source.replace(/[a-zA-Z0-9_]+/g, token => map.get(token) || token); }
function copiedPage(page, allocate) {
  const out = clone(page), map = new Map(); out.id = allocate('page_');
  walk(out.elements, el => { const id = allocate('el_'); map.set(el.id,id); el.id=id; });
  const outlineIds = new Map();
  function remap(v) { if (!v || typeof v !== 'object') return; if (typeof v.id === 'string') { if (!outlineIds.has(v.id)) outlineIds.set(v.id,allocate(v.id.startsWith('image_')?'image_':'row_')); v.id=outlineIds.get(v.id); } if (map.has(v.elementId)) v.elementId=map.get(v.elementId); Object.values(v).forEach(remap); }
  remap(out.outline); if (out.motion?.source) out.motion.source=remapMotionSource(out.motion.source,map); return out;
}
export function pastePages(project, clipboard, afterId) {
  if (clipboard?.type !== 'visual-workbench/pages' || clipboard.projectId !== project.id) throw new Error('页面仅支持在同一项目内粘贴');
  const out=clone(project), allocate=allocator(out), added=clipboard.pages.map(p=>copiedPage(p,allocate));
  const index=out.pages.findIndex(p=>p.id===afterId); out.pages.splice(index<0?out.pages.length:index+1,0,...added);
  return { project:out, selectedPageIds:added.map(p=>p.id), currentPageId:added[0]?.id || afterId };
}
export function duplicatePages(project, ids, afterId=ids.at(-1)) { return pastePages(project,copyPages(project,ids),afterId); }
export function deletePages(project, ids, currentPageId) {
  const set=new Set(ids), out=clone(project), index=project.pages.findIndex(p=>p.id===currentPageId); out.pages=out.pages.filter(p=>!set.has(p.id));
  if (!out.pages.length) throw new Error('请至少保留一页');
  const current=out.pages.find(p=>p.id===currentPageId)||out.pages[Math.min(Math.max(index,0),out.pages.length-1)];
  return {project:out,selectedPageIds:[],currentPageId:current.id};
}
export function movePages(project, ids, targetId, position='before') {
  const set=new Set(ids), out=clone(project), moving=out.pages.filter(p=>set.has(p.id));
  if (!set.has(targetId)) { out.pages=out.pages.filter(p=>!set.has(p.id)); let index=out.pages.findIndex(p=>p.id===targetId); if(index<0)index=out.pages.length; else if(position==='after')index++; out.pages.splice(index,0,...moving); }
  return {project:out,selectedPageIds:moving.map(p=>p.id)};
}
export function insertPage(project,targetId,position='after') {
  const out=clone(project), id=allocator(out)('page_'), page={id,name:'新页面',background:clone(project.pages.find(p=>p.id===targetId)?.background || '#ffffff'),elements:[]};
  let index=out.pages.findIndex(p=>p.id===targetId); if(index<0)index=out.pages.length; else if(position==='after')index++; out.pages.splice(index,0,page);
  return {project:out,selectedPageIds:[id],currentPageId:id};
}
