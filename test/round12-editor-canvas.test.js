// 第 12 轮：编辑画布 = 当前页的隔离 iframe；修改进修改单（撤销 / 自动保存）；选中时的窄工具条；贴图；文件变化重载；已删除的功能不再出现。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {startWorkbench,openProject,v3Project,pageHTML,clickInFrame,painted} from './round12-editor-fixture.js';
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const saved=page=>page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
const frame=page=>page.frameLocator('#artboard > iframe');
async function ready(page){await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});await painted(page);}

test('round12 画布：课件页按画板尺寸缩放进画布区居中，iframe 隔离（只允许脚本），已删功能的界面不出现',async t=>{
 const {page,errors}=await startWorkbench(t);await openProject(page);await ready(page);await settle(page);
 const info=await page.evaluate(()=>{const f=document.querySelector('#artboard > iframe'),s=document.querySelector('#artboard'),w=document.querySelector('#canvas-well');
  const sr=s.getBoundingClientRect(),wr=w.getBoundingClientRect();
  return {sandbox:f.getAttribute('sandbox'),frames:document.querySelectorAll('#artboard iframe').length,stage:{l:sr.left,t:sr.top,w:sr.width,h:sr.height},well:{l:wr.left,t:wr.top,w:wr.width,h:wr.height}};});
 assert.equal(info.frames,1);
 assert.ok(/allow-scripts/.test(info.sandbox)&&!/allow-same-origin/.test(info.sandbox),`sandbox=${info.sandbox}`);
 assert.ok(Math.abs(info.stage.w/info.stage.h-1920/1080)<0.01,'画板比例');
 assert.ok(info.stage.l>=info.well.l&&info.stage.t>=info.well.t&&info.stage.l+info.stage.w<=info.well.l+info.well.w+1&&info.stage.t+info.stage.h<=info.well.t+info.well.h+1,'画板在画布区里');
 const cx=info.stage.l+info.stage.w/2,wx=info.well.l+info.well.w/2;assert.ok(Math.abs(cx-wx)<2,'水平居中');
 for(const gone of ['add-text','add-shape','import','preview-motion','compare-variants','tab-outline','tab-layers','tab-assets'])assert.equal(await page.locator(`[data-action="${gone}"]`).count(),0,`${gone} 应已删除`);
 for(const gone of ['.ed-layers','[data-step-view]','.ed-motion-status','[data-scale-selection]','#outline-host'])assert.equal(await page.locator(gone).count(),0,`${gone} 应已删除`);
 assert.equal(await page.locator('[data-page-name]').inputValue(),'第1页');
 assert.ok(await page.locator('.ed-inspector [data-action="brief"]').count()===1&&await page.locator('.ed-inspector [data-action="versions"]').count()===1);
 assert.deepEqual(errors,[]);
});

test('round12 画布：网页页面显示固定设备窗口（电脑 1440×900、手机 390×844），换页切换窗口比例，高度可改并保存',async t=>{
 const project=v3Project({id:'site',web:true,pages:['首页','手机页']});
 const {page,errors,files}=await startWorkbench(t,{projects:[project]});await openProject(page,'site');await ready(page);await settle(page);
 const ratio=()=>page.locator('#artboard').evaluate(n=>{const r=n.getBoundingClientRect();return r.width/r.height;});
 assert.ok(Math.abs(await ratio()-1440/900)<0.01);
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__open').click();await ready(page);await settle(page);
 assert.ok(Math.abs(await ratio()-390/844)<0.01);
 assert.equal(await page.locator('[data-page-device]').inputValue(),'手机端');
 await page.locator('[data-page-height]').fill('3000');await page.locator('[data-page-height]').press('Enter');await saved(page);
 assert.equal(disk(files.site).pages[1].size.height,3000);
 assert.deepEqual(errors,[]);
});

test('round12 修改单：选中文字出窄工具条，改字号写进 edits 并保存；撤销 / 重做只重放修改单，不重建 iframe；Esc 取消选中',async t=>{
 const {page,errors,files}=await startWorkbench(t);await openProject(page);await ready(page);
 await page.evaluate(()=>{window.__frame=document.querySelector('#artboard > iframe');});
 await clickInFrame(page,'[data-vw-id="card"]');
 await page.waitForSelector('.ed-quickbar:not([hidden]) [data-q="background"]');
 assert.equal(await page.locator('.ed-quickbar [data-q="fontSize"]').count(),0,'卡片没有文字能力');
 await clickInFrame(page,'[data-vw-id="title"]',{at:{x:3,y:3}});
 await page.waitForSelector('.ed-quickbar:not([hidden]) [data-q="fontSize"]');
 assert.equal(await page.locator('.ed-quickbar [data-q="color"]').count(),1);
 await page.locator('.ed-quickbar [data-q="fontSize"]').fill('120');await page.locator('.ed-quickbar [data-q="fontSize"]').press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('1'));await saved(page);
 const edit=disk(files.demo).pages[0].edits.find(e=>e.kind==='fontSize');
 assert.equal(edit?.target,'title');assert.equal(edit.after.fontSize,120);
 assert.equal(await frame(page).locator('[data-vw-id="title"]').evaluate(n=>getComputedStyle(n).fontSize),'120px');
 await page.locator('[data-action="undo"]').click();await saved(page);
 assert.equal(disk(files.demo).pages[0].edits.length,0);
 await page.waitForTimeout(200);
 assert.equal(await frame(page).locator('[data-vw-id="title"]').evaluate(n=>getComputedStyle(n).fontSize),'96px');
 await page.locator('[data-action="redo"]').click();await saved(page);
 assert.equal(disk(files.demo).pages[0].edits.length,1);
 assert.equal(await page.evaluate(()=>document.querySelector('#artboard > iframe')===window.__frame),true,'iframe 节点不换');
 await page.locator('#canvas-well').click({position:{x:5,y:5}});await page.keyboard.press('Escape');
 await page.waitForSelector('.ed-quickbar[hidden]',{state:'attached'});
 assert.deepEqual(errors,[]);
});

test('round12 贴图：父页面粘贴图片 → 存成素材、记 addImage、出现在页面里；删除要确认并能撤销',async t=>{
 const {page,errors,files}=await startWorkbench(t);await openProject(page);await ready(page);
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=400;c.height=300;const g=c.getContext('2d');g.fillStyle='#e11d48';g.fillRect(0,0,400,300);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'red.png',{type:'image/png'}));
  document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
 });
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('1'),null,{timeout:15000});await saved(page);
 const project=disk(files.demo),add=project.pages[0].edits.find(e=>e.kind==='addImage');
 assert.ok(add&&/^u_/.test(add.target));assert.ok(project.assets.some(a=>a.id===add.after.asset));
 assert.ok(add.after.width<=1920*0.6+1&&add.after.height<=1080*0.6+1);
 assert.ok(Math.abs(add.after.x+add.after.width/2-960)<=1&&Math.abs(add.after.y+add.after.height/2-540)<=1,'放在可见区域中央');
 await frame(page).locator(`[data-vw-id="${add.target}"]`).waitFor({timeout:10000});
 await clickInFrame(page,`[data-vw-id="${add.target}"]`,{button:'right'});
 await page.locator('.g-context-menu button',{hasText:'删除'}).waitFor();await painted(page);
 await page.locator('.g-context-menu button',{hasText:'删除'}).click();await page.locator('[data-confirm-yes]').waitFor();await painted(page);await page.locator('[data-confirm-yes]').click();await saved(page);
 assert.equal(disk(files.demo).pages[0].edits.length,0);
 await page.locator('[data-action="undo"]').click();await saved(page);
 assert.equal(disk(files.demo).pages[0].edits.length,1);
 assert.deepEqual(errors,[]);
});

test('round12 文件变化：agent 改了当前页的页面文件，iframe 自动换成新内容；改了别的页只更新缩略图',async t=>{
 const {page,errors,dir}=await startWorkbench(t);await openProject(page);await ready(page);
 assert.equal(await frame(page).locator('h1').textContent(),'第1页');
 writeFileSync(join(dir,'projects/demo/pages/page_p01.html'),pageHTML('agent 新写的标题'));
 await frame(page).locator('h1',{hasText:'agent 新写的标题'}).waitFor({timeout:15000});
 writeFileSync(join(dir,'projects/demo/pages/page_p02.html'),pageHTML('第二页新内容'));
 await page.waitForTimeout(1500);
 assert.equal(await frame(page).locator('h1').textContent(),'agent 新写的标题');
 assert.deepEqual(errors,[]);
});
