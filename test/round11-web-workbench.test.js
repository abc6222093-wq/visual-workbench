// 第 11 轮第二阶段：网页项目的界面——新建、窗口里滚轮浏览与编辑、变体与并排对比、交接包、关窗前保存。
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
const SAMPLE=new URL('../examples/sample-web/',import.meta.url);

async function setup(t,{baseline=false,viewport={width:1600,height:1000}}={}){
 const dir=mkdtempSync(join(tmpdir(),'vw-round11-web-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const pd=join(dir,'projects','sample-web');mkdirSync(pd,{recursive:true});cpSync(SAMPLE,pd,{recursive:true});
 if(baseline){mkdirSync(join(pd,'import'),{recursive:true});writeFileSync(join(pd,'import','baseline.json'),readFileSync(join(pd,'project.json')));}
 server=createServer({dataDir:dir});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${server.address().port}`;
 browser=await launchBrowser();const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForSelector('.hm-grid');
 const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 return {dir,page,errors,request,file:id=>join(dir,'projects',id,'project.json')};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
async function openProject(page,id){await page.locator(`[data-action="open"][data-id="${id}"]`).click();await page.waitForSelector('#artboard');await page.waitForTimeout(300);}
const scale=page=>page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a);
const translateY=page=>page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).f);
const scrollY=page=>page.locator('#artboard-holder').evaluate(n=>Number(n.dataset.scrollY));
async function saved(page){await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');}
async function wheel(page,dy){const b=await page.locator('#artboard-holder').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.wheel(0,dy);await page.waitForTimeout(120);}
const findEl=(project,id)=>{const scan=items=>{for(const e of items){if(e.id===id)return e;const f=e.children&&scan(e.children);if(f)return f;}};for(const p of project.pages){const f=scan(p.elements);if(f)return f;}};

test('round11 网页：新建网页项目两页（电脑端 / 手机端）、加页菜单、设备小标、页面高度、底部尺寸；课件新建不变',async t=>{
 const {page,errors,file}=await setup(t);
 await page.locator('.hm-panel [data-action="new"]').first().click();
 await page.fill('#new-form input[name="name"]','新网页');
 assert.equal(await page.locator('#new-form select[name="preset"]').isVisible(),true);
 await page.check('#new-form input[name="kind"][value="web"]');
 assert.equal(await page.locator('#new-form select[name="preset"]').isVisible(),false,'网页不用选画板');
 assert.match(await page.locator('#new-form [data-web-note]').innerText(),/1440×900.*390×844/);
 const created=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');
 await page.locator('#new-form button[type="submit"]').click();
 const id=(await (await created).json()).project.id;await page.waitForSelector('#artboard');
 let p=disk(file(id));
 assert.equal(p.kind,'web');assert.deepEqual(p.artboard,{preset:'web-desktop',width:1440,height:900});
 assert.deepEqual(p.pages.map(x=>[x.name,x.device,x.size.width,x.size.height]),[['首页 · 电脑端','desktop',1440,1800],['首页 · 手机端','mobile',390,1688]]);
 assert.deepEqual(await page.locator('.page-list .ed-page__device').allInnerTexts(),['电脑','手机']);
 assert.match(await page.locator('.ed-foot').innerText(),/电脑端窗口 1440×900\s*·\s*整页 1440×1800/);
 // 加页：先选设备
 await page.locator('[data-action="add-page"]').click();
 await page.locator('.g-context-menu button',{hasText:'手机端页面'}).click();
 await saved(page);p=disk(file(id));
 assert.equal(p.pages.length,3);assert.equal(p.pages[2].device,'mobile');assert.deepEqual(p.pages[2].size,{width:390,height:1688});
 assert.deepEqual(await page.locator('.page-list .ed-page__device').allInnerTexts(),['电脑','手机','手机'],'patch 后小标仍在');
 // 未选元素：属性栏「页面」区改整页高度（不小于窗口高）
 const height=page.locator('[data-page-height]');
 await height.fill('3000');await height.press('Enter');await saved(page);
 assert.equal(disk(file(id)).pages[2].size.height,3000);
 assert.match(await page.locator('.ed-foot').innerText(),/手机端窗口 390×844\s*·\s*整页 390×3000/);
 await height.fill('100');await height.press('Enter');await saved(page);
 assert.equal(disk(file(id)).pages[2].size.height,844,'不小于窗口高');
 await page.locator('[data-action="undo"]').click();await saved(page);
 assert.equal(disk(file(id)).pages[2].size.height,3000,'改高度进撤销');
 // 课件新建照旧
 await page.locator('[data-action="home"]').click();await page.waitForSelector('.hm-grid');
 assert.equal(await page.locator('[data-action="import-html"]').innerText(),'导入 HTML / 网页');
 await page.locator('.hm-panel [data-action="new"]').first().click();
 await page.fill('#new-form input[name="name"]','课件');
 const deckCreated=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');
 await page.locator('#new-form button[type="submit"]').click();
 const deck=(await (await deckCreated).json()).project;await page.waitForSelector('#artboard');
 assert.equal(deck.kind,undefined);assert.equal(deck.pages.length,1);assert.deepEqual(deck.artboard,{preset:'slide-16x9',width:1920,height:1080});
 assert.equal(await page.locator('.ed-viewport').count(),0);assert.equal(await page.locator('.ed-page__device').count(),0);
 // 课件的加页照旧直接加
 await page.locator('[data-action="add-page"]').click();assert.equal(await page.locator('.g-context-menu').count(),0);
 assert.deepEqual(errors,[]);
});

test('round11 网页：窗口固定比例、滚轮浏览并夹住、滚到下方直接选中拖动、拖到窗口底边自动滚动、换页回顶、Home/End；课件无窗口',async t=>{
 const {page,errors,file,request}=await setup(t);
 await openProject(page,'sample-web');
 const s=await scale(page),holder=await page.locator('#artboard-holder').boundingBox();
 assert.equal(await page.locator('#artboard-holder.ed-viewport').count(),1);
 assert.ok(Math.abs(holder.width-1440*s)<=1.5&&Math.abs(holder.height-900*s)<=1.5,`窗口 ${holder.width}×${holder.height}，scale ${s}`);
 assert.equal(await translateY(page),0);
 await wheel(page,600);
 assert.equal(await scrollY(page),600);assert.ok(Math.abs(await translateY(page)+600*s)<0.6);
 await wheel(page,5000);assert.equal(await scrollY(page),1500,'夹到 整页高 − 窗口高');
 await wheel(page,-9000);assert.equal(await scrollY(page),0);
 // 横向滚轮不动
 const b=await page.locator('#artboard-holder').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.wheel(400,0);await page.waitForTimeout(100);assert.equal(await scrollY(page),0);
 // 滚到 1000：整页 1400 处的正文就在窗口里，直接点选并拖动 100 屏幕像素
 await wheel(page,1000);assert.equal(await scrollY(page),1000);
 const body=await page.locator('#artboard [data-element-id="el_body_desk"]').boundingBox();
 assert.ok(body.y>b.y&&body.y<b.y+b.height,'元素在窗口里');
 await page.keyboard.down('Alt');
 await page.mouse.move(body.x+40,body.y+20);await page.mouse.down();await page.mouse.move(body.x+40,body.y+70,{steps:4});await page.mouse.move(body.x+40,body.y+120,{steps:4});await page.mouse.up();
 await page.keyboard.up('Alt');await saved(page);
 const moved=findEl(disk(file('sample-web')),'el_body_desk');
 assert.ok(Math.abs(moved.y-(1400+100/s))<=1.5,`y=${moved.y} 期望约 ${1400+100/s}`);assert.equal(moved.x,320);
 // 拖到窗口底边：自动滚动，元素跟着往下
 await page.keyboard.press('Home');await page.waitForTimeout(80);assert.equal(await scrollY(page),0);
 const sub=await page.locator('#artboard [data-element-id="el_sub_desk"]').boundingBox();
 await page.keyboard.down('Alt');
 await page.mouse.move(sub.x+30,sub.y+10);await page.mouse.down();await page.mouse.move(sub.x+30,sub.y+60,{steps:3});
 await page.mouse.move(sub.x+30,b.y+b.height-6,{steps:6});
 const t0=await translateY(page);await page.waitForTimeout(500);await page.mouse.move(sub.x+31,b.y+b.height-5);
 const t1=await translateY(page);
 assert.ok(t1<t0-20,`自动滚动 translateY ${t0} → ${t1}`);
 await page.mouse.up();const scrolled=await scrollY(page);await page.keyboard.up('Alt');await saved(page);
 const subMoved=findEl(disk(file('sample-web')),'el_sub_desk');
 const expected=440+(b.y+b.height-5-(sub.y+10))/s+scrolled;
 assert.ok(Math.abs(subMoved.y-expected)<=3,`拖动换算含滚动量：y=${subMoved.y} 期望约 ${expected}`);
 // End 到底；换页回到顶部（手机端窗口 390×844）
 await page.locator('#canvas-well').click({position:{x:5,y:5}});
 await page.keyboard.press('End');await page.waitForTimeout(80);assert.equal(await scrollY(page),1500);
 await page.locator('.page-list [data-action="switch"][data-id="page_home_mob"]').click();await page.waitForTimeout(200);
 assert.equal(await scrollY(page),0);
 const ms=await scale(page),mh=await page.locator('#artboard-holder').boundingBox();
 assert.ok(Math.abs(mh.width-390*ms)<=1.5&&Math.abs(mh.height-844*ms)<=1.5);
 await wheel(page,99999);assert.equal(await scrollY(page),3000-844);
 // 课件项目：没有窗口
 assert.equal((await request('/api/projects','POST',{id:'deck-one',name:'课件'})).status,201);
 await page.locator('[data-action="home"]').click();await page.waitForSelector('.hm-grid');await openProject(page,'deck-one');
 assert.equal(await page.locator('.ed-viewport').count(),0);
 await wheel(page,500);assert.equal(await translateY(page),0);
 assert.deepEqual(errors,[]);
});

test('round11 网页：复制为变体 3 份、并排对比 4 份、选定第 2 份写回原件并删变体、一次撤销恢复',async t=>{
 const {page,errors,file}=await setup(t);
 await openProject(page,'sample-web');
 const title=await page.locator('#artboard [data-element-id="el_title_desk"]').boundingBox();
 await page.mouse.click(title.x+title.width/2,title.y+title.height/2,{button:'right'});
 await page.locator('.g-context-menu button',{hasText:'复制为变体…'}).click();
 await page.locator('[data-variant-count="3"]').click();await page.locator('[data-variant-ok]').click();
 await saved(page);
 let els=disk(file('sample-web')).pages[0].elements,variants=els.filter(e=>e.variantOf==='el_title_desk');
 assert.equal(variants.length,3);assert.deepEqual(variants.map(v=>v.name.replace(/^.*· /,'')),['变体 1','变体 2','变体 3']);
 const orig=els.find(e=>e.id==='el_title_desk');
 // 放不下就往下排开，相隔 24
 assert.deepEqual(variants.map(v=>[v.x,v.y]),[1,2,3].map(n=>[orig.x,orig.y+n*(orig.height+24)]));
 // 把变体 2 改成红色
 await page.locator(`.ed-layers [data-action="select"][data-id="${variants[1].id}"]`).click();
 await page.locator('.ed-props [data-prop="color"]').evaluate(n=>{n.value='#ff0000';n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));});
 await saved(page);
 assert.equal(findEl(disk(file('sample-web')),variants[1].id).color,'#ff0000');
 // 并排对比
 await page.locator('.ed-tools [data-action="compare-variants"]').click();
 assert.equal(await page.locator('.vw-compare__card').count(),4);
 assert.deepEqual(await page.locator('.vw-compare__foot span').allInnerTexts(),['原件','变体 1','变体 2','变体 3']);
 await page.locator('[data-compare-choose="2"]').click();await saved(page);
 els=disk(file('sample-web')).pages[0].elements;
 const chosen=els.find(e=>e.id==='el_title_desk');
 assert.equal(chosen.color,'#ff0000');assert.equal(chosen.x,orig.x);assert.equal(chosen.y,orig.y);assert.equal(chosen.name,orig.name);
 assert.equal(els.filter(e=>e.variantOf).length,0);
 assert.equal(await page.locator('.vw-compare').count(),0);
 assert.equal(await page.locator('.ed-tools [data-action="compare-variants"]').count(),0,'没有变体后按钮消失');
 await page.locator('[data-action="undo"]').click();await saved(page);
 els=disk(file('sample-web')).pages[0].elements;
 assert.equal(els.filter(e=>e.variantOf==='el_title_desk').length,3);assert.equal(els.find(e=>e.id==='el_title_desk').color,orig.color);
 // Esc 关闭弹层
 await page.locator('.ed-tools [data-action="compare-variants"]').click();assert.equal(await page.locator('.vw-compare').count(),1);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.vw-compare').count(),0);
 // 页面变体：右键页面 → 复制为变体 2 份 → 选定原页 → 变体页删掉
 await page.locator('.page-list .ed-page[data-page-id="page_home_mob"]').click({button:'right'});
 await page.locator('.g-context-menu button',{hasText:'复制为变体…'}).click();
 await page.locator('[data-variant-count="2"]').click();await page.locator('[data-variant-ok]').click();await saved(page);
 let pages=disk(file('sample-web')).pages;
 assert.deepEqual(pages.filter(p=>p.variantOf==='page_home_mob').map(p=>p.name),['首页 · 手机端 · 变体 1','首页 · 手机端 · 变体 2']);
 await page.locator('.page-list [data-action="switch"][data-id="page_home_mob"]').click();
 await page.locator('.ed-tools [data-action="compare-variants"]').click();
 assert.equal(await page.locator('.vw-compare__card').count(),3);
 await page.locator('[data-compare-choose="0"]').click();await saved(page);
 pages=disk(file('sample-web')).pages;assert.equal(pages.length,2);assert.equal(pages.some(p=>p.variantOf),false);
 assert.deepEqual(errors,[]);
});

test('round11 交接包：有基准时弹层列出改动清单与复制给 agent 的文字；没有基准时中文提示',async t=>{
 const {page,errors,request}=await setup(t,{baseline:true});
 assert.equal((await request('/api/projects','POST',{id:'deck-two',name:'课件'})).status,201);
 await page.reload();await page.waitForSelector('.hm-grid');
 await openProject(page,'sample-web');
 await page.locator('[data-action="export"]').click();
 await page.locator('[data-action="export-kind"][data-kind="handoff"]').click();
 assert.match(await page.locator('[data-action="export-kind"][data-kind="handoff"]').innerText(),/交接包（改动清单 \+ 对比图）[\s\S]*改前 = 导入时的样子/);
 await page.locator('[data-action="export-start"]').click();
 await page.waitForSelector('#handoff-text',{timeout:120000});
 const files=await page.locator('#export-files').innerText();
 assert.match(files,/改动清单\.md/);
 assert.match(await page.locator('#handoff-text').inputValue(),/改动清单/);
 assert.equal(await page.locator('[data-action="reveal"]').count(),1);
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};});
 await page.locator('[data-action="copy-handoff"]').click();
 assert.match(await page.evaluate(()=>window.__copied),/改动清单/);
 await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('已复制，开新的 agent 对话时直接粘贴'));
 // 没有基准：服务端中文提示
 await page.locator('[data-action="close"]').first().click();
 await page.locator('[data-action="home"]').click();await page.waitForSelector('.hm-grid');await openProject(page,'deck-two');
 await page.locator('[data-action="export"]').click();await page.locator('[data-action="export-kind"][data-kind="handoff"]').click();
 await page.locator('[data-action="export-start"]').click();
 await page.waitForFunction(()=>/导入基准/.test(document.querySelector('#toast')?.textContent||''));
 assert.deepEqual(errors,[]);
});

test('round11 关窗前保存：window.vwFlushBeforeClose 收尾微调并等保存完',async t=>{
 const {page,errors,file}=await setup(t);
 await openProject(page,'sample-web');
 assert.equal(await page.evaluate(()=>typeof window.vwFlushBeforeClose),'function');
 const title=await page.locator('#artboard [data-element-id="el_title_desk"]').boundingBox();
 await page.mouse.click(title.x+title.width-6,title.y+title.height/2);
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>window.vwFlushBeforeClose());
 assert.equal(await page.locator('#save-status').textContent(),'已保存');
 assert.equal(findEl(disk(file('sample-web')),'el_title_desk').x,122);
 assert.deepEqual(errors,[]);
});
