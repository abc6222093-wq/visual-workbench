import {selectPageIds} from './page-operations.js';
import {showContextMenu,closeContextMenu} from './context-menu.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preferenceKey='visual-workbench.page-view';
export function readPageViewPreference(storage=globalThis.localStorage) { try{return storage?.getItem(preferenceKey)==='timeline'?'timeline':'list';}catch{return 'list';} }
export function writePageViewPreference(mode,storage=globalThis.localStorage) { if(mode==='grid')return;try{storage?.setItem(preferenceKey,mode==='timeline'?'timeline':'list');}catch{} }
// 页面项标签旁的小字 chip：草稿页「草稿」，有屏数时「N 屏」（screensOf(page) 给屏数，0 = 不显示）
export function pageChips(page,screensOf) { const n=Number(screensOf?.(page))||0; return `${page.draft?'<span class="g-chip ed-page__chip" data-chip="draft">草稿</span>':''}${n>1?`<span class="g-chip ed-page__chip" data-chip="screens">${n} 屏</span>`:''}`; }
export function renderPageItems({project,currentPageId,selectedPageIds=[],mode='list',screensOf=null}) {
  const selected=new Set(selectedPageIds);
  return `<div class="page-view page-view--${esc(mode)}" data-page-view="${esc(mode)}" tabindex="0" aria-label="页面${mode==='grid'?'网格':mode==='timeline'?'时间轴':'列表'}">${project.pages.map((p,i)=>`<div class="ed-page ${p.id===currentPageId?'active':''} ${selected.has(p.id)?'is-selected':''}" data-page-index="${i}" data-page-id="${esc(p.id)}"><input class="g-check ed-page__check" type="checkbox" data-check="${esc(p.id)}" ${selected.has(p.id)?'checked':''} aria-label="选择第 ${i+1} 页"><button class="ed-page__open" data-action="switch" data-id="${esc(p.id)}" title="${esc(p.name)}"><span class="ed-page__thumb" aria-hidden="true" inert data-preview="${esc(p.id)}"></span><span class="ed-page__label"><b>${String(i+1).padStart(2,'0')}</b><i>${esc(p.name)}</i><span class="ed-page__chips">${pageChips(p,screensOf)}</span>${project.kind==='web'&&p.device?`<span class="g-chip ed-page__device" data-device="${esc(p.device)}">${p.device==='mobile'?'手机':'电脑'}</span>`:''}</span></button></div>`).join('')}</div>`;
}
export function pageContextItems(canPaste=true,extra=[]) { return [{action:'copy-pages',label:'复制'},{action:'paste-pages',label:'粘贴',disabled:!canPaste},{action:'duplicate-pages',label:'创建副本'},{separator:true},{action:'insert-page-before',label:'在前面插入页面'},{action:'insert-page-after',label:'在后面插入页面'},...(extra.length?[{separator:true},...extra]:[]),{separator:true},{action:'delete-pages',label:'删除'}]; }
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
  const gestures=mountPageGestures(root,{context,select,action,callbacks,signal:controller.signal});
  root.addEventListener('click',e=>{if(gestures.swallowClick(e))return;const row=item(e);if(!row)return;e.stopPropagation(); const id=row.dataset.pageId,c=context(); select(id,e,e.target.matches('input[data-check]'));if(!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.target.matches('input')&&c.mode!=='grid')callbacks.openPage?.(id);},options);
  root.addEventListener('dblclick',e=>{const row=item(e);if(!row)return;e.stopPropagation();callbacks.openPage?.(row.dataset.pageId);if(context().mode==='grid')callbacks.view?.(context().returnMode||readPageViewPreference());},options);
  root.addEventListener('contextmenu',e=>{const row=item(e);if(!row)return;e.preventDefault();e.stopPropagation();const id=row.dataset.pageId,c=context();const ids=new Set(c.selectedPageIds||[]).has(id)?Array.from(c.selectedPageIds):select(id,{});showContextMenu({x:e.clientX,y:e.clientY,items:pageContextItems(c.canPaste!==false,c.extraMenuItems||[]),onAction:name=>action(name,{ids,targetId:id})});},options);
  root.addEventListener('dragstart',e=>{const row=item(e);if(!row)return;const id=row.dataset.pageId,c=context();const dragIds=new Set(c.selectedPageIds||[]).has(id)?Array.from(c.selectedPageIds):select(id,{});e.dataTransfer.setData('application/x-vw-pages',JSON.stringify(dragIds));e.dataTransfer.effectAllowed='copyMove';},options);
  root.addEventListener('dragover',e=>{if(item(e)){e.preventDefault();e.dataTransfer.dropEffect='move';}},options);
  root.addEventListener('drop',e=>{const row=item(e);if(!row)return;const raw=e.dataTransfer.getData('application/x-vw-pages');if(!raw)return;e.preventDefault();e.stopPropagation();let ids;try{ids=JSON.parse(raw);}catch{return;}if(!Array.isArray(ids))return;const rect=row.getBoundingClientRect(),mode=context().mode;const after=mode==='timeline'?e.clientX>rect.left+rect.width/2:e.clientY>rect.top+rect.height/2;action('move-pages',{ids,targetId:row.dataset.pageId,position:after?'after':'before'});},options);
  root.addEventListener('keydown',e=>{if(e.target.matches('input:not([type=checkbox]),textarea,[contenteditable]:not([contenteditable=false])'))return;const c=context(),ids=Array.from(c.selectedPageIds||[]);if(e.key==='Escape'&&ids.length){e.preventDefault();e.stopPropagation();callbacks.selection?.([],null);}else if(e.key==='Escape'&&c.mode==='grid'){e.preventDefault();callbacks.view?.(c.returnMode||readPageViewPreference());}else if((e.metaKey||e.ctrlKey)&&['c','v','d','a'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();const key=e.key.toLowerCase();if(key==='a')callbacks.selection?.(c.project.pages.map(p=>p.id),c.project.pages[0]?.id);else action({'c':'copy-pages','v':'paste-pages','d':'duplicate-pages'}[key],{ids,targetId:c.currentPageId});}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();action('delete-pages',{ids,targetId:c.currentPageId});}},options);
  return ()=>{controller.abort();gestures.cancel();closeContextMenu();};
}
// ---------- 指针拖动排序与框选：三种视图共用，插入线、让位、自动滚动、「N 页」徽标 ----------
const DRAG_THRESHOLD=4, EDGE=40, SHIFT=16;
function mountPageGestures(root,{context,select,action,callbacks,signal}) {
  let g=null, suppressClick=false;
  const rows=()=>[...root.querySelectorAll(':scope > .ed-page[data-page-id]')];
  const axis=()=>context().mode==='timeline'?'x':'y';
  // 视图根内容坐标（含滚动），覆盖层以根为定位参照，随内容一起滚动。
  const point=(x,y)=>{const o=root.getBoundingClientRect();return {x:x-o.left+root.scrollLeft-root.clientLeft,y:y-o.top+root.scrollTop-root.clientTop};};
  const box=el=>{const r=el.getBoundingClientRect(),p=point(r.left,r.top);return {left:p.x,top:p.y,right:p.x+r.width,bottom:p.y+r.height,width:r.width,height:r.height};};
  function scroller(dir) {
    for (let el=root;el&&el!==document.body&&el!==document.documentElement;el=el.parentElement) {
      const s=getComputedStyle(el),ov=dir==='x'?s.overflowX:s.overflowY;
      if (/(auto|scroll)/.test(ov)&&(dir==='x'?el.scrollWidth>el.clientWidth+1:el.scrollHeight>el.clientHeight+1)) return el;
    }
    return null;
  }
  function overlay(cls,parent=root) { const el=document.createElement('div');el.className=cls;el.setAttribute('aria-hidden','true');parent.append(el);return el; }
  function start(e,kind) {
    const c=context(),row=kind==='drag'?e.target.closest('[data-page-index][data-page-id]'):null;
    g={kind,id:row?.dataset.pageId,pointerId:e.pointerId,x:e.clientX,y:e.clientY,last:{x:e.clientX,y:e.clientY},origin:point(e.clientX,e.clientY),active:false,
      additive:e.shiftKey||e.metaKey||e.ctrlKey,base:Array.from(c.selectedPageIds||[]),hadSelection:!!(c.selectedPageIds||[]).length,raf:0,selKey:''};
    g.move=ev=>{if(ev.pointerId!==g.pointerId)return;g.last={x:ev.clientX,y:ev.clientY};if(!g.active){if(Math.hypot(ev.clientX-g.x,ev.clientY-g.y)<=DRAG_THRESHOLD)return;activate();}ev.preventDefault();update();};
    g.up=ev=>{if(ev.pointerId===g.pointerId)finish(true);};
    g.cancelEv=ev=>{if(ev.pointerId===g.pointerId)finish(false);};
    g.key=ev=>{if(ev.key==='Escape'&&g?.active){ev.preventDefault();ev.stopPropagation();finish(false);}};
    window.addEventListener('pointermove',g.move,{signal});window.addEventListener('pointerup',g.up,{signal});window.addEventListener('pointercancel',g.cancelEv,{signal});window.addEventListener('keydown',g.key,{capture:true,signal});
  }
  function activate() {
    g.active=true;suppressClick=true;
    if (g.kind==='drag') {
      const c=context(),selected=new Set(c.selectedPageIds||[]);
      g.ids=selected.has(g.id)?c.project.pages.map(p=>p.id).filter(id=>selected.has(id)):select(g.id,{});
      g.dragSet=new Set(g.ids);g.items=rows().map(el=>({el,id:el.dataset.pageId,box:box(el)}));g.order=g.items.map(it=>it.id);
      for (const it of g.items) if (g.dragSet.has(it.id)) it.el.classList.add('is-drag-source');
      root.classList.add('is-page-dragging');g.line=overlay(`page-drop-line page-drop-line--${context().mode==='list'?'horizontal':'vertical'}`);g.line.hidden=true;
      if (g.ids.length>1) { g.badge=overlay('page-drag-badge',document.body);g.badge.textContent=`${g.ids.length} 页`; }
    } else { root.classList.add('is-page-marquee');g.marquee=overlay('page-marquee'); }
    const loop=()=>{if(!g?.active)return;autoScroll();if(g)g.raf=requestAnimationFrame(loop);};g.raf=requestAnimationFrame(loop);
  }
  // 指针靠近滚动区边缘（或越过边缘）时按距离加速滚动。
  function autoScroll() {
    const dirs=g.kind==='marquee'&&context().mode==='grid'?['y','x']:[axis()];
    for (const dir of dirs) {
      const el=scroller(dir);if(!el||!g)continue;const r=el.getBoundingClientRect(),p=dir==='x'?g.last.x:g.last.y,lo=dir==='x'?r.left:r.top,hi=dir==='x'?r.right:r.bottom;
      const speed=v=>Math.ceil(Math.min(1,(EDGE-v)/EDGE)*18);let delta=0;
      if (p<lo+EDGE) delta=-speed(p-lo); else if (p>hi-EDGE) delta=speed(hi-p);
      if (!delta) continue;const before=dir==='x'?el.scrollLeft:el.scrollTop;
      if (dir==='x') el.scrollLeft+=delta; else el.scrollTop+=delta;
      if ((dir==='x'?el.scrollLeft:el.scrollTop)!==before) update();
    }
  }
  function update() {
    if (!root.isConnected) return finish(false);
    if (g.badge) { g.badge.style.left=`${g.last.x+14}px`;g.badge.style.top=`${g.last.y+14}px`; }
    if (g.kind==='drag') return updateDrop();
    const p=point(g.last.x,g.last.y),o=g.origin,rect={left:Math.min(o.x,p.x),top:Math.min(o.y,p.y),right:Math.max(o.x,p.x),bottom:Math.max(o.y,p.y)};
    Object.assign(g.marquee.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.right-rect.left}px`,height:`${rect.bottom-rect.top}px`});
    const hits=rows().filter(el=>{const b=box(el);return b.left<rect.right&&b.right>rect.left&&b.top<rect.bottom&&b.bottom>rect.top;}).map(el=>el.dataset.pageId);
    const want=new Set([...(g.additive?g.base:[]),...hits]),ids=context().project.pages.map(p=>p.id).filter(id=>want.has(id)),key=ids.join('\n');
    if (key!==g.selKey) { g.selKey=key;callbacks.selection?.(ids,hits[0]||(g.additive?context().anchorId:null)||null); }
  }
  // 插入位置：列表/时间轴按主轴中心线数，网格找最近的卡片再按左右半边。
  function slot(p) {
    const items=g.items,n=items.length;if(!n)return null;
    if (context().mode==='grid') {
      let best=0,bd=Infinity;
      items.forEach((it,i)=>{const b=it.box,dx=Math.max(b.left-p.x,0,p.x-b.right),dy=Math.max(b.top-p.y,0,p.y-b.bottom),d=dx*dx+dy*dy*4;if(d<bd){bd=d;best=i;}});
      const b=items[best].box,after=p.x>b.left+b.width/2,same=it=>Math.abs(it.box.top-b.top)<2,index=best+(after?1:0);
      const prev=items[index-1]&&same(items[index-1])?items[index-1].box:null,next=items[index]&&same(items[index])?items[index].box:null;
      const x=prev&&next?(prev.right+next.left)/2:next?next.left-8:prev.right+8;
      return {index,line:{left:x-1.5,top:b.top,width:3,height:b.height},shift:(it,i)=>same(it)?(i<index?-1:1):0};
    }
    const ax=axis(),s=ax==='x'?'left':'top',e=ax==='x'?'right':'bottom',v=ax==='x'?p.x:p.y;
    const index=items.filter(it=>(it.box[s]+it.box[e])/2<v).length;
    const prev=items[index-1]?.box,next=items[index]?.box,pos=prev&&next?(prev[e]+next[s])/2:next?next[s]-6:prev[e]+6,cross=items[0].box;
    const line=ax==='x'?{left:pos-1.5,top:cross.top,width:3,height:Math.max(...items.map(it=>it.box.height))}:{left:cross.left,top:pos-1.5,width:Math.max(...items.map(it=>it.box.width)),height:3};
    return {index,line,shift:(it,i)=>i<index?-1:1};
  }
  // 插入序号换成 move-pages 参数：目标页不能是被拖的页；结果与原顺序相同视为原地不动。
  function target(index) {
    const items=g.items;let i=index;while(i<items.length&&g.dragSet.has(items[i].id))i++;
    if (i<items.length) return {targetId:items[i].id,position:'before'};
    i=index-1;while(i>=0&&g.dragSet.has(items[i].id))i--;
    return i>=0?{targetId:items[i].id,position:'after'}:null;
  }
  function reorder({targetId,position}) { const rest=g.order.filter(id=>!g.dragSet.has(id));let i=rest.indexOf(targetId);if(position==='after')i++;rest.splice(i,0,...g.order.filter(id=>g.dragSet.has(id)));return rest; }
  function updateDrop() {
    const s=slot(point(g.last.x,g.last.y)),t=s&&target(s.index),changed=!!t&&reorder(t).join('\n')!==g.order.join('\n');
    g.drop=changed?t:null;g.line.hidden=!changed;
    if (changed) Object.assign(g.line.style,{left:`${s.line.left}px`,top:`${s.line.top}px`,width:`${s.line.width}px`,height:`${s.line.height}px`});
    const prop=context().mode==='list'?'translateY':'translateX';
    g.items.forEach((it,i)=>{const d=changed?s.shift(it,i)*SHIFT/2:0;it.el.style.transform=d?`${prop}(${d}px)`:'';});
  }
  function finish(commit) {
    if (!g) return;const done=g;g=null;cancelAnimationFrame(done.raf);
    window.removeEventListener('pointermove',done.move);window.removeEventListener('pointerup',done.up);window.removeEventListener('pointercancel',done.cancelEv);window.removeEventListener('keydown',done.key,{capture:true});
    done.line?.remove();done.badge?.remove();done.marquee?.remove();root.classList.remove('is-page-dragging','is-page-marquee');
    if (done.kind==='drag'&&done.items) {
      const drop=commit&&done.drop;if(drop)root.classList.add('is-dropping');
      for (const it of done.items) { it.el.classList.remove('is-drag-source');it.el.style.transform=''; }
      if (drop) { requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('is-dropping')));action('move-pages',{ids:done.ids,targetId:drop.targetId,position:drop.position}); }
    }
    // 空白处只是点一下（没有拖框）：取消页面选择。
    if (commit&&done.kind==='marquee'&&!done.active&&done.hadSelection) callbacks.selection?.([],null);
    if (done.active) setTimeout(()=>{suppressClick=false;},0);
  }
  root.addEventListener('pointerdown',e=>{
    if (e.button!==0||g) return;
    const row=e.target.closest?.('[data-page-index][data-page-id]');
    if (row) { if (!e.target.matches('input,textarea,select')) start(e,'drag'); return; }
    if (e.target!==root&&e.target.parentElement!==root) return;
    // 点到视图根自己的滚动条时不处理。
    const r=root.getBoundingClientRect();if(e.clientX-r.left-root.clientLeft>root.clientWidth||e.clientY-r.top-root.clientTop>root.clientHeight)return;
    e.preventDefault();root.focus?.({preventScroll:true});start(e,'marquee');
  },{signal});
  // 拖动或框选松手后紧跟的那次 click 不再当作点击（不换页、不改选择）。
  return {cancel:()=>finish(false),swallowClick:e=>{if(!suppressClick)return false;e.preventDefault();e.stopPropagation();return true;}};
}
