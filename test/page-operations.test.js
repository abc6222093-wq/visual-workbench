import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPageIds,movePages,pageClipboard,readPageClipboard,writePageClipboard,PAGE_CLIPBOARD_TYPE} from '../web/page-operations.js';
// 第 12 轮：页面是独立的 HTML 文件，增删复制由服务端做；这里只剩选择、排序、页面剪贴板的纯逻辑。
const project=()=>({id:'test-deck',pages:[{id:'page_first',name:'First',file:'pages/page_first.html',edits:[]},{id:'page_second',name:'Second',file:'pages/page_second.html'},{id:'page_third',name:'Third',file:'pages/page_third.html'}]});
test('selection supports toggles, ordered shift ranges and preserved anchor',()=>{const p=project().pages;let r=selectPageIds(p,[],'page_first');r=selectPageIds(p,r.selectedPageIds,'page_third',{ctrlKey:true},r.anchorId);assert.deepEqual(r.selectedPageIds,['page_first','page_third']);r=selectPageIds(p,r.selectedPageIds,'page_second',{shiftKey:true},r.anchorId);assert.deepEqual(r.selectedPageIds,['page_second','page_third']);assert.equal(r.anchorId,'page_third');});
test('batch move preserves project order and handles own target',()=>{const p=project(),before=structuredClone(p);assert.deepEqual(movePages(p,['page_third','page_first'],'page_second','after').project.pages.map(p=>p.id),['page_second','page_first','page_third']);assert.deepEqual(movePages(p,['page_first'],'page_first').project,p);assert.deepEqual(p,before);});
test('page clipboard records source project and pages in project order; storage is resilient',()=>{
 const clip=pageClipboard(project(),['page_third','page_first']);
 assert.deepEqual(clip,{type:PAGE_CLIPBOARD_TYPE,fromProject:'test-deck',pageIds:['page_first','page_third']});
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 assert.equal(readPageClipboard(storage),null);writePageClipboard(clip,storage);assert.deepEqual(readPageClipboard(storage),clip);
 values.set('visual-workbench.page-clipboard','{bad');assert.equal(readPageClipboard(storage),null);
 assert.equal(readPageClipboard({getItem(){throw Error('blocked');}}),null);
 assert.doesNotThrow(()=>writePageClipboard(clip,{setItem(){throw Error('full');}}));
});
