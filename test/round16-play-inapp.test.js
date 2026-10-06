// 第 16 轮：桌面应用（User-Agent 带 VisualWorkbenchDesktop/版本）里点「放映」在应用窗口里放映（#vw-show），不开新窗口、不跳转；
// Esc 收起，回到编辑器原来那一页。浏览器版仍然 window.open 新标签。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject} from './round12-editor-fixture.js';

async function toPage2(page){
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__open').click();
 await page.waitForSelector('#artboard[data-page-id="page_p02"]');
}

test('round16 应用内放映：桌面应用不开新页面，#vw-show 放映当前页，Esc 回到原来那一页',async t=>{
 const {browser,url,page:first}=await startWorkbench(t,{prefix:'vw-round16-play-'});
 const ua=(await first.evaluate(()=>navigator.userAgent))+' VisualWorkbenchDesktop/0.2.0';
 const context=await browser.newContext({userAgent:ua,viewport:{width:1400,height:900}});t.after(()=>context.close().catch(()=>{}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await openProject(page);await toPage2(page);
 const before=context.pages().length,href=page.url();
 await page.locator('[data-action="play"]').click();
 await page.waitForSelector('#vw-show .vw-show__stage iframe',{timeout:15000});
 await page.waitForFunction(()=>/^2 \/ 3/.test(document.querySelector('#vw-show .vw-show__hint')?.textContent||''),null,{timeout:15000});
 await page.waitForTimeout(300);
 assert.equal(context.pages().length,before,'没有打开新页面');
 assert.equal(page.url(),href,'没有跳转');
 await page.keyboard.press('Escape');
 await page.waitForSelector('#vw-show',{state:'detached'});
 assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_p02','回到原来那一页');
 assert.equal(page.url(),href);
 assert.deepEqual(errors,[]);
});

test('round16 浏览器版放映：仍然 window.open 新标签',async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'vw-round16-play-web-'});
 await openProject(page);await toPage2(page);
 const [popup]=await Promise.all([page.context().waitForEvent('page'),page.locator('[data-action="play"]').click()]);
 await popup.waitForLoadState('domcontentloaded');
 const u=new URL(popup.url());
 assert.equal(u.pathname,'/player.html');assert.equal(u.searchParams.get('project'),'demo');assert.equal(u.searchParams.get('page'),'page_p02');
 assert.equal(await page.locator('#vw-show').count(),0);
 assert.deepEqual(errors,[]);
});
