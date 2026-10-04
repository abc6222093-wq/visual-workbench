import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';

// 自建与 home() 相同结构的总览 DOM，挂冒泡阶段的 click 模拟 app 的「打开」
async function overview(t){
 const dir=mkdtempSync(join(tmpdir(),'vw-round9-home-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
 await page.evaluate(async()=>{
  document.body.replaceChildren();document.body.style.margin='0';
  for(const href of ['/glass.css','/style.css','/home-selection.css']){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l);await new Promise(r=>{l.onload=r;l.onerror=r;});}
  const app=document.createElement('div');app.id='app-fixture';
  const card=i=>`<div class="hm-cell" data-project-id="p${i}"><button class="hm-card" data-action="open" data-id="p${i}"><div class="hm-card__thumb"><div class="hm-card__art" style="width:100%;height:100%"></div></div><div class="hm-card__info"><strong>项目 ${i}</strong><small>1 页</small></div><span class="hm-card__tag">custom</span></button><button class="ed-add hm-master" data-action="master" data-id="p${i}">母</button><div class="hm-project-actions"><button class="g-btn" data-action="project-rename" data-id="p${i}">重命名</button></div></div>`;
  app.innerHTML=`<section class="hm-panel" style="height:860px"><div class="hm-scroll ed-scroll"><div class="hm-grid">${[1,2,3,4,5,6].map(card).join('')}<button class="hm-card hm-card--add" data-action="new"><span>新建项目</span></button></div></div></section>`;
  document.body.append(app);
  window.log={open:[],action:[],change:[],winKeys:[],menuOpen:[]};
  app.addEventListener('click',e=>{const b=e.target.closest('[data-action="open"]');if(b)log.open.push(b.dataset.id);});
  window.addEventListener('keydown',e=>log.winKeys.push(e.key));
  const {mountHomeSelection}=await import('/home-selection.js');
  window.sel=mountHomeSelection(app.querySelector('.hm-scroll'),{onOpen:id=>log.menuOpen.push(id),onAction:(a,ids)=>log.action.push([a,ids]),onChange:ids=>log.change.push(ids)});
 });
 return {page,errors};
}
const log=page=>page.evaluate(()=>structuredClone(window.log));
const selected=page=>page.evaluate(()=>window.sel.selected);
const card=(page,i)=>page.locator(`.hm-cell[data-project-id="p${i}"] > .hm-card`);
const checkOpacity=(page,i,v)=>page.waitForFunction(([i,v])=>getComputedStyle(document.querySelector(`.hm-cell[data-project-id="p${i}"] > .hm-check`)).opacity===v,[i,v]);
async function drag(page,a,b,modifier){if(modifier)await page.keyboard.down(modifier);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();if(modifier)await page.keyboard.up(modifier);}

test('round9 home: click opens, modifier click and checkbox select, marquee, blank click, Escape, bar and Delete',async t=>{
 const {page,errors}=await overview(t);
 await card(page,1).click();assert.deepEqual((await log(page)).open,['p1']);assert.deepEqual(await selected(page),[]);
 await card(page,2).click({modifiers:['Shift']});await card(page,3).click({modifiers:['ControlOrMeta']});
 assert.deepEqual(await selected(page),['p2','p3']);assert.deepEqual((await log(page)).open,['p1']);
 assert.equal(await page.locator('.hm-cell.is-selected').count(),2);
 await card(page,3).click({modifiers:['Meta']});assert.deepEqual(await selected(page),['p2']);
 // 有选中时勾选框常显；点勾选框切换且不打开
 await checkOpacity(page,4,'1');
 await page.locator('.hm-cell[data-project-id="p4"] > .hm-check').click();assert.deepEqual(await selected(page),['p2','p4']);assert.equal((await log(page)).open.length,1);
 assert.equal(await page.locator('.hm-selbar').isVisible(),true);assert.match(await page.locator('.hm-selbar').innerText(),/已选\s*2\s*个项目/);
 await page.locator('.hm-selbar [data-hm-sel="delete"]').click();assert.deepEqual((await log(page)).action.at(-1),['delete',['p2','p4']]);
 await page.locator('.hm-selbar [data-hm-sel="clear"]').click();assert.deepEqual(await selected(page),[]);assert.equal(await page.locator('.hm-selbar').isVisible(),false);
 // 无选中时勾选框只在悬停出现
 await page.mouse.move(5,890);await checkOpacity(page,4,'0');
 // 空白拖框：从滚动区左上角的内边距拖到第 2 张卡片中间
 const root=await page.locator('.hm-scroll').boundingBox(),c2=await card(page,2).boundingBox(),c5=await card(page,5).boundingBox(),grid=await page.locator('.hm-grid').boundingBox();
 await page.mouse.move(root.x+4,root.y+4);await page.mouse.down();await page.mouse.move(root.x+6,root.y+5);assert.equal(await page.locator('.hm-marquee').count(),0);
 await page.mouse.move(c2.x+c2.width/2,c2.y+c2.height/2,{steps:6});assert.equal(await page.locator('.hm-marquee').count(),1);await page.mouse.up();
 assert.equal(await page.locator('.hm-marquee').count(),0);assert.deepEqual(await selected(page),['p1','p2']);assert.equal((await log(page)).open.length,1);
 // Shift 追加：从网格下方空白往上拖进第 5 张
 const below={x:c5.x+c5.width/2,y:grid.y+grid.height+30};
 await drag(page,below,{x:below.x+8,y:c5.y+c5.height/2},'Shift');assert.deepEqual(await selected(page),['p1','p2','p5']);
 // 不按 Shift 重新框选会替换
 await drag(page,below,{x:below.x+8,y:c5.y+c5.height/2});assert.deepEqual(await selected(page),['p5']);
 // 点空白（不拖动）取消选择
 await page.mouse.click(below.x,below.y);assert.deepEqual(await selected(page),[]);
 // Esc：有选中时清空且不冒泡到 window；无选中时照常冒泡
 await card(page,1).click({modifiers:['Shift']});const before=(await log(page)).winKeys.length;
 await page.keyboard.press('Escape');assert.deepEqual(await selected(page),[]);assert.equal((await log(page)).winKeys.length,before);
 await page.keyboard.press('Escape');assert.deepEqual((await log(page)).winKeys.slice(before),['Escape']);
 // Delete / Backspace 删除选中
 await card(page,3).click({modifiers:['Shift']});await card(page,6).click({modifiers:['Shift']});
 await page.keyboard.press('Delete');assert.deepEqual((await log(page)).action.at(-1),['delete',['p3','p6']]);
 await page.keyboard.press('Backspace');assert.equal((await log(page)).action.length,3);
 assert.ok((await log(page)).change.length>0);assert.deepEqual(errors,[]);
});

test('round9 home: context menu for one project and for a multi-selection, then dispose cleans up',async t=>{
 const {page,errors}=await overview(t);
 await card(page,2).click({button:'right'});
 const names=await page.getByRole('menuitem').allInnerTexts();assert.deepEqual(names,['打开','重命名','复制项目','删除项目']);
 await page.getByRole('menuitem',{name:'重命名'}).click();assert.deepEqual((await log(page)).action.at(-1),['rename',['p2']]);assert.equal(await page.locator('.g-context-menu').count(),0);
 await card(page,2).click({button:'right'});await page.getByRole('menuitem',{name:'复制项目'}).click();assert.deepEqual((await log(page)).action.at(-1),['duplicate',['p2']]);
 await card(page,2).click({button:'right'});await page.getByRole('menuitem',{name:'删除项目'}).click();assert.deepEqual((await log(page)).action.at(-1),['delete',['p2']]);
 await card(page,4).click({button:'right'});await page.getByRole('menuitem',{name:'打开'}).click();assert.deepEqual((await log(page)).menuOpen,['p4']);assert.deepEqual((await log(page)).open,[]);
 // 右键已在多选中的卡片
 await card(page,1).click({modifiers:['Shift']});await card(page,3).click({modifiers:['Shift']});
 await card(page,3).click({button:'right'});assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(),['删除 2 个项目','取消选择']);
 // 菜单开着时 Esc 交给菜单，不清选择
 await page.keyboard.press('Escape');assert.equal(await page.locator('.g-context-menu').count(),0);assert.deepEqual(await selected(page),['p1','p3']);
 await card(page,3).click({button:'right'});await page.getByRole('menuitem',{name:'删除 2 个项目'}).click();assert.deepEqual((await log(page)).action.at(-1),['delete',['p1','p3']]);
 await card(page,1).click({button:'right'});await page.getByRole('menuitem',{name:'取消选择'}).click();assert.deepEqual(await selected(page),[]);
 // 右键未选中的卡片（另有选中）出单个菜单
 await card(page,1).click({modifiers:['Shift']});await card(page,3).click({modifiers:['Shift']});
 await card(page,5).click({button:'right'});assert.equal(await page.getByRole('menuitem',{name:'打开'}).count(),1);
 // dispose：菜单、勾选框、选择条、选中描边、类名与 window 键盘监听全部移除
 const before=(await log(page)).winKeys.length;
 await page.evaluate(()=>window.sel.dispose());
 assert.equal(await page.locator('.g-context-menu, .hm-check, .hm-selbar, .hm-marquee, .hm-cell.is-selected, .hm-sel-host, .hm-sel-root, .has-selection').count(),0);
 await page.keyboard.press('Escape');assert.deepEqual((await log(page)).winKeys.slice(before),['Escape']);
 await card(page,2).click({modifiers:['Shift']});assert.deepEqual((await log(page)).open,['p2']);
 const menus=await page.locator('.g-context-menu').count();await card(page,2).click({button:'right'});assert.equal(await page.locator('.g-context-menu').count(),menus);
 assert.deepEqual(errors,[]);
});
