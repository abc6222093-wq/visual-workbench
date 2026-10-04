import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeBounds, resizeGroup } from '../web/editor.js';

const point = (b, x, y) => {
  const a = (b.rotation || 0)*Math.PI/180;
  return [b.x+b.width/2+x*b.width/2*Math.cos(a)-y*b.height/2*Math.sin(a),
    b.y+b.height/2+x*b.width/2*Math.sin(a)+y*b.height/2*Math.cos(a)];
};
for (const type of ['text','image','shape','group']) {
  for (const edge of ['nw','n','ne','e','se','s','sw','w']) {
    test(`${type} ${edge} resize fixes opposite edge at every rotation`, () => {
      for (const rotation of [0,30,90,147,270]) {
        const old = { type, x:10,y:20,width:200,height:120,rotation };
        const frozen = structuredClone(old);
        const b = { ...old, ...resizeBounds(old,edge,25,-17) };
        const ax = edge.includes('w') ? 1 : edge.includes('e') ? -1 : 0;
        const ay = edge.includes('n') ? 1 : edge.includes('s') ? -1 : 0;
        const before=point(old,ax,ay), after=point(b,ax,ay);
        before.forEach((value,i)=>assert.ok(Math.abs(value-after[i])<1e-8));
        if (edge==='n'||edge==='s') assert.equal(b.width,old.width);
        if (edge==='e'||edge==='w') assert.equal(b.height,old.height);
        assert.deepEqual(old,frozen);
      }
    });
  }
}
test('group edge resize scales descendants on one axis only', () => {
  const old={type:'group',x:0,y:0,width:100,height:100,children:[{type:'shape',x:10,y:20,width:30,height:40}]};
  const next=structuredClone(old), b=resizeBounds(old,'e',50,70);
  resizeGroup(next,old,b.width,b.height); Object.assign(next,b);
  assert.deepEqual(next.children[0],{type:'shape',x:15,y:20,width:45,height:40});
});
test('zero crossing clamps size and preserves the anchor',()=>{
  const old={x:10,y:20,width:30,height:40,rotation:30};
  const next={...old,...resizeBounds(old,'nw',1000,1000)};
  assert.equal(next.width,0); assert.equal(next.height,0);
  point(old,1,1).forEach((value,i)=>assert.ok(Math.abs(value-point(next,1,1)[i])<1e-8));
});

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
async function browserEditor(t) {
  const dir=mkdtempSync(join(tmpdir(),'vw-round6-editor-'));
  cpSync(new URL('../examples/sample-deck/',import.meta.url),join(dir,'projects/sample-deck'),{recursive:true});
  const file=join(dir,'projects/sample-deck/project.json');
  const project=JSON.parse(readFileSync(file,'utf8'));
  project.pages[0].motion={steps:1,source:`export default ctx => {const node=ctx.element('el_title1').node;node.style.opacity='0';return {step(){node.style.opacity='1'}}}`};
  project.pages[1].motion={steps:0,source:'export default () => ({})'};
  writeFileSync(file,JSON.stringify(project));
  const server=createServer({dataDir:dir});
  t.after(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const browser=await launchBrowser();t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard');
  return {page,file,project};
}
test('screen 1 matches playback initialization, later screens run steps without changing data',async t=>{
  const {page,file,project}=await browserEditor(t);const before=readFileSync(file,'utf8');
  await page.locator('[data-step-view]').selectOption('-1');
  await page.waitForSelector('#artboard[data-step-shown="-1"]');
  const opacity=await page.locator('#artboard [data-element-id="el_title1"]').evaluate(n=>getComputedStyle(n).opacity);
  const playbackOpacity=await page.evaluate(async project=>{
    const {renderPage}=await import('/render.js'),{createPlayback}=await import('/playback.js');
    const root=renderPage(project,project.pages[0],{assetBase:'/data/projects/sample-deck'});document.body.append(root);
    const run=createPlayback(project,project.pages[0],{root,assetBase:'/data/projects/sample-deck'});await run.ready;
    const value=getComputedStyle(root.querySelector('[data-element-id="el_title1"]')).opacity;await run.destroy();root.remove();return value;
  },project);
  assert.equal(opacity,playbackOpacity);assert.equal(opacity,'0');
  await page.locator('[data-step-view]').selectOption('1');await page.waitForSelector('#artboard[data-step-shown="1"]');
  assert.equal(await page.locator('#artboard [data-element-id="el_title1"]').evaluate(n=>getComputedStyle(n).opacity),'1');
  await page.locator('[data-step-view]').selectOption('0');
  assert.equal(readFileSync(file,'utf8'),before);
  await page.locator(`[data-action="switch"][data-id="${project.pages[1].id}"]`).click();
  assert.deepEqual(await page.locator('[data-step-view] option').allTextContents(),['全部显示','第 1 屏']);
});
test('inspector collapse enlarges canvas, persists refresh, and survives focus mode',async t=>{
  const {page}=await browserEditor(t);
  const width=await page.locator('#canvas-well').evaluate(n=>n.clientWidth);
  await page.locator('[data-action="toggle-inspector"]').click();
  assert.ok(await page.locator('#canvas-well').evaluate(n=>n.clientWidth)>width);
  assert.equal(await page.locator('[data-action="toggle-inspector"]').getAttribute('aria-expanded'),'false');
  await page.locator('[data-action="focus"]').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-action="toggle-inspector"]').getAttribute('aria-expanded'),'false');
  await page.reload();await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  assert.equal(await page.locator('[data-action="toggle-inspector"]').getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.ed-crumb').getAttribute('title'),await page.locator('.ed-crumb').textContent());
});
// 第 10 轮起文字框高度由内容决定、没有上下把手，这里改用图片元素验证全部八个把手
test('all eight canvas handles resize in place with edge axis constraints',async t=>{
  const {page,file}=await browserEditor(t);
  for(const edge of ['nw','n','ne','e','se','s','sw','w']) {
    await page.locator('[data-action="select"][data-id="el_logo1"]').click();
    assert.equal(await page.locator('[data-resize="el_logo1"]').count(),8);
    const old=JSON.parse(readFileSync(file,'utf8')).pages[0].elements.find(e=>e.id==='el_logo1');
    const handle=await page.locator(`[data-resize="el_logo1"][data-handle="${edge}"]`).boundingBox();
    await page.evaluate(()=>window.dragOriginal=document.querySelector('#artboard [data-element-id="el_logo1"]'));
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
    await page.mouse.move(handle.x+handle.width/2+12,handle.y+handle.height/2+10);
    assert.equal(await page.evaluate(()=>window.dragOriginal===document.querySelector('#artboard [data-element-id="el_logo1"]')),true);
    await Promise.all([page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok()),page.mouse.up()]);
    const next=JSON.parse(readFileSync(file,'utf8')).pages[0].elements.find(e=>e.id==='el_logo1');
    if(edge==='n'||edge==='s') assert.equal(next.width,old.width);else assert.notEqual(next.width,old.width);
    if(edge==='e'||edge==='w') assert.equal(next.height,old.height);else assert.notEqual(next.height,old.height);
  }
});
