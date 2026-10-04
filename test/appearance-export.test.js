import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {createServer} from './helpers/isolated-server.js';
import {launchBrowser} from '../src/browser.js';
import {exportHtml} from '../src/export/html.js';
import {exportImages,exportPdf} from '../src/export/images.js';
const now='2026-10-01T12:00:00.000Z';
function appearanceProject() {
 const base=(id,type,x)=>({id,type,x,y:20,width:60,height:60,zIndex:1,opacity:0.5,flipX:true,flipY:true});
 return {format:'visual-workbench/project',formatVersion:2,id:'appearance-demo',name:'外观',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:400,height:140},fonts:[],assets:[{id:'asset_logo01',kind:'image',file:'assets/logo.svg',name:'logo',pendingLayout:false,width:60,height:60,addedAt:now}],pages:[{id:'page_appear01',name:'外观',background:'#ffffff',elements:[{...base('el_text01','text',20),text:'Flip',fontSize:24,color:'#ff0000'},{...base('el_image01','image',100),asset:'asset_logo01',fit:'fill',tint:'#ff0000'},{...base('el_shape01','shape',180),shape:'rect',fill:'#ff0000'},{...base('el_group01','group',260),children:[{...base('el_child01','shape',0),y:0,shape:'rect',fill:'#ff0000',opacity:1,flipX:false,flipY:false}]}]}]};
}

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="30" height="60" fill="black"/></svg>';
test('appearance survives motion transforms, current base snapshots, offline and PNG export',{timeout:120000},async t=> {
 const dir=mkdtempSync(join(tmpdir(),'vw-appearance-'));const projectDir=join(dir,'projects/appearance-demo');mkdirSync(join(projectDir,'assets'),{recursive:true});writeFileSync(join(projectDir,'assets/logo.svg'),svg);
 const project=appearanceProject();writeFileSync(join(projectDir,'project.json'),JSON.stringify(project));
 const html=await exportHtml({projectDir,outFile:join(dir,'deck.html')});const source=readFileSync(html.file,'utf8');assert.match(source,/flipX/);assert.match(source,/data:image\/svg\+xml;base64/);
 const server=createServer({dataDir:dir});let browser;
 t.after(async()=>{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 browser=await launchBrowser();
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async project=> {
  const {renderPage,updateElementNode}=await import('/render.js');const {loadMotion}=await import('/motion-runtime.js');const {appearanceControls}=await import('/appearance-controls.js');
  const root=renderPage(project,project.pages[0],{assetBase:'/data/projects/appearance-demo'});document.body.replaceChildren(root);
  const styles=project.pages[0].elements.map(e=>{const n=root.querySelector(`[data-element-id="${e.id}"]`);return {opacity:n.style.opacity,flip:n.firstElementChild.style.transform};});
  const controller=new AbortController();project.pages[0].motion={steps:0,source:'export default async function(ctx){const e=ctx.element("el_image01");e.node.dataset.initialX=String(e.base.x);e.node.style.transform="translateX(12px)";return {}}'};let ctx=(await loadMotion(project,project.pages[0],root,controller.signal)).context;
  const before=ctx.element('el_image01').base;project.pages[0].elements[1].x=120;
  ctx=(await loadMotion(project,project.pages[0],root,controller.signal)).context;const current=ctx.element('el_image01');current.node.style.transform='translateX(12px)';
  updateElementNode(current.node,{...current.base,tint:'#00ff00'});
  const tint=current.node.querySelector('[data-vw-tint]').style.backgroundColor;
  const selected=project.pages[0].elements[2];const shape=root.querySelector('[data-element-id="el_shape01"]');
  for(let i=0;i<8;i++){const handle=document.createElement('i');handle.dataset.resize=String(i);shape.append(handle);}
  updateElementNode(shape,{...selected,flipX:false,flipY:false});updateElementNode(shape,selected);
  const handleCount=shape.querySelectorAll(':scope > [data-resize]').length;
  const unflipped=renderPage(project,{...project.pages[0],elements:[{...selected,flipX:false,flipY:false}]});const fresh=unflipped.querySelector('[data-element-id]');
  for(let i=0;i<8;i++){const handle=document.createElement('i');handle.dataset.resize=String(i);fresh.append(handle);}
  updateElementNode(fresh,selected);const freshHandles=fresh.querySelectorAll(':scope > [data-resize]').length;current.node.style.transform='translateX(12px)';
  const patches=[];const controls=appearanceControls(project.pages[0].elements,{change:p=>patches.push(p),commit:p=>patches.push(p)});const slider=controls.querySelector('input');slider.value='0.2';slider.dispatchEvent(new Event('input'));slider.dispatchEvent(new Event('change'));controls.querySelector('button').click();
  return {initializedX:current.node.dataset.initialX,handleCount,freshHandles,styles,before:before.x,after:current.base.x,baseFlip:current.base.flipX,flip:current.node.firstElementChild.style.transform,tint,childFound:!!ctx.element('el_child01').node,patches};
 },project);
 assert.equal(result.initializedX,'120');assert.equal(result.handleCount,8);assert.equal(result.freshHandles,8);assert.ok(result.styles.every(s=>s.opacity==='0.5'&&s.flip==='scale(-1, -1)'));assert.equal(result.before,100);assert.equal(result.after,120);assert.equal(result.baseFlip,true);assert.equal(result.flip,'scale(-1, -1)');assert.equal(result.tint,'rgb(0, 255, 0)');assert.equal(result.childFound,true);assert.deepEqual(result.patches,[{opacity:0.2},{opacity:0.2},{flipX:false},{flipX:false}]);
 const offline=await browser.newPage({viewport:{width:400,height:140}});const blocked=[];await offline.route('**/*',route=> /^(file|data|blob):/.test(route.request().url())?route.continue():(blocked.push(route.request().url()),route.abort()));await offline.goto(pathToFileURL(html.file).href);await offline.waitForSelector('#vw-stage [data-vw-flip]');
 const output=await exportImages({projectDir,outDir:join(dir,'images')});
 // Compare artboard pixels without the playback UI counter overlay.
 assert.equal(await offline.locator('#vw-counter').textContent(),'1 / 1');
 assert.equal(await offline.locator('#vw-counter').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0.4)');
 const shot=await offline.locator('#vw-stage .vw-artboard').screenshot({style:'#vw-counter, #vw-toast { visibility: hidden !important; }'});const image=readFileSync(output.files[0].path);
 const raw=await sharp(shot).removeAlpha().raw().toBuffer({resolveWithObject:true});const exported=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(raw.info.width,400);assert.deepEqual(raw.data,exported.data);assert.deepEqual(blocked,[]);
 // Flipped asymmetric image occupies right half, with opacity composited against white.
 const pixel=(x,y)=>[...raw.data.subarray((y*400+x)*3,(y*400+x)*3+3)];assert.deepEqual(pixel(110,40),[255,255,255]);assert.ok(pixel(150,40)[1]>=125&&pixel(150,40)[1]<=130);
 const pdf=await exportPdf({projectDir,outFile:join(dir,'appearance.pdf')});assert.ok(readFileSync(pdf.file).subarray(0,5).equals(Buffer.from('%PDF-')));assert.ok(pdf.bytes>0);
});
