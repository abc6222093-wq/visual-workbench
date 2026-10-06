// 第 13 轮：批注（docs/round13-contract.md §6）。工具条「批注」按下后在画布上拖框、写一句话（回车保存、Esc 取消）；
// 批注框可点选、拖动、拖右下角改大小、双击改字、Delete / 右键删除、Esc 取消选中；数据在 pages[].annotations，走撤销和自动保存；
// 不在批注模式时这一层不挡画布（点画布照常选中页面里的元素）。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startWorkbench,openProject,clickInFrame,painted} from './round12-editor-fixture.js';

const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const saved=page=>page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');
const notes=files=>disk(files.demo).pages[0].annotations||[];
async function until(fn,ms=8000){const t0=Date.now();let v;while(Date.now()-t0<ms){v=fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw new Error('等不到 '+JSON.stringify(v));}
// 页面坐标 → 屏幕坐标
const screen=(page,x,y)=>page.evaluate(([x,y])=>{const r=document.querySelector('#artboard').getBoundingClientRect(),s=r.width/1920;return {x:r.left+x*s,y:r.top+y*s,s};},[x,y]);

test('round13 批注：拖框写字、移动、改大小、改字、删除、撤销；不在批注模式时不挡画布',async t=>{
 const {page,errors,files}=await startWorkbench(t,{prefix:'vw-round13-annot-'});
 await openProject(page);await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});
 const button=page.locator('.ed-tools [data-action="annotate"]');
 assert.equal(await button.getAttribute('aria-pressed'),'false');
 await button.click();
 assert.equal(await button.getAttribute('aria-pressed'),'true');
 // 等批注层画出来（Chromium 画出新的一帧后才按新层次把鼠标送给批注层，而不是下面的隔离 iframe）
 await painted(page);await page.waitForTimeout(100);
 // 拖出一个框（页面坐标 300,200 → 900,500）
 const a=await screen(page,300,200),b=await screen(page,900,500);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
 const input=page.locator('.vw-annot-input input');await input.waitFor();
 // Esc 取消：不留批注
 await input.fill('不要这条');await input.press('Escape');
 await page.waitForSelector('.vw-annot-input',{state:'detached'});
 assert.equal(await page.locator('.vw-annot:not(.vw-annot--draft)').count(),0);
 // 再拖一次，回车保存
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
 await input.waitFor();await input.fill('这里加一个字');await input.press('Enter');
 await saved(page);
 let list=await until(()=>notes(files).length===1&&notes(files));
 const first=list[0];
 assert.match(first.id,/^an_[a-z0-9]{8}$/);assert.equal(first.text,'这里加一个字');
 assert.ok(Math.abs(first.x-300)<3&&Math.abs(first.y-200)<3&&Math.abs(first.width-600)<3&&Math.abs(first.height-300)<3,JSON.stringify(first));
 assert.ok(first.at,'记了时间');
 // 批注层和 #artboard 同一个缩放；框是半透明黄底，带文字标签
 const look=await page.evaluate(()=>{const l=document.querySelector('.vw-annot-layer'),box=l.querySelector('.vw-annot');return {same:l.style.transform===document.querySelector('#artboard').style.transform,bg:getComputedStyle(box).backgroundColor,label:box.querySelector('.vw-annot__text').textContent};});
 assert.ok(look.same,'批注层跟着画布缩放');assert.match(look.bg,/rgba\(255, 214, 10, 0\.28\)/);assert.equal(look.label,'这里加一个字');
 // 退出批注模式（Esc 先取消选中，再退出模式）
 await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 assert.equal(await button.getAttribute('aria-pressed'),'false');
 // 不在批注模式：点卡片照常选中页面里的元素（批注层不挡）
 await painted(page);await page.waitForTimeout(100);
 await clickInFrame(page,'[data-vw-id="card"]',{at:{x:30,y:170}}); // 卡片上批注框外面的地方
 await page.waitForSelector('.ed-quickbar:not([hidden]) [data-q="background"]');
 // 拖动批注框（非模式下也能点批注框）
 const c=await screen(page,600,350);
 await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(c.x+100*c.s,c.y+50*c.s,{steps:6});await page.mouse.up();
 list=await until(()=>notes(files)[0]?.x>350&&notes(files));
 assert.ok(Math.abs(list[0].x-400)<4&&Math.abs(list[0].y-250)<4,`移动后：${JSON.stringify(list[0])}`);
 assert.equal(await page.locator('.vw-annot.is-selected').count(),1,'拖动后选中');
 // 拖右下角改大小
 await painted(page);await page.waitForTimeout(100);
 const g=await page.locator('.vw-annot.is-selected [data-annot-grip]').boundingBox();
 await page.mouse.move(g.x+g.width/2,g.y+g.height/2);await page.mouse.down();await page.mouse.move(g.x+g.width/2+100*c.s,g.y+g.height/2+100*c.s,{steps:6});await page.mouse.up();
 list=await until(()=>notes(files)[0]?.width>650&&notes(files));
 assert.ok(Math.abs(list[0].width-700)<5&&Math.abs(list[0].height-400)<5,`改大小后：${JSON.stringify(list[0])}`);
 // 双击改字
 const mid=await page.locator('.vw-annot.is-selected').boundingBox();
 await page.mouse.dblclick(mid.x+mid.width/2,mid.y+mid.height/2);
 await input.waitFor();assert.equal(await input.inputValue(),'这里加一个字');
 await input.fill('这段太挤');await input.press('Enter');
 list=await until(()=>notes(files)[0]?.text==='这段太挤'&&notes(files));
 // Delete 删掉，撤销回来
 await page.mouse.click(mid.x+mid.width/2,mid.y+mid.height/2);
 await page.keyboard.press('Delete');
 await until(()=>notes(files).length===0);
 assert.equal(await page.locator('.vw-annot').count(),0);
 await page.locator('[data-action="undo"]').click();
 await page.waitForSelector('.vw-annot');
 await until(()=>notes(files).length===1);
 // 右键「删除」
 await page.mouse.click(mid.x+mid.width/2,mid.y+mid.height/2,{button:'right'});
 await page.locator('.g-context-menu button',{hasText:'删除'}).click();
 await until(()=>notes(files).length===0);
 // 缩略图里没有批注（缩略图是页面文件本身）
 assert.equal(await page.locator('.ed-page__thumb .vw-annot').count(),0);
 await painted(page);
 assert.deepEqual(errors,[]);
});
