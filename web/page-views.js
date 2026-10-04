import {selectPageIds} from './page-operations.js';
import {showContextMenu,closeContextMenu} from './context-menu.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preferenceKey='visual-workbench.page-view';
export function readPageViewPreference(storage=globalThis.localStorage) { try{return storage?.getItem(preferenceKey)==='timeline'?'timeline':'list';}catch{return 'list';} }
export function writePageViewPreference(mode,storage=globalThis.localStorage) { if(mode==='grid')return;try{storage?.setItem(preferenceKey,mode==='timeline'?'timeline':'list');}catch{} }
export function renderPageItems({project,currentPageId,selectedPageIds=[],mode='list'}) {
  const selected=new Set(selectedPageIds);
  return `<div class="page-view page-view--${esc(mode)}" data-page-view="${esc(mode)}" tabindex="0" aria-label="页面${mode==='grid'?'网格':mode==='timeline'?'时间轴':'列表'}">${project.pages.map((p,i)=>`<div class="ed-page ${p.id===currentPageId?'active':''} ${selected.has(p.id)?'is-selected':''}" data-page-index="${i}" data-page-id="${esc(p.id)}" draggable="true"><input class="g-check ed-page__check" type="checkbox" data-check="${esc(p.id)}" ${selected.has(p.id)?'checked':''} aria-label="选择第 ${i+1} 页"><button class="ed-page__open" data-action="switch" data-id="${esc(p.id)}" title="${esc(p.name)}"><span class="ed-page__thumb" aria-hidden="true" inert data-preview="${esc(p.id)}"></span><span class="ed-page__label"><b>${String(i+1).padStart(2,'0')}</b><i>${esc(p.name)}</i></span></button></div>`).join('')}</div>`;
}
export function pageContextItems(canPaste=true) { return [{action:'copy-pages',label:'复制'},{action:'paste-pages',label:'粘贴',disabled:!canPaste},{action:'duplicate-pages',label:'创建副本'},{separator:true},{action:'insert-page-before',label:'在前面插入页面'},{action:'insert-page-after',label:'在后面插入页面'},{separator:true},{action:'delete-pages',label:'删除'}]; }
// getContext must always return the latest app state, even after a rerender.
export function mountPageViews(root,{getContext,callbacks={}}) {
  const controller=new AbortController(), options={signal:controller.signal};
  // Thumbnails are static previews, never page cards or editor selection targets.
  for (const preview of root.querySelectorAll?.('[data-preview]') || []) {
    for (const node of preview.querySelectorAll('[data-page-id]')) node.removeAttribute('data-page-id');
    for (const node of preview.querySelectorAll('.is-selected')) node.classList.remove('is-selected');
  }
  const context=()=>getContext(); const action=(name,payload)=>callbacks.action?.(name,payload);
  const item=e=>e.target.closest?.('[data-page-index][data-page-id]');
  function select(id,e,toggle=false) { const c=context(), result=selectPageIds(c.project.pages,c.selectedPageIds,id,{metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,toggle},c.anchorId); callbacks.selection?.(result.selectedPageIds,result.anchorId);return result.selectedPageIds; }
  root.addEventListener('click',e=>{const row=item(e);if(!row)return;e.stopPropagation(); const id=row.dataset.pageId,c=context(); select(id,e,e.target.matches('input[data-check]'));if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.target.matches('input')&&c.mode!=='grid')callbacks.openPage?.(id);},options);
  root.addEventListener('dblclick',e=>{const row=item(e);if(!row)return;e.stopPropagation();callbacks.openPage?.(row.dataset.pageId);if(context().mode==='grid')callbacks.view?.(context().returnMode||readPageViewPreference());},options);
  root.addEventListener('contextmenu',e=>{const row=item(e);if(!row)return;e.preventDefault();e.stopPropagation();const id=row.dataset.pageId,c=context();const ids=new Set(c.selectedPageIds||[]).has(id)?Array.from(c.selectedPageIds):select(id,{});showContextMenu({x:e.clientX,y:e.clientY,items:pageContextItems(c.canPaste!==false),onAction:name=>action(name,{ids,targetId:id})});},options);
  root.addEventListener('dragstart',e=>{const row=item(e);if(!row)return;const id=row.dataset.pageId,c=context();const dragIds=new Set(c.selectedPageIds||[]).has(id)?Array.from(c.selectedPageIds):select(id,{});e.dataTransfer.setData('application/x-vw-pages',JSON.stringify(dragIds));e.dataTransfer.effectAllowed='copyMove';},options);
  root.addEventListener('dragover',e=>{if(item(e)){e.preventDefault();e.dataTransfer.dropEffect='move';}},options);
  root.addEventListener('drop',e=>{const row=item(e);if(!row)return;const raw=e.dataTransfer.getData('application/x-vw-pages');if(!raw)return;e.preventDefault();e.stopPropagation();let ids;try{ids=JSON.parse(raw);}catch{return;}if(!Array.isArray(ids))return;const rect=row.getBoundingClientRect(),mode=context().mode;const after=mode==='timeline'?e.clientX>rect.left+rect.width/2:e.clientY>rect.top+rect.height/2;action('move-pages',{ids,targetId:row.dataset.pageId,position:after?'after':'before'});},options);
  root.addEventListener('keydown',e=>{if(e.target.matches('input:not([type=checkbox]),textarea,[contenteditable]:not([contenteditable=false])'))return;const c=context(),ids=Array.from(c.selectedPageIds||[]);if(e.key==='Escape'&&c.mode==='grid'){e.preventDefault();callbacks.view?.(c.returnMode||readPageViewPreference());}else if((e.metaKey||e.ctrlKey)&&['c','v','d','a'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();const key=e.key.toLowerCase();if(key==='a')callbacks.selection?.(c.project.pages.map(p=>p.id),c.project.pages[0]?.id);else action({'c':'copy-pages','v':'paste-pages','d':'duplicate-pages'}[key],{ids,targetId:c.currentPageId});}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();action('delete-pages',{ids,targetId:c.currentPageId});}},options);
  return ()=>{controller.abort();closeContextMenu();};
}
