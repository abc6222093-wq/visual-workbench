// 第 12 轮修正（任务 3）：编辑画布的「第 N 屏」。
// 带动效的页面（motion.steps = n）在画布上方显示「第 1 屏」…「第 n+1 屏」；选哪一屏画布就停在那一屏播完的样子，照常修改。
// 往后选在原 iframe 里原地快进；往回选另建 iframe，新的加载好之前旧的一直显示（不闪白）。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startWorkbench,openProject,v3Project,pageHTML,painted} from './round12-editor-fixture.js';
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const motion=`<p class="item" data-vw-id="item1" style="position:absolute;left:120px;top:700px;font-size:40px;margin:0">第一项</p><p class="item" data-vw-id="item2" style="position:absolute;left:120px;top:800px;font-size:40px;margin:0">第二项</p>
<script>vw.motion({init(){document.querySelectorAll('.item').forEach(n=>n.style.visibility='hidden');},step(i){document.querySelectorAll('.item')[i].style.visibility='visible';}});</script>`;
function project(){const p=v3Project({id:'deck',pages:['动效页','静止页']});p.pages[0].motion={steps:2};return p;}
const html=(p,i)=>pageHTML(p.name,{body:i===0?motion:''});
async function visibleItems(page){
 const el=await page.$('#artboard > iframe:not(.vw-frame-pending)');const frame=await el.contentFrame();
 return frame.evaluate(()=>[...document.querySelectorAll('.item')].map(n=>getComputedStyle(n).visibility==='visible'));
}
async function ready(page){await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});await painted(page);}
// 记录 #artboard 里 iframe 的情况：任何时刻至少有一个可见的 iframe（不闪白），最多两个
async function watchFrames(page){
 await page.evaluate(()=>{window.__frameLog=[];const stage=document.querySelector('#artboard');
  const look=()=>{const all=[...stage.querySelectorAll('iframe')];window.__frameLog.push({n:all.length,visible:all.filter(f=>getComputedStyle(f).visibility!=='hidden').length});};
  window.__frameObs=new MutationObserver(look);window.__frameObs.observe(stage,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});look();});
}

test('round12 修正 第 N 屏：选屏后画布停在那一屏，往后原地快进，往回双缓冲不闪白；在某一屏照常拖动产生修改单',async t=>{
 const {page,errors,files}=await startWorkbench(t,{projects:[project()],html,prefix:'我的云端硬盘 第N屏-'});
 await openProject(page,'deck');await ready(page);
 const labels=await page.locator('.ed-screens:not([hidden]) [data-action="screen"]').allTextContents();
 assert.deepEqual(labels.map(s=>s.trim()),['第 1 屏','第 2 屏','第 3 屏']);
 assert.equal(await page.locator('.ed-screens [aria-pressed="true"]').textContent(),'第 1 屏');
 assert.deepEqual(await visibleItems(page),[false,false],'第 1 屏 = 初始化完成、第 1 步之前');

 await page.evaluate(()=>{document.querySelector('#artboard > iframe').dataset.probe='first';});
 await page.locator('[data-action="screen"][data-screen="2"]').click();
 await page.waitForFunction(()=>document.querySelector('.ed-screens [aria-pressed="true"]')?.dataset.screen==='2');
 for(let i=0;i<50&&JSON.stringify(await visibleItems(page))!=='[true,false]';i++)await page.waitForTimeout(100);
 assert.deepEqual(await visibleItems(page),[true,false],'第 2 屏：第 1 步播完');

 // 在第 2 屏拖动卡片 → 修改单
 const outer=await page.locator('#artboard > iframe').evaluate(f=>{const r=f.getBoundingClientRect();return {x:r.left,y:r.top,scale:r.width/f.offsetWidth};});
 const card=await (await (await page.$('#artboard > iframe')).contentFrame()).locator('[data-vw-id="card"]').evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
 const sx=outer.x+card.x*outer.scale,sy=outer.y+card.y*outer.scale;
 await page.mouse.click(sx,sy);await page.waitForTimeout(150);
 await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+60,sy+30,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
 for(let i=0;i<40&&!disk(files.deck).pages[0].edits.some(e=>e.target==='card');i++)await page.waitForTimeout(100);
 const moved=disk(files.deck).pages[0].edits.find(e=>e.target==='card');
 assert.ok(moved,'在第 2 屏拖动卡片写进了修改单');

 // 第 3 屏：原地前进，iframe 不换
 await page.locator('[data-action="screen"][data-screen="3"]').click();
 for(let i=0;i<50&&JSON.stringify(await visibleItems(page))!=='[true,true]';i++)await page.waitForTimeout(100);
 assert.deepEqual(await visibleItems(page),[true,true],'第 3 屏：两步都播完');
 assert.equal(await page.locator('#artboard > iframe').evaluate(f=>f.dataset.probe),'first','往后选屏原地快进，不换 iframe');

 // 回第 1 屏：换 iframe，但新 iframe 加载好之前旧的一直显示
 await watchFrames(page);
 await page.locator('[data-action="screen"][data-screen="1"]').click();
 await page.waitForFunction(()=>{const f=document.querySelectorAll('#artboard iframe');return f.length===1&&f[0].dataset.probe!=='first';},null,{timeout:15000});
 await page.waitForTimeout(200);
 const log=await page.evaluate(()=>{window.__frameObs.disconnect();return window.__frameLog;});
 assert.ok(log.length>1,'记录到了换 iframe 的过程');
 assert.ok(log.every(e=>e.visible>=1),`换屏过程中始终有一个可见的 iframe：${JSON.stringify(log)}`);
 assert.ok(log.every(e=>e.n<=2),'最多同时两个 iframe');
 assert.deepEqual(await visibleItems(page),[false,false],'回到第 1 屏');
 assert.equal(await page.locator('#artboard').getAttribute('data-ready'),'1');
 // 修改单仍然叠在新 iframe 上
 const tr=await (await (await page.$('#artboard > iframe')).contentFrame()).locator('[data-vw-id="card"]').evaluate(n=>getComputedStyle(n).translate);
 assert.notEqual(tr,'none','回到第 1 屏后拖动过的卡片仍在新位置');

 // 没有动效的页：不显示屏选择
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__open').click();await ready(page);
 assert.equal(await page.locator('.ed-screens:not([hidden])').count(),0,'没有动效的页不显示屏选择');
 // 回到动效页：从第 1 屏开始
 await page.locator('.page-list .ed-page[data-page-id="page_p01"] .ed-page__open').click();await ready(page);
 assert.equal(await page.locator('.ed-screens [aria-pressed="true"]').textContent(),'第 1 屏');
 assert.deepEqual(errors,[]);
});
