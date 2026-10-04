// 第 11 轮：页面缩略图任何操作后都完整显示整页（0h）、时间轴缩小一半（0d）、网页项目按页自己的尺寸缩放。
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
const now='2026-10-04T12:00:00.000Z';
const text=(id,content,x,y)=>({id,type:'text',name:id,x,y,width:900,height:150,zIndex:1,text:content,fontSize:120,fontWeight:700,align:'left',color:'#111111'});
function deck(){return {format:'visual-workbench/project',formatVersion:2,id:'demo',name:'缩略图验收',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1920,height:1080},assets:[],fonts:[],
 pages:Array.from({length:4},(_,i)=>({id:`page_t${i+1}`,name:`第${i+1}页 很长很长的页面名称`,background:'#fde9d9',elements:[text(`el_a${i}`,'SENBI',40,40),text(`el_b${i}`,'千',1500,860)]}))};}
async function open(t,{viewport={width:1500,height:1000},project=deck(),before}={}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round11-pages-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'projects',project.id),{recursive:true});writeFileSync(join(dir,'projects',project.id,'project.json'),JSON.stringify(project));
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 if(before)await page.evaluate(before);
 if(before)await page.reload();
 await page.locator(`[data-action="open"][data-id="${project.id}"]`).click();await page.waitForSelector('#artboard');return {page,errors};
}
// 每张缩略图：迷你画板完整落在宿主里、宽或高贴合宿主、比例与页一致；卡片里页名在缩略图下面不重叠
async function measure(page,sel){
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 return page.evaluate(sel=>[...document.querySelectorAll(`${sel} .ed-page[data-page-id]`)].map(card=>{
  const host=card.querySelector('.ed-page__thumb'),board=host?.querySelector('.miniature > .vw-artboard'),label=card.querySelector('.ed-page__label');
  const h=host.getBoundingClientRect(),b=board?.getBoundingClientRect(),l=label.getBoundingClientRect(),c=card.getBoundingClientRect();
  return {id:card.dataset.pageId,host:{l:h.left,t:h.top,r:h.right,b:h.bottom,w:h.width,h:h.height},board:b&&{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height},
   label:{t:l.top,b:l.bottom,h:l.height},card:{t:c.top,b:c.bottom,h:c.height,w:c.width},hostScrollW:host.scrollWidth,hostScrollH:host.scrollHeight};
 }),sel);
}
function assertFits(cards,{ratio=1920/1080,ratios}={},why=''){
 assert.ok(cards.length>0,`${why}: 没有页面项`);
 for(const c of cards){
  const m=`${why} ${c.id}: ${JSON.stringify(c)}`;
  assert.ok(c.board,`${m} 没有迷你画板`);
  assert.ok(c.host.w>0&&c.host.h>0,`${m} 宿主没有大小`);
  assert.ok(c.board.l>=c.host.l-1&&c.board.t>=c.host.t-1&&c.board.r<=c.host.r+1&&c.board.b<=c.host.b+1,`${m} 画板超出宿主`);
  assert.ok(Math.abs(c.board.w-c.host.w)<=1.5||Math.abs(c.board.h-c.host.h)<=1.5,`${m} 画板没贴合宿主`);
  const want=ratios?.[c.id]??ratio;assert.ok(Math.abs(c.board.w/c.board.h-want)/want<0.03,`${m} 比例不对`);
  assert.ok(c.hostScrollW<=Math.ceil(c.host.w)+1&&c.hostScrollH<=Math.ceil(c.host.h)+1,`${m} 宿主被撑开`);
  assert.ok(c.label.t>=c.host.b-1,`${m} 页名与缩略图重叠`);
  assert.ok(c.label.b<=c.card.b+1,`${m} 页名溢出卡片`);
 }
}
const toggle=page=>page.locator('.ed-pages > [data-action="toggle-pages"]').click();

test('round11 列表缩略图：页面栏折叠时打开项目，再展开，缩略图完整显示整页',async t=>{
 const {page,errors}=await open(t,{before:()=>localStorage.setItem('vw-pages-collapsed','true')});
 await toggle(page);await page.waitForSelector('.page-list .ed-page');
 assertFits(await measure(page,'.page-list'),{},'折叠打开后展开');
 assert.deepEqual(errors,[]);
});

test('round11 列表缩略图：折叠/展开、切时间轴/网格再回列表、改窗口大小后都完整',async t=>{
 const {page,errors}=await open(t);
 assertFits(await measure(page,'.page-list'),{},'初次打开');
 await toggle(page);await toggle(page);assertFits(await measure(page,'.page-list'),{},'收起再展开');
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');
 assertFits(await measure(page,'.ed-page-timeline'),{},'时间轴');
 // 时间轴里加一页：左侧列表此时是隐藏的，新缩略图量不到大小；切回列表后必须补上缩放
 await page.locator('.ed-col-head [data-action="add-page"]').evaluate(n=>n.click());await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===5);await page.waitForTimeout(150);
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline',{state:'detached'});
 assertFits(await measure(page,'.page-list'),{},'时间轴切回列表');
 await page.locator('.ed-tools [data-action="page-grid"]').click();await page.waitForSelector('.ed-page-grid [data-page-view]');
 assertFits(await measure(page,'.ed-page-grid'),{},'网格');
 await page.locator('.ed-tools [data-action="page-grid"]').click();await page.waitForSelector('.ed-page-grid',{state:'detached'});
 assertFits(await measure(page,'.page-list'),{},'网格切回列表');
 await page.setViewportSize({width:1100,height:800});await page.waitForTimeout(150);
 assertFits(await measure(page,'.page-list'),{},'窗口变窄');
 await page.setViewportSize({width:1800,height:1000});await page.waitForTimeout(150);
 assertFits(await measure(page,'.page-list'),{},'窗口变宽');
 await page.locator('.ed-col-head [data-action="add-page"]').evaluate(n=>n.click());await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===6);
 await page.waitForTimeout(150);assertFits(await measure(page,'.page-list'),{},'新加一页');
 assert.deepEqual(errors,[]);
});

test('round11 时间轴缩小一半：卡片约 96 宽、缩略图约 54 高，页名序号可读，整条不超过 110 高',async t=>{
 const {page,errors}=await open(t);
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');
 const cards=await measure(page,'.ed-page-timeline');assertFits(cards,{},'时间轴');
 for(const c of cards){assert.ok(c.card.w>=90&&c.card.w<=110,`卡片宽 ${c.card.w}`);assert.ok(c.host.h>=48&&c.host.h<=60,`缩略图高 ${c.host.h}`);assert.ok(c.label.h>=12,`页名高 ${c.label.h}`);}
 const info=await page.evaluate(()=>{const host=document.querySelector('.ed-page-timeline'),label=document.querySelector('.ed-page-timeline .ed-page__label'),b=label.querySelector('b'),i=label.querySelector('i');
  return {height:host.getBoundingClientRect().height,num:b.textContent,numSize:parseFloat(getComputedStyle(b).fontSize),nameSize:parseFloat(getComputedStyle(i).fontSize),nameW:i.getBoundingClientRect().width};});
 assert.ok(info.height<=110,`时间轴高 ${info.height}`);assert.equal(info.num,'01');assert.ok(info.numSize>=10&&info.nameSize>=11,'字号不小于 10/11px');assert.ok(info.nameW>20,'页名有显示宽度');
 assert.deepEqual(errors,[]);
});

test('round11 网页项目：缩略图按每页自己的尺寸缩放，竖长页完整显示在宿主里（contain、居中）',async t=>{
 const project={format:'visual-workbench/project',formatVersion:2,id:'site',name:'网页缩略图',kind:'web',createdAt:now,updatedAt:now,artboard:{preset:'web-desktop',width:1440,height:900},assets:[],fonts:[],
  pages:[{id:'page_desk',name:'首页 · 电脑端',background:'#dbeafe',elements:[],device:'desktop',size:{width:1440,height:3200}},
   {id:'page_mob',name:'首页 · 手机端',background:'#fde68a',elements:[],device:'mobile',size:{width:390,height:5000}},
   {id:'page_short',name:'关于',background:'#fecaca',elements:[],device:'desktop',size:{width:1440,height:900}}]};
 const {page,errors}=await open(t,{project});
 const ratios={page_desk:1440/3200,page_mob:390/5000,page_short:1440/900};
 const cards=await measure(page,'.page-list');assertFits(cards,{ratios},'网页列表');
 for(const c of cards.filter(c=>c.id!=='page_short')){const mid=(c.host.l+c.host.r)/2,bm=(c.board.l+c.board.r)/2;assert.ok(Math.abs(mid-bm)<=1.5,`${c.id} 没有水平居中`);}
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await page.waitForSelector('.ed-page-timeline [data-page-view]');
 assertFits(await measure(page,'.ed-page-timeline'),{ratios},'网页时间轴');
 assert.deepEqual(errors,[]);
});
