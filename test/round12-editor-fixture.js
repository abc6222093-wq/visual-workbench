// 第 12 轮界面测试共用的夹具：临时数据目录 + 临时 home，写一个格式 v3 的小项目（project.json + pages/*.html）。
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createServer} from './helpers/isolated-server.js';import {launchBrowser} from '../src/browser.js';
export const now='2026-10-05T12:00:00.000Z';
/** 一页课件 / 网页的 HTML：标题能改字改色挪动，卡片能挪动缩放改底色。 */
export function pageHTML(title,{bg='#fde9d9',body=''}={}){
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{background:${bg};font-family:sans-serif}h1{position:absolute;left:120px;top:100px;margin:0;font-size:96px;color:#222222}.card{position:absolute;left:120px;top:400px;width:600px;height:200px;background:#f1f5f9}</style></head><body><h1 data-vw-id="title" data-vw="text move color">${title}</h1><div class="card" data-vw-id="card" data-vw="move resize background"></div>${body}</body></html>`;
}
/** v3 项目对象。pages 给页名数组；web=true 时第 1 页电脑端、其余交替手机端。 */
export function v3Project({id='demo',name='第 12 轮验收',pages=['第1页','第2页','第3页'],web=false,artboard={preset:'slide-16x9',width:1920,height:1080}}={}){
 return {format:'visual-workbench/project',formatVersion:3,id,name,createdAt:now,updatedAt:now,...(web?{kind:'web'}:{}),
  artboard:web?{preset:'web-desktop',width:1440,height:900}:artboard,assets:[],fonts:[],
  pages:pages.map((n,i)=>{const pid=`page_p${String(i+1).padStart(2,'0')}`;const device=web?(i%2?'mobile':'desktop'):null;
   return {id:pid,name:n,file:`pages/${pid}.html`,edits:[],...(web?{device,size:{width:device==='mobile'?390:1440,height:device==='mobile'?2000:2400}}:{})};})};
}
/** 把项目写进数据目录；html(page, i) 可自定页面内容。 */
export function writeProject(dataDir,project,html=(p)=>pageHTML(p.name)){
 const root=join(dataDir,'projects',project.id);mkdirSync(join(root,'pages'),{recursive:true});mkdirSync(join(root,'assets'),{recursive:true});
 project.pages.forEach((p,i)=>writeFileSync(join(root,p.file),html(p,i)));
 writeFileSync(join(root,'project.json'),JSON.stringify(project,null,2));
 return join(root,'project.json');
}
/** 起服务 + 浏览器；projects 是要写进去的项目列表。 */
export async function startWorkbench(t,{projects=[v3Project()],viewport={width:1600,height:1000},html,prefix='vw-round12-editor-',serverOptions={}}={}){
 const dir=mkdtempSync(join(tmpdir(),prefix));let server,browser;
 t.after(async()=>{await browser?.close();if(server?.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
 const files=Object.fromEntries(projects.map(p=>[p.id,writeProject(dir,p,html)]));
 server=createServer({dataDir:dir,...serverOptions});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
 return {dir,page,errors,url,files,browser,server};
}
/** 从总览打开项目，等画布的 iframe 出现。 */
export async function openProject(page,id='demo'){
 await page.locator(`[data-action="open"][data-id="${id}"]`).click();
 await page.waitForSelector('#artboard > iframe');
}
/** 点 iframe 里的元素。画布的 iframe 被外层 CSS 缩放，Playwright 的 frameLocator 坐标不算缩放，这里自己换算。 */
export async function clickInFrame(page,selector,{button='left',at=null}={}){
 const outer=await page.locator('#artboard > iframe').evaluate(f=>{const r=f.getBoundingClientRect();return {x:r.left,y:r.top,scale:r.width/f.offsetWidth};});
 const frame=await (await page.$('#artboard > iframe')).contentFrame();
 const inner=await frame.locator(selector).first().evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};});
 const px=at?at.x:inner.w/2,py=at?at.y:inner.h/2;
 await page.mouse.click(outer.x+(inner.x+px)*outer.scale,outer.y+(inner.y+py)*outer.scale,{button});
}
/** 等浏览器真正画出新内容（两帧）。弹窗 / 菜单刚出现就点，Chromium 可能还按旧画面把点击送进下面的隔离 iframe。 */
export const painted=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
