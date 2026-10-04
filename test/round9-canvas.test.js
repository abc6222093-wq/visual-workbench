import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
// 第 9 轮：画布上直接做（就地编辑文字、旋转把手、悬停描边、拖放替换图片、属性栏补齐、形状选择、总览选择、Esc 逐层退出）
const now='2026-10-04T12:00:00.000Z';
const text=(id,x,y,extra={})=>({id,type:'text',x,y,width:360,height:45,zIndex:2,text:'hello world',fontSize:32,color:'#111111',...extra});
const project=(id,name)=>({format:'visual-workbench/project',formatVersion:2,id,name,createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},
 assets:[{id:'asset_pica',kind:'image',file:'assets/a.png',name:'图 A',width:40,height:30,pendingLayout:false,addedAt:now},{id:'asset_picb',kind:'image',file:'assets/b.png',name:'图 B',width:40,height:30,pendingLayout:false,addedAt:now}],fonts:[],
 pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[text('el_text',80,80),{id:'el_shape',type:'shape',shape:'rect',x:500,y:300,width:200,height:120,zIndex:3,fill:'#88aadd',cornerRadius:0},{id:'el_image',type:'image',x:80,y:360,width:240,height:180,zIndex:1,asset:'asset_pica',fit:'cover'}]},
  {id:'page_second',name:'第二页',background:'#ffffff',elements:[]}]});
async function editor(t,{projects=['demo']}={}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round9-canvas-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 for(const id of projects){const pd=join(dir,'projects',id);mkdirSync(join(pd,'assets'),{recursive:true});
  writeFileSync(join(pd,'assets/a.png'),await sharp({create:{width:40,height:30,channels:4,background:'#3366cc'}}).png().toBuffer());
  writeFileSync(join(pd,'assets/b.png'),await sharp({create:{width:40,height:30,channels:4,background:'#cc6633'}}).png().toBuffer());
  writeFileSync(join(pd,'project.json'),JSON.stringify(project(id,`项目 ${id}`)));}
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 return {page,errors,dir,file:join(dir,'projects',projects[0],'project.json'),async openProject(id=projects[0]){await page.locator(`[data-action="open"][data-id="${id}"]`).click();await page.waitForSelector('#artboard');
  // 整编辑器重建 = #app 的直接子节点被替换
  await page.evaluate(()=>{window.__rebuilds=0;new MutationObserver(l=>{for(const m of l)if(m.removedNodes.length)window.__rebuilds++;}).observe(document.querySelector('#app'),{childList:true});window.__board=document.querySelector('#artboard');});}};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const el=(file,id,pageIndex=0)=>disk(file).pages[pageIndex].elements.find(e=>e.id===id);
async function saved(page,action){await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()),action()]);}
async function center(page,id){const b=await page.locator(`#artboard [data-element-id="${id}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};}
const editing=page=>page.evaluate(()=>!!document.querySelector('#artboard [contenteditable]'));
async function stable(page){assert.equal(await page.evaluate(()=>window.__rebuilds),0);assert.equal(await page.evaluate(()=>window.__board===document.querySelector('#artboard')),true);}

test('round9 canvas text: double-click edits in place with IME, Esc/blank finish, one undo step and live outline sync',async t=>{
 const {page,file,errors,openProject}=await editor(t);await openProject();
 // 打开大纲：文稿框随画布打字实时同步
 await page.locator('[data-action="tab-outline"]').click();const doc=page.locator('textarea[data-outline-document]');await doc.waitFor();await page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()).catch(()=>{});
 const {b}=await center(page,'el_text');
 // 双击在「world」前面放光标
 await page.mouse.dblclick(b.x+b.width*0.02,b.y+12);assert.equal(await editing(page),true);
 const before=await page.locator('#artboard [data-element-id="el_text"]').evaluate(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,getComputedStyle(n).fontSize];});
 await page.keyboard.press('Home');await page.keyboard.type('A ');
 assert.match(await doc.inputValue(),/A hello world/);
 // 输入法：组合中间态不进大纲、Esc 不结束；提交后才同步
 const client=await page.context().newCDPSession(page);
 await client.send('Input.imeSetComposition',{text:'に',selectionStart:1,selectionEnd:1});await client.send('Input.imeSetComposition',{text:'にほ',selectionStart:2,selectionEnd:2});
 assert.doesNotMatch(await doc.inputValue(),/に/);await page.keyboard.press('Escape');assert.equal(await editing(page),true);
 await client.send('Input.insertText',{text:'日本'});await page.waitForFunction(()=>/A 日本hello world/.test(document.querySelector('textarea[data-outline-document]').value));
 await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('第二行');
 const during=await page.locator('#artboard [data-element-id="el_text"]').evaluate(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,getComputedStyle(n).fontSize];});assert.deepEqual(during,before);
 await saved(page,()=>page.keyboard.press('Escape'));assert.equal(await editing(page),false);
 assert.equal(el(file,'el_text').text,'A 日本hello world\n第二行');assert.equal(await page.locator('[data-resize="el_text"]').count(),6);
 // 一次编辑会话 = 一条撤销记录
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(el(file,'el_text').text,'hello world');
 await saved(page,()=>page.locator('[data-action="redo"]').click());assert.equal(el(file,'el_text').text,'A 日本hello world\n第二行');
 // 编辑中可以拖选一部分替换；点空白结束
 const box=(await center(page,'el_text')).b;await page.mouse.dblclick(box.x+4,box.y+12);
 await page.keyboard.press('ControlOrMeta+a');await page.keyboard.type('全新');
 const well=await page.locator('#canvas-well').boundingBox();await saved(page,()=>page.mouse.click(well.x+10,well.y+10));
 assert.equal(el(file,'el_text').text,'全新');assert.equal(await editing(page),false);
 await stable(page);assert.deepEqual(errors,[]);
});

test('round9 canvas text: Enter, context menu and new text all enter editing; inspector typing merges into one undo',async t=>{
 const {page,file,errors,openProject}=await editor(t);await openProject();
 await page.locator('[data-action="select"][data-id="el_text"]').click();await page.keyboard.press('Enter');assert.equal(await editing(page),true);
 await page.keyboard.type('回车编辑');await saved(page,()=>page.keyboard.press('Escape'));assert.equal(el(file,'el_text').text,'回车编辑');
 const p=await center(page,'el_text');await page.mouse.click(p.x,p.y,{button:'right'});await page.getByRole('menuitem',{name:'编辑文字'}).click();assert.equal(await editing(page),true);
 await page.keyboard.type('右键编辑');await saved(page,()=>page.keyboard.press('Escape'));assert.equal(el(file,'el_text').text,'右键编辑');
 // 新建文字：直接进入编辑，打字替换占位字
 await page.locator('[data-action="add-text"]').click();assert.equal(await editing(page),true);
 await page.keyboard.type('新标题');await saved(page,()=>page.keyboard.press('Escape'));
 const added=disk(file).pages[0].elements.filter(e=>e.type==='text'&&e.id!=='el_text');assert.equal(added.length,1);assert.equal(added[0].text,'新标题');
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(disk(file).pages[0].elements.find(e=>e.id===added[0].id).text,'改这里开始创作');
 // 属性栏文本框：连续打字只记一条撤销
 await page.locator('[data-action="select"][data-id="el_text"]').click();const area=page.locator('textarea[data-prop="text"]');await area.focus();await area.evaluate(n=>n.setSelectionRange(n.value.length,n.value.length));
 await saved(page,()=>page.keyboard.type('一二三',{delay:30}));await page.waitForTimeout(700);assert.equal(el(file,'el_text').text,'右键编辑一二三');
 await page.locator('#canvas-well').click({position:{x:10,y:10}});await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(el(file,'el_text').text,'右键编辑');
 await stable(page);assert.deepEqual(errors,[]);
});

test('round9 canvas: rotate handle snaps, hover outline, drop-to-replace image, inspector fields, live colour and shape picker',async t=>{
 const {page,file,errors,openProject}=await editor(t);await openProject();
 // 悬停细描边
 const s=await center(page,'el_shape');await page.mouse.move(s.x,s.y);
 assert.notEqual(await page.locator('#artboard [data-element-id="el_shape"]').evaluate(n=>getComputedStyle(n).outlineStyle),'none');
 // 旋转把手：从把手拖到元素右侧（≈90°，吸附）
 await page.mouse.click(s.x,s.y);const handle=page.locator('#artboard [data-rotate="el_shape"]');assert.equal(await handle.count(),1);
 const h=await handle.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
 await page.mouse.move(s.x-60,s.y+5,{steps:4});await page.mouse.move(s.x-120,s.y+3,{steps:4});
 assert.match(await page.locator('#artboard .ed-rotate-label').textContent(),/90°/);
 await saved(page,()=>page.mouse.up());assert.equal(el(file,'el_shape').rotation,90);assert.equal(await page.locator('#artboard .ed-rotate-label').count(),0);
 // 拖素材到图片上 = 替换，位置大小不变
 await page.locator('[data-action="tab-assets"]').click();const before=el(file,'el_image');
 await saved(page,()=>page.locator('.ed-assets [data-asset="asset_picb"]').dragTo(page.locator('#artboard [data-element-id="el_image"]')));
 const after=el(file,'el_image');assert.equal(after.asset,'asset_picb');assert.deepEqual([after.x,after.y,after.width,after.height],[before.x,before.y,before.width,before.height]);
 assert.equal(disk(file).pages[0].elements.filter(e=>e.type==='image').length,1);
 // 属性栏：显示方式、段落、圆角
 await page.locator('[data-action="tab-layers"]').click();await page.locator('[data-action="select"][data-id="el_image"]').click();
 await saved(page,()=>page.locator('select[data-prop="fit"]').selectOption('contain'));assert.equal(el(file,'el_image').fit,'contain');
 assert.equal(await page.locator('#artboard [data-element-id="el_image"] img').evaluate(n=>getComputedStyle(n).objectFit),'contain');
 await page.locator('[data-action="select"][data-id="el_text"]').click();
 await saved(page,()=>page.locator('select[data-prop="align"]').selectOption('center'));assert.equal(el(file,'el_text').align,'center');
 await saved(page,async()=>{await page.locator('input[data-prop="lineHeight"]').fill('1.8');await page.locator('input[data-prop="lineHeight"]').press('Enter');await page.locator('input[data-prop="lineHeight"]').blur();});assert.equal(el(file,'el_text').lineHeight,1.8);
 assert.equal(await page.locator('#artboard [data-element-id="el_text"]').evaluate(n=>getComputedStyle(n).textAlign),'center');
 await page.locator('[data-action="select"][data-id="el_shape"]').click();
 await saved(page,async()=>{await page.locator('input[data-prop="cornerRadius"]').fill('30');await page.locator('input[data-prop="cornerRadius"]').blur();});assert.equal(el(file,'el_shape').cornerRadius,30);
 // 颜色实时预览：input 时画面变、项目不变；change 才写入
 const color=page.locator('input[data-prop="fill"]');const putsBefore=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.initiatorType==='fetch').length);
 await color.evaluate(n=>{n.value='#ff0000';n.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator('#artboard [data-element-id="el_shape"]').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 0, 0)');assert.equal(el(file,'el_shape').fill,'#88aadd');
 await saved(page,()=>color.evaluate(n=>n.dispatchEvent(new Event('change',{bubbles:true}))));assert.equal(el(file,'el_shape').fill,'#ff0000');void putsBefore;
 // 形状按钮：选圆形
 await page.locator('[data-action="add-shape"]').click();await saved(page,()=>page.getByRole('menuitem',{name:'圆形'}).click());
 assert.equal(disk(file).pages[0].elements.filter(e=>e.shape==='ellipse').length,1);
 await stable(page);assert.deepEqual(errors,[]);
});

test('round9 selection habits: Escape clears page selection in the list, overview selects, marquees and batch-deletes',async t=>{
 const {page,errors,dir,openProject}=await editor(t,{projects:['alpha','beta','gamma']});
 // 总览：Shift 加选、Esc 取消、拖框、选择条批量删除（一次确认）
 await page.locator('[data-action="open"][data-id="alpha"]').click({modifiers:['Shift']});assert.equal(await page.locator('#artboard').count(),0);
 assert.equal(await page.locator('.hm-cell.is-selected').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.hm-cell.is-selected').count(),0);
 const grid=await page.locator('.hm-scroll').boundingBox(),last=await page.locator('.hm-cell[data-project-id="gamma"]').boundingBox();
 await page.mouse.move(grid.x+grid.width-8,grid.y+grid.height-8);await page.mouse.down();await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:6});await page.mouse.up();
 assert.ok(await page.locator('.hm-cell.is-selected').count()>=1);
 await page.mouse.click(grid.x+grid.width-8,grid.y+grid.height-8);assert.equal(await page.locator('.hm-cell.is-selected').count(),0);
 await page.locator('.hm-cell[data-project-id="beta"] .hm-check').check();await page.locator('.hm-cell[data-project-id="gamma"] .hm-check').check();
 assert.match(await page.locator('.hm-selbar').textContent(),/已选 2 个项目/);
 await page.locator('.hm-selbar [data-hm-sel="delete"]').click();await page.locator('[data-confirm-yes]').click();
 await page.waitForFunction(()=>!document.querySelector('[data-project-id="beta"]')&&!document.querySelector('[data-project-id="gamma"]'));
 assert.deepEqual(readdirSync(join(dir,'projects')).filter(n=>!n.startsWith('.')).sort(),['alpha']);
 // 编辑器左侧列表：选中页后（焦点不在列表上）按 Esc 取消
 await openProject('alpha');await page.locator('.page-list [data-page-id="page_second"] .ed-page__check').check();assert.equal(await page.locator('.page-list .ed-page.is-selected').count(),1);
 await page.locator('#canvas-well').click({position:{x:10,y:10}});await page.keyboard.press('Escape');assert.equal(await page.locator('.page-list .ed-page.is-selected').count(),0);
 await stable(page);assert.deepEqual(errors,[]);
});
