import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

async function open(t) {
  const dir=mkdtempSync(join(tmpdir(),'vw-outline-ui-'));
  cpSync(new URL('../examples/sample-deck/',import.meta.url),join(dir,'projects/sample-deck'),{recursive:true,filter:name=>!String(name).includes('/versions')});
  const server=createServer({dataDir:dir});
  let browser;
  t.after(async()=>{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async()=>{
    const {mountOutlineView}=await import('/outline-view.js');
    const project=(await (await fetch('/api/projects/sample-deck')).json()).project;
    project.pages=project.pages.slice(0,2);
    project.pages[0].outline={screens:2,notes:'',images:[],rows:[{id:'row_testing',role:'title',text:'<hello> world',emphasis:[],from:1,until:null}]};
    const host=document.createElement('div');host.id='outline-test';host.className='outline-host';document.querySelector('#app').replaceChildren(host);
    window.outlineTest={project,calls:[]};
    window.outlineTest.view=mountOutlineView({host,getProject:()=>project,mutate:fn=>fn(project),getRevision:()=> 'rev',flush:async()=>{window.outlineTest.calls.push('flush');},request:async(suffix,method,body)=>{window.outlineTest.calls.push({suffix,method,body});return {text:'brief'};},acceptResult:async()=>{},assetBase:'/data/projects/sample-deck',notice:message=>window.outlineTest.message=message});
  });
  return page;
}
test('大纲：角色、文字选择强调安全呈现，编辑保留选区和已有强调',async t=>{
  const page=await open(t),row=page.locator('[data-outline-row="row_testing"]'),textarea=row.locator('textarea');
  assert.deepEqual(await row.locator('select option').allTextContents(),['大标题','小标题','英文副标题','正文','注释']);
  await textarea.evaluate(n=>{n.focus();n.setSelectionRange(1,6);});
  await row.locator('[data-outline-action="emphasis"]').click();
  assert.equal(await row.locator('mark').textContent(),'hello');
  assert.equal(await row.locator('.outline-marked').textContent(),'<hello> world');
  assert.equal(await row.locator('.outline-marked hello').count(),0);
  await textarea.press('End');await textarea.press('!');
  assert.equal(await row.locator('mark').textContent(),'hello');
  assert.equal(await textarea.evaluate(n=>document.activeElement===n),true);
});
test('大纲：勾选跨重绘保留，新增屏继承文字，消失可恢复，复制先保存',async t=>{
  const page=await open(t),card=page.locator('[data-outline-page]').first();
  await card.locator('[data-outline-check]').check();
  await card.locator('[data-outline-action="screen-add"]').click();
  assert.equal(await card.locator('[data-outline-check]').isChecked(),true);
  assert.equal(await card.locator('[data-outline-screen]').inputValue(),'3');
  assert.equal(await card.locator('[data-outline-row]').count(),1);
  await card.locator('[data-outline-action="disappear"]').click();
  assert.equal(await card.locator('[data-outline-action="disappear"]').textContent(),'恢复显示');
  await card.locator('[data-outline-action="disappear"]').click();
  assert.equal(await page.evaluate(()=>window.outlineTest.project.pages[0].outline.rows[0].until),null);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}}));
  await page.locator('[data-outline-action="copy-selected"]').click();
  const calls=await page.evaluate(()=>window.outlineTest.calls);
  assert.equal(calls[0],'flush');assert.match(calls[1].suffix,/outline\/brief\?pageIds=page_/);
});
test('大纲提取：运行初始化和各步，尊重祖先 opacity，清理离屏节点',async t=>{
  const page=await open(t);
  const result=await page.evaluate(async()=>{
    const {captureOutlinePage}=await import('/outline-capture.js');
    const p=structuredClone(window.outlineTest.project),page=p.pages[0];
    const text=page.elements.find(e=>e.type==='text');
    page.elements=[{id:'el_groupcapture',type:'group',x:0,y:0,width:800,height:600,rotation:0,opacity:1,zIndex:0,children:[text]}];
    page.motion={steps:2,source:`export default ctx=>{const n=ctx.element('el_groupcapture').node;n.style.opacity='0';return {step(i){n.style.opacity=i===0?'1':'0';}}}`};
    const frames=await captureOutlinePage(p,page,'/data/projects/sample-deck');
    const {nodeIsVisible}=await import('/outline-capture.js');
    const parent=document.createElement('div'),child=document.createElement('div'); parent.style.visibility='hidden';child.style.visibility='visible';parent.append(child);document.body.append(parent);const overrideVisible=nodeIsVisible(child,parent);parent.remove();
    return {overrideVisible,visible:frames.map(f=>f[0].visible),text:frames[0][0].text,holders:[...document.body.children].filter(n=>n.style.left==='-100000px').length};
  });
  assert.equal(result.overrideVisible,true);assert.deepEqual(result.visible,[false,true,false]);assert.equal(result.holders,0);assert.ok(result.text);
});

test('大纲强调范围：前方插入移动范围，末尾追加保留范围，删除选中字去掉空范围',async()=>{
  const {adjustEmphasis,markedText}=await import('../web/outline-view.js');
  assert.deepEqual(adjustEmphasis('hello world','xx hello world',[{start:6,end:11}]),[{start:9,end:14}]);
  assert.deepEqual(adjustEmphasis('hello world','hello world!',[{start:0,end:5}]),[{start:0,end:5}]);
  assert.deepEqual(adjustEmphasis('hello world','hello ',[{start:6,end:11}]),[]);
  assert.deepEqual(adjustEmphasis('abcdef','aXXXXf',[{start:0,end:2},{start:4,end:6}]),[{start:0,end:6}]);
  assert.equal(markedText({text:'<script>"x"</script>',emphasis:[{start:1,end:7}]}),'&lt;<mark>script</mark>&gt;&quot;x&quot;&lt;/script&gt;');
});
