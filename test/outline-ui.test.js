import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

async function open(t) {
  const dir=mkdtempSync(join(tmpdir(),'vw-outline-panel-'));
  cpSync(new URL('../examples/sample-deck/',import.meta.url),join(dir,'projects/sample-deck'),{recursive:true,filter:name=>!String(name).includes('/versions')});
  const server=createServer({dataDir:dir});let browser;
  t.after(async()=>{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').waitFor();
  await page.evaluate(async()=>{
    const {mountOutlinePanel}=await import('/outline-panel.js');
    const project=(await (await fetch('/api/projects/sample-deck')).json()).project;
    project.pages=project.pages.slice(0,2);
    project.pages[0].elements=[];
    project.pages[0].outline={mode:'document',screens:2,notes:'',images:[],rows:[{id:'row_testing',role:'title',text:'<hello> world',emphasis:[],from:1,until:null},{id:'row_body',role:'body',text:'第一行\n第二行',emphasis:[],from:1,until:null}]};
    project.pages[1].outline={mode:'document',screens:1,notes:'第二页备注',images:[],rows:[{id:'row_other',role:'body',text:'第二页',emphasis:[],from:1,until:null}]};
    for (const p of project.pages) p.elements=p.outline.rows.map((r,i)=>{r.elementId=`el_test${i}_${p.id}`;return {id:r.elementId,type:'text',text:r.text,x:0,y:i*100,width:500,height:80,font:null,fontSize:28,fontWeight:400,lineHeight:1.4,color:'#111111',zIndex:i};});
    const host=document.createElement('div');host.id='outline-test';host.style.width='320px';document.querySelector('#app').replaceChildren(host);
    const state=window.outlineTest={project,calls:[],pageIndex:0,screen:1};
    state.view=mountOutlinePanel({host,getProject:()=>project,getPage:()=>project.pages[state.pageIndex],getScreen:()=>state.screen,setScreen:s=>{state.screen=s;},mutate:(fn,meta)=>{state.calls.push(meta.kind);return fn(project,project.pages[state.pageIndex]);},flush:async()=>{state.calls.push('flush');},request:async suffix=>{state.calls.push(suffix);return {text:'brief'};},openLibrary:async()=>({id:'asset_test',name:'参考图'}),notice:message=>state.message=message});
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{state.copied=text;}}});
  });return page;
}

test('文稿面板：单一自动高度文稿，选区强调安全呈现且保留焦点',async t=>{
  const page=await open(t),editor=page.locator('[data-outline-document]');
  assert.equal(await page.locator('.outline-document-box textarea').count(),1);
  assert.deepEqual(await page.locator('[data-outline-role] option').allTextContents(),['大标题','小标题','英文副标题','正文','注释']);
  const bounds=await page.evaluate(()=>({doc:document.querySelector('.outline-document-box').getBoundingClientRect().bottom,tools:document.querySelector('.outline-panel-controls').getBoundingClientRect().top}));
  assert.ok(bounds.tools>=bounds.doc);
  await editor.evaluate(n=>{n.focus();n.setSelectionRange(1,6);n.dispatchEvent(new Event('select'));});
  await page.locator('[data-outline-action="emphasis"]').click();
  assert.equal(await page.locator('.outline-document-overlay mark').textContent(),'hello');
  assert.equal(await page.locator('.outline-document-overlay hello').count(),0);
  assert.deepEqual(await editor.evaluate(n=>({focus:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd})),{focus:true,start:1,end:6});
  assert.equal(await page.evaluate(()=>window.outlineTest.calls.at(-1)),'metadata');
  await editor.fill(Array.from({length:30},(_,i)=>`段落${i}`).join('\n\n'));
  assert.ok(await editor.evaluate(n=>n.clientHeight>500&&n.scrollHeight<=n.clientHeight+2));
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length),30);
});

test('文稿面板：正文单回车保留段落，标题回车另起段，中文合成不提前分段',async t=>{
  const page=await open(t),editor=page.locator('[data-outline-document]');
  await editor.evaluate(n=>{n.focus();n.setSelectionRange(n.value.length,n.value.length);n.dispatchEvent(new Event('select'));});
  await editor.press('Enter');await editor.press('x');
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length),2);
  assert.match(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows[1].text),/第二行\nx$/);
  await editor.evaluate(n=>{n.focus();n.setSelectionRange(13,13);n.dispatchEvent(new Event('select'));});
  await editor.press('Enter');await page.keyboard.insertText('新');
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length),3);
  const count=await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length);
  await editor.evaluate(n=>{n.dispatchEvent(new CompositionEvent('compositionstart'));n.value+='\n\n中文';n.dispatchEvent(new InputEvent('input',{isComposing:true,data:'中文'}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));});
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length),count);
  await editor.evaluate(n=>n.dispatchEvent(new CompositionEvent('compositionend',{data:'中文'})));
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.length),count+1);
});

test('文稿面板：屏幕与页面切换、消失行不参与编辑、图片备注与复制',async t=>{
  const page=await open(t),editor=page.locator('[data-outline-document]');
  await editor.evaluate(n=>{n.focus();n.setSelectionRange(0,0);n.dispatchEvent(new Event('select'));});
  await page.locator('[data-outline-action="disappear"]').click();
  assert.equal(await editor.inputValue(),'第一行\n第二行');
  await editor.fill('第一行已改');
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.find(r=>r.id==='row_testing').text),'<hello> world');
  await page.locator('[data-outline-action="screen-add"]').click();
  assert.equal(await page.evaluate(()=>window.outlineTest.screen),3);
  assert.equal(await page.locator('[data-outline-action="screen-delete"]').count(),3);
  await page.locator('[data-outline-action="screen-delete"][data-screen="2"]').click();
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.screens),2);
  await page.locator('[data-outline-action="add-image"]').click();
  await page.locator('[data-outline-caption]').fill('图片的要求');
  await page.locator('[data-outline-notes]').fill('页面要求');
  await page.locator('[data-outline-action="copy-current"]').click();
  const calls=await page.evaluate(()=>window.outlineTest.calls);assert.equal(calls.at(-2),'flush');assert.match(calls.at(-1),/^\/outline\/brief\?pageIds=/);
  await page.evaluate(()=>{window.outlineTest.pageIndex=1;window.outlineTest.screen=null;window.outlineTest.view.refresh();});
  assert.equal(await editor.inputValue(),'第二页');assert.equal(await page.locator('[data-outline-notes]').inputValue(),'第二页备注');
  await page.evaluate(()=>window.outlineTest.view.dispose());assert.equal(await editor.count(),0);
});

test('空文稿可先选角色，新段落采用该角色而后回车默认正文',async t=>{
  const page=await open(t),editor=page.locator('[data-outline-document]');
  await editor.fill('');
  await page.locator('[data-outline-role]').selectOption('title');
  await editor.fill('新的标题');
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows[0].role),'title');
  await editor.press('End');await editor.press('Enter');await page.keyboard.insertText('正文');
  assert.deepEqual(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.map(r=>r.role)),['title','body']);
});

test('文稿格式：换行标准化及强调不解释 HTML',async()=>{
  const {normalizeDocumentText,markedText}=await import('../web/outline-panel.js');
  assert.equal(normalizeDocumentText('标题\r\n\r\n正文\r下一行'),'标题\n\n正文\n下一行');
  assert.equal(markedText({text:'<script>"x"</script>',emphasis:[{start:1,end:7}]}),'&lt;<mark>script</mark>&gt;&quot;x&quot;&lt;/script&gt;');
});

test('旧大纲提取仍支持祖先可见性和清理离屏节点',async t=>{
  const page=await open(t);
  const result=await page.evaluate(async()=>{
    const {captureOutlinePage}=await import('/outline-capture.js');
    const p=structuredClone(window.outlineTest.project),sample=(await (await fetch('/api/projects/sample-deck')).json()).project.pages[0],page=p.pages[0];
    const text=sample.elements.find(e=>e.type==='text');
    page.elements=[{id:'el_groupcapture',type:'group',x:0,y:0,width:800,height:600,rotation:0,opacity:1,zIndex:0,children:[text]}];
    page.motion={steps:2,source:`export default ctx=>{const n=ctx.element('el_groupcapture').node;n.style.opacity='0';return {step(i){n.style.opacity=i===0?'1':'0';}}}`};
    const frames=await captureOutlinePage(p,page,'/data/projects/sample-deck');
    return {visible:frames.map(f=>f[0].visible),holders:[...document.body.children].filter(n=>n.style.left==='-100000px').length};
  });assert.deepEqual(result.visible,[false,true,false]);assert.equal(result.holders,0);
});


test('新段空行和选区在点下方角色框后保留，屏按钮不会在失焦时丢失点击',async t=>{
  const page=await open(t),editor=page.locator('[data-outline-document]');
  await editor.fill('');await page.locator('[data-outline-role]').selectOption('title');
  await editor.fill('标题');await editor.press('End');await editor.press('Enter');
  assert.equal(await editor.inputValue(),'标题\n\n');
  await page.locator('[data-outline-role]').selectOption('note');
  assert.equal(await editor.inputValue(),'标题\n\n');
  await editor.focus();await page.keyboard.insertText('注释');
  assert.deepEqual(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows.map(r=>r.role)),['title','note']);
  await page.locator('[data-outline-action="screen-add"]').click();
  assert.equal(await page.evaluate(()=>window.outlineTest.screen),3);
});
