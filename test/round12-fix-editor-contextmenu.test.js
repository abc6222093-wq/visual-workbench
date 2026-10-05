// 第 12 轮修正（任务 5）：右键菜单。工作台不能拦住输入框和改字中的元素的右键（桌面应用靠浏览器的 context-menu 事件弹「剪切 / 复制 / 粘贴」，
// 被 preventDefault 就不弹）；改字中的元素必须 isContentEditable（桌面应用据此判断能不能粘贴）。另外旧版桌面应用顶部有可关闭的提示。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject,clickInFrame,painted} from './round12-editor-fixture.js';
const fire=`n=>n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))`;

test('round12 修正 右键：页面名输入框和改字中的元素的 contextmenu 没被 preventDefault，改字中的元素 isContentEditable',async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'我的云端硬盘 右键-'});
 await openProject(page);await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});await painted(page);
 const input=page.locator('[data-page-name]');
 assert.equal(await input.evaluate(new Function('return '+fire)()),true,'页面名输入框的右键没被拦');
 await clickInFrame(page,'[data-vw-id="title"]');
 const frame=await (await page.$('#artboard > iframe')).contentFrame();
 await frame.waitForFunction(()=>document.querySelector('[data-vw-id="title"]')?.isContentEditable===true,null,{timeout:5000});
 const title=frame.locator('[data-vw-id="title"]');
 assert.equal(await title.evaluate(n=>n.isContentEditable),true,'改字中的元素 isContentEditable');
 assert.equal(await title.evaluate(new Function('return '+fire)()),true,'改字中的元素的右键没被拦');
 // 父页面在捕获阶段也不拦
 assert.equal(await page.evaluate(()=>document.querySelector('#artboard > iframe').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))),true,'画布 iframe 节点的右键没被拦');
 assert.equal(await page.locator('#desktop-notice').count(),0,'普通浏览器不显示桌面应用提示');
 assert.deepEqual(errors,[]);
});

test('round12 修正 旧版桌面应用：顶部显示可关闭的提示；新版不显示',async t=>{
 const {browser,url}=await startWorkbench(t,{prefix:'我的云端硬盘 桌面-'});
 const old=await browser.newPage({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Electron/44.0.0 Safari/537.36'});
 await old.goto(url);
 await old.waitForSelector('#desktop-notice');
 assert.match(await old.locator('#desktop-notice').textContent(),/桌面应用是旧版本，右键菜单等功能要重新制作应用才有，见 docs\/desktop\.md/);
 await openProject(old);
 assert.equal(await old.locator('#desktop-notice').count(),1,'进编辑器后提示还在');
 await old.locator('[data-close-desktop-notice]').click();
 assert.equal(await old.locator('#desktop-notice').count(),0);
 await old.locator('[data-action="home"]').click();await old.waitForSelector('[data-action="open"]');
 assert.equal(await old.locator('#desktop-notice').count(),0,'关掉后这次不再出现');
 const fresh=await browser.newPage({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Electron/44.0.0 Safari/537.36 VisualWorkbenchDesktop/0.2.0'});
 await fresh.goto(url);await fresh.waitForSelector('[data-action="open"]');await painted(fresh);
 assert.equal(await fresh.locator('#desktop-notice').count(),0,'新版桌面应用不提示');
});
