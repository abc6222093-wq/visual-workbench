// 第 12 轮：缩略图 = 叠好修改单、去掉脚本的静态页面，放进 sandbox="" 的 iframe，按宿主大小完整显示（contain、居中）。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject,v3Project,pageHTML} from './round12-editor-fixture.js';
async function measure(page,sel){
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 return page.evaluate(sel=>[...document.querySelectorAll(`${sel} .ed-page[data-page-id]`)].map(card=>{
  const host=card.querySelector('.ed-page__thumb'),f=host.querySelector('iframe'),h=host.getBoundingClientRect(),b=f?.getBoundingClientRect();
  return {id:card.dataset.pageId,sandbox:f?.getAttribute('sandbox'),host:{l:h.left,t:h.top,r:h.right,b:h.bottom,w:h.width,h:h.height},frame:b&&{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}};
 }),sel);
}
function assertFits(cards,ratioOf,why){
 assert.ok(cards.length);
 for(const c of cards){const m=`${why} ${JSON.stringify(c)}`;
  assert.ok(c.frame,`${m} 没有 iframe`);assert.equal(c.sandbox,'',`${m} 缩略图不能跑脚本`);
  assert.ok(c.frame.l>=c.host.l-1&&c.frame.t>=c.host.t-1&&c.frame.r<=c.host.r+1&&c.frame.b<=c.host.b+1,`${m} 超出宿主`);
  assert.ok(Math.abs(c.frame.w-c.host.w)<=1.5||Math.abs(c.frame.h-c.host.h)<=1.5,`${m} 没贴合宿主`);
  const want=ratioOf(c.id);assert.ok(Math.abs(c.frame.w/c.frame.h-want)/want<0.03,`${m} 比例不对`);}
}
const waitThumbs=(page,sel,n)=>page.waitForFunction(([sel,n])=>document.querySelectorAll(`${sel} .ed-page__thumb iframe`).length>=n,[sel,n]);

test('round12 缩略图：课件页完整显示；不跑页面脚本；修改单叠在缩略图上；折叠展开、时间轴、网格都完整',async t=>{
 const project=v3Project();project.pages[0].edits=[{id:'ed_thumb001',target:'title',kind:'text',at:'2026-10-05T12:00:00.000Z',before:{html:'第1页',text:'第1页'},after:{html:'改过的标题',text:'改过的标题'}}];
 const {page,errors}=await startWorkbench(t,{projects:[project],html:p=>pageHTML(p.name,{body:'<script>document.body.dataset.ran="yes"</script>'})});
 await openProject(page);await waitThumbs(page,'.page-list',3);
 assertFits(await measure(page,'.page-list'),()=>1920/1080,'列表');
 const doc=await page.locator('.page-list .ed-page').first().locator('iframe').evaluate(f=>f.srcdoc);
 assert.ok(doc.includes('改过的标题'),'缩略图叠了修改单');assert.ok(!/<script/i.test(doc),'缩略图去掉了脚本');
 await page.locator('.ed-pages > [data-action="toggle-pages"]').click();await page.locator('.ed-pages > [data-action="toggle-pages"]').click();
 await waitThumbs(page,'.page-list',3);assertFits(await measure(page,'.page-list'),()=>1920/1080,'收起再展开');
 await page.locator('.ed-tools [data-action="page-timeline"]').click();await waitThumbs(page,'.ed-page-timeline',3);
 assertFits(await measure(page,'.ed-page-timeline'),()=>1920/1080,'时间轴');
 await page.locator('.ed-tools [data-action="page-timeline"]').click();
 await page.locator('.ed-tools [data-action="page-grid"]').click();await waitThumbs(page,'.ed-page-grid',3);
 assertFits(await measure(page,'.ed-page-grid'),()=>1920/1080,'网格');
 assert.deepEqual(errors,[]);
});

test('round12 缩略图：网页项目按设备窗口比例显示（电脑 1440×900、手机 390×844）',async t=>{
 const project=v3Project({id:'site',web:true,pages:['首页','手机页']});
 const {page,errors}=await startWorkbench(t,{projects:[project]});await openProject(page,'site');await waitThumbs(page,'.page-list',2);
 assertFits(await measure(page,'.page-list'),id=>id==='page_p01'?1440/900:390/844,'网页');
 assert.deepEqual(errors,[]);
});

test('round12 总览卡片缩略图也是无脚本 iframe',async t=>{
 const {page,errors}=await startWorkbench(t);
 await page.waitForFunction(()=>document.querySelector('.hm-card__art iframe'));
 assert.equal(await page.locator('.hm-card__art iframe').first().getAttribute('sandbox'),'');
 assert.deepEqual(errors,[]);
});
