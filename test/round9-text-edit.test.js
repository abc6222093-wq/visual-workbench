import test, {before, after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';

// 就地编辑文字模块：在缩放 0.5 的画板里模仿 render.js 的文字节点（pre-wrap、8 个缩放把手），真浏览器操作。
let dir,home,server,browser,url;
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'vw-round9-text-edit-'));home=mkdtempSync(join(tmpdir(),'vw-round9-home-'));
 server=createServer({dataDir:dir,configHome:home});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 url=`http://127.0.0.1:${server.address().port}`;browser=await launchBrowser();
});
after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});});

const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0}.resize-handle{position:absolute;width:10px;height:10px;background:#38bdf8}</style>
<div id="outside" style="position:absolute;left:700px;top:500px;width:120px;height:40px">外面</div><input id="other" style="position:absolute;left:700px;top:600px">
<div id="holder" style="position:absolute;left:40px;top:40px;transform:scale(0.5);transform-origin:0 0"><div id="board" style="position:relative;width:1000px;height:700px;background:#fff;overflow:hidden"></div></div>`;
async function fixture(t,{text='hello brave world',flip=false,start=true,options={}}={}){
 const page=await browser.newPage({viewport:{width:1000,height:800}});t.after(()=>page.close());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${url}/vw-text-edit-blank`);await page.setContent(html);
 await page.evaluate(async({text,flip})=>{
  const node=document.createElement('div');node.dataset.elementId='el_text';node.dataset.elementType='text';
  node.style.cssText='position:absolute;left:100px;top:120px;width:640px;height:260px;font-family:monospace;font-size:48px;line-height:1.4;color:rgb(200, 30, 60);white-space:pre-wrap;overflow-wrap:break-word;outline:2px solid #38bdf8;cursor:pointer';
  let host=node;if(flip){host=document.createElement('div');host.dataset.vwFlip='1';host.style.cssText='position:absolute;inset:0;width:100%;height:100%;transform:scale(-1, 1)';node.append(host);}
  host.textContent=text;
  for(const edge of ['nw','n','ne','e','se','s','sw','w']){const h=document.createElement('span');h.className='resize-handle';h.dataset.resize='el_text';h.dataset.handle=edge;node.append(h);}
  document.getElementById('board').append(node);
  window.log={inputs:[],commits:[],windowKeys:[]};window.addEventListener('keydown',e=>log.windowKeys.push(e.key));
  window.mod=await import('/text-edit.js');
  window.begin=(opts={})=>{window.session=mod.startTextEdit(node,{text:node.querySelector(':scope > [data-vw-flip]')?.textContent??node.firstChild.data,...opts,onInput:v=>log.inputs.push(v),onCommit:c=>log.commits.push(c)});return true;};
  node.addEventListener('dblclick',e=>{if(!mod.isEditingTextNode(node))begin({point:{clientX:e.clientX,clientY:e.clientY}});});
 },{text,flip});
 if(start)await page.evaluate(o=>begin(o),options);
 return {page,errors,log:()=>page.evaluate(()=>window.log),text:()=>page.evaluate(()=>session.text),active:()=>page.evaluate(()=>session.active)};
}
// 文字节点中第 i 个字符的屏幕位置（左边缘 / 右边缘、垂直中点）
const charBox=(page,i)=>page.evaluate(i=>{const node=document.querySelector('[data-element-id="el_text"]'),host=node.querySelector(':scope > [data-vw-flip]')||node,text=[...host.childNodes].find(n=>n.nodeType===3),r=document.createRange();r.setStart(text,i);r.setEnd(text,i+1);const b=r.getBoundingClientRect();return {left:b.left,right:b.right,y:(b.top+b.bottom)/2};},i);
const structure=page=>page.evaluate(()=>{const node=document.querySelector('[data-element-id="el_text"]'),host=node.querySelector(':scope > [data-vw-flip]')||node;return {texts:[...host.childNodes].filter(n=>n.nodeType===3).map(n=>n.data),first:host.firstChild?.nodeType,handles:node.querySelectorAll(':scope > [data-resize]').length,editable:host.getAttribute('contenteditable'),cursor:node.style.cursor,userSelect:node.style.userSelect,editing:mod.isEditingTextNode(node)};});

test('round9 text edit: double click places the caret where clicked inside the scaled board',async t=>{
 const {page,errors,log,text}=await fixture(t,{start:false});const b=await charBox(page,6);
 await page.mouse.dblclick(b.left+1,b.y);assert.equal((await structure(page)).editable!==null,true);
 await page.keyboard.type('X');assert.equal(await text(),'hello Xbrave world');assert.deepEqual((await log()).inputs.at(-1),'hello Xbrave world');
 const end=await charBox(page,17);await page.mouse.click(end.right-1,end.y);await page.keyboard.type('!');assert.equal(await text(),'hello Xbrave world!');
 assert.deepEqual(errors,[]);
});

test('round9 text edit: mouse drag selects part of the text and Ctrl/Cmd+A only selects this element',async t=>{
 const {page,errors,log,text}=await fixture(t);const a=await charBox(page,6),z=await charBox(page,10);
 await page.mouse.move(a.left+1,a.y);await page.mouse.down();await page.mouse.move(z.right-1,z.y,{steps:6});await page.mouse.up();
 assert.equal(await page.evaluate(()=>getSelection().toString()),'brave');await page.keyboard.type('calm');assert.equal(await text(),'hello calm world');
 await page.keyboard.press('ControlOrMeta+a');assert.equal(await page.evaluate(()=>getSelection().toString()),'hello calm world');
 await page.keyboard.type('new');assert.equal(await text(),'new');
 for(const key of ['Delete','ArrowLeft','Backspace'])await page.keyboard.press(key);assert.equal(await text(),'nw');
 const keys=(await log()).windowKeys;assert.deepEqual(keys,[]);assert.equal((await log()).commits.length,0);assert.deepEqual(errors,[]);
});

test('round9 text edit: Enter inserts newline characters and line-end deletion joins lines',async t=>{
 const {page,errors,text}=await fixture(t,{text:'ab'});
 await page.keyboard.press('Enter');await page.keyboard.type('c');await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('d');
 assert.equal(await text(),'ab\nc\n\nd');
 await page.keyboard.press('Backspace');assert.equal(await text(),'ab\nc\n\n');await page.keyboard.type('e');assert.equal(await text(),'ab\nc\n\ne');
 for(let i=0;i<3;i++)await page.keyboard.press('ArrowUp');await page.keyboard.press('End');await page.keyboard.press('Delete');assert.equal(await text(),'abc\n\ne');
 await page.keyboard.press('Escape');const s=await structure(page);assert.deepEqual(s.texts,['abc\n\ne']);assert.equal(s.first,3);assert.deepEqual(errors,[]);
});

test('round9 text edit: Japanese and Chinese IME composition does not report or end editing until committed',async t=>{
 const {page,errors,log,text,active}=await fixture(t,{text:'言葉：'});const client=await page.context().newCDPSession(page);
 const inputs=async()=>(await log()).inputs.length;
 for(const step of ['に','にほ','にほん','日本']){await client.send('Input.imeSetComposition',{text:step,selectionStart:step.length,selectionEnd:step.length});assert.equal(await inputs(),0);}
 await page.keyboard.press('Escape');assert.equal(await active(),true);
 await client.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:229,nativeVirtualKeyCode:229});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:229,nativeVirtualKeyCode:229});
 assert.equal(await active(),true);assert.equal(await inputs(),0);
 await client.send('Input.insertText',{text:'日本'});await page.waitForFunction(()=>log.inputs.length>0);
 assert.match((await log()).inputs.at(-1),/日本/);assert.equal(await text(),'言葉：日本');assert.equal((await log()).inputs.some(v=>/[にほん]/.test(v)),false);
 const before=await inputs();
 for(const step of ['z','zh','zhong','中'])await client.send('Input.imeSetComposition',{text:step,selectionStart:step.length,selectionEnd:step.length});
 assert.equal(await inputs(),before);
 await page.keyboard.press('Escape');assert.equal(await active(),true);assert.equal(await inputs(),before);
 await client.send('Input.insertText',{text:'中文'});await page.waitForFunction(n=>log.inputs.length>n,before);
 assert.equal(await text(),'言葉：日本中文');assert.equal((await log()).inputs.at(-1),'言葉：日本中文');
 await page.keyboard.press('Escape');assert.equal(await active(),false);assert.deepEqual((await log()).commits,[{text:'言葉：日本中文',changed:true}]);assert.deepEqual(errors,[]);
});

test('round9 text edit: Escape commits once, restores the node and never reaches window shortcuts',async t=>{
 const {page,errors,log}=await fixture(t);const editing=await structure(page);assert.equal(editing.handles,0);assert.equal(editing.cursor,'text');assert.equal(editing.userSelect,'text');assert.equal(editing.editing,true);
 assert.equal(await page.evaluate(()=>getComputedStyle(session.host).caretColor),'rgb(200, 30, 60)');
 await page.keyboard.type(' again');await page.keyboard.press('Escape');
 const l=await log();assert.deepEqual(l.commits,[{text:'hello brave world again',changed:true}]);assert.deepEqual(l.windowKeys,[]);
 const s=await structure(page);assert.deepEqual(s.texts,['hello brave world again']);assert.equal(s.first,3);assert.equal(s.handles,8);assert.equal(s.editable,null);assert.equal(s.cursor,'pointer');assert.equal(s.userSelect,'');assert.equal(s.editing,false);
 await page.evaluate(()=>session.finish());await page.keyboard.press('Escape');assert.equal((await log()).commits.length,1);assert.deepEqual((await log()).windowKeys,['Escape']);assert.deepEqual(errors,[]);
});

test('round9 text edit: clicking outside or moving focus to another input ends editing once',async t=>{
 const {page,errors,log}=await fixture(t);const o=await page.locator('#outside').boundingBox();
 let clicked=false;await page.exposeFunction('outsideClicked',()=>{clicked=true;});await page.evaluate(()=>document.getElementById('outside').addEventListener('click',()=>outsideClicked()));
 await page.mouse.click(o.x+5,o.y+5);assert.deepEqual((await log()).commits,[{text:'hello brave world',changed:false}]);assert.equal(clicked,true);assert.equal((await structure(page)).handles,8);
 await page.evaluate(()=>begin());await page.keyboard.type('?');await page.evaluate(()=>document.getElementById('other').focus());await page.waitForFunction(()=>log.commits.length===2);
 assert.deepEqual((await log()).commits[1],{text:'hello brave world?',changed:true});assert.equal(await page.evaluate(()=>document.activeElement.id),'other');
 // Window losing focus (switching apps) keeps the session open.
 await page.evaluate(()=>begin());await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{value:()=>false,configurable:true});session.host.blur();});await page.waitForTimeout(30);
 assert.equal(await page.evaluate(()=>session.active),true);await page.evaluate(()=>{delete document.hasFocus;session.finish();});assert.equal((await log()).commits.length,3);assert.deepEqual(errors,[]);
});

test('round9 text edit: selectAll replaces the placeholder when typing right away',async t=>{
 const {page,errors,log,text}=await fixture(t,{text:'双击编辑文字',options:{selectAll:true}});
 assert.equal(await page.evaluate(()=>getSelection().toString()),'双击编辑文字');await page.keyboard.type('新标题');assert.equal(await text(),'新标题');
 await page.keyboard.press('Escape');assert.deepEqual((await log()).commits,[{text:'新标题',changed:true}]);assert.deepEqual(errors,[]);
});

test('round9 text edit: geometry and computed text style stay identical before, during and after editing, also when flipped',async t=>{
 for(const flip of [false,true]){
  const {page,errors}=await fixture(t,{text:'第一行 first line\n第二行 second',flip,start:false});
  const measure=()=>page.evaluate(()=>{const node=document.querySelector('[data-element-id="el_text"]'),host=node.querySelector(':scope > [data-vw-flip]')||node,cs=getComputedStyle(host),r=node.getBoundingClientRect(),text=[...host.childNodes].find(n=>n.nodeType===3),range=document.createRange();range.selectNodeContents(text);const lines=[...range.getClientRects()].map(b=>[b.left,b.top,b.width,b.height].map(v=>Math.round(v*100)/100));
   return {rect:[r.left,r.top,r.width,r.height],fontSize:cs.fontSize,lineHeight:cs.lineHeight,color:cs.color,fontFamily:cs.fontFamily,whiteSpace:cs.whiteSpace,left:getComputedStyle(node).left,top:getComputedStyle(node).top,transform:cs.transform,lines};});
  const before=await measure();await page.evaluate(()=>begin());const during=await measure();await page.evaluate(()=>session.finish());const afterwards=await measure();
  assert.deepEqual(during,before,`flip=${flip}`);assert.deepEqual(afterwards,before,`flip=${flip}`);
  const s=await structure(page);assert.equal(s.handles,8);assert.deepEqual(s.texts,['第一行 first line\n第二行 second']);assert.deepEqual(errors,[]);
 }
});
