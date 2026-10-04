import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPageItems,readPageViewPreference,writePageViewPreference,pageContextItems} from '../web/page-views.js';
test('list, grid and timeline preserve page selectors and escape data',()=>{for(const mode of ['list','grid','timeline']){const html=renderPageItems({project:{pages:[{id:'page_first',name:'<script>"'}]},currentPageId:'page_first',selectedPageIds:new Set(['page_first']),mode});assert.ok(html.includes('data-action="switch"'));assert.ok(html.includes('data-id="page_first"'));assert.ok(html.includes('data-check="page_first"'));assert.ok(html.includes('checked'));assert.ok(html.includes('is-selected'));assert.ok(html.includes(`page-view--${mode}`));assert.ok(!html.includes('<script>'));}});
test('only list/timeline preference persists with resilient storage',()=>{const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};assert.equal(readPageViewPreference(storage),'list');writePageViewPreference('timeline',storage);writePageViewPreference('grid',storage);assert.equal(readPageViewPreference(storage),'timeline');writePageViewPreference('list',storage);assert.equal(readPageViewPreference(storage),'list');assert.equal(readPageViewPreference({getItem(){throw Error();}}),'list');});
test('context menu offers all requested operations and disables unavailable paste',()=>{const items=pageContextItems(false);assert.deepEqual(items.filter(i=>i.action).map(i=>i.action),['copy-pages','paste-pages','duplicate-pages','insert-page-before','insert-page-after','delete-pages']);assert.ok(items.find(i=>i.action==='paste-pages').disabled);});

test('mounted views route multi-selection, grid exit, clipboard and batch drop through callbacks',async()=>{
  const {mountPageViews}=await import('../web/page-views.js');
  const handlers=new Map(),root={addEventListener:(name,handler)=>handlers.set(name,handler)},calls=[];
  const ctx={project:{pages:[{id:'page_first'},{id:'page_second'}]},selectedPageIds:['page_first'],currentPageId:'page_first',mode:'grid',returnMode:'timeline'};
  const dispose=mountPageViews(root,{getContext:()=>ctx,callbacks:{selection:(ids,anchor)=>{ctx.selectedPageIds=ids;ctx.anchorId=anchor;calls.push(['selection',ids]);},view:mode=>calls.push(['view',mode]),openPage:id=>calls.push(['open',id]),action:(name,payload)=>calls.push([name,payload])}});
  const row={dataset:{pageId:'page_second'},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
  const target={closest:()=>row,matches:()=>false};
  const event={target,stopPropagation(){},preventDefault(){},ctrlKey:true};
  handlers.get('click')(event);assert.deepEqual(ctx.selectedPageIds,['page_first','page_second']);assert.equal(calls.some(c=>c[0]==='open'),false);
  // 第 9 轮 D3：网格里有选中页时，Esc 先取消选择；没有选中时再按 Esc 才回到原视图
  handlers.get('keydown')({...event,key:'Escape'});assert.deepEqual(calls.at(-1),['selection',[]]);assert.equal(calls.some(c=>c[0]==='view'),false);
  handlers.get('keydown')({...event,key:'Escape'});assert.deepEqual(calls.at(-1),['view','timeline']);
  ctx.selectedPageIds=['page_first','page_second'];
  handlers.get('keydown')({...event,key:'c'});assert.equal(calls.at(-1)[0],'copy-pages');assert.deepEqual(calls.at(-1)[1].ids,['page_first','page_second']);
  handlers.get('drop')({...event,clientY:80,altKey:true,dataTransfer:{getData:()=>JSON.stringify(['page_first'])}});assert.equal(calls.at(-1)[0],'move-pages');assert.equal(calls.at(-1)[1].position,'after');
  dispose();
});

test('round8 page view event delegation uses cards when a thumbnail contains page metadata',async()=>{
 const {mountPageViews}=await import('../web/page-views.js');const handlers=new Map(),calls=[];
 const row={dataset:{pageId:'page_first',pageIndex:'0'},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})};
 const nested={dataset:{pageId:'preview_only'}};
 const target={closest:selector=>selector==='[data-page-index][data-page-id]'?row:nested,matches:()=>false};
 const root={addEventListener:(name,handler)=>handlers.set(name,handler)};
 const context={project:{pages:[{id:'page_first'},{id:'page_second'}]},selectedPageIds:['page_second'],currentPageId:'page_second',mode:'list'};
 const dispose=mountPageViews(root,{getContext:()=>context,callbacks:{selection:ids=>calls.push(['selection',ids]),openPage:id=>calls.push(['open',id]),action:(name,payload)=>calls.push([name,payload])}});
 const event={target,stopPropagation(){},preventDefault(){}};
 handlers.get('click')(event);assert.deepEqual(calls,[['selection',['page_first']],['open','page_first']]);
 const transfer={setData:(type,data)=>calls.push([type,JSON.parse(data)]),getData:()=>JSON.stringify(['page_second'])};
 handlers.get('dragstart')({...event,dataTransfer:transfer});assert.deepEqual(calls.at(-1),['application/x-vw-pages',['page_first']]);
 handlers.get('drop')({...event,dataTransfer:transfer,clientY:90});assert.deepEqual(calls.at(-1),['move-pages',{ids:['page_second'],targetId:'page_first',position:'after'}]);
 dispose();
});
