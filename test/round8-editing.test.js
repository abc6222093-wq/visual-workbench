import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
const now='2026-10-01T12:00:00.000Z';
// 第 10 轮：文字框高度由内容决定，夹具按单行 16px（ceil(16×1.4)=23）写，打开时不触发校正
const text=(id,x,y)=>({id,type:'text',x,y,width:120,height:23,zIndex:1,text:id,fontSize:16,color:'#111111'});
async function editor(t,{transformed=false,motionFailure=false,viewport={width:1600,height:1100}}={}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round8-editor-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'projects/demo'),{recursive:true});const file=join(dir,'projects/demo/project.json');
 const project={format:'visual-workbench/project',formatVersion:2,id:'demo',name:'编辑操作验收',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},assets:[],fonts:[],pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[text('el_first',80,80),text('el_second',300,80),text('el_third',500,240),{...text('el_locked',700,80),locked:true},{id:'el_group_first',type:'group',x:100,y:400,width:300,height:100,zIndex:2,children:[text('el_child',0,0),{...text('el_childtwo',160,0),zIndex:2}]}]},{id:'page_second',name:'第二页',background:'#ffffff',elements:[]},{id:'page_third',name:'第三页',background:'#ffffff',elements:[]}]};
 if(motionFailure)project.pages[0].motion={steps:0,source:'export default ()=>{throw new Error("motion warning fixture")}'};
 if(transformed){
  const {elementInPage}=await import('../web/element-operations.js'),{visualBounds}=await import('../web/layout-tools.js');
  project.pages[0].elements=[{id:'el_group_first',type:'group',x:120,y:200,width:400,height:240,zIndex:2,rotation:30,flipX:true,children:[{...text('el_child',60,70),text:'ab',width:80,height:23,rotation:20}]}];
  const child=visualBounds(elementInPage(project.pages[0],'el_child'));
  project.pages[0].elements.push({id:'el_resize_target',type:'shape',shape:'rect',fill:'#999999',x:child.x-2,y:600,width:4,height:4,zIndex:1});
 }
 writeFileSync(file,JSON.stringify(project));server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});browser=await launchBrowser();const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));const requests=[];page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/api/projects/demo'))requests.push(r);});
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
 assert.equal(await page.locator('[data-resize="el_first"]').count(),6);assert.equal(await page.locator('[data-resize="el_second"]').count(),6);assert.equal(await page.locator('[data-resize="el_locked"]').count(),0);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize]').count(),0);
 const child=await center(page,'el_child');await page.mouse.click(child.x,child.y);assert.equal(await page.locator('[data-resize="el_group_first"]').count(),8);
 await page.mouse.click(child.x,child.y);assert.equal(await page.locator('[data-resize="el_child"]').count(),6);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize="el_group_first"]').count(),8);await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize]').count(),0);
 await select(page,'el_first');const before=disk(file).pages[0].elements[0];const count=requests.length;
 await saved(page,async()=>{for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');});
 assert.equal(requests.length-count,1);assert.equal(disk(file).pages[0].elements[0].x,before.x+4);assert.equal(disk(file).pages[0].elements[0].y,before.y+10);
 await saved(page,()=>page.keyboard.press('ControlOrMeta+z'));assert.deepEqual(disk(file).pages[0].elements[0],before);
 await select(page,'el_first');await page.keyboard.press('ControlOrMeta+c');await page.keyboard.press('PageDown');await saved(page,()=>page.keyboard.press('ControlOrMeta+v'));
 const pasted=disk(file).pages[1].elements[0];assert.equal(pasted.text,'el_first');assert.equal(pasted.x,before.x);assert.notEqual(pasted.id,'el_first');
 await page.keyboard.press('Escape');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_first');
 await page.keyboard.press('ControlOrMeta+a');assert.equal(await page.locator('[data-resize="el_locked"]').count(),0);assert.equal(await page.locator('[data-resize]').count(),26);assert.deepEqual(errors,[]);
});

test('round8 pages: list multiselect, batch clipboard, grid exit, timeline persistence, context insertion and undo',async t=>{
 const {page,file,errors}=await editor(t);assert.equal(await page.locator('.page-list [data-preview] [data-page-id]').count(),0);assert.equal(await page.locator('.page-list [data-preview] .is-selected').count(),0);const first=page.locator('.page-list [data-page-index][data-page-id="page_first"] .ed-page__open'),third=page.locator('.page-list [data-page-index][data-page-id="page_third"] .ed-page__open');
 await first.click();await third.click({modifiers:['Shift']});assert.equal(await page.locator('.page-list [data-page-index].is-selected').count(),3);
 await third.focus();await page.keyboard.press('ControlOrMeta+c');await saved(page,()=>page.keyboard.press('ControlOrMeta+v'));assert.equal(disk(file).pages.length,6);
 await page.locator('.ed-tools [data-action="page-grid"]').click();assert.equal(await page.locator('.ed-page-grid [data-page-index][data-page-id]').count(),6);assert.equal(await page.locator('#canvas-well').isVisible(),false);
 await page.locator('.ed-page-grid [data-page-index][data-page-id="page_second"] .ed-page__open').dblclick();assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_second');assert.equal(await page.locator('.ed-page-grid').count(),0);
 await page.locator('.ed-tools [data-action="page-timeline"]').click();assert.equal(await page.locator('.ed-page-timeline [data-page-index][data-page-id]').count(),6);assert.equal(await page.locator('.ed-pages [data-action="toggle-pages"]').getAttribute('aria-expanded'),'false');await page.locator('.ed-pages [data-action="toggle-pages"]').click();assert.equal(await page.locator('.ed-page-timeline').count(),0);assert.equal(await page.locator('.ed-pages [data-action="toggle-pages"]').getAttribute('aria-expanded'),'true');await page.locator('.ed-tools [data-action="page-timeline"]').click();assert.equal(await page.locator('.ed-pages .page-list').isVisible(),false);
 await page.reload();await page.locator('[data-action="open"][data-id="demo"]').click();await page.waitForSelector('#artboard');assert.equal(await page.locator('.ed-page-timeline').count(),1);
 const row=page.locator('.ed-page-timeline [data-page-index][data-page-id="page_first"] .ed-page__open');await row.click({button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'在后面插入页面'}).click());assert.equal(disk(file).pages.length,7);assert.equal(disk(file).pages[1].name,'新页面');
 await page.locator('[data-action="undo"]').click();await page.waitForFunction(()=>document.querySelectorAll('.ed-page-timeline [data-page-index][data-page-id]').length===6);assert.deepEqual(errors,[]);
});

test('round8 canvas context grouping, appearance, alignment and typing guard share history',async t=>{
 const {page,file,errors}=await editor(t);await select(page,'el_first');await page.locator('[data-action="select"][data-id="el_second"]').click({modifiers:['Shift']});
 const point=await center(page,'el_first');await page.mouse.click(point.x,point.y,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'编组',exact:true}).click());const g=disk(file).pages[0].elements.find(e=>e.type==='group'&&e.id!=='el_group_first');assert.equal(g.children.length,2);
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

test('round8 page batches sort, duplicate and delete in each view and grid Escape returns',async t=>{
 const {page,file,errors}=await editor(t);
 for(const mode of ['list','timeline','grid']){
  if(mode==='timeline')await page.locator('.ed-tools [data-action="page-timeline"]').click();
  if(mode==='grid')await page.locator('.ed-tools [data-action="page-grid"]').click();
  const selector=mode==='list'?'.page-list':mode==='timeline'?'.ed-page-timeline':'.ed-page-grid';
  const first=page.locator(`${selector} [data-page-index][data-page-id="page_first"] .ed-page__open`),third=page.locator(`${selector} [data-page-index][data-page-id="page_third"] .ed-page__open`);
  await first.click();await third.click({modifiers:['ControlOrMeta']});assert.equal(await page.locator(`${selector} [data-page-index].is-selected`).count(),2);
  await saved(page,()=>page.locator(`${selector} [data-page-index][data-page-id="page_first"]`).evaluate((node,{selector})=>{
   const transfer=new DataTransfer();node.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const target=document.querySelector(`${selector} [data-page-index][data-page-id="page_second"]`),box=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:box.right-1,clientY:box.bottom-1}));
  },{selector}));
  assert.deepEqual(disk(file).pages.map(p=>p.id),['page_second','page_first','page_third']);
  await page.locator(`${selector} [data-page-index][data-page-id="page_first"] .ed-page__open`).click({button:'right'});
  await saved(page,()=>page.getByRole('menuitem',{name:'创建副本'}).click());assert.equal(disk(file).pages.length,5);
  await page.locator(`${selector} [data-page-index].is-selected .ed-page__open`).first().focus();await saved(page,()=>page.keyboard.press('Delete'));assert.equal(disk(file).pages.length,3);
  // Undo deletion, duplication and sorting to reuse the original fixture in the next surface.
  for(let i=0;i<3;i++)await saved(page,()=>page.locator('[data-action="undo"]').click());assert.deepEqual(disk(file).pages.map(p=>p.id),['page_first','page_second','page_third']);
  if(mode==='grid'){await page.locator(`${selector} [data-page-index][data-page-id="page_first"] .ed-page__open`).focus();await page.keyboard.press('Escape');assert.equal(await page.locator('.ed-page-grid').count(),0);assert.equal(await page.locator('.ed-page-timeline').count(),1);}
 }
 assert.deepEqual(errors,[]);
});

test('round8 right click lock, unlock, blank paste and group-free selection keep editable history',async t=>{
 const {page,file,errors}=await editor(t);const p=await center(page,'el_first');await page.mouse.click(p.x,p.y,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'锁定',exact:true}).click());assert.equal(disk(file).pages[0].elements.find(e=>e.id==='el_first').locked,true);
 await page.mouse.click(p.x,p.y,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'解锁',exact:true}).click());assert.equal(disk(file).pages[0].elements.find(e=>e.id==='el_first').locked,false);
 await select(page,'el_first');await page.keyboard.press('ControlOrMeta+c');const box=await page.locator('#artboard').boundingBox();await page.mouse.click(box.x+box.width-15,box.y+box.height-15,{button:'right'});await saved(page,()=>page.getByRole('menuitem',{name:'粘贴',exact:true}).click());const elements=disk(file).pages[0].elements;assert.equal(elements.length,6);assert.equal(elements.at(-1).x,104);
 await saved(page,()=>page.keyboard.press('ControlOrMeta+z'));assert.equal(disk(file).pages[0].elements.length,5);await saved(page,()=>page.keyboard.press('ControlOrMeta+Shift+z'));assert.equal(disk(file).pages[0].elements.length,6);assert.deepEqual(errors,[]);
});

test('round8 group child resize uses page snap guides and keeps its opposite rotated anchor fixed',async t=>{
 const {page,file,errors}=await editor(t,{transformed:true});const {elementWithParents,elementInPage}=await import('../web/element-operations.js'),{visualBounds}=await import('../web/layout-tools.js');
 await select(page,'el_child');const original=disk(file).pages[0],g=original.elements[0],old=g.children[0];
 const anchor=e=>{const a=e.rotation*Math.PI/180;return elementWithParents({x:e.x+e.width/2-e.width/2*Math.cos(a),y:e.y+e.height/2-e.width/2*Math.sin(a),width:0,height:0},[g]);};const fixed=anchor(old);
 const scale=await page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a),handle=await page.locator('[data-resize="el_child"][data-handle="e"]').boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();const a=10*Math.PI/180;
 await page.mouse.move(handle.x+handle.width/2-3*Math.cos(a)*scale,handle.y+handle.height/2-3*Math.sin(a)*scale);assert.ok(await page.locator('.ed-guide').count()>0);
 await saved(page,()=>page.mouse.up());const final=disk(file).pages[0],child=final.elements[0].children[0],after=anchor(child);
 assert.ok(Math.abs(after.x-fixed.x)<1e-6);assert.ok(Math.abs(after.y-fixed.y)<1e-6);assert.equal(child.height,old.height);assert.ok(Math.abs(visualBounds(elementInPage(final,'el_child')).x-original.elements[1].x)<1e-6);assert.deepEqual(errors,[]);
});

test('round8 motion warning stays on one line at narrow width and legacy formats show plain Chinese',async t=>{
 const {page,file}=await editor(t,{motionFailure:true});const before=readFileSync(file,'utf8');await page.setViewportSize({width:1000,height:850});
 const chip=page.locator('.ed-motion-status');await chip.filter({hasText:'动效检查未通过'}).waitFor();
 const size=await chip.evaluate(n=>{const range=document.createRange();range.selectNodeContents(n);return {lines:range.getClientRects().length,whiteSpace:getComputedStyle(n).whiteSpace};});
 assert.equal(size.whiteSpace,'nowrap');assert.equal(size.lines,1);assert.match(await chip.getAttribute('title'),/motion warning fixture/);
 await page.evaluate(async()=>{const {mountMotionStatus}=await import('/motion-status.js');mountMotionStatus({formatVersion:1},'',document.querySelector('.ed-toolbar'));});
 const old=page.locator('.ed-motion-status').last();assert.equal(await old.textContent(),'这是旧格式的项目，暂时检查不了动效');assert.equal(await old.evaluate(n=>getComputedStyle(n).whiteSpace),'nowrap');assert.equal(readFileSync(file,'utf8'),before);
});


test('round8 multiple elements resize together, snap their combined edge, retain opposite anchors and undo once',async t=>{
 // At 1:1 scale, exact pointer pixels avoid float32 subpixel input rounding.
 const {page,file,errors}=await editor(t,{viewport:{width:2000,height:1400}});const original=disk(file).pages[0].elements;
 await select(page,'el_first');await page.locator('[data-action="select"][data-id="el_second"]').click({modifiers:['Shift']});
 const scale=await page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);assert.equal(scale,1);
 async function resize(){const handle=await page.locator('[data-resize="el_second"][data-handle="e"]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+77*scale,handle.y+handle.height/2);}
 await resize();assert.ok(await page.locator('.ed-guide[data-axis="x"]').count()>0);await saved(page,()=>page.mouse.up());
 const after=disk(file).pages[0].elements;
 for(const id of ['el_first','el_second']){const old=original.find(e=>e.id===id),next=after.find(e=>e.id===id);assert.ok(Math.abs(next.width-200)<1e-6);assert.equal(next.x,old.x);assert.equal(next.y,old.y);assert.equal(next.height,old.height);assert.deepEqual({...next,width:old.width},old);}
 assert.deepEqual(after.slice(2),original.slice(2));assert.equal(await page.locator('.ed-guide').count(),0);
 await saved(page,()=>page.keyboard.press('ControlOrMeta+z'));assert.deepEqual(disk(file).pages[0].elements,original);
 // Undo intentionally clears selection; select the same pair before testing Alt.
 await select(page,'el_first');await page.locator('[data-action="select"][data-id="el_second"]').click({modifiers:['Shift']});
 await page.keyboard.down('Alt');await resize();assert.equal(await page.locator('.ed-guide').count(),0);await saved(page,()=>page.mouse.up());await page.keyboard.up('Alt');
 for(const id of ['el_first','el_second'])assert.ok(Math.abs(disk(file).pages[0].elements.find(e=>e.id===id).width-197)<1e-6);
 assert.deepEqual(errors,[]);
});
