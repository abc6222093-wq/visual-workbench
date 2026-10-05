// 第 12 轮：窄窗口（内容区约 1440×900、左右栏都展开）顶部工具条不换行、页面名完整可读；专注模式、折叠栏照旧。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject,v3Project} from './round12-editor-fixture.js';
const NAME='第 3 页 · 课程介绍与学习目标';

async function rowsOf(page,sel){
 return page.locator(sel).evaluate(bar=>{const kids=[...bar.children].filter(n=>getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0);
  const tops=kids.map(n=>Math.round(n.getBoundingClientRect().top+n.getBoundingClientRect().height/2));
  return {spread:Math.max(...tops)-Math.min(...tops),height:bar.getBoundingClientRect().height,overflow:bar.scrollWidth-bar.clientWidth};});
}
for(const viewport of [{width:1440,height:900},{width:1280,height:800}]){
 test(`round12 窄窗口 ${viewport.width}×${viewport.height}：顶栏和画布工具条一行，页面名完整可读`,async t=>{
  const project=v3Project({pages:['第1页','第2页',NAME]});
  const {page,errors}=await startWorkbench(t,{projects:[project],viewport});await openProject(page);
  await page.locator(`.page-list .ed-page[data-page-id="page_p03"] .ed-page__open`).click();
  await page.waitForFunction(n=>document.querySelector('.ed-crumb')?.textContent===n,NAME);
  const grid=await page.locator('.ed-grid').evaluate(n=>({pages:!n.classList.contains('is-pages-collapsed'),inspector:!n.classList.contains('is-inspector-collapsed')}));
  assert.deepEqual(grid,{pages:true,inspector:true},'左右栏都展开');
  const top=await rowsOf(page,'.ed-top > .ed-bar');assert.ok(top.spread<=2,`顶栏按钮不在一行：${JSON.stringify(top)}`);assert.ok(top.height<=50);
  const tools=await rowsOf(page,'.ed-toolbar');assert.ok(tools.spread<=2,`画布工具条换行了：${JSON.stringify(tools)}`);assert.ok(tools.height<=44);
  const crumb=await page.locator('.ed-crumb').evaluate(n=>({sw:n.scrollWidth,cw:n.clientWidth}));
  assert.ok(crumb.sw<=crumb.cw+1,`页面名被截断：${JSON.stringify(crumb)}`);
  const title=await page.locator('.ed-top').evaluate(n=>n.scrollWidth<=n.clientWidth+1);assert.ok(title,'顶栏没有横向溢出');
  assert.deepEqual(errors,[]);
 });
}

test('round12 专注模式与折叠栏：藏起面板、画布变大，Esc 退出；折叠状态记住',async t=>{
 const {page,errors,url}=await startWorkbench(t);await openProject(page);
 const width=()=>page.locator('#artboard').evaluate(n=>n.getBoundingClientRect().width);
 await page.waitForSelector('#artboard[data-ready="1"]');const before=await width();
 await page.locator('.ed-tools [data-action="focus"]').click();await page.waitForTimeout(150);
 assert.ok(await page.locator('.ed-shell.is-focus').count()===1);assert.ok(await width()>before,'专注模式画布变大');
 await page.keyboard.press('Escape');await page.waitForSelector('.ed-shell.is-focus',{state:'detached'});
 await page.locator('[data-action="toggle-pages"]').click();await page.locator('[data-action="toggle-inspector"]').click();
 assert.equal(await page.locator('.ed-grid.is-pages-collapsed.is-inspector-collapsed').count(),1);
 await page.goto(url);await openProject(page);
 assert.equal(await page.locator('.ed-grid.is-pages-collapsed.is-inspector-collapsed').count(),1,'刷新后记得折叠');
 assert.deepEqual(errors,[]);
});
