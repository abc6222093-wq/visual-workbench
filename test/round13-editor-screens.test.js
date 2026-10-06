// 第 13 轮 0a：「第 N 屏」一定看得见。屏切换在画布下方一排标签按钮（比工具条按钮大）；
// motion.steps 写了 → steps+1 屏；没写但页面登记了 step → 隐藏探测 iframe 数出 n → n+1 屏 + 说明；
// 页面有自己的动画 / 脚本但没有 vw.motion → 只写一句说明；静态页什么都不显示。页面栏页面项旁「N 屏」。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startWorkbench,openProject,v3Project,pageHTML,painted} from './round12-editor-fixture.js';

const runtime=readFileSync(new URL('../web/page-runtime.js',import.meta.url),'utf8');
const canCount=/countSteps/.test(runtime)&&/hasStep/.test(runtime);
const items=`<p class="item" style="position:absolute;left:120px;top:700px;font-size:40px;margin:0">第一项</p><p class="item" style="position:absolute;left:120px;top:800px;font-size:40px;margin:0">第二项</p>`;
const motion=`${items}<script>vw.motion({init(){document.querySelectorAll('.item').forEach(n=>n.style.visibility='hidden');},step(i){document.querySelectorAll('.item')[i].style.visibility='visible';}});</script>`;
const own=`<style>@keyframes spin{to{transform:rotate(360deg)}}.spin{position:absolute;left:900px;top:300px;width:80px;height:80px;background:#88dad1;animation:spin 3s linear infinite}</style><div class="spin"></div><script>document.title='自己的脚本';</script>`;
function project(){const p=v3Project({id:'deck',pages:['写了步数','没写步数','自己的动画','静止页']});p.pages[0].motion={steps:2};return p;}
const html=(p,i)=>pageHTML(p.name,{body:[motion,motion,own,''][i]});
async function ready(page){await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});await painted(page);}
const open=async(page,id)=>{await page.locator(`.page-list .ed-page[data-page-id="${id}"] .ed-page__open`).click();await ready(page);};
const visibleItems=async page=>{const f=await (await page.$('#artboard > iframe:not(.vw-frame-pending)')).contentFrame();return f.evaluate(()=>[...document.querySelectorAll('.item')].map(n=>getComputedStyle(n).visibility==='visible'));};

test('round13 第 N 屏：画布下方的标签按钮、数屏、说明文字、页面栏「N 屏」',async t=>{
 const {page,errors}=await startWorkbench(t,{projects:[project()],html,prefix:'vw-round13-screens-'});
 await openProject(page,'deck');await ready(page);
 // 写了 steps：三屏，在画布下方（.ed-foot 里），按钮比工具条按钮大
 const labels=await page.locator('.ed-foot .ed-screens:not([hidden]) [data-action="screen"]').allTextContents();
 assert.deepEqual(labels.map(s=>s.trim()),['第 1 屏','第 2 屏','第 3 屏']);
 assert.equal(await page.locator('.ed-toolbar .ed-screens').count(),0,'画布上方工具条里不再有屏按钮');
 const geo=await page.evaluate(()=>{const b=document.querySelector('.ed-screen').getBoundingClientRect(),w=document.querySelector('#canvas-well').getBoundingClientRect(),t=document.querySelector('.ed-tbtn').getBoundingClientRect();return {top:b.top,h:b.height,wellBottom:w.bottom,tbtn:t.height,font:parseFloat(getComputedStyle(document.querySelector('.ed-screen')).fontSize),tfont:parseFloat(getComputedStyle(document.querySelector('.ed-tbtn')).fontSize)};});
 assert.ok(geo.top>=geo.wellBottom-1,`屏按钮在画布区下面：${JSON.stringify(geo)}`);
 assert.ok(geo.h>geo.tbtn&&geo.font>geo.tfont,`屏按钮比工具条按钮大：${JSON.stringify(geo)}`);
 assert.equal(await page.locator('.ed-screens [aria-pressed="true"]').textContent(),'第 1 屏');
 assert.equal(await page.locator('[data-screens-note]').isHidden(),true,'写了步数的页不需要说明');
 assert.equal(await page.locator('.page-list .ed-page[data-page-id="page_p01"] [data-chip="screens"]').textContent(),'3 屏');
 assert.equal(await page.locator('.page-list .ed-page[data-page-id="page_p04"] [data-chip="screens"]').count(),0);
 await page.locator('[data-action="screen"][data-screen="2"]').click();
 for(let i=0;i<50&&JSON.stringify(await visibleItems(page))!=='[true,false]';i++)await page.waitForTimeout(100);
 assert.deepEqual(await visibleItems(page),[true,false]);

 // 静态页：什么都不显示
 await open(page,'page_p04');
 assert.equal(await page.locator('.ed-screens:not([hidden])').count(),0);
 assert.equal(await page.locator('[data-screens-note]').isHidden(),true);

 if(!canCount){console.log('# 运行时还没有 countSteps / ready.motion（A 组），跳过数屏和说明文字的检查');assert.deepEqual(errors,[]);return;}
 // 没写 steps 但登记了 step：工作台数出 2 步 → 3 屏 + 说明；页面栏「3 屏」
 await open(page,'page_p02');
 await page.waitForFunction(()=>document.querySelectorAll('.ed-screens:not([hidden]) [data-action="screen"]').length===3,null,{timeout:20000});
 assert.equal(await page.locator('[data-screens-note]').textContent(),'屏数由工作台数出，请 agent 在 project.json 写上 motion.steps');
 await page.waitForSelector('.page-list .ed-page[data-page-id="page_p02"] [data-chip="screens"]');
 assert.equal(await page.locator('.page-list .ed-page[data-page-id="page_p02"] [data-chip="screens"]').textContent(),'3 屏');
 assert.equal(await page.locator('#vw-probe-host iframe').count(),0,'探测 iframe 用完就销毁');
 // 数出来以后画布停在第 1 屏（跑过初始化），可以切到第 3 屏
 for(let i=0;i<50&&JSON.stringify(await visibleItems(page))!=='[false,false]';i++)await page.waitForTimeout(100);
 assert.deepEqual(await visibleItems(page),[false,false]);
 await page.locator('[data-action="screen"][data-screen="3"]').click();
 for(let i=0;i<50&&JSON.stringify(await visibleItems(page))!=='[true,true]';i++)await page.waitForTimeout(100);
 assert.deepEqual(await visibleItems(page),[true,true]);
 // 页面自己的动画、脚本，没有 vw.motion：只写一句说明，不显示屏按钮
 await open(page,'page_p03');
 await page.waitForFunction(()=>!document.querySelector('[data-screens-note]')?.hidden,null,{timeout:10000});
 assert.equal(await page.locator('[data-screens-note]').textContent(),'这页有自己的动画，但没有分屏；要分屏请让 agent 用 vw.motion 写并填上 motion.steps');
 assert.equal(await page.locator('.ed-screens:not([hidden])').count(),0);
 assert.equal(await page.locator('.page-list .ed-page[data-page-id="page_p03"] [data-chip="screens"]').count(),0);
 // 回到数过的页：用缓存，不再探测
 await open(page,'page_p02');
 assert.equal(await page.locator('.ed-screens:not([hidden]) [data-action="screen"]').count(),3);
 assert.deepEqual(errors,[]);
});
