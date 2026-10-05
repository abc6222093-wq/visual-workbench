// 第 12 轮：页面整理（加页、复制页、删页、跨项目复制粘贴走 POST /pages；排序、改名走整份保存）、放映入口、存版。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';import {join,dirname} from 'node:path';
import {startWorkbench,openProject,v3Project,painted} from './round12-editor-fixture.js';
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const saved=page=>page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
const rows=page=>page.locator('.page-list .ed-page[data-page-id]');
const pagesOp=(page,op)=>page.waitForResponse(r=>r.request().method()==='POST'&&/\/api\/projects\/[^/]+\/pages$/.test(r.url())&&JSON.parse(r.request().postData()||'{}').op===op);

test('round12 页面：加页、创建副本、删除（确认后页面文件一起删）都经服务端，页面栏和磁盘一致',async t=>{
 const {page,errors,files}=await startWorkbench(t);await openProject(page);
 const root=dirname(files.demo);
 await Promise.all([pagesOp(page,'create'),page.locator('.ed-col-head [data-action="add-page"]').click()]);
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===4);
 let project=disk(files.demo);assert.equal(project.pages.length,4);
 const added=project.pages[1];assert.ok(existsSync(join(root,added.file)),'新页的文件');
 assert.equal(await page.locator('.page-list .ed-page.active').getAttribute('data-page-id'),added.id,'新页在当前页后面并成为当前页');
 await page.locator('.page-list .ed-page[data-page-id="page_p03"]').click({button:'right'});
 await Promise.all([pagesOp(page,'duplicate'),page.locator('.g-context-menu button',{hasText:'创建副本'}).click()]);
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===5);
 project=disk(files.demo);assert.equal(project.pages.length,5);
 const copy=project.pages[project.pages.findIndex(p=>p.id==='page_p03')+1];assert.notEqual(copy.id,'page_p03');assert.ok(existsSync(join(root,copy.file)));
 await page.locator('.page-list .ed-page[data-page-id="page_p02"]').click({button:'right'});
 await page.locator('.g-context-menu button',{hasText:'删除'}).click();
 await page.locator('[data-confirm-yes]').waitFor();await painted(page);
 await Promise.all([pagesOp(page,'delete'),page.locator('[data-confirm-yes]').click()]);
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===4);
 project=disk(files.demo);assert.ok(!project.pages.some(p=>p.id==='page_p02'));assert.ok(!existsSync(join(root,'pages/page_p02.html')),'页面文件一起删');
 assert.deepEqual(errors,[]);
});

test('round12 页面：拖动排序有插入线并保存顺序；改页面名写回；时间轴 / 网格视图仍在',async t=>{
 const {page,errors,files}=await startWorkbench(t);await openProject(page);
 const box=async id=>{const b=await page.locator(`.page-list .ed-page[data-page-id="${id}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};};
 const a=await box('page_p01'),c=await box('page_p03');
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(c.x,c.b.y+c.b.height*.8,{steps:10});await page.waitForTimeout(200);
 assert.equal(await page.locator('.page-drop-line').evaluate(n=>n.hidden),false);
 await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/api/projects/demo')),page.mouse.up()]);await saved(page);
 assert.deepEqual(disk(files.demo).pages.map(p=>p.id),['page_p02','page_p03','page_p01']);
 await page.locator('[data-page-name]').fill('改过的页名');await page.locator('[data-page-name]').press('Enter');await saved(page);
 assert.ok(disk(files.demo).pages.some(p=>p.name==='改过的页名'));
 assert.equal(await page.locator('.ed-crumb').textContent(),'改过的页名');
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline',{state:'detached'});
 await page.locator('.ed-tools [data-action="page-grid"]').click();await page.waitForSelector('.ed-page-grid [data-page-view]');
 // 拖动排序后被拖的页仍是选中的：Esc 先取消选择，再按一次退出网格
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForSelector('.ed-page-grid',{state:'detached'});
 assert.deepEqual(errors,[]);
});

test('round12 页面：复制页面后到另一个项目粘贴（copy-from），同项目粘贴（duplicate）',async t=>{
 const a=v3Project({id:'alpha',name:'甲'}),b=v3Project({id:'beta',name:'乙',pages:['乙1']});
 const {page,errors,files}=await startWorkbench(t,{projects:[a,b]});await openProject(page,'alpha');
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__check').check();
 await page.locator('.page-list [data-page-view]').focus();
 await page.keyboard.press('ControlOrMeta+c');
 await Promise.all([pagesOp(page,'duplicate'),page.keyboard.press('ControlOrMeta+v')]);
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===4);
 await page.locator('[data-action="home"]').click();await openProject(page,'beta');
 await page.locator('.page-list .ed-page[data-page-id="page_p01"]').click({button:'right'});
 const [response]=await Promise.all([pagesOp(page,'copy-from'),page.locator('.g-context-menu button',{hasText:'粘贴'}).click()]);
 assert.deepEqual(JSON.parse(response.request().postData()).pageIds,['page_p02']);
 assert.equal(JSON.parse(response.request().postData()).fromProject,'alpha');
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===2);
 const project=disk(files.beta);assert.equal(project.pages.length,2);assert.ok(existsSync(join(dirname(files.beta),project.pages[1].file)));
 assert.deepEqual(errors,[]);
});

test('round12 放映打开放映页（当前页）；存一版进版本列表',async t=>{
 const {page,errors}=await startWorkbench(t);await openProject(page);
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__open').click();
 const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('[data-action="play"]').click()]);
 const url=new URL(popup.url());assert.equal(url.pathname,'/player.html');assert.equal(url.searchParams.get('project'),'demo');assert.equal(url.searchParams.get('page'),'page_p02');
 await popup.close();
 await page.locator('.ed-inspector [data-action="version"]').click();await page.locator('#version-form').waitFor();await painted(page);await page.locator('#version-form input[name="note"]').fill('第一版');
 await page.locator('#version-form button[type="submit"]').click();await page.waitForSelector('#modal-root:empty',{state:'attached'});
 await page.locator('.ed-inspector [data-action="versions"]').click();await page.locator('.g-sheet',{hasText:'第一版'}).waitFor();
 assert.deepEqual(errors,[]);
});
