import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
// 第 10 轮：文字框随内容自动长高（含旧项目校正先存版）、画布上裁切图片、属性栏替换图片、旋转把手贴边换位
const now='2026-10-04T12:00:00.000Z';
const project=()=>({format:'visual-workbench/project',formatVersion:2,id:'demo',name:'第 10 轮',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},
 assets:[{id:'asset_wide',kind:'image',file:'assets/wide.png',name:'宽图',width:40,height:30,pendingLayout:false,addedAt:now},{id:'asset_wideb',kind:'image',file:'assets/wideb.png',name:'宽图 B',width:80,height:60,pendingLayout:false,addedAt:now},{id:'asset_tall',kind:'image',file:'assets/tall.png',name:'竖图',width:30,height:60,pendingLayout:false,addedAt:now}],fonts:[],
 pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[
  {id:'el_text',type:'text',x:80,y:80,width:360,height:45,zIndex:2,text:'hello world',fontSize:32,color:'#111111'},
  {id:'el_stale',type:'text',x:80,y:200,width:300,height:300,zIndex:2,text:'旧项目里框太高',fontSize:32,color:'#111111'},
  {id:'el_image',type:'image',x:500,y:300,width:200,height:150,zIndex:1,asset:'asset_wide',fit:'cover'},
  {id:'el_edge',type:'shape',shape:'rect',x:20,y:4,width:120,height:692,zIndex:1,fill:'#88aadd'}]}]});
async function editor(t,{mutate}={}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round10-canvas-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const pd=join(dir,'projects/demo');mkdirSync(join(pd,'assets'),{recursive:true});
 const png=async(w,h,bg)=>sharp({create:{width:w,height:h,channels:4,background:bg}}).png().toBuffer();
 writeFileSync(join(pd,'assets/wide.png'),await png(40,30,'#3366cc'));writeFileSync(join(pd,'assets/wideb.png'),await png(80,60,'#cc6633'));writeFileSync(join(pd,'assets/tall.png'),await png(30,60,'#33cc66'));
 const data=project();mutate?.(data);writeFileSync(join(pd,'project.json'),JSON.stringify(data));
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const puts=[];page.on('request',r=>{if(r.method()==='PUT')puts.push(r.url());});
 const origin=`http://127.0.0.1:${server.address().port}`;await page.goto(origin);await page.locator('[data-action="open"][data-id="demo"]').click();await page.waitForSelector('#artboard');
 return {page,errors,puts,origin,file:join(pd,'project.json')};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const el=(file,id)=>disk(file).pages[0].elements.find(e=>e.id===id);
async function saved(page,action){await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()),action()]);}
async function center(page,id){const b=await page.locator(`#artboard [data-element-id="${id}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};}
const heightOf=(page,id)=>page.locator(`#artboard [data-element-id="${id}"]`).evaluate(n=>parseFloat(n.style.height));

test('round10 text height: stale box is corrected once after an automatic version; typing, width and font changes follow content',async t=>{
 const {page,errors,origin,file}=await editor(t);
 // 旧项目：框太高的文字打开时先存版再校正；一致的不动
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
 await page.waitForFunction(()=>parseFloat(document.querySelector('#artboard [data-element-id="el_stale"]').style.height)<300);
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
 const versions=await(await fetch(`${origin}/api/projects/demo/versions`)).json();
 assert.equal(versions.length,1);assert.match(versions[0].note,/自动长高校正前自动存版/);
 assert.equal(el(file,'el_stale').height,45);assert.equal(el(file,'el_text').height,45);
 // 文字框没有上下把手
 await page.locator('[data-action="select"][data-id="el_text"]').click();
 assert.deepEqual((await page.locator('[data-resize="el_text"]').evaluateAll(ns=>ns.map(n=>n.dataset.handle))).sort(),['e','ne','nw','se','sw','w']);
 assert.equal(await page.locator('input[data-prop="height"]').getAttribute('readonly'),'');
 // 就地编辑：回车加行，边打边长；结束后写回并保存
 const {b}=await center(page,'el_text');await page.mouse.dblclick(b.x+b.width*0.9,b.y+8);
 await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('第二行');
 assert.equal(await heightOf(page,'el_text'),90);
 await saved(page,()=>page.keyboard.press('Escape'));assert.equal(el(file,'el_text').height,90);
 // 字号变大：高度跟着变；撤销回到原高度
 await saved(page,async()=>{const input=page.locator('input[data-prop="fontSize"]');await input.fill('16');await input.press('Enter');await input.blur();});
 assert.equal(el(file,'el_text').height,45);assert.equal(el(file,'el_text').fontSize,16);
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(el(file,'el_text').height,90);assert.equal(el(file,'el_text').fontSize,32);
 // 拖右边把手把框拉窄：内容折行，高度即时变化，松手后写回
 await page.locator('[data-action="select"][data-id="el_text"]').click();const scale=await page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);
 const h=await page.locator('[data-resize="el_text"][data-handle="e"]').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2-220*scale,h.y+h.height/2,{steps:4});
 assert.ok(await heightOf(page,'el_text')>90,'拖窄时高度即时增加');
 await saved(page,()=>page.mouse.up());const after=el(file,'el_text');assert.equal(after.width,140);assert.ok(after.height>90);
 assert.deepEqual(errors,[]);
});

test('round10 crop: double-click crops on the canvas, one undo step, menu and inspector entries, replace keeps or refits crop',async t=>{
 const {page,errors,file,puts}=await editor(t,{mutate(p){p.pages[0].elements=p.pages[0].elements.filter(e=>e.id!=='el_stale');}});
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');const putsBefore=puts.length;
 const before=el(file,'el_image');const {x,y}=await center(page,'el_image');
 await page.mouse.dblclick(x,y);const overlay=page.locator('#artboard .crop-overlay');assert.equal(await overlay.count(),1);
 assert.equal(await page.locator('[data-resize="el_image"]').count(),0);
 const scale=await page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);
 const imgBefore=await page.locator('#artboard [data-element-id="el_image"] img').boundingBox();
 const se=await page.locator('[data-crop-handle="se"]').boundingBox();await page.mouse.move(se.x+se.width/2,se.y+se.height/2);await page.mouse.down();await page.mouse.move(se.x+se.width/2-60*scale,se.y+se.height/2-45*scale,{steps:4});await page.mouse.up();
 const imgDuring=await page.locator('#artboard [data-element-id="el_image"] img').boundingBox();
 assert.ok(Math.abs(imgDuring.x-imgBefore.x)<1.5&&Math.abs(imgDuring.width-imgBefore.width)<1.5,'拖框时画布上的图片不动');
 await saved(page,()=>page.keyboard.press('Escape'));assert.equal(await overlay.count(),0);
 const cropped=el(file,'el_image');assert.equal(cropped.width,140);assert.equal(cropped.height,105);assert.ok(cropped.crop&&cropped.crop.width<1&&cropped.crop.height<1);assert.equal(puts.length-putsBefore,1,'一次裁切一次保存');
 assert.equal(await page.locator('[data-resize="el_image"]').count(),8,'裁切结束后把手回来');
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.deepEqual(el(file,'el_image'),before);
 await saved(page,()=>page.locator('[data-action="redo"]').click());assert.deepEqual(el(file,'el_image'),cropped);
 // 右键「裁切」、属性栏「裁切」都能进入；Esc 不改东西就不保存
 const p2=await center(page,'el_image');await page.mouse.click(p2.x,p2.y,{button:'right'});await page.getByRole('menuitem',{name:'裁切'}).click();assert.equal(await overlay.count(),1);
 const count=puts.length;await page.keyboard.press('Escape');await page.waitForTimeout(900);assert.equal(await overlay.count(),0);assert.equal(puts.length,count);
 await page.locator('[data-action="select"][data-id="el_image"]').click();await page.locator('[data-action="crop-image"]').click();assert.equal(await overlay.count(),1);await page.keyboard.press('Escape');
 // 替换图片：同比例保留裁切；比例不同按框比例重算（不变形）
 await page.locator('[data-action="replace-image"]').click();await saved(page,()=>page.locator('[data-image-picker] [data-pick="asset:asset_wideb"]').first().click());
 let now_=el(file,'el_image');assert.equal(now_.asset,'asset_wideb');assert.deepEqual(now_.crop,cropped.crop);assert.deepEqual([now_.x,now_.y,now_.width,now_.height],[cropped.x,cropped.y,cropped.width,cropped.height]);
 await page.locator('[data-action="replace-image"]').click();await saved(page,()=>page.locator('[data-image-picker] [data-pick="asset:asset_tall"]').first().click());
 now_=el(file,'el_image');assert.equal(now_.asset,'asset_tall');assert.ok(Math.abs((now_.crop.width*30)/(now_.crop.height*60)-now_.width/now_.height)<1e-2,'裁切区域和框同比例');
 assert.deepEqual(errors,[]);
});

test('round10 rotate handle stays reachable when the element touches both artboard edges',async t=>{
 const {page,errors}=await editor(t);await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
 await page.locator('[data-action="select"][data-id="el_edge"]').click();const handle=page.locator('[data-rotate="el_edge"]');
 assert.equal(await handle.getAttribute('data-side'),'right');
 const board=await page.locator('#artboard').boundingBox(),h=await handle.boundingBox();
 assert.ok(h.x>=board.x&&h.x+h.width<=board.x+board.width&&h.y>=board.y&&h.y+h.height<=board.y+board.height,'把手在画板可见范围内');
 assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-rotate]')?.dataset.rotate,{x:h.x+h.width/2,y:h.y+h.height/2}),'el_edge');
 await page.locator('[data-action="select"][data-id="el_text"]').click();assert.equal(await page.locator('[data-rotate="el_text"]').getAttribute('data-side'),'bottom');
 assert.deepEqual(errors,[]);
});
