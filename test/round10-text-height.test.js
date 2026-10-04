import test, {before, after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
import {fitTextHeights,affectsTextHeight} from '../web/text-metrics.js';

// 文字框自动高度的测量模块：真浏览器里和 height:auto 的参照 div 比。
let dir,home,server,browser,url;
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'vw-round10-text-height-'));home=mkdtempSync(join(tmpdir(),'vw-round10-home-'));
 mkdirSync(join(dir,'projects','demo','fonts'),{recursive:true});
 copyFileSync(new URL('../examples/sample-deck/fonts/Inter-Variable.ttf',import.meta.url),join(dir,'projects','demo','fonts','Inter-Variable.ttf'));
 writeFileSync(join(dir,'projects','demo','project.json'),'{}'); // 服务端只认有 project.json 的项目文件夹，字体按普通文件取
 server=createServer({dataDir:dir,configHome:home});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 url=`http://127.0.0.1:${server.address().port}`;browser=await launchBrowser();
});
after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});});

const base={id:'el_t',type:'text',x:30,y:40,width:400,height:10,rotation:0,zIndex:1,text:'第一行文字\n第二行 second line\nthird',fontSize:40,lineHeight:1.4,letterSpacing:0,fontWeight:400,align:'left',color:'#222222'};
const project=(fonts=[])=>({id:'demo',artboard:{width:1200,height:800},fonts,assets:[],pages:[{id:'p1',background:'#ffffff',elements:[]}]});
async function fixture(t){
 const page=await browser.newPage({viewport:{width:1300,height:900}});t.after(()=>page.close());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${url}/vw-text-height-blank`);
 await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><div id="stage"></div>`);
 await page.evaluate(async()=>{
  window.tm=await import('/text-metrics.js');window.render=await import('/render.js');
  // 参照：同样排版样式、height:auto、scale 1 的普通 div；末尾换行用「多一个字」占住新行
  window.reference=(el,family='sans-serif')=>{
   if(el.text==='')return Math.ceil(el.fontSize*el.lineHeight);
   const d=document.createElement('div');
   d.style.cssText=`position:absolute;left:0;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;width:${el.width}px;font-family:${family};font-size:${el.fontSize}px;font-weight:${el.fontWeight||400};line-height:${el.lineHeight};letter-spacing:${el.letterSpacing||0}px;text-align:${el.align||'left'}`;
   d.textContent=el.text.endsWith('\n')?el.text+'x':el.text;document.body.append(d);const h=d.getBoundingClientRect().height;d.remove();return Math.ceil(h-0.01);
  };
  // 画到画板（可缩放）里的真实节点
  window.mount=(project,el,scale=1)=>{
   const holder=document.createElement('div');holder.id=`artboard`;holder.style.cssText=`position:absolute;left:0;top:0;transform:scale(${scale});transform-origin:0 0`;
   const root=render.renderPage(project,{id:'p1',background:'#fff',elements:[el]},{interactive:true,selectedIds:[el.id]});holder.append(root);document.getElementById('stage').append(holder);
   const node=root.querySelector('[data-element-id]');
   for(const h of ['nw','se']){const s=document.createElement('span');s.dataset.resize=el.id;s.dataset.handle=h;s.style.cssText='position:absolute;width:10px;height:10px';node.append(s);}
   const r=document.createElement('span');r.dataset.rotate=el.id;r.style.cssText='position:absolute;width:10px;height:10px;top:-30px';node.append(r);
   return {node,remove:()=>holder.remove()};
  };
 });
 return {page,errors};
}

test('round10 text height: three lines match the browser layout, offscreen measurer equals node measure',async t=>{
 const {page,errors}=await fixture(t);
 const r=await page.evaluate(async({el,p})=>{const m=tm.createTextMeasurer(p);await m.ready;const a=m.measure(el);const {node,remove}=mount(p,el);const b=tm.measureTextNode(node);remove();m.dispose();return {a,b,ref:reference(el),left:document.querySelectorAll('[aria-hidden]').length};},{el:base,p:project()});
 assert.equal(r.ref,Math.ceil(3*40*1.4));assert.equal(r.a,r.ref);assert.equal(r.b,r.ref);assert.equal(r.left,0);assert.deepEqual(errors,[]);
});

test('round10 text height: text, size, line height, spacing, width, newlines and empty text all follow the content',async t=>{
 const {page,errors}=await fixture(t);
 const long='视觉工作台让文字框随内容自动长高，内容变多往下长，内容变少缩回来，不截断也不溢出。'.repeat(2);
 const cases=[{text:long},{text:'短'},{fontSize:64},{fontSize:18},{lineHeight:2.1},{lineHeight:1},{letterSpacing:12,text:long},{width:160},{width:900},{text:'a\nb\nc\nd\ne'},{text:'结尾换行\n'},{text:'两个换行\n\n'},{text:'\n'},{text:''},{fontSize:37,lineHeight:1.33,text:long},{align:'center',text:long,width:300}];
 const rows=await page.evaluate(async({base,cases,p})=>{const m=tm.createTextMeasurer(p);await m.ready;const out=[];
  for(const c of cases){const el={...base,...c};const {node,remove}=mount(p,el);out.push({c,ref:reference(el),measure:m.measure(el),node:tm.measureTextNode(node)});remove();}
  m.dispose();return out;},{base,cases,p:project()});
 for(const row of rows){assert.equal(row.measure,row.ref,JSON.stringify(row));assert.equal(row.node,row.ref,JSON.stringify(row));}
 const by=k=>rows.find(r=>JSON.stringify(r.c)===JSON.stringify(k)).ref;
 assert.ok(by({text:long})>by({text:'短'}));assert.equal(by({text:'短'}),56);assert.ok(by({width:160})>by({width:900}));
 assert.equal(by({text:'结尾换行\n'}),112);assert.equal(by({text:'两个换行\n\n'}),168);assert.equal(by({text:'\n'}),112);assert.equal(by({text:''}),56);
 assert.deepEqual(errors,[]);
});

test('round10 text height: custom project font measures like the reference only after ready',async t=>{
 const {page,errors}=await fixture(t);
 const fonts=[{id:'font_inter',family:'Inter',file:'fonts/Inter-Variable.ttf',weight:'variable',style:'normal'}];
 const el={...base,font:'font_inter',width:330,fontSize:44,text:'Inter wraps differently from the fallback face: WWWW mmmm iiii llll 1234567890 ABCDEFG'};
 const r=await page.evaluate(async({el,p})=>{
  const m=tm.createTextMeasurer(p,{assetBase:'/data/projects/demo'});
  // 字体还没加载完：这时量出来按后备字体排，可能和最终不一致 —— 所以调用方必须先 await ready
  const early=m.measure(el);
  await m.ready;const after=m.measure(el);
  const loaded=document.fonts.check('400 16px "vw-demo-font_inter"');
  const {node,remove}=mount(p,el);const viaNode=tm.measureTextNode(node);remove();
  const ref=reference(el,'"vw-demo-font_inter"'),fallback=reference(el,'sans-serif');m.dispose();
  return {early,after,loaded,viaNode,ref,fallback};
 },{el,p:project(fonts)});
 assert.equal(r.loaded,true);assert.equal(r.after,r.ref);assert.equal(r.viaNode,r.ref);assert.ok(Number.isInteger(r.early));
 assert.deepEqual(errors,[]);
});

test('round10 text height: fitTextHeights updates every text element including groups and is idempotent',()=>{
 const p={id:'demo',pages:[
  {id:'p1',elements:[{id:'a',type:'text',text:'x',height:10},{id:'s',type:'shape',height:10},{id:'g',type:'group',height:300,children:[{id:'b',type:'text',text:'xx',height:20},{id:'i',type:'image',height:5}]}]},
  {id:'p2',elements:[{id:'c',type:'text',text:'xxx',height:30},{id:'d',type:'text',text:'',height:7}]}]};
 const measure=el=>el.text.length*10||7;
 assert.deepEqual(fitTextHeights(p,measure),[]); // 高度本来就对：不报改动
 const q={id:'demo',pages:[{id:'p1',elements:[{id:'a',type:'text',text:'xyz',height:10},{id:'s',type:'shape',height:10},{id:'g',type:'group',height:300,children:[{id:'b',type:'text',text:'xxxx',height:20},{id:'i',type:'image',height:5}]}]},{id:'p2',elements:[{id:'c',type:'text',text:'xxx',height:30},{id:'d',type:'text',text:'',height:1}]}]};
 assert.deepEqual(fitTextHeights(q,measure),[{pageId:'p1',id:'a',from:10,to:30},{pageId:'p1',id:'b',from:20,to:40},{pageId:'p2',id:'d',from:1,to:7}]);
 assert.equal(q.pages[0].elements[1].height,10);assert.equal(q.pages[0].elements[2].height,300);assert.equal(q.pages[0].elements[2].children[1].height,5);
 assert.equal(q.pages[0].elements[2].children[0].height,40);
 assert.deepEqual(fitTextHeights(q,measure),[]);
 const only=fitTextHeights({pages:[{id:'x',elements:[{id:'e',type:'text',text:'xxxxx',height:1}]},{id:'y',elements:[{id:'f',type:'text',text:'xxxxx',height:1}]}]},measure,{pages:[{id:'y',elements:[{id:'f',type:'text',text:'xx',height:1}]}]});
 assert.deepEqual(only,[{pageId:'y',id:'f',from:1,to:20}]);
});

test('round10 text height: affectsTextHeight only reacts to layout fields',()=>{
 const t={id:'a',type:'text',text:'hi',fontSize:20,fontWeight:400,lineHeight:1.4,letterSpacing:0,font:'f1',width:100,height:28,stroke:null,align:'left',x:0,y:0,color:'#000',opacity:1};
 for(const [k,v] of [['text','hey'],['fontSize',21],['fontWeight',700],['lineHeight',1.5],['letterSpacing',2],['font','f2'],['width',120],['stroke',{color:'#fff',width:2}],['align','center']])assert.equal(affectsTextHeight(t,{...t,[k]:v}),true,k);
 for(const [k,v] of [['x',5],['y',9],['color','#f00'],['opacity',0.5],['height',99],['rotation',30],['shadow',{color:'#000',x:1,y:1,blur:2}]])assert.equal(affectsTextHeight(t,{...t,[k]:v}),false,k);
 assert.equal(affectsTextHeight(t,{...t}),false);
 assert.equal(affectsTextHeight({id:'s',type:'shape',width:1},{id:'s',type:'shape',width:2}),false);
 assert.equal(affectsTextHeight(null,t),true);assert.equal(affectsTextHeight(t,null),true);
});

test('round10 text height: node inside an artboard scaled 0.37 measures like scale 1, flipped and in groups too',async t=>{
 const {page,errors}=await fixture(t);
 const el={...base,text:'缩放不影响测量：画板像素才是标准。'.repeat(3),fontSize:33,lineHeight:1.27,width:310};
 const r=await page.evaluate(({el,p})=>{
  const one=mount(p,el,1),small=mount(p,el,0.37),flip=mount(p,{...el,flipX:true,flipY:true},0.37);
  const group={id:'g1',type:'group',x:100,y:100,width:500,height:500,rotation:25,zIndex:1,children:[{...el,id:'el_child',x:10,y:10}]};
  const g=mount(p,group,0.37);const child=g.node.querySelector('[data-element-id="el_child"]');
  const out={one:tm.measureTextNode(one.node),small:tm.measureTextNode(small.node),flip:tm.measureTextNode(flip.node),group:tm.measureTextNode(child),ref:reference(el),
   untouched:small.node.style.height,handles:small.node.querySelectorAll('[data-resize],[data-rotate]').length,stray:document.querySelectorAll('[aria-hidden]').length};
  return out;
 },{el,p:project()});
 assert.equal(r.one,r.ref);assert.equal(r.small,r.ref);assert.equal(r.flip,r.ref);assert.equal(r.group,r.ref);
 assert.equal(r.untouched,'10px');assert.equal(r.handles,3);assert.equal(r.stray,0);assert.deepEqual(errors,[]);
});
