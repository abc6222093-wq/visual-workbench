// 第 9 轮：编辑器「丝滑」—— 任何编辑都不能让画面整体重建；保存在后台悄悄进行；自己写的文件读回不再刷新画面。
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createServer} from './helpers/isolated-server.js';import {createProjectWatcher} from '../src/watch.js';import {launchBrowser} from '../src/browser.js';
const now='2026-10-01T12:00:00.000Z';
// 当前步骤名：素材请求记在哪一步，修之前的输出能看出是哪一步重新加载了图片
const stage={name:'open'};
async function editor(t){
 const dir=mkdtempSync(join(tmpdir(),'vw-round9-smooth-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const projectDir=join(dir,'projects/demo');mkdirSync(join(projectDir,'assets'),{recursive:true});const file=join(projectDir,'project.json');
 writeFileSync(join(projectDir,'assets/pic.png'),await sharp({create:{width:40,height:30,channels:4,background:'#3366cc'}}).png().toBuffer());
 const project={format:'visual-workbench/project',formatVersion:2,id:'demo',name:'丝滑验收',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},
  assets:[{id:'asset_picture',kind:'image',file:'assets/pic.png',name:'图',width:40,height:30,pendingLayout:false,addedAt:now}],fonts:[],
  pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[
   {id:'el_image',type:'image',x:60,y:60,width:200,height:150,zIndex:1,asset:'asset_picture',fit:'cover'},
   {id:'el_text',type:'text',x:320,y:80,width:300,height:80,zIndex:2,text:'原来的字',fontSize:32,color:'#111111'},
   {id:'el_shape',type:'shape',shape:'rect',x:420,y:360,width:200,height:160,zIndex:3,fill:'#dd8844',cornerRadius:12}]},
  {id:'page_second',name:'第二页',background:'#ffffff',elements:[{id:'el_second_text',type:'text',x:100,y:100,width:300,height:80,zIndex:1,text:'第二页',fontSize:32,color:'#111111'}]}]};
 writeFileSync(file,JSON.stringify(project));server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const assetRequests=[],gets=[];page.on('request',r=>{const u=r.url();if(u.includes('/data/projects/demo/assets/')&&r.frame()===page.mainFrame())assetRequests.push(`${stage.name}: ${u.split('/').pop()}`);if(r.method()==='GET'&&/\/api\/projects\/demo(\?|$)/.test(u))gets.push(u);});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-action="open"][data-id="demo"]').click();
 await page.waitForFunction(()=>{const img=document.querySelector('#artboard [data-element-id="el_image"] img');return img&&img.complete&&img.naturalWidth>0;});
 await page.waitForLoadState('networkidle');await page.waitForTimeout(600);
 return {page,file,errors,assetRequests,gets};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
// 等保存完成；超时不抛错，记进 unsaved，最后一起比较，修之前的输出能看到全部差异
const unsaved=[];
const saved=async(page,action,name)=>{try{await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok(),{timeout:8000}),action()]);await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存',null,{timeout:8000});}catch(e){unsaved.push(`${name}: ${e.message.split('\n')[0]}`);}};
async function center(page,id){const b=await page.locator(`#artboard [data-element-id="${id}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};}
async function drag(page,id,dx,dy){const p=await center(page,id);await page.keyboard.down('Alt');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+dx,p.y+dy,{steps:6});await page.mouse.up();await page.keyboard.up('Alt');}
// 素材请求只数编辑器页面自己的（后台动效检查在隐藏 iframe 里另行渲染，不算画面上的图片）
// 观察器：#app 子节点被替换 = 整个编辑器重建；记录关键节点以比较身份；记录可见的保存标签变化与提示文字
const install=page=>page.evaluate(()=>{
 const q=s=>document.querySelector(s),w=window.__vw={rebuilds:0,toasts:[],saveMutations:0};
 new MutationObserver(list=>{for(const m of list)if(m.type==='childList')w.rebuilds++;}).observe(q('#app'),{childList:true});
 new MutationObserver(()=>{const t=q('#toast').textContent;if(t)w.toasts.push(t);}).observe(q('#toast'),{childList:true,characterData:true,subtree:true});
 // 可见的保存标签：#save-chip 里看得见的部分（视觉隐藏、只给读屏的 #save-status 不算）
 const hidden=n=>{for(let e=n.nodeType===1?n:n.parentElement;e&&e!==document.body;e=e.parentElement){const r=e.getBoundingClientRect(),s=getComputedStyle(e);if((r.width<=1&&r.height<=1)||s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return true;}return false;};
 w.watchSave=()=>{w.saveMutations=0;w.upAt=Infinity;window.addEventListener('pointerup',()=>{w.upAt=performance.now();},{capture:true});w.saveObserver?.disconnect();w.saveObserver=new MutationObserver(list=>{
  // 只统计松手后 1.4 秒内的可见变化：超过 1.5 秒的慢保存按设计会显示「正在保存…」（全量测试满负载时可能出现）
  if(performance.now()-w.upAt>=1400)return;for(const m of list){const targets=m.type==='childList'?[...m.addedNodes,...m.removedNodes].map(n=>n.isConnected?n:m.target):[m.target];if(targets.some(n=>!hidden(n)))w.saveMutations++;}});w.saveObserver.observe(q('#save-chip'),{childList:true,subtree:true,characterData:true,attributes:true});};
 w.nodes={shell:q('.ed-shell'),artboard:q('#artboard'),holder:q('#artboard-holder'),pages:q('.ed-pages'),list:q('.page-list'),view:q('.page-list [data-page-view]'),inspector:q('.ed-inspector'),body:q('.ed-inspector__body'),img:q('#artboard [data-element-id="el_image"] img'),mini:q('.page-list [data-preview="page_first"] .vw-artboard')};
 w.items=[...document.querySelectorAll('.page-list .ed-page[data-page-id]')];
 w.same=()=>{const now={shell:q('.ed-shell'),artboard:q('#artboard'),holder:q('#artboard-holder'),pages:q('.ed-pages'),list:q('.page-list'),view:q('.page-list [data-page-view]'),inspector:q('.ed-inspector'),body:q('.ed-inspector__body'),mini:q('.page-list [data-preview="page_first"] .vw-artboard')};
  const out=Object.fromEntries(Object.entries(now).map(([k,v])=>[k,!!v&&v===w.nodes[k]]));out.items=w.items.every((n,i)=>n===document.querySelectorAll('.page-list .ed-page[data-page-id]')[i]);return out;};
 w.sameImg=()=>q('#artboard [data-element-id="el_image"] img')===w.nodes.img;
});
const allSame={shell:true,artboard:true,holder:true,pages:true,list:true,view:true,inspector:true,body:true,mini:true,items:true};

test('round9 smooth: edits patch in place, images never reload, saves stay quiet and self writes do not refresh',async t=>{
 const {page,file,errors,assetRequests,gets}=await editor(t);await install(page);const report={};const assetsBefore=assetRequests.length;
 await page.locator('[data-action="select"][data-id="el_shape"]').click();
 await page.evaluate(()=>{window.__vw.xInput=document.querySelector('[data-prop="x"]');window.__vw.watchSave();});
 stage.name='drag'; // 1 拖动形状并松手：保存期间可见的保存标签不变
 await saved(page,()=>drag(page,'el_shape',60,40),'drag');const moved=disk(file).pages[0].elements.find(e=>e.id==='el_shape');
 report.dragQuiet=await page.evaluate(()=>window.__vw.saveMutations);
 report.afterDrag=await page.evaluate(()=>({...window.__vw.same(),img:window.__vw.sameImg(),xInput:document.querySelector('[data-prop="x"]')===window.__vw.xInput}));
 // 缩略图稍后原地更新（不换节点）
 report.miniUpdated=await page.waitForFunction(x=>{const n=document.querySelector('.page-list [data-preview="page_first"] [data-element-id="el_shape"]');return n&&n.style.left===`${x}px`;},moved.x,{timeout:4000}).then(()=>true,()=>false);
 stage.name='fill'; // 2 属性栏改填充颜色
 await saved(page,()=>page.evaluate(()=>{const i=document.querySelector('[data-prop="fill"]');i.value='#112233';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}),'fill');
 report.fill=disk(file).pages[0].elements.find(e=>e.id==='el_shape').fill;
 stage.name='undo-redo'; // 3 撤销、重做：图片节点不换
 await saved(page,()=>page.locator('[data-action="undo"]').click(),'undo');report.undoImg=await page.evaluate(()=>window.__vw.sameImg());
 await saved(page,()=>page.locator('[data-action="redo"]').click(),'redo');report.redoImg=await page.evaluate(()=>window.__vw.sameImg());
 report.afterUndoRedo=await page.evaluate(()=>window.__vw.same());
 stage.name='text'; // 4 属性栏改文字
 await page.locator('[data-action="select"][data-id="el_text"]').click();
 await saved(page,()=>page.locator('[data-prop="text"]').fill('新的字'),'text');report.text=await page.locator('#artboard [data-element-id="el_text"]').textContent();
 stage.name='pages'; // 5 换到第二页再回来
 await page.locator('.page-list .ed-page[data-page-id="page_second"] .ed-page__open').click();await page.waitForFunction(()=>document.querySelector('#artboard').dataset.pageId==='page_second'&&document.querySelector('#artboard [data-element-id="el_second_text"]'));
 await page.locator('.page-list .ed-page[data-page-id="page_first"] .ed-page__open').click();await page.waitForFunction(()=>document.querySelector('#artboard').dataset.pageId==='page_first'&&document.querySelector('#artboard [data-element-id="el_image"] img')?.complete);
 report.afterPages=await page.evaluate(()=>window.__vw.same());
 report.rebuilds=await page.evaluate(()=>window.__vw.rebuilds);
 report.assetRequests=assetRequests.slice(assetsBefore);
 report.agentToast=(await page.evaluate(()=>window.__vw.toasts)).some(x=>x.includes('已载入 agent'));
 // 6 自己写的文件读回：保存完再等 1 秒，画板和属性栏没被重建，也不去拉取项目
 await page.evaluate(()=>{const w=window.__vw;w.board2=document.querySelector('#artboard');w.props2=document.querySelector('.ed-props');w.firstChild2=w.board2.firstElementChild;});
 const getsBefore=gets.length;await saved(page,()=>drag(page,'el_shape',-30,0),'self');
 await page.evaluate(()=>{window.__vw.props3=document.querySelector('.ed-props');window.__vw.board3=document.querySelector('[data-element-id="el_text"]');});
 await page.waitForTimeout(1000);
 report.selfWrite={gets:gets.length-getsBefore,...await page.evaluate(()=>{const w=window.__vw;return {board:document.querySelector('#artboard')===w.board2,props:document.querySelector('.ed-props')===w.props3,text:document.querySelector('[data-element-id="el_text"]')===w.board3};})};
 // 7 agent 在外面改了 project.json：仍会载入，画板节点不换
 const external=disk(file);external.pages[0].elements.find(e=>e.id==='el_text').x=333;writeFileSync(file,JSON.stringify(external));
 report.agent=await page.waitForFunction(()=>document.querySelector('#artboard [data-element-id="el_text"]')?.style.left==='333px',null,{timeout:8000}).then(()=>true,()=>false);
 report.afterAgent=await page.evaluate(()=>({...window.__vw.same(),rebuilds:window.__vw.rebuilds}));
 report.errors=errors;report.unsaved=unsaved;
 assert.deepEqual(report,{
  dragQuiet:0,afterDrag:{...allSame,img:true,xInput:true},miniUpdated:true,fill:'#112233',undoImg:true,redoImg:true,afterUndoRedo:allSame,text:'新的字',
  afterPages:allSame,rebuilds:0,assetRequests:[],agentToast:false,selfWrite:{gets:0,board:true,props:true,text:true},agent:true,afterAgent:{...allSame,rebuilds:0},errors:[],unsaved:[],
 });
});

// 连续保存两次：监听先读到第一次写的内容、再读到第二次的，两次都算工作台自己写的（不能误判成 agent 在改）
test('round9 watcher: consecutive self writes are all recognised as self writes',async t=>{
 const projectsDir=mkdtempSync(join(tmpdir(),'vw-round9-watch-'));mkdirSync(join(projectsDir,'demo'));const file=join(projectsDir,'demo/project.json');writeFileSync(file,'{"v":0}\n');
 const w=createProjectWatcher({projectsDir,fsWatch:false,pollMs:60000});const events=[];w.subscribe('demo',ev=>events.push(ev));
 t.after(()=>{w.close();rmSync(projectsDir,{recursive:true,force:true});});
 const first=Buffer.from('{"v":11}\n'),second=Buffer.from('{"v":222}\n'); // 长度不同：轮询按 mtime+size 也一定能看到
 w.noteSelfWrite('demo','project.json',first);w.noteSelfWrite('demo','project.json',second);
 writeFileSync(file,first);await w.scanNow('demo');writeFileSync(file,second);await w.scanNow('demo');
 assert.deepEqual(events.filter(e=>e.type==='changed').map(e=>e.external),[false,false]);assert.equal(w.agentState('demo'),'idle');
 // 之后 agent 真的改了：照样算外部修改
 writeFileSync(file,'{"v":3333}\n');await w.scanNow('demo');assert.equal(events.filter(e=>e.type==='changed').at(-1).external,true);
});
