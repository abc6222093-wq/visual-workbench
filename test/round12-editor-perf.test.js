// 第 12 轮：40 页项目流畅——缩略图懒加载（只给看得见的建 iframe，远离视口的卸掉），打开、滚动页面栏、切页都在合理时间内。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject,v3Project} from './round12-editor-fixture.js';
const N=40,LIMIT=24;
const thumbFrames=(page,sel='.page-list')=>page.evaluate(sel=>document.querySelectorAll(`${sel} .ed-page__thumb iframe`).length,sel);
const allFrames=page=>page.evaluate(()=>document.querySelectorAll('iframe').length);

test('round12 性能：40 页项目打开、页面栏滚到底、连续切页都快，iframe 数有上限',async t=>{
 const project=v3Project({id:'big',pages:Array.from({length:N},(_,i)=>`第${i+1}页`)});
 const {page,errors}=await startWorkbench(t,{projects:[project],viewport:{width:1440,height:900}});
 let t0=Date.now();await openProject(page,'big');await page.waitForSelector('#artboard[data-ready="1"]');const openMs=Date.now()-t0;
 assert.ok(openMs<6000,`打开用了 ${openMs}ms`);
 await page.waitForFunction(()=>document.querySelector('.page-list .ed-page__thumb iframe'));
 let max=await thumbFrames(page);
 const list=page.locator('.page-list');
 t0=Date.now();
 for(let i=0;i<20;i++){await list.evaluate(n=>{n.scrollTop+=n.clientHeight*0.8;});await page.waitForTimeout(60);max=Math.max(max,await thumbFrames(page));}
 const scrollMs=Date.now()-t0;assert.ok(scrollMs<8000,`滚动用了 ${scrollMs}ms`);
 assert.ok(max<=LIMIT,`页面栏同时最多 ${max} 个 iframe`);
 await page.waitForFunction(()=>{const items=[...document.querySelectorAll('.page-list .ed-page')];return items.at(-1).querySelector('.ed-page__thumb iframe');},null,{timeout:8000});
 const first=await page.locator('.page-list .ed-page').first().evaluate(n=>n.querySelector('.ed-page__thumb iframe')?1:0);
 assert.equal(first,0,'远离视口的缩略图已卸掉');
 await list.evaluate(n=>{n.scrollTop=0;});
 t0=Date.now();
 for(let i=0;i<10;i++){await page.keyboard.press('ArrowDown');await page.waitForFunction(i=>document.querySelector('#artboard')?.dataset.pageId===`page_p${String(i+2).padStart(2,'0')}`,i);}
 await page.waitForSelector('#artboard[data-ready="1"]');
 const switchMs=Date.now()-t0;assert.ok(switchMs<8000,`切 10 页用了 ${switchMs}ms`);
 assert.ok(await allFrames(page)<=LIMIT+4,'整个界面的 iframe 数有上限');
 await page.locator('.ed-tools [data-action="page-grid"]').click();await page.waitForSelector('.ed-page-grid [data-page-view]');await page.waitForTimeout(400);
 assert.ok(await thumbFrames(page,'.ed-page-grid')<=LIMIT,'网格里也只建看得见的');
 assert.deepEqual(errors,[]);
});
