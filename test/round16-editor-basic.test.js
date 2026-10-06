// 第 16 轮：整个编辑器（真实服务 + 真实浏览器）里的基本编辑路径：
// 删除（remove 记进修改单、画面隐藏、撤销恢复）、右键「删除」、多选一起拖一步撤销、工具条对齐 6 种（一步撤销）、画布四周框选、
// 拖动中在窗口外松开（父页面收到 buttons=0 的移动 → 拖动结束、框不留在页面上）、换页双缓冲（始终只有一个看得见的 iframe）。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startWorkbench,openProject,clickInFrame,painted} from './round12-editor-fixture.js';
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const saved=page=>page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
const frameSel='#artboard > iframe:not(.vw-frame-pending)';
const frame=page=>page.frameLocator(frameSel);
async function ready(page){await page.waitForFunction(()=>document.querySelector('#artboard')?.dataset.ready==='1'&&document.querySelectorAll('#artboard > iframe').length===1,null,{timeout:15000});await painted(page);}
const editsOf=(files,i=0)=>disk(files.demo).pages[i].edits;
// 页面坐标（画板像素）→ 父页面屏幕坐标
const toScreen=(page,x,y)=>page.locator(frameSel).evaluate((f,[x,y])=>{const r=f.getBoundingClientRect(),k=r.width/f.offsetWidth;return {x:r.left+x*k,y:r.top+y*k};},[x,y]);
const elBox=(page,id)=>frame(page).locator(`[data-vw-id="${id}"]`).evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};});
const visibility=(page,id)=>frame(page).locator(`[data-vw-id="${id}"]`).evaluate(n=>getComputedStyle(n).visibility);
const quickbarShown=page=>page.waitForSelector('.ed-quickbar:not([hidden])');
async function selectTwo(page){
 await clickInFrame(page,'[data-vw-id="title"]');await quickbarShown(page);
 await page.keyboard.down('Shift');await clickInFrame(page,'[data-vw-id="card"]');await page.keyboard.up('Shift');
 await page.waitForSelector('.ed-quickbar [data-action="align"][data-align="left"]');
}

test('round16 删除：Delete 记 remove、画面隐藏、撤销恢复；右键「删除」同样', async t=>{
 const {page,errors,files}=await startWorkbench(t,{prefix:'vw-r16-editor-del-'});await openProject(page);await ready(page);
 await clickInFrame(page,'[data-vw-id="card"]');await quickbarShown(page);
 await page.keyboard.press('Delete');
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('1'));await saved(page);
 const rm=editsOf(files).find(e=>e.kind==='remove');
 assert.equal(rm?.target,'card');assert.deepEqual(rm.after,{removed:true});
 assert.equal(await visibility(page,'card'),'hidden');
 assert.equal(await page.locator('[data-confirm-yes]').count(),0,'不弹确认');
 await page.locator('[data-action="undo"]').click();await saved(page);
 assert.equal(editsOf(files).length,0);
await frame(page).locator('[data-vw-id="card"]').evaluate(n=>new Promise(r=>{const ok=()=>getComputedStyle(n).visibility==='visible'?r():requestAnimationFrame(ok);ok();}));
 // 右键标题 → 「删除」
 await clickInFrame(page,'[data-vw-id="title"]',{button:'right'});
 await page.locator('.g-context-menu button',{hasText:'删除'}).waitFor();await painted(page);
 await page.locator('.g-context-menu button',{hasText:'删除'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('1'));await saved(page);
 assert.deepEqual(editsOf(files).map(e=>[e.target,e.kind]),[['title','remove']]);
 assert.equal(await visibility(page,'title'),'hidden');
 assert.deepEqual(errors,[]);
});

test('round16 多选一起拖 = 一步撤销；工具条对齐 6 种（按选中范围），每种一步撤销', async t=>{
 const {page,errors,files}=await startWorkbench(t,{prefix:'vw-r16-editor-multi-'});await openProject(page);await ready(page);
 await selectTwo(page);
 const card=await elBox(page,'card');
 const a=await toScreen(page,card.x+300,card.y+100),b=await toScreen(page,card.x+400,card.y+150);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('2'));await saved(page);
 const moves=editsOf(files);
 assert.deepEqual(moves.map(e=>e.target).sort(),['card','title']);
 for(const e of moves){assert.equal(e.kind,'move');assert.ok(Math.abs(e.after.dx-100)<=2&&Math.abs(e.after.dy-50)<=2,JSON.stringify(e.after));}
 await page.locator('[data-action="undo"]').click();await saved(page);
 assert.equal(editsOf(files).length,0,'一步撤销两处');
 // 对齐：标题 120,100（宽高按字），卡片 120,400 600×200
 const t0=await elBox(page,'title');
 const U={l:120,r:720,t:100,b:600};
 const want={left:[{x:120},{x:120}],centerX:[{x:(U.l+U.r)/2-t0.w/2},{x:120}],right:[{x:U.r-t0.w},{x:120}],
  top:[{y:100},{y:100}],centerY:[{y:(U.t+U.b)/2-t0.h/2},{y:250}],bottom:[{y:U.b-t0.h},{y:400}]};
 for(const [mode,[tw,cw]] of Object.entries(want)){
  // 撤销后选中可能被清掉（工具条收起）：没有对齐按钮就重新选两个
  if(!await page.locator(`.ed-quickbar:not([hidden]) [data-action="align"][data-align="${mode}"]`).count())await selectTwo(page);
  await page.locator(`.ed-quickbar [data-action="align"][data-align="${mode}"]`).click();
  const changes=mode==='left'?0:1;
  if(changes){await page.waitForFunction(()=>!document.querySelector('[data-edit-count]')?.textContent.includes('还没有'));await saved(page);}
  else await page.waitForTimeout(300);
  const tb=await elBox(page,'title'),cb=await elBox(page,'card');
  for(const [k,v] of Object.entries(tw))assert.ok(Math.abs(tb[k]-v)<=1,`${mode} 标题 ${k}=${tb[k]} 应为 ${v}`);
  for(const [k,v] of Object.entries(cw))assert.ok(Math.abs(cb[k]-v)<=1,`${mode} 卡片 ${k}=${cb[k]} 应为 ${v}`);
  if(changes){
   await page.locator('[data-action="undo"]').click();await saved(page);
   assert.equal(editsOf(files).length,0,`${mode} 一步撤销`);

   await frame(page).locator('[data-vw-id="title"]').evaluate(n=>new Promise(r=>{const ok=()=>Math.abs(n.getBoundingClientRect().left-120)<1&&Math.abs(n.getBoundingClientRect().top-100)<1?r():requestAnimationFrame(ok);ok();}));
  }
 }
 assert.deepEqual(errors,[]);
});

test('round16 画布四周框选：从页面外拖进来，完全框住的才选中；松开后父页面的框消失', async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'vw-r16-editor-wellmq-'});await openProject(page);await ready(page);
 const art=await page.locator('#artboard-holder').boundingBox();
 const end=await toScreen(page,1000,330);// 框住标题（120..,100..约 200），不碰卡片（top 400）
 const hit=await page.evaluate(([x,y])=>{const n=document.elementFromPoint(x,y);return n?.id||n?.className||n?.tagName;},[art.x-12,art.y-12]);
 assert.ok(['canvas-well','artboard-holder'].includes(hit),`画布四周空白处：${hit}`);
 // 按下后等挡板画出来再移动：挡板还没进合成层时，经过页面上方的移动会被隔离的 iframe 收走（见报告）
 await page.mouse.move(art.x-12,art.y-12);await page.mouse.down();await painted(page);
 await page.mouse.move(end.x-100,end.y-50,{steps:4});
 await page.waitForSelector('.ed-marquee',{timeout:5000});
 await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up();
 await page.waitForSelector('.ed-quickbar:not([hidden]) [data-q="fontSize"]');
 assert.equal(await page.locator('.ed-quickbar [data-q="background"]').count(),0,'只选中了标题');
 assert.equal(await page.locator('.ed-marquee').count(),0);assert.equal(await page.locator('.ed-marquee-shield').count(),0);
 // 在窗口外松开（之后第一下移动 buttons=0）：框选结束，框不留在画布上
 await page.mouse.move(art.x-12,art.y-12);await page.mouse.down();await painted(page);
 await page.mouse.move(art.x+60,art.y+60,{steps:4});
 await page.waitForSelector('.ed-marquee');
 await page.evaluate(([x,y])=>document.querySelector('#canvas-well').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,buttons:0,pointerId:1})),[art.x+80,art.y+80]);
 await page.waitForSelector('.ed-marquee',{state:'detached'});
 assert.equal(await page.locator('.ed-marquee-shield').count(),0);
 await page.mouse.up();
 assert.deepEqual(errors,[]);
});

test('round16 页面里拖动中在窗口外松开：父页面收到 buttons=0 的移动 → 拖动结束、修改记下、框不留在页面上', async t=>{
 const {page,errors,files}=await startWorkbench(t,{prefix:'vw-r16-editor-dragout-'});await openProject(page);await ready(page);
 const card=await elBox(page,'card');
 const a=await toScreen(page,card.x+300,card.y+100),b=await toScreen(page,card.x+340,card.y+100);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});
 // 鼠标在窗口外松开：父页面收不到 pointerup，下一次移动时按键已松开
 await page.evaluate(([x,y])=>window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,buttons:0,pointerId:1})),[b.x+20,b.y]);
 await page.waitForFunction(()=>document.querySelector('[data-edit-count]')?.textContent.includes('1'));await saved(page);
 const mv=editsOf(files)[0];
 assert.equal(mv.target,'card');assert.equal(mv.kind,'move');assert.ok(mv.after.dx>30,JSON.stringify(mv.after));
 await page.mouse.up();
 // 页面里的框选：同样结束，框不留
 const s1=await toScreen(page,1300,60),s2=await toScreen(page,1500,200);
 await page.mouse.move(s1.x,s1.y);await page.mouse.down();await page.mouse.move(s2.x,s2.y,{steps:5});
 const mq=()=>frame(page).locator('vw-ui').evaluate(h=>h.shadowRoot.querySelector('.marquee').hidden);

 for(let i=0;i<50&&await mq();i++)await page.waitForTimeout(20);
 assert.equal(await mq(),false,'页面里的框选框');
 await page.evaluate(([x,y])=>window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:x,clientY:y,buttons:0,pointerId:1})),[s2.x+10,s2.y]);
 for(let i=0;i<50&&!await mq();i++)await page.waitForTimeout(20);
 assert.equal(await mq(),true,'框不留在页面上');
 await page.mouse.up();
 assert.deepEqual(errors,[]);
});

test('round16 换页双缓冲：旧页留到新页画好才去掉，期间始终只有一个看得见的 iframe', async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'vw-r16-editor-swap-'});await openProject(page);await ready(page);
 await page.evaluate(()=>{
  window.__swap={samples:[],max:0};const stage=document.querySelector('#artboard');
  const sample=()=>{const fs=[...stage.querySelectorAll(':scope > iframe')];const vis=fs.filter(f=>getComputedStyle(f).visibility!=='hidden'&&!f.classList.contains('vw-frame-pending'));
   window.__swap.max=Math.max(window.__swap.max,fs.length);window.__swap.samples.push([fs.length,vis.length,vis[0]?.dataset.vwPage||null]);};
  new MutationObserver(sample).observe(stage,{childList:true,subtree:false,attributes:true,attributeFilter:['class'],subtree:true});
  const loop=()=>{sample();if(!window.__swap.stop)requestAnimationFrame(loop);};loop();
 });
 for(const id of ['page_p02','page_p03','page_p01']){
  await page.locator(`.page-list .ed-page[data-page-id="${id}"] .ed-page__open`).click();
  await page.waitForFunction(id=>{const fs=document.querySelectorAll('#artboard > iframe');return fs.length===1&&fs[0].dataset.vwPage===id&&document.querySelector('#artboard').dataset.ready==='1';},id,{timeout:15000});
  assert.equal(await frame(page).locator('h1').textContent(),{page_p02:'第2页',page_p03:'第3页',page_p01:'第1页'}[id]);
 }
 const swap=await page.evaluate(()=>{window.__swap.stop=true;return window.__swap;});
 assert.equal(swap.max,2,'换页时新旧两个 iframe 并存过（旧页留着占位）');
 const bad=swap.samples.filter(([,v])=>v!==1);
 assert.deepEqual(bad,[],'任何时刻都只有一个看得见的 iframe');
 assert.deepEqual(errors,[]);
});
