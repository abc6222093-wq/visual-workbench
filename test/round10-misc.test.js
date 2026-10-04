// 第 10 轮遗留待办：总览 Shift 范围选择与拖框自动滚动；往回翻页时 anime.js 动效瞬间停在最后一步
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';

async function openPage(t,viewport={width:1100,height:900}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round10-misc-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{browser=await launchBrowser();}catch(error){if(error.code==='NO_BROWSER'){t.skip('本机没有可用浏览器');return null;}throw error;}
 const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 return {page,errors};
}

// 与 round9-home 相同结构的总览 DOM；count 张卡片，panelHeight 控制滚动区高度
async function overview(t,{count=6,panelHeight=860}={}){
 const opened=await openPage(t);if(!opened)return null;const {page}=opened;
 await page.evaluate(async([count,panelHeight])=>{
  document.body.replaceChildren();document.body.style.margin='0';
  for(const href of ['/glass.css','/style.css','/home-selection.css']){const l=document.createElement('link');l.rel='stylesheet';l.href=href;document.head.append(l);await new Promise(r=>{l.onload=r;l.onerror=r;});}
  const app=document.createElement('div');
  const card=i=>`<div class="hm-cell" data-project-id="p${i}"><button class="hm-card" data-action="open" data-id="p${i}"><div class="hm-card__thumb"><div class="hm-card__art" style="width:100%;height:100%"></div></div><div class="hm-card__info"><strong>项目 ${i}</strong><small>1 页</small></div></button></div>`;
  app.innerHTML=`<section class="hm-panel" style="height:${panelHeight}px"><div class="hm-scroll ed-scroll"><div class="hm-grid">${Array.from({length:count},(_,i)=>card(i+1)).join('')}</div></div></section>`;
  document.body.append(app);
  window.log={open:[]};
  app.addEventListener('click',e=>{const b=e.target.closest('[data-action="open"]');if(b)log.open.push(b.dataset.id);});
  const {mountHomeSelection}=await import('/home-selection.js');
  window.sel=mountHomeSelection(app.querySelector('.hm-scroll'),{});
 },[count,panelHeight]);
 return opened;
}
const selected=page=>page.evaluate(()=>window.sel.selected);
const card=(page,i)=>page.locator(`.hm-cell[data-project-id="p${i}"] > .hm-card`);

test('round10 home: Shift click selects the range from the anchor; Cmd/Ctrl and the checkbox move the anchor',async t=>{
 const o=await overview(t);if(!o)return;const {page,errors}=o;
 await card(page,2).click({modifiers:['ControlOrMeta']});
 await card(page,5).click({modifiers:['Shift']});assert.deepEqual(await selected(page),['p2','p3','p4','p5']);
 // Cmd/Ctrl 单击切换单张并把锚点挪到这里；Shift 再从新锚点选到 p1（并入已有选中）
 await card(page,4).click({modifiers:['ControlOrMeta']});assert.deepEqual(await selected(page),['p2','p3','p5']);
 await card(page,1).click({modifiers:['Shift']});assert.deepEqual(await selected(page),['p1','p2','p3','p4','p5']);
 // 勾选框也更新锚点
 await page.keyboard.press('Escape');assert.deepEqual(await selected(page),[]);
 await card(page,6).hover();await page.locator('.hm-cell[data-project-id="p6"] > .hm-check').click();
 await card(page,4).click({modifiers:['Shift']});assert.deepEqual(await selected(page),['p4','p5','p6']);
 // 清空后没有锚点：Shift 单击只切换单张
 await page.keyboard.press('Escape');
 await card(page,3).click({modifiers:['Shift']});await card(page,6).click({modifiers:['Shift']});
 assert.deepEqual(await selected(page),['p3','p6']);
 assert.deepEqual(await page.evaluate(()=>log.open),[]);assert.deepEqual(errors,[]);
});

test('round10 home: dragging a marquee to the bottom/top edge auto-scrolls and keeps updating the selection',async t=>{
 const o=await overview(t,{count:24,panelHeight:320});if(!o)return;const {page,errors}=o;
 const scroll=page.locator('.hm-scroll');const box=await scroll.boundingBox();
 const info=()=>page.evaluate(()=>{const r=document.querySelector('.hm-scroll');return {top:r.scrollTop,max:r.scrollHeight-r.clientHeight};});
 assert.ok((await info()).max>300,'测试需要足够长的滚动内容');
 const x=box.x+box.width-30;
 await page.mouse.move(box.x+4,box.y+4);await page.mouse.down();
 await page.mouse.move(x,box.y+box.height/2,{steps:4});
 const visible=(await selected(page)).length;assert.ok(visible>0&&visible<24);
 // 停在离下边缘 10px 处不动：逐帧滚动直到底
 await page.mouse.move(x,box.y+box.height-10,{steps:2});
 await page.waitForFunction(()=>{const r=document.querySelector('.hm-scroll');return r.scrollTop>=r.scrollHeight-r.clientHeight-1;},null,{timeout:8000});
 assert.equal((await selected(page)).length,24,'滚到底后框选覆盖全部卡片');
 assert.ok((await selected(page)).includes('p1'),'起点跟着内容走，最上面的卡片仍在框内');
 // 框不会撑大滚动内容
 const atBottom=await info();assert.ok(atBottom.top<=atBottom.max+1);
 // 拖到上边缘：往回滚，框选随之收缩
 await page.mouse.move(x,box.y+12,{steps:4});
 await page.waitForFunction(top=>document.querySelector('.hm-scroll').scrollTop<top-100,atBottom.top,{timeout:8000});
 await page.mouse.up();
 assert.ok((await selected(page)).length<24);
 assert.equal(await page.locator('.hm-marquee').count(),0);
 // 松开后不再滚动
 const after=(await info()).top;await page.waitForTimeout(150);assert.equal((await info()).top,after);
 assert.deepEqual(errors,[]);
});

// 用 anime.js 写的单步动效：3 秒（或给定时长）右移 200px，await then 后记下完成
const animeSource=duration=>`export default async function (ctx) {
  const anime = await ctx.importModule('/vendor/anime.esm.min.js');
  const { node } = ctx.element('el_box');
  return {
    async step(index) {
      const loop = anime.animate(node.querySelector('i'), { rotate: 360, duration: 500, loop: true });
      const tl = anime.createTimeline().add(node, { opacity: 0.5, duration: ${duration} }).add(node, { scale: 1.5, duration: ${duration} });
      await anime.animate(node, { translateX: 200, duration: ${duration}, delay: 50 }).then(() => { node.dataset.moved = '1'; });
      await tl;
      await new Promise(resolve => anime.createTimer({ duration: ${duration}, onComplete: resolve }));
      node.dataset.done = String(index);
      ctx.signal.addEventListener('abort', () => loop.cancel(), { once: true });
    }
  };
}`;

async function runAnime(page,{duration,startAtEnd,thenReset=false}){
 return page.evaluate(async({source,startAtEnd,thenReset})=>{
  document.body.replaceChildren();
  const root=document.createElement('div');root.style.cssText='position:relative;width:400px;height:200px';
  root.innerHTML='<div data-element-id="el_box" style="position:absolute;width:40px;height:40px;background:#38bdf8"><i style="display:block;width:10px;height:10px"></i></div>';
  document.body.append(root);
  const node=root.firstElementChild;
  const project={id:'anime-test',formatVersion:2,artboard:{width:400,height:200},pages:[]};
  const page={id:'page_anime',elements:[{id:'el_box',type:'shape',x:0,y:0,width:40,height:40}],motion:{steps:1,source}};
  project.pages=[page];
  const {createPlayback}=await import('/playback.js');
  const errors=[];const t0=performance.now();
  const playback=createPlayback(project,page,{root,startAtEnd,onError:e=>errors.push(e.message)});
  await playback.ready;
  const readyMs=performance.now()-t0;
  const state=()=>({transform:node.style.transform,opacity:node.style.opacity,moved:node.dataset.moved||'',done:node.dataset.done||''});
  const out={readyMs,afterReady:state(),nextStep:playback.getState().nextStep,errors};
  if(thenReset){
   await playback.reset();
   const n=root.querySelector('[data-element-id="el_box"]');
   const t1=performance.now();
   await new Promise(resolve=>{const check=()=>n.dataset.done==='0'?resolve():setTimeout(check,10);playback.next();check();});
   out.normalMs=performance.now()-t1;
   out.afterNormal={transform:n.style.transform,done:n.dataset.done};
  }
  await playback.destroy();
  return out;
 },{source:animeSource(duration),startAtEnd,thenReset});
}

test('round10 back navigation: anime.js steps jump to their end state instantly while fast-forwarding',async t=>{
 const o=await openPage(t);if(!o)return;const {page,errors}=o;
 const fast=await runAnime(page,{duration:3000,startAtEnd:true,thenReset:false});
 assert.deepEqual(fast.errors,[]);
 assert.ok(fast.readyMs<300,`快进用了 ${Math.round(fast.readyMs)} ms`);
 assert.equal(fast.nextStep,1);
 assert.equal(fast.afterReady.done,'0');assert.equal(fast.afterReady.moved,'1');
 assert.match(fast.afterReady.transform,/translateX\(200px\)/);assert.match(fast.afterReady.transform,/scale\(1\.5\)/);
 assert.equal(fast.afterReady.opacity,'0.5');
 assert.deepEqual(errors,[]);
});

test('round10 back navigation: anime.js keeps its real duration in normal playback, including after a fast-forward',async t=>{
 const o=await openPage(t);if(!o)return;const {page,errors}=o;
 // 一步里依次：600ms 动画、再等 600ms 的时间线、再 600ms 计时器 → 正常播放至少约 1.8 秒
 const normal=await runAnime(page,{duration:600,startAtEnd:false,thenReset:true});
 assert.ok(normal.normalMs>=1700,`正常播放只用了 ${Math.round(normal.normalMs)} ms`);
 assert.match(normal.afterNormal.transform,/translateX\(200px\)/);
 // 先快进（瞬间完成），reset 后再正常播放：速度恢复
 const mixed=await runAnime(page,{duration:600,startAtEnd:true,thenReset:true});
 assert.ok(mixed.readyMs<300,`快进用了 ${Math.round(mixed.readyMs)} ms`);
 assert.ok(mixed.normalMs>=1700,`快进之后的正常播放只用了 ${Math.round(mixed.normalMs)} ms`);
 assert.deepEqual([...normal.errors,...mixed.errors],[]);assert.deepEqual(errors,[]);
});
