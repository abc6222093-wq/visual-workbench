import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { launchBrowser } from '../src/browser.js';

async function open(t, legacy=false, motion=false) {
  const dir=mkdtempSync(join(tmpdir(),'vw-document-acceptance-')), file=join(dir,'projects/sample-deck/project.json');
  cpSync(new URL('../examples/sample-deck/',import.meta.url),join(dir,'projects/sample-deck'),{recursive:true,filter:p=>!String(p).includes('/versions')});
  const original=JSON.parse(readFileSync(file,'utf8'));
  original.pages[0].elements=original.pages[0].elements.filter(e=>e.type==='text').slice(0,2);
  original.pages[0].elements.push({...structuredClone(original.pages[0].elements[0]),id:'el_decoration',text:'DECORATIVE',decorative:true});
  delete original.pages[0].motion;
  if(motion) original.pages[0].motion={steps:1,source:"export default ctx=>{const n=ctx.element('el_subtitle1').node;n.style.opacity='0';return {step(){n.style.opacity='1';}}}"};
  if(legacy) original.pages[0].outline={screens:2,notes:'旧备注',images:[],rows:[{id:'row_legacy',role:'title',text:'旧大纲保留文案',emphasis:[],from:1,until:null}]};
  writeFileSync(file,JSON.stringify(original));
  const server=createServer({dataDir:dir});let browser;
  t.after(async()=>{await browser?.close();if(server.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await launchBrowser();const p=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin);await p.locator('[data-action="open"][data-id="sample-deck"]').click();
  await p.locator('[data-action="tab-outline"]').click();await p.waitForSelector('[data-outline-document]');
  return {p,file,original,origin,errors};
}
const waitSaved=async p=>{await p.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');};
const disk=file=>JSON.parse(readFileSync(file,'utf8'));

test('document panel: live bidirectional text, independent paragraphs, deletion, history, metadata and current page',async t=>{
  const {p,file,original,errors}=await open(t);
  const doc=p.locator('[data-outline-document]');
  assert.equal(await p.locator('[data-action="toggle-outline"]').count(),0);
  assert.equal(await p.locator('.ed-inspector [data-action="versions"]').count(),0);
  assert.ok(!(await doc.inputValue()).includes('DECORATIVE'));
  const old=original.pages[0].elements[0],second=original.pages[0].elements[1];
  await doc.fill(`改好的标题\n\n${second.text}`);
  await p.waitForFunction(()=>document.querySelector('#artboard [data-element-id="el_title1"]').textContent==='改好的标题');
  await waitSaved(p);assert.deepEqual(disk(file).pages[0].elements[0],{...old,text:'改好的标题'});
  // Highlight does not change any canvas data.
  const beforeEmphasis=disk(file).pages[0].elements;
  await doc.evaluate(e=>{e.focus();e.setSelectionRange(0,2);e.dispatchEvent(new Event('select'));});
  await p.locator('[data-outline-action="emphasis"]').click();await waitSaved(p);
  assert.deepEqual(disk(file).pages[0].elements,beforeEmphasis);
  assert.equal(await p.locator('.outline-document-overlay mark').textContent(),'改好');
  await p.locator('[data-outline-action="emphasis"]').click();await waitSaved(p);
  assert.equal(await p.locator('.outline-document-overlay mark').count(),0);
  // Body newlines retain one element; blank line adds another independent element.
  await doc.fill(`改好的标题\n\n${second.text}\n\n新正文第一行\n第二行\n\n独立注释`);await waitSaved(p);
  let project=disk(file),paragraph=project.pages[0].elements.find(e=>e.text==='新正文第一行\n第二行');
  assert.ok(paragraph);assert.ok(project.pages[0].elements.some(e=>e.text==='独立注释'));
  assert.equal(project.pages[0].outline.rows.length,4);
  await p.locator('[data-action="undo"]').click();await p.waitForSelector('[data-outline-document]');
  assert.ok(!(await doc.inputValue()).includes('新正文'));
  await p.locator('[data-action="redo"]').click();await p.waitForSelector('[data-outline-document]');
  assert.ok((await doc.inputValue()).includes('新正文'));
  // Canvas property editing updates its mapped document, with no extraction step.
  await p.locator('[data-action="tab-layers"]').click();
  await p.locator(`[data-action="select"][data-id="${old.id}"]`).click();
  await p.locator('[data-prop="text"]').fill('画布改字');await p.locator('[data-prop="text"]').press('Tab');
  await p.locator('[data-action="tab-outline"]').click();assert.ok((await doc.inputValue()).startsWith('画布改字'));
  // Delete a document paragraph, then a canvas element.
  await doc.fill(`画布改字\n\n${second.text}\n\n独立注释`);await waitSaved(p);
  assert.ok(!disk(file).pages[0].elements.some(e=>e.id===paragraph.id));
  await p.locator('[data-action="tab-layers"]').click();await p.locator(`[data-action="select"][data-id="${old.id}"]`).click();await p.locator('[data-action="delete"]').click();
  await p.locator('[data-action="tab-outline"]').click();assert.ok(!(await doc.inputValue()).includes('画布改字'));
  await waitSaved(p);
  await p.locator('[data-action="switch"][data-id="page_scene2"]').click();await p.waitForSelector('[data-outline-document]');
  assert.ok(!(await doc.inputValue()).includes('独立注释'));
  await p.locator('[data-action="switch"][data-id="page_cover1"]').click();await p.waitForSelector('[data-outline-document]');
  assert.ok((await doc.inputValue()).includes('独立注释'));
  // Screen controls share the toolbar; only-one-screen deletion preserves content.
  await p.locator('[data-outline-action="screen-add"]').click();
  assert.equal(await p.locator('[data-step-view]').inputValue(),'1');
  assert.ok((await p.locator('.outline-motion-warning').textContent()).includes('agent'));
  await p.locator('[data-outline-action="screen-delete"][data-screen="2"]').click();
  assert.equal(await p.locator('[data-step-view]').inputValue(),'-1');
  await p.locator('[data-outline-action="screen-delete"][data-screen="1"]').click();
  assert.ok((await doc.inputValue()).includes('独立注释'));
  assert.equal(await p.locator('[data-outline-action="screen-delete"]').count(),1);
  assert.deepEqual(errors,[]);
});

test('legacy outline conversion automatically versions first and keeps unmapped pending text',async t=>{
  const {p,file,origin,errors}=await open(t,true);await waitSaved(p);
  assert.ok((await p.locator('[data-outline-document]').inputValue()).includes('旧大纲保留文案'));
  const project=disk(file);assert.equal(project.pages[0].outline.mode,'document');
  assert.equal(project.pages[0].outline.notes,'旧备注');
  assert.ok(project.pages[0].elements.some(e=>e.text==='旧大纲保留文案'));
  const versions=await(await fetch(`${origin}/api/projects/sample-deck/versions`)).json();assert.equal(versions.length,1);
  // Agent writes to the same project file; a non-focused panel receives the update.
  await p.locator('[data-outline-notes]').focus();await p.locator('[data-outline-notes]').press('Tab');
  project.pages[0].elements.find(e=>e.id==='el_title1').text='agent 新文案';
  project.pages[0].outline.rows.find(r=>r.elementId==='el_title1').text='agent 新文案';
  writeFileSync(file,JSON.stringify(project));
  await p.waitForFunction(()=>document.querySelector('[data-outline-document]')?.value.includes('agent 新文案'));
  assert.deepEqual(errors,[]);
});


test('existing motion seeds document visibility and toolbar changes the displayed paragraphs',async t=>{
  const {p,file,errors}=await open(t,false,true);
  await waitSaved(p);
  const cover=disk(file).pages[0];
  assert.deepEqual(cover.outline.rows.find(r=>r.elementId==='el_subtitle1').visibleOn,[2]);
  await p.locator('[data-step-view]').selectOption('-1');
  await p.waitForSelector('#artboard[data-step-shown="-1"]');
  assert.ok(!(await p.locator('[data-outline-document]').inputValue()).includes(cover.elements[1].text));
  await p.locator('[data-outline-action="screen"][data-screen="2"]').click();
  assert.equal(await p.locator('[data-step-view]').inputValue(),'1');
  assert.ok((await p.locator('[data-outline-document]').inputValue()).includes(cover.elements[1].text));
  const before=readFileSync(file,'utf8');
  await p.locator('[data-step-view]').selectOption('0');
  assert.equal(readFileSync(file,'utf8'),before,'screen selection alone never changes the project');
  assert.deepEqual(errors,[]);
});
