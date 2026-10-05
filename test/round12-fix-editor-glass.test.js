// 第 12 轮修正（任务 4）：点一下画布，画布四周的磨砂玻璃不能闪一下。
// 原因：选中 / 取消选中时快捷工具条显示 / 隐藏，玻璃层把整个玻璃效果销毁重建（重新截取整层，很慢），重建完之前所有玻璃都消失。
// 要求：玻璃片的增减（隐藏的工具条、专注模式的退出按钮）不重建玻璃效果；只有换画面（总览 ↔ 编辑器）才重建。
import test from 'node:test';import assert from 'node:assert/strict';
import {startWorkbench,openProject,clickInFrame,painted} from './round12-editor-fixture.js';

const stats=page=>page.evaluate(()=>({...(window.__vwGlassStats||{})}));
const plate=(page,key)=>page.evaluate(k=>{const p=document.querySelector(`.gl-layer > .gl-plate[data-key="${k}"]`);if(!p)return null;const r=p.getBoundingClientRect(),cs=getComputedStyle(p);
 return {w:r.width,h:r.height,left:r.left,top:r.top,visible:cs.visibility!=='hidden'&&cs.display!=='none'&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight};},key);
// 玻璃层、玻璃片、WebGL 画出来的玻璃画布：节点身份全部不变
const probe=page=>page.evaluate(()=>{const layer=document.querySelector('.gl-layer');layer.dataset.probe='layer';
 const canvases=[...layer.querySelectorAll('.gl-plate > canvas')];canvases.forEach((c,i)=>c.dataset.probe=`c${i}`);return canvases.length;});
const probesAlive=page=>page.evaluate(()=>{const layer=document.querySelector('.gl-layer');
 return {layer:layer?.dataset.probe==='layer'&&layer.isConnected,canvases:[...document.querySelectorAll('.gl-plate > canvas[data-probe]')].length};});

test('round12 修正 玻璃：选中 / 取消选中 / 进出改字都不重建玻璃效果，工具条的玻璃片显示时有尺寸、隐藏时不画',async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'我的云端硬盘 玻璃-'});
 await openProject(page);await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});
 // 等玻璃效果第一次启动完成（headless 下 WebGL 可能失败，只看启动次数）
 await page.waitForFunction(()=>window.__vwGlassStats&&window.__vwGlassStats.inits>=1&&!window.__vwGlassStats.busy,null,{timeout:20000});
 await page.waitForTimeout(500);
 const before=await stats(page);
 const canvases=await probe(page);
 console.log(`# 玻璃画布 ${canvases} 块（0 表示这台机器没有 WebGL，玻璃效果没启动）`);
 const hidden=await plate(page,'quickbar');
 assert.ok(!hidden||!hidden.visible,'工具条隐藏时它的玻璃片不画');

 // 1. 点卡片：选中，工具条出现
 await clickInFrame(page,'[data-vw-id="card"]');
 await page.waitForSelector('.ed-quickbar:not([hidden])');await page.waitForTimeout(600);await painted(page);
 const bar=await page.locator('.ed-quickbar').evaluate(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,left:r.left,top:r.top};});
 const mid=await stats(page);
 assert.equal(mid.inits,before.inits,`选中后玻璃效果被重新启动（inits ${before.inits} → ${mid.inits}）`);
 const shown=await plate(page,'quickbar');
 assert.ok(shown&&shown.visible&&shown.w>0&&shown.h>0,`工具条显示时它的玻璃片有尺寸：${JSON.stringify(shown)}`);
 assert.ok(Math.abs(shown.left-bar.left)<1.5&&Math.abs(shown.top-bar.top)<1.5&&Math.abs(shown.w-bar.w)<1.5,'玻璃片和工具条对齐');

 // 2. 点空白：取消选中，工具条隐藏
 await page.locator('#canvas-well').click({position:{x:5,y:5}});
 await page.waitForSelector('.ed-quickbar[hidden]',{state:'attached'});await page.waitForTimeout(600);
 const after=await plate(page,'quickbar');
 assert.ok(after&&!after.visible,'工具条隐藏后玻璃片不画（但节点保留）');

 // 3. 进出改字：单击标题进入改字，Esc 退出
 await clickInFrame(page,'[data-vw-id="title"]');await page.waitForTimeout(400);
 await page.keyboard.press('Escape');await page.waitForTimeout(200);await page.keyboard.press('Escape');
 await page.waitForTimeout(600);

 // 4. 专注模式：多一块「退出专注模式」玻璃片，也不重建
 await page.locator('.ed-tools [data-action="focus"]').click();await page.waitForSelector('.ed-focus-exit');await page.waitForTimeout(600);
 const exitPlate=await page.evaluate(()=>{const p=document.querySelector('.gl-layer > .gl-plate[data-key="focus-exit"]');return p?{canvas:!!p.querySelector(':scope > canvas'),w:p.getBoundingClientRect().width}:null;});
 assert.ok(exitPlate&&exitPlate.w>0,'专注模式的退出按钮有玻璃片');
 if(canvases>0)assert.ok(exitPlate.canvas,'新玻璃片加进了正在运行的玻璃效果（有自己的玻璃画布）');
 await page.locator('.ed-focus-exit [data-action="focus"]').click();await page.waitForTimeout(600);

 const end=await stats(page);
 assert.equal(end.inits,before.inits,`玻璃效果被重新启动了 ${end.inits-before.inits} 次（应为 0）`);
 assert.equal(end.destroys,before.destroys,'玻璃效果不应被销毁');
 const alive=await probesAlive(page);
 assert.ok(alive.layer,'玻璃层节点不变');
 assert.equal(alive.canvases,canvases,'WebGL 玻璃画布节点不变');
 assert.deepEqual(errors,[]);
});

test('round12 修正 玻璃：总览 ↔ 编辑器换画面时照常重建一次',async t=>{
 const {page}=await startWorkbench(t,{prefix:'我的云端硬盘 玻璃-'});
 await page.waitForFunction(()=>window.__vwGlassStats?.inits>=1&&!window.__vwGlassStats.busy,null,{timeout:20000});
 const home=await stats(page);
 await openProject(page);
 await page.waitForFunction(n=>window.__vwGlassStats.inits>n&&!window.__vwGlassStats.busy,home.inits,{timeout:20000});
 const keys=await page.evaluate(()=>[...document.querySelectorAll('.gl-layer > .gl-plate')].map(p=>p.dataset.key).sort());
 assert.ok(!keys.includes('home'),`换到编辑器后总览的玻璃片应清掉：${keys}`);
 assert.ok(keys.includes('work')&&keys.includes('quickbar'),`编辑器的玻璃片（含隐藏的工具条）都在：${keys}`);
});
