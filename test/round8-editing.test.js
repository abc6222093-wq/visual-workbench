import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
const now='2026-10-01T12:00:00.000Z';
const text=(id,x,y)=>({id,type:'text',x,y,width:120,height:60,zIndex:1,text:id,fontSize:24,color:'#111111'});
async function editor(t){
 const dir=mkdtempSync(join(tmpdir(),'vw-round8-editor-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'projects/demo'),{recursive:true});const file=join(dir,'projects/demo/project.json');
 const project={format:'visual-workbench/project',formatVersion:2,id:'demo',name:'编辑操作验收',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},assets:[],fonts:[],pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[text('el_first',80,80),text('el_second',300,80),text('el_third',500,240),{...text('el_locked',700,80),locked:true},{id:'group_first',type:'group',x:100,y:400,width:300,height:100,zIndex:2,children:[text('el_child',0,0),{...text('el_childtwo',160,0),zIndex:2}]}]},{id:'page_second',name:'第二页',background:'#ffffff',elements:[]},{id:'page_third',name:'第三页',background:'#ffffff',elements:[]}]};
 writeFileSync(file,JSON.stringify(project));server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const requests=[];page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/api/projects/demo'))requests.push(r);});
 const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);await page.locator('[data-action="open"][data-id="demo"]').click();await page.waitForSelector('#artboard');return {page,file,errors,requests,server,dir,url};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
async function saved(page,action){await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()),action()]);}
async function select(page,id){await page.locator(`[data-action="select"][data-id="${id}"]`).click();}
async function center(page,id){const b=await page.locator(`#artboard [data-element-id="${id}"]`).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};}
async function gesture(page,start,end){await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();}

test('round8 elements: marquee, whole groups, drill in, Escape, clipboard and batch arrows',async t=>{
 const {page,file,errors,requests}=await editor(t);const board=await page.locator('#artboard').boundingBox(),scale=board.width/1000;
 await gesture(page,{x:board.x+40*scale,y:board.y+40*scale},{x:board.x+450*scale,y:board.y+180*scale});
 assert.equal(await page.locator('[data-resize="el_first"]').count(),8);assert.equal(await page.locator('[data-resize="el_second"]').count(),8);assert.equal(await page.locator('[data-resize="el_locked"]').count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize]').count(),0);
 const child=await center(page,'el_child');await page.mouse.click(child.x,child.y);assert.equal(await page.locator('[data-resize="group_first"]').count(),8);
 await page.mouse.click(child.x,child.y);assert.equal(await page.locator('[data-resize="el_child"]').count(),8);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize="group_first"]').count(),8);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize]').count(),0);
 await select(page,'el_first');const before=disk(file).pages[0].elements[0];const count=requests.length;
 await saved(page,async()=>{for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');});
 assert.equal(requests.length-count,1);assert.equal(disk(file).pages[0].elements[0].x,before.x+4);assert.equal(disk(file).pages[0].elements[0].y,before.y+10);
 await saved(page,()=>page.keyboard.press('ControlOrMeta+z'));assert.deepEqual(disk(file).pages[0].elements[0],before);
 await select(page,'el_first');await page.keyboard.press('ControlOrMeta+c');await page.keyboard.press('PageDown');await saved(page,()=>page.keyboard.press('ControlOrMeta+v'));
 const pasted=disk(file).pages[1].elements[0];assert.equal(pasted.text,'el_first');assert.equal(pasted.x,before.x);assert.notEqual(pasted.id,'el_first');
 await page.keyboard.press('Escape');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_first');
 await page.keyboard.press('ControlOrMeta+a');assert.equal(await page.locator('[data-resize="el_locked"]').count(),0);assert.equal(await page.locator('[data-resize]').count(),32);assert.deepEqual(errors,[]);
});

test('round8 pages: list multiselect, batch clipboard, grid exit, timeline persistence, context insertion and undo',async t=>{
 const {page,file,errors}=await editor(t);const first=page.locator('.page-list [data-page-id="page_first"] .ed-page__open'),third=page.locator('.page-list [data-page-id="page_third"] .ed-page__open');
 await first.click();await third.click({modifiers:['Shift']});assert.equal(await page.locator('.page-list .is-selected').count(),3);
 await third.focus();await page.keyboard.press('ControlOrMeta+c');await saved(page,()=>page.keyboard.press('ControlOrMeta+v'));assert.equal(disk(file).pages.length,6);
 await page.locator('.ed-tools [data-action="page-grid"]').click();assert.equal(await page.locator('.ed-page-grid [data-page-id]').count(),6);assert.equal(await page.locator('#canvas-well').isVisible(),false);
 await page.locator('.ed-page-grid [data-page-id="page_second"] .ed-page__open').dblclick();assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_second');assert.equal(await page.locator('.ed-page-grid').count(),0);
 await page.locator('.ed-tools [data-action="page-timeline"]').click();assert.equal(await page.locator('.ed-page-timeline [data-page-id]').count(),6);assert.equal(await page.locator('.ed-pages .page-list').isVisible(),false);
 await page.reload();await page.locator('[data-action="open"][data-id="demo"]').click();assert.equal(await page.locator('.ed-page-timeline').count(),1);
 const row=page.locator('.ed-page-timeline [data-page-id="page_first"] .ed-page__open');await row.click({button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'在后面插入页面'}).click());assert.equal(disk(file).pages.length,7);assert.equal(disk(file).pages[1].name,'新页面');
 await page.locator('[data-action="undo"]').click();await page.waitForFunction(()=>document.querySelectorAll('.ed-page-timeline [data-page-id]').length===6);assert.deepEqual(errors,[]);
});

test('round8 canvas context grouping, appearance, alignment and typing guard share history',async t=>{
 const {page,file,errors}=await editor(t);await select(page,'el_first');await page.locator('[data-action="select"][data-id="el_second"]').click({modifiers:['Shift']});
 const point=await center(page,'el_first');await page.mouse.click(point.x,point.y,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'编组',exact:true}).click());const g=disk(file).pages[0].elements.find(e=>e.type==='group'&&e.id!=='group_first');assert.equal(g.children.length,2);
 await saved(page,()=>page.getByRole('button',{name:'水平翻转',exact:true}).click());assert.equal(disk(file).pages[0].elements.find(e=>e.id===g.id).flipX,true);assert.equal(await page.locator(`[data-resize="${g.id}"]`).count(),8);
 const slider=page.getByRole('slider',{name:'不透明度'});await saved(page,()=>slider.evaluate(n=>{n.value='.35';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}));assert.equal(disk(file).pages[0].elements.find(e=>e.id===g.id).opacity,.35);
 const groupPoint=await center(page,g.id);await page.mouse.click(groupPoint.x,groupPoint.y,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'取消编组'}).click());assert.equal(disk(file).pages[0].elements.some(e=>e.id===g.id),false);
 await select(page,'el_first');await page.locator('[data-action="select"][data-id="el_third"]').click({modifiers:['Shift']});await saved(page,()=>page.locator('[data-align="top"]').click());assert.equal(disk(file).pages[0].elements.find(e=>e.id==='el_first').y,disk(file).pages[0].elements.find(e=>e.id==='el_third').y);
 await select(page,'el_first');const input=page.locator('[data-prop="text"]');await input.focus();const previous=disk(file);await page.keyboard.press('ControlOrMeta+a');await page.keyboard.press('ArrowRight');await page.keyboard.press('PageDown');assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_first');assert.deepEqual(disk(file),previous);assert.deepEqual(errors,[]);
});

test('round8 snap guides appear at element edges and Alt bypasses without duplicating',async t=>{
 const {page,file,errors}=await editor(t);await select(page,'el_third');const b=await page.locator('#artboard').boundingBox(),scale=b.width/1000,p=await center(page,'el_third');
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+(304-500)*scale,p.y);assert.ok(await page.locator('.ed-guide[data-axis="x"]').count()>0);await saved(page,()=>page.mouse.up());assert.equal(disk(file).pages[0].elements.find(e=>e.id==='el_third').x,300);assert.equal(await page.locator('.ed-guide').count(),0);
 const q=await center(page,'el_third');await page.keyboard.down('Alt');await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x+4*scale,q.y);assert.equal(await page.locator('.ed-guide').count(),0);await saved(page,()=>page.mouse.up());await page.keyboard.up('Alt');assert.equal(disk(file).pages[0].elements.find(e=>e.id==='el_third').x,304);assert.equal(disk(file).pages[0].elements.length,5);assert.deepEqual(errors,[]);
});

test('round8 overview rename, duplicate, trash restore, and close save and clear session',async t=>{
 const {page,file,errors,server,dir}=await editor(t);await page.locator('[data-action="home"]').click();await page.locator('[data-action="project-rename"][data-id="demo"]').click();await page.locator('.project-management-form input').fill('新名称');await page.locator('.project-management-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="open"][data-id="demo"]').textContent.includes('新名称'));assert.equal(disk(file).id,'demo');
 await page.locator('[data-action="project-duplicate"][data-id="demo"]').click();await page.waitForSelector('#artboard');assert.equal(await page.locator('.ed-title').textContent(),'新名称 副本');await page.locator('[data-action="home"]').click();
 await page.locator('[data-action="project-delete"][data-id="demo"]').click();await page.locator('[data-confirm-yes]').click();await page.waitForFunction(()=>!document.querySelector('[data-action="open"][data-id="demo"]'));await page.locator('[data-action="project-trash"]').click();await page.locator('[data-restore]').click();await page.waitForSelector('[data-action="open"][data-id="demo"]');await page.locator('[data-trash-close]').click();await page.locator('[data-action="open"][data-id="demo"]').click();
 await select(page,'el_first');await page.locator('[data-prop="text"]').fill('关闭前的最后修改');await page.locator('[data-action="close-workbench"]').click();await page.locator('[data-confirm-yes]').click();await page.getByText('工作台已关闭，可以关掉这个窗口了').waitFor();assert.equal(disk(file).pages[0].elements[0].text,'关闭前的最后修改');assert.equal(server.listening,false);const {readdirSync}=await import('node:fs');assert.equal(readdirSync(join(dir,'.workbench-sessions')).length,0);assert.deepEqual(errors,[]);
});
