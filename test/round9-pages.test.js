import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {pageHTML} from './round12-editor-fixture.js';import {launchBrowser} from '../src/browser.js';
const now='2026-10-04T12:00:00.000Z',ids=Array.from({length:8},(_,i)=>`page_pg0${i+1}`);
async function open(t,viewport={width:1600,height:1200}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round9-pages-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'projects/demo'),{recursive:true});const file=join(dir,'projects/demo/project.json');
 // 第 12 轮：v3 夹具（每页一个页面文件）
 const project={format:'visual-workbench/project',formatVersion:3,id:'demo',name:'页面拖动验收',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1600,height:900},assets:[],fonts:[],pages:ids.map((id,i)=>({id,name:`第${i+1}页`,file:`pages/${id}.html`,edits:[]}))};
 mkdirSync(join(dir,'projects/demo/pages'),{recursive:true});for(const p of project.pages)writeFileSync(join(dir,'projects/demo',p.file),pageHTML(p.name));
 writeFileSync(file,JSON.stringify(project));server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport});const errors=[],puts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/api/projects/demo'))puts.push(r);});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-action="open"][data-id="demo"]').click();await page.waitForSelector('#artboard > iframe');return {page,file,errors,puts};
}
const order=file=>JSON.parse(readFileSync(file,'utf8')).pages.map(p=>p.id);
const surface={list:'.page-list',timeline:'.ed-page-timeline',grid:'.ed-page-grid'};
const row=(page,mode,id)=>page.locator(`${surface[mode]} .ed-page[data-page-id="${id}"]`);
const selectedCount=(page,mode)=>page.locator(`${surface[mode]} .ed-page.is-selected`).count();
async function box(page,mode,id){const b=await row(page,mode,id).boundingBox();return {...b,cx:b.x+b.width/2,cy:b.y+b.height/2};}
async function press(page,{x,y}){await page.mouse.move(x,y);await page.mouse.down();}
async function moveTo(page,{x,y}){await page.mouse.move(x,y,{steps:8});await page.waitForTimeout(260);}
async function drop(page){await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/api/projects/demo')&&r.ok()),page.mouse.up()]);}
const lineRect=page=>page.locator('.page-drop-line').evaluate(n=>{const r=n.getBoundingClientRect();return {hidden:n.hidden,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};});
async function dragState(page,mode,dragged){return page.evaluate(({sel,dragged})=>{const items=[...document.querySelectorAll(`${sel} .ed-page[data-page-id]`)];return {shifted:items.filter(n=>!dragged.includes(n.dataset.pageId)&&getComputedStyle(n).transform!=='none').length,opacity:Math.max(...dragged.map(id=>Number(getComputedStyle(document.querySelector(`${sel} .ed-page[data-page-id="${id}"]`)).opacity))),stray:document.querySelectorAll(`${sel} [data-page-view] > :not(.ed-page)[data-page-id]`).length};},{sel:surface[mode],dragged});}

test('round9 list drag shows insertion line, making room, translucent source and saves order',async t=>{
 const {page,file,errors}=await open(t);const from=await box(page,'list','page_pg02'),p5=await box(page,'list','page_pg05');
 await press(page,{x:from.cx,y:from.cy});await moveTo(page,{x:p5.cx,y:p5.y+p5.height*.75});
 const line=await lineRect(page),p5now=await box(page,'list','page_pg05'),p6now=await box(page,'list','page_pg06'),state=await dragState(page,'list',['page_pg02']);
 assert.equal(line.hidden,false);assert.ok(line.width>line.height,'list line is horizontal');assert.ok(line.top>=p5now.y+p5now.height-2&&line.bottom<=p6now.y+2,'line between page 5 and 6');
 assert.ok(state.shifted>0,'other pages make room');assert.ok(state.opacity<1,'dragged page is translucent');assert.equal(state.stray,0);
 assert.equal(await page.locator('.page-drag-badge').count(),0);
 await drop(page);assert.deepEqual(order(file),['page_pg01','page_pg03','page_pg04','page_pg05','page_pg02','page_pg06','page_pg07','page_pg08']);
 assert.equal(await page.locator('.page-drop-line').count(),0);assert.deepEqual(errors,[]);
});

test('round9 multi-page drag shows N pages badge and keeps relative order',async t=>{
 const {page,file,errors}=await open(t);
 await row(page,'list','page_pg02').locator('.ed-page__open').click();for(const id of ['page_pg04','page_pg06'])await row(page,'list',id).locator('.ed-page__open').click({modifiers:['ControlOrMeta']});
 assert.equal(await selectedCount(page,'list'),3);
 const from=await box(page,'list','page_pg04'),p3=await box(page,'list','page_pg03');
 await press(page,{x:from.cx,y:from.cy});await moveTo(page,{x:p3.cx,y:p3.y+p3.height*.2});
 assert.equal(await page.locator('.page-drag-badge').textContent(),'3 页');assert.ok((await dragState(page,'list',['page_pg02','page_pg04','page_pg06'])).opacity<1);
 await drop(page);assert.deepEqual(order(file),['page_pg01','page_pg02','page_pg04','page_pg06','page_pg03','page_pg05','page_pg07','page_pg08']);
 assert.equal(await page.locator('.page-drag-badge').count(),0);assert.deepEqual(errors,[]);
});

test('round9 timeline and grid drag use vertical insertion lines',async t=>{
 const {page,file,errors}=await open(t);
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');
 let from=await box(page,'timeline','page_pg01'),to=await box(page,'timeline','page_pg03');
 await press(page,{x:from.cx,y:from.cy});await moveTo(page,{x:to.x+to.width*.8,y:to.cy});
 let line=await lineRect(page);assert.equal(line.hidden,false);assert.ok(line.height>line.width,'timeline line is vertical');
 const p3=await box(page,'timeline','page_pg03'),p4=await box(page,'timeline','page_pg04');assert.ok(line.left>=p3.x+p3.width-2&&line.right<=p4.x+2);assert.ok((await dragState(page,'timeline',['page_pg01'])).shifted>0);
 await drop(page);assert.deepEqual(order(file),['page_pg02','page_pg03','page_pg01','page_pg04','page_pg05','page_pg06','page_pg07','page_pg08']);
 await page.locator('.ed-tools [data-action="page-grid"]').click();await page.waitForSelector('.ed-page-grid [data-page-view]');
 from=await box(page,'grid','page_pg06');to=await box(page,'grid','page_pg03');
 await press(page,{x:from.cx,y:from.cy});await moveTo(page,{x:to.x+to.width*.2,y:to.cy});
 line=await lineRect(page);assert.equal(line.hidden,false);assert.ok(line.height>line.width,'grid line is vertical');
 const left=await box(page,'grid','page_pg02'),right=await box(page,'grid','page_pg03');assert.ok(Math.abs(left.y-right.y)<2,'fixture keeps both cards on one grid row');assert.ok(line.left>=left.x+left.width-2&&line.right<=right.x+2,'grid line sits between two cards');
 assert.ok((await dragState(page,'grid',['page_pg06'])).shifted>0);
 await drop(page);assert.deepEqual(order(file),['page_pg02','page_pg06','page_pg03','page_pg01','page_pg04','page_pg05','page_pg07','page_pg08']);assert.deepEqual(errors,[]);
});

test('round9 dragging to the list edge auto-scrolls and Escape cancels without saving',async t=>{
 const {page,file,errors,puts}=await open(t,{width:1400,height:500});const scroller=page.locator('.page-list');
 const area=await scroller.boundingBox(),from=await box(page,'list','page_pg01');assert.ok(await scroller.evaluate(n=>n.scrollHeight>n.clientHeight));
 const before=await scroller.evaluate(n=>n.scrollTop);await press(page,{x:from.cx,y:from.cy});await moveTo(page,{x:from.cx,y:area.y+area.height-6});
 for(let i=0;i<6;i++){await page.mouse.move(from.cx,area.y+area.height-5-i%2);await page.waitForTimeout(100);}
 assert.ok(await scroller.evaluate(n=>n.scrollTop)>before+40,'list scrolled while dragging at its edge');
 const count=puts.length;await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(200);
 assert.equal(puts.length,count);assert.deepEqual(order(file),ids);assert.equal(await page.locator('.page-drop-line').count(),0);assert.deepEqual(errors,[]);
});

test('round9 grid marquee selects, Shift adds, blank click clears and Escape clears before leaving the grid',async t=>{
 const {page,errors}=await open(t);await page.locator('.ed-tools [data-action="page-grid"]').click();const root=page.locator('.ed-page-grid [data-page-view]');await root.waitFor();
 const area=await root.boundingBox(),p2=await box(page,'grid','page_pg02');
 await press(page,{x:area.x+6,y:area.y+6});await moveTo(page,{x:p2.cx,y:p2.cy});
 assert.ok(await page.locator('.page-marquee').isVisible());await page.mouse.up();
 assert.equal(await selectedCount(page,'grid'),2);assert.equal(await page.locator('.page-marquee').count(),0);
 const tops=await page.evaluate(()=>[...document.querySelectorAll('.ed-page-grid .ed-page[data-page-id]')].map(n=>({id:n.dataset.pageId,top:Math.round(n.getBoundingClientRect().top)})));
 const second=tops.filter(x=>x.top>tops[0].top+2),a=await box(page,'grid',second[0].id),b=await box(page,'grid',second[1].id);
 await page.keyboard.down('Shift');await press(page,{x:area.x+6,y:a.cy});await moveTo(page,{x:b.cx,y:b.cy});await page.mouse.up();await page.keyboard.up('Shift');
 assert.equal(await selectedCount(page,'grid'),4);
 await page.mouse.click(area.x+6,area.y+6);assert.equal(await selectedCount(page,'grid'),0);assert.equal(await page.locator('.ed-page-grid').count(),1);
 await press(page,{x:area.x+6,y:area.y+6});await moveTo(page,{x:p2.cx,y:p2.cy});await page.mouse.up();assert.equal(await selectedCount(page,'grid'),2);
 // D3：网格里有选中页时 Esc 先取消选择、仍停在网格；再按一次 Esc 才回到原视图
 await page.keyboard.press('Escape');assert.equal(await selectedCount(page,'grid'),0);assert.equal(await page.locator('.ed-page-grid').count(),1);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.ed-page-grid').count(),0);
 assert.deepEqual(errors,[]);
});

test('round9 list and timeline blank click and Escape clear page selection',async t=>{
 const {page,errors}=await open(t);
 for(const mode of ['list','timeline']){
  if(mode==='timeline'){await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');}
  const select=async()=>{await row(page,mode,'page_pg01').locator('.ed-page__open').click();await row(page,mode,'page_pg03').locator('.ed-page__open').click({modifiers:['Shift']});assert.equal(await selectedCount(page,mode),3);};
  const root=page.locator(`${surface[mode]} [data-page-view]`);
  await select();let blank;
  // 列表：滚到底，点最后一页下方的留白；时间轴：点两张卡之间的空隙。
  if(mode==='list'){await page.locator('.page-list').evaluate(n=>{n.scrollTop=n.scrollHeight;});const last=await box(page,mode,'page_pg08');blank={x:last.cx,y:last.y+last.height+10};}
  else{const a=await box(page,mode,'page_pg01'),b=await box(page,mode,'page_pg02');blank={x:(a.x+a.width+b.x)/2,y:a.cy};}
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.matches('[data-page-view]'),blank),true,`${mode} blank point belongs to the view root`);
  await page.mouse.click(blank.x,blank.y);assert.equal(await selectedCount(page,mode),0);
  await select();await root.focus();await page.keyboard.press('Escape');assert.equal(await selectedCount(page,mode),0);assert.equal(await root.count(),1);
 }
 assert.deepEqual(errors,[]);
});

test('round9 plain clicks still switch and select pages without sorting',async t=>{
 const {page,file,errors,puts}=await open(t);
 await row(page,'list','page_pg03').locator('.ed-page__open').click();assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_pg03');assert.equal(await selectedCount(page,'list'),1);
 const p5=await box(page,'list','page_pg05');await page.mouse.move(p5.cx,p5.cy);await page.mouse.down();await page.mouse.move(p5.cx+2,p5.cy+2);await page.mouse.up();
 assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_pg05');assert.equal(await row(page,'list','page_pg05').evaluate(n=>n.classList.contains('is-selected')),true);
 await page.waitForTimeout(300);assert.equal(puts.length,0);assert.deepEqual(order(file),ids);assert.deepEqual(errors,[]);
});
