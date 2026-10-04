import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
// 第 11 轮：画布手感（参考 Canva）——就地改字的选区、编辑时框不动、单击进编辑、拖角缩放文字、分组整组拖动、整体等比缩放、快捷工具条
const now='2026-10-04T12:00:00.000Z';
const project=()=>({format:'visual-workbench/project',formatVersion:2,id:'demo',name:'第 11 轮画布',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:1000,height:700},
 assets:[{id:'asset_picture',kind:'image',file:'assets/a.png',name:'图',width:40,height:30,pendingLayout:false,addedAt:now}],fonts:[],
 pages:[{id:'page_first',name:'第一页',background:'#ffffff',elements:[
  {id:'el_text',type:'text',x:60,y:60,width:520,height:90,zIndex:2,text:'hello brave world\nsecond line here',fontSize:32,lineHeight:1.4,color:'#111111',letterSpacing:2,stroke:{color:'#000000',width:2},shadow:{color:'#00000066',x:2,y:4,blur:8}},
  {id:'el_shape',type:'shape',shape:'rect',x:700,y:60,width:200,height:120,zIndex:3,fill:'#88aadd',cornerRadius:10},
  {id:'el_image',type:'image',x:700,y:260,width:160,height:120,zIndex:1,asset:'asset_picture',fit:'cover'},
  {id:'el_group',type:'group',x:100,y:380,width:400,height:200,zIndex:4,children:[
   {id:'el_part_a',type:'shape',shape:'rect',x:0,y:0,width:150,height:200,zIndex:1,fill:'#cc6633',cornerRadius:8},
   {id:'el_part_b',type:'shape',shape:'rect',x:250,y:50,width:150,height:150,zIndex:2,fill:'#3366cc'}]}]}]});
async function editor(t){
 const dir=mkdtempSync(join(tmpdir(),'vw-round11-editor-'));const home=mkdtempSync(join(tmpdir(),'vw-round11-home-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});});
 const pd=join(dir,'projects','demo');mkdirSync(join(pd,'assets'),{recursive:true});
 writeFileSync(join(pd,'assets/a.png'),await sharp({create:{width:40,height:30,channels:4,background:'#3366cc'}}).png().toBuffer());
 writeFileSync(join(pd,'project.json'),JSON.stringify(project()));
 server=createServer({dataDir:dir,configHome:home});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1600,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-action="open"][data-id="demo"]').click();await page.waitForSelector('#artboard');
 await page.waitForTimeout(400);
 return {page,errors,file:join(pd,'project.json'),scale:await page.locator('#artboard').evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a)};
}
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const find=(file,id)=>{const scan=items=>{for(const e of items){if(e.id===id)return e;if(e.children){const f=scan(e.children);if(f)return f;}}};return scan(disk(file).pages[0].elements);};
async function saved(page,action){await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()),action()]);}
async function box(page,id){return page.locator(`#artboard [data-element-id="${id}"]`).boundingBox();}
const editing=page=>page.evaluate(()=>!!document.querySelector('#artboard [contenteditable]'));
const selection=page=>page.evaluate(()=>getSelection().toString());
const handles=(page,id)=>page.locator(`[data-resize="${id}"]`).count();
// 文字节点里第 i 个字符的屏幕位置
const charBox=(page,i)=>page.evaluate(i=>{const node=document.querySelector('#artboard [data-element-id="el_text"]'),host=node.querySelector(':scope > [data-vw-flip]')||node,text=[...host.childNodes].find(n=>n.nodeType===3),r=document.createRange();r.setStart(text,i);r.setEnd(text,i+1);const b=r.getBoundingClientRect();return {left:b.left,right:b.right,x:(b.left+b.right)/2,y:(b.top+b.bottom)/2};},i);
async function blank(page){const well=await page.locator('#canvas-well').boundingBox();await page.mouse.click(well.x+12,well.y+well.height-12);}
async function drag(page,from,to,steps=6){await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps});await page.mouse.up();}
async function shiftClick(page,p){await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');}
const mid=b=>({x:b.x+b.width/2,y:b.y+b.height/2});

test('round11 0c/0a: 未选中的文字双击 = 进入编辑并选中点到的词；拖选、Shift+方向键扩选、三击选段、Ctrl/Cmd+A 只选本框文字',async t=>{
 const {page,errors,file}=await editor(t);
 const w=await charBox(page,8);await page.mouse.dblclick(w.x,w.y);
 assert.equal(await editing(page),true);assert.equal(await selection(page),'brave');
 // Shift+方向键扩选
 await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');assert.equal(await selection(page),'brave w');
 // 拖动鼠标选一段（框不动）
 const before=await box(page,'el_text');const a=await charBox(page,0),z=await charBox(page,4);
 await drag(page,{x:a.left+1,y:a.y},{x:z.right-1,y:z.y});
 assert.equal(await selection(page),'hello');assert.deepEqual(await box(page,'el_text'),before);
 // 三击选中一整段（换行之间）
 const p=await charBox(page,22);await page.mouse.click(p.x,p.y,{clickCount:3});
 assert.equal(await selection(page),'second line here');
 // Ctrl/Cmd+A：只选这段文字，不选画布元素
 await page.keyboard.press('ControlOrMeta+a');assert.equal(await selection(page),'hello brave world\nsecond line here');
 assert.equal(await handles(page,'el_shape'),0);assert.equal(await editing(page),true);
 await page.keyboard.type('新的');await saved(page,()=>page.keyboard.press('Escape'));
 assert.equal(find(file,'el_text').text,'新的');assert.equal(find(file,'el_text').x,60);assert.equal(find(file,'el_text').y,60);
 assert.deepEqual(errors,[]);
});

test('round11 0b/0c: 选中的文字再单击一次（不拖动）就在点到的位置进入编辑；编辑中在框里拖动只选字不移动元素，Esc 退出后才能拖',async t=>{
 const {page,errors,file}=await editor(t);
 const c=await charBox(page,6);
 await page.mouse.click(c.left+1,c.y);assert.equal(await editing(page),false);assert.equal(await handles(page,'el_text'),6);
 await page.waitForTimeout(600); // 和上一次单击分开，不算双击
 // 按下松开有 2px 的抖动也算单击
 await drag(page,{x:c.left+1,y:c.y},{x:c.left+3,y:c.y},1);
 assert.equal(await editing(page),true);
 assert.equal(await page.evaluate(()=>{const s=getSelection();return s.isCollapsed&&s.anchorOffset;}),6);
 const before=await box(page,'el_text');const from=await charBox(page,0),to=await charBox(page,10);
 await drag(page,{x:from.left+1,y:from.y},{x:to.right-1,y:to.y+40},8);
 assert.notEqual(await selection(page),'');assert.deepEqual(await box(page,'el_text'),before);
 await page.keyboard.press('Escape');assert.equal(await editing(page),false);
 assert.equal(find(file,'el_text').x,60);
 // 退出编辑后：拖动 = 移动元素
 const b=await box(page,'el_text');await saved(page,()=>drag(page,mid(b),{x:mid(b).x+50,y:mid(b).y}));
 assert.ok(find(file,'el_text').x>80,'退出编辑后可以拖动');
 // Shift 单击仍是加选（不进入编辑）
 const s=await box(page,'el_shape');await shiftClick(page,mid(s));
 assert.equal(await editing(page),false);assert.equal(await handles(page,'el_shape'),8);assert.equal(await handles(page,'el_text'),6);
 assert.deepEqual(errors,[]);
});

test('round11 0e: 文字框拖角 = 文字连同框按宽度比例缩放（字号、字距、描边、投影），拖左右边只改宽度重新换行',async t=>{
 const {page,errors,file,scale}=await editor(t);
 const b=await box(page,'el_text');await page.mouse.click(b.x+b.width-20,b.y+b.height-10);
 const old=find(file,'el_text');
 const h=mid(await page.locator('[data-resize="el_text"][data-handle="se"]').boundingBox());
 await saved(page,()=>drag(page,h,{x:h.x+260*scale,y:h.y+20*scale}));
 const big=find(file,'el_text'),f=big.width/old.width;
 assert.ok(f>1.4&&f<1.6,`宽度按拖动放大（比例 ${f}）`);
 assert.ok(Math.abs(big.fontSize-old.fontSize*f)<0.05,`字号按比例（${big.fontSize}）`);
 assert.ok(Math.abs(big.letterSpacing-old.letterSpacing*f)<0.05);assert.ok(Math.abs(big.stroke.width-old.stroke.width*f)<0.05);
 assert.ok(Math.abs(big.shadow.blur-old.shadow.blur*f)<0.05);assert.ok(Math.abs(big.shadow.y-old.shadow.y*f)<0.05);
 assert.equal(big.x,old.x);assert.equal(big.y,old.y);assert.ok(big.height>old.height*1.3,'高度按内容重算');
 // 拖右边：只改宽度，字号不变
 const e=mid(await page.locator('[data-resize="el_text"][data-handle="e"]').boundingBox());
 await saved(page,()=>drag(page,e,{x:e.x-480*scale,y:e.y},5));
 const narrow=find(file,'el_text');assert.equal(narrow.fontSize,big.fontSize);assert.ok(narrow.width<big.width-400);assert.ok(narrow.height>big.height,'变窄后折行变高');
 // 撤销一次回到拖角后的样子
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(find(file,'el_text').width,big.width);
 assert.deepEqual(errors,[]);
});

test('round11 0f: 选中分组后按在组内元素上拖动 = 整组移动；单击不拖才进入分组选中子元素；Esc 逐层退回',async t=>{
 const {page,errors,file}=await editor(t);
 const p=mid(await box(page,'el_part_a'));
 await page.mouse.click(p.x,p.y);assert.equal(await handles(page,'el_group'),8,'第一次单击选中整组');
 await page.waitForTimeout(600);
 const before=find(file,'el_group');
 // 修复前：这里按下即切到 el_ga，只拖动了子元素
 await saved(page,()=>drag(page,p,{x:p.x+80,y:p.y+30}));
 const moved=find(file,'el_group');
 assert.ok(moved.x>before.x+40,`整组移动（x ${before.x} → ${moved.x}）`);assert.ok(moved.y>before.y+10);
 assert.deepEqual(moved.children.map(c=>[c.id,c.x,c.y]),before.children.map(c=>[c.id,c.x,c.y]),'组内元素相对位置不变');
 assert.equal(await handles(page,'el_group'),8,'拖完仍选中整组');
 // 单击（不拖）进入分组
 const a2=mid(await box(page,'el_part_a'));await page.mouse.click(a2.x,a2.y);
 assert.equal(await handles(page,'el_part_a'),8);assert.equal(await handles(page,'el_group'),0);
 await page.waitForTimeout(600);
 // 进入后拖动只移动这个子元素
 const c=mid(await box(page,'el_part_a'));await saved(page,()=>drag(page,c,{x:c.x+40,y:c.y},5));
 const after=find(file,'el_group');assert.equal(after.x,moved.x);assert.ok(after.children[0].x>30);
 await page.keyboard.press('Escape');assert.equal(await handles(page,'el_group'),8);
 await page.keyboard.press('Escape');assert.equal(await page.locator('[data-resize]').count(),0);
 assert.deepEqual(errors,[]);
});

test('round11 A5: 多选 / 全选拖角默认等比整体缩放（Shift 恢复各自拉伸）；分组拖角等比；「整体缩放 %」以选区中心为基准',async t=>{
 const {page,errors,file,scale}=await editor(t);
 // 分组拖角：等比，组内间距、圆角一起变
 const g=await box(page,'el_group');await page.mouse.click(g.x+10,g.y+g.height/2);
 const og=find(file,'el_group');const se=mid(await page.locator('[data-resize="el_group"][data-handle="se"]').boundingBox());
 await saved(page,()=>drag(page,se,{x:se.x-100*scale,y:se.y-10*scale},5));
 const sg=find(file,'el_group');const fg=sg.width/og.width;
 assert.ok(Math.abs(fg-0.75)<0.01,`比例按宽度（${fg}）`);assert.ok(Math.abs(sg.height-og.height*fg)<=1,'高度同比例');
 assert.equal(sg.x,og.x);assert.equal(sg.y,og.y);
 assert.ok(Math.abs(sg.children[1].x-og.children[1].x*fg)<=1,'组内间距按比例');assert.ok(Math.abs(sg.children[0].cornerRadius-8*fg)<0.05,'圆角按比例');
 // Ctrl+A 全选后拖角：所有元素一起等比缩放（字号、描边、投影也变）
 await blank(page);await page.keyboard.press('ControlOrMeta+a');
 const ids=['el_text','el_shape','el_image','el_group'];for(const id of ids)assert.ok(await handles(page,id)>0,id);
 const olds=Object.fromEntries(ids.map(id=>[id,find(file,id)]));
 const nw=mid(await page.locator('[data-resize="el_text"][data-handle="nw"]').boundingBox());
 // 拖的是 el_text 的左上角（也是选区左上角）：以选区右下角为基准缩小
 await saved(page,()=>drag(page,nw,{x:nw.x+84*scale,y:nw.y+40*scale}));
 const news=Object.fromEntries(ids.map(id=>[id,find(file,id)]));
 const right=e=>e.x+e.width,bottom=e=>e.y+e.height,maxR=o=>Math.max(...ids.map(id=>right(o[id]))),minX=o=>Math.min(...ids.map(id=>o[id].x));
 const f=(maxR(news)-minX(news))/(maxR(olds)-minX(olds));assert.ok(f>0.85&&f<0.95,`整体比例 ${f}`);
 assert.ok(Math.abs(maxR(news)-maxR(olds))<=2,'对角（右边）固定');assert.ok(Math.abs(news.el_shape.width-olds.el_shape.width*f)<=2);
 assert.ok(Math.abs(news.el_text.fontSize-olds.el_text.fontSize*f)<0.2,'字号一起缩放');assert.ok(Math.abs(news.el_text.stroke.width-olds.el_text.stroke.width*f)<0.05);
 assert.ok(Math.abs(news.el_shape.cornerRadius-10*f)<0.05);
 // Shift + 拖角：保持旧行为（各自拉伸，不改字号）
 const fs0=news.el_text.fontSize;const h2=mid(await page.locator('[data-resize="el_shape"][data-handle="se"]').boundingBox());
 await page.keyboard.down('Shift');await saved(page,()=>drag(page,h2,{x:h2.x+30*scale,y:h2.y+30*scale},4));await page.keyboard.up('Shift');
 assert.equal(find(file,'el_text').fontSize,fs0);
 // 整体缩放 %：快捷工具条里输入 50
 await blank(page);
 const s=mid(await box(page,'el_shape'));await page.mouse.click(s.x,s.y);const im=mid(await box(page,'el_image'));await shiftClick(page,im);
 const two=['el_shape','el_image'].map(id=>find(file,id));
 const cx=(Math.min(...two.map(e=>e.x))+Math.max(...two.map(right)))/2,cy=(Math.min(...two.map(e=>e.y))+Math.max(...two.map(bottom)))/2;
 const input=page.locator('.ed-quickbar input[data-scale-selection]');assert.equal(await input.count(),1);
 await saved(page,async()=>{await input.fill('50');await input.press('Enter');});
 const half=['el_shape','el_image'].map(id=>find(file,id));
 assert.ok(Math.abs(half[0].width-two[0].width/2)<=1);assert.ok(Math.abs(half[1].height-two[1].height/2)<=1);
 const ncx=(Math.min(...half.map(e=>e.x))+Math.max(...half.map(right)))/2,ncy=(Math.min(...half.map(e=>e.y))+Math.max(...half.map(bottom)))/2;
 assert.ok(Math.abs(ncx-cx)<=1.5&&Math.abs(ncy-cy)<=1.5,'以选区中心为基准');
 assert.equal(await input.inputValue(),'100');
 // 一次整体缩放 = 一条撤销
 await saved(page,()=>page.locator('[data-action="undo"]').click());assert.equal(find(file,'el_shape').width,two[0].width);
 assert.deepEqual(errors,[]);
});

test('round11 0g: 选中元素时画布上方出现快捷工具条（按类型）；改字号生效；图片有裁切；取消选择后隐藏且画板不重新缩放',async t=>{
 const {page,errors,file}=await editor(t);
 const bar=page.locator('.ed-quickbar');assert.equal(await bar.isVisible(),false);
 const boardBefore=await page.locator('#artboard').boundingBox();
 const b=await box(page,'el_text');await page.mouse.click(b.x+b.width-20,b.y+b.height-10);
 assert.equal(await bar.isVisible(),true);
 const barBox=await bar.boundingBox(),tools=await page.locator('.ed-toolbar').boundingBox();
 assert.ok(barBox.y>=tools.y+tools.height-1&&barBox.height<=44,'窄窄一条，在工具栏下方');
 assert.deepEqual(await page.locator('#artboard').boundingBox(),boardBefore,'工具条出现不挤压画布');
 for(const prop of ['font','fontSize','color','align','lineHeight','letterSpacing'])assert.equal(await bar.locator(`[data-qprop="${prop}"]`).count(),1,prop);
 const size=bar.locator('[data-qprop="fontSize"]');assert.equal(await size.inputValue(),'32');
 await saved(page,async()=>{await size.fill('40');await size.press('Enter');});
 assert.equal(find(file,'el_text').fontSize,40);assert.equal(await page.locator('.ed-props input[data-prop="fontSize"]').inputValue(),'40','侧栏同步');
 // 增量刷新：同一选择下改属性，工具条内容节点不重建
 await bar.evaluate(n=>{window.__qt=n.firstElementChild;});
 await saved(page,async()=>{const lh=bar.locator('[data-qprop="lineHeight"]');await lh.fill('1.6');await lh.press('Enter');});
 assert.equal(find(file,'el_text').lineHeight,1.6);assert.equal(await bar.evaluate(n=>n.firstElementChild===window.__qt),true);
 // 描边入口：跳到侧栏的描边区
 await bar.locator('[data-qaction="quick-style"][data-section="stroke"]').click();
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.prop),'stroke.color');
 // 图片：裁切、替换、翻转、透明度
 const im=mid(await box(page,'el_image'));await page.mouse.click(im.x,im.y);
 assert.equal(await bar.locator('[data-qaction="crop-image"]').count(),1);assert.equal(await bar.locator('[data-qaction="replace-image"]').count(),1);
 await saved(page,()=>bar.locator('[data-qaction="quick-flip"][data-axis="flipX"]').click());assert.equal(find(file,'el_image').flipX,true);
 await saved(page,async()=>{const o=bar.locator('[data-qprop="opacity"]');await o.fill('60');await o.press('Enter');});assert.equal(find(file,'el_image').opacity,0.6);
 await bar.locator('[data-qaction="crop-image"]').click();assert.equal(await page.locator('#artboard .crop-overlay').count(),1);await page.keyboard.press('Escape');
 // 形状：填充、圆角
 await blank(page);const s=mid(await box(page,'el_shape'));await page.mouse.click(s.x,s.y);
 assert.equal(await bar.locator('[data-qprop="fill"]').count(),1);
 await saved(page,async()=>{const r=bar.locator('[data-qprop="cornerRadius"]');await r.fill('24');await r.press('Enter');});assert.equal(find(file,'el_shape').cornerRadius,24);
 // 分组：透明度 + 整体缩放
 const g=await box(page,'el_group');await page.mouse.click(g.x+10,g.y+g.height/2);
 assert.equal(await bar.locator('[data-qprop="opacity"]').count(),1);assert.equal(await bar.locator('[data-scale-selection]').count(),1);
 // 取消选择：隐藏
 await blank(page);assert.equal(await bar.isVisible(),false);
 assert.deepEqual(await page.locator('#artboard').boundingBox(),boardBefore);
 assert.deepEqual(errors,[]);
});
