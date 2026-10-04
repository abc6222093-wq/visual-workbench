import test from 'node:test';
import assert from 'node:assert/strict';
import {selectableIds,marqueeIds,copyElements,pasteElements,groupElements,ungroupElements,nudgeElements,escapeSelection,isTypingTarget} from '../web/element-operations.js';
import {createHistory,deleteElements} from '../web/editor.js';
const el=(id,x=10,y=20)=>({id,type:'text',x,y,width:50,height:30,zIndex:1,text:id,fontSize:20,color:'#111111'});
function fixture(){return {id:'sample',pages:[{id:'page_one',elements:[el('el_one'),el('el_two',80),{...el('el_locked',0),locked:true},{id:'group_one',type:'group',x:150,y:80,width:100,height:60,zIndex:2,children:[el('el_child',0,0)]}]},{id:'page_two',elements:[]}]};}
test('marquee and select all exclude locks and keep groups whole, shift union is stable',()=>{
 const page=fixture().pages[0];assert.deepEqual(selectableIds(page),['el_one','el_two','group_one']);
 assert.deepEqual(marqueeIds(page,{x:0,y:0,width:220,height:120}),['el_one','el_two','group_one']);
 const measured=new Map([['group_one',{x:300,y:300,width:50,height:60}]]);assert.deepEqual(marqueeIds({...page,elements:[page.elements[3]]},{x:290,y:290,width:70,height:80},measured),['group_one']);
 assert.deepEqual([...new Set(['el_one',...marqueeIds(page,{x:75,y:0,width:60,height:60})])],['el_one','el_two']);
});
test('clipboard crosses pages, renews nested IDs, offsets original and retains appearance and source',()=>{
 const project=fixture(),p=project.pages[0];p.elements[3].children[0].flipX=true;p.elements[3].opacity=.4;
 const before=structuredClone(project),clip=copyElements(project,p,['group_one','el_child','el_locked']);
 const ids=pasteElements(project,project.pages[1],clip,0);assert.equal(ids.length,2);assert.equal(project.pages[1].elements[0].x,150);assert.notEqual(project.pages[1].elements[0].children[0].id,'el_child');assert.equal(project.pages[1].elements[0].children[0].flipX,true);assert.equal(project.pages[1].elements[0].opacity,.4);
 assert.deepEqual(p,before.pages[0]);const same=pasteElements(project,p,copyElements(project,p,['el_one']));assert.equal(p.elements.find(e=>e.id===same[0]).x,34);assert.equal(p.elements.find(e=>e.id===same[0]).y,44);
 assert.throws(()=>pasteElements({id:'other'},p,clip),/同一个项目/);
});
test('group and ungroup preserve positions, style and nested IDs with undo and redo',()=>{
 const project=fixture(),p=project.pages[0],history=createHistory(project),original=structuredClone(p.elements.slice(0,2));const ids=groupElements(p,['el_two','el_one']);history.commit(project);const group=p.elements.find(e=>e.id===ids[0]);assert.equal(group.children.length,2);assert.equal(group.x,10);assert.equal(group.width,120);assert.deepEqual(escapeSelection(p,['el_one']),ids);assert.deepEqual(escapeSelection(p,ids),[]);
 const restored=ungroupElements(p,ids);assert.deepEqual(new Set(restored),new Set(['el_one','el_two']));for(const old of original){const next=p.elements.find(e=>e.id===old.id);assert.equal(next.x,old.x);assert.equal(next.y,old.y);assert.equal(next.text,old.text);}history.commit(project);assert.equal(history.undo().pages[0].elements.find(e=>e.id===ids[0]).type,'group');assert.equal(history.redo().pages[0].elements.find(e=>e.id==='el_one').x,10);
 assert.throws(()=>groupElements(p,['el_one','el_locked']),/至少两个/);
});
test('arrows move 1 or 10 page pixels, ancestor selection prevents double movement, batch one undo',()=>{
 const project=fixture(),p=project.pages[0],history=createHistory(project),before=structuredClone(project);
 for(let i=0;i<4;i++)nudgeElements(p,['el_one','el_locked','group_one','el_child'],1,0);
 nudgeElements(p,['el_one'],0,10);history.commit(project);assert.equal(p.elements[0].x,14);assert.equal(p.elements[0].y,30);assert.equal(p.elements[2].x,0);assert.equal(p.elements[3].x,154);assert.equal(p.elements[3].children[0].x,0);assert.deepEqual(history.undo(),before);assert.equal(history.canUndo,false);assert.equal(history.redo().pages[0].elements[0].x,14);
 deleteElements(p,['group_one']);assert.equal(p.elements.some(e=>e.id==='group_one'),false);
});
test('ungroup flipped and rotated group preserves child center and composited opacity',()=>{
 const page={elements:[{id:'group',type:'group',x:100,y:100,width:100,height:100,rotation:90,flipX:true,opacity:.5,zIndex:1,children:[{...el('child',0,0),width:20,height:20,opacity:.4}]}]};ungroupElements(page,['group']);const child=page.elements[0];assert.equal(child.x,180);assert.equal(child.y,180);assert.equal(child.rotation,90);assert.equal(child.flipX,true);assert.equal(child.opacity,.2);
});
test('typing guard includes native inputs, outline and rich documents',()=>{for(const name of ['input','textarea','select','[contenteditable]','[data-outline-document]'])assert.equal(isTypingTarget({closest:query=>query.includes(name)?{}:null}),true);assert.equal(isTypingTarget({closest:()=>null}),false);});
test('grouping and ungrouping remain valid project format with integer layers',async()=>{
 const {validateProjectData}=await import('../src/validate.js');const now='2026-10-01T12:00:00.000Z';
 const project={format:'visual-workbench/project',formatVersion:2,id:'model-demo',name:'模型',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:500,height:500},fonts:[],assets:[],pages:[{id:'page_model',name:'一页',background:'#ffffff',elements:[el('el_first'),el('el_second',80)]}]};
 const page=project.pages[0],ids=groupElements(page,['el_second','el_first']);assert.match(ids[0],/^el_/);assert.equal(validateProjectData(project).ok,true);assert.deepEqual(page.elements[0].children.map(e=>e.id),['el_first','el_second']);ungroupElements(page,ids);assert.equal(validateProjectData(project).ok,true);assert.ok(page.elements.every(e=>Number.isInteger(e.zIndex)));
});
test('copying a child retains its visible page position and inherited rotation / opacity',()=>{
 const p={id:'page_one',elements:[{id:'el_group',type:'group',x:100,y:200,width:100,height:100,rotation:90,flipX:true,opacity:.5,zIndex:1,children:[{...el('el_child',0,0),width:20,height:20,opacity:.4}]}]};const project={id:'demo'};const clip=copyElements(project,p,['el_child']);assert.equal(clip.elements[0].x,180);assert.equal(clip.elements[0].y,280);assert.equal(clip.elements[0].rotation,90);assert.equal(clip.elements[0].flipX,true);assert.equal(clip.elements[0].opacity,.2);assert.equal(p.elements[0].children[0].x,0);
});
