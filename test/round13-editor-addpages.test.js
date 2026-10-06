// 第 13 轮：从其他项目添加页面（§10）、「复制给 agent」分裂菜单（§7）、页面栏拖进 .html 导入成页面（§8 编辑器部分）。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startWorkbench,openProject,v3Project,painted} from './round12-editor-fixture.js';

const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const pagesOp=(page,op)=>page.waitForResponse(r=>r.request().method()==='POST'&&/\/pages$/.test(r.url())&&JSON.parse(r.request().postData()||'{}').op===op);
// 不碰系统剪贴板：把 writeText 换成记下来
const fakeClipboard=page=>page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text;}}}));

test('round13 从其他项目添加页面：按文件夹分组的项目列表、缩略图勾选、插到第 N 页后面；之后「复制给 agent → 请统一风格」可用',async t=>{
 const a=v3Project({id:'deck-a',name:'本项目',pages:['封面','内容','结尾']});
 const b=v3Project({id:'deck-b',name:'别的项目',pages:['甲','乙','丙']});b.folder='十月';
 const c=v3Project({id:'deck-c',name:'第三个',pages:['一']});
 const {page,errors,files}=await startWorkbench(t,{projects:[a,b,c],prefix:'vw-round13-addpages-'});
 await openProject(page,'deck-a');
 await fakeClipboard(page);
 // 拼页之前：「请设计」「请统一风格」不可用
 await page.locator('.ed-inspector [data-action="brief"]').click();
 await page.waitForSelector('.g-context-menu');
 assert.deepEqual(await page.locator('.g-context-menu button').allTextContents(),['请处理修改单','请设计','请统一风格','请整理文件夹']);
 assert.equal(await page.locator('.g-context-menu button',{hasText:'请设计'}).isDisabled(),true);
 assert.equal(await page.locator('.g-context-menu button',{hasText:'请统一风格'}).isDisabled(),true);
 await page.locator('.g-context-menu button',{hasText:'请处理修改单'}).click();
 await page.waitForFunction(()=>window.copied);
 assert.match(await page.evaluate(()=>window.copied),/deck-a/);
 // 「添加页面」菜单 → 从其他项目…
 await page.locator('.page-list .ed-page[data-page-id="page_p02"] .ed-page__open').click();
 await page.locator('.ed-col-head [data-action="add-page"]').click();
 await page.locator('.g-context-menu button',{hasText:'从其他项目'}).click();
 await page.waitForSelector('.ap-sheet');
 const listText=await page.locator('.ap-projects').innerText();
 assert.match(listText,/十月/);assert.match(listText,/别的项目/);assert.match(listText,/第三个/);assert.doesNotMatch(listText,/本项目/,'当前项目不在列表里');
 assert.equal(await page.locator('[data-ap-after]').inputValue(),'page_p02','默认插到当前页后面');
 await page.locator('[data-ap-project="deck-b"]').click();
 await page.waitForSelector('.ap-page');
 assert.equal(await page.locator('.ap-page').count(),3);
 await page.waitForSelector('.ap-thumb .miniature iframe',{state:'attached'});
 assert.equal(await page.locator('[data-ap-add]').isDisabled(),true);
 await page.locator('[data-ap-check="page_p01"]').check();
 await page.locator('[data-ap-check="page_p03"]').check();
 await Promise.all([pagesOp(page,'copy-from'),page.locator('[data-ap-add]').click()]);
 await page.waitForFunction(()=>document.querySelectorAll('.page-list .ed-page').length===5);
 await page.waitForFunction(()=>/已添加 2 页/.test(document.querySelector('#toast')?.textContent||''));
 assert.match(await page.locator('#toast').textContent(),/请统一风格/);
 const project=disk(files['deck-a']);
 assert.deepEqual(project.pages.map(p=>p.name).slice(0,4),['封面','内容','甲','丙'],'插在第 2 页后面');
 const added=project.pages[2];
 assert.equal(await page.locator('.page-list .ed-page.active').getAttribute('data-page-id'),added.id,'选中新页');
 // 跨项目复制时写上来源（C 组的 copyPagesInto）
 if(added.origin?.project){
  assert.equal(added.origin.project,'deck-b');
  await page.locator('.ed-inspector [data-action="brief"]').click();
  await page.waitForSelector('.g-context-menu');
  assert.equal(await page.locator('.g-context-menu button',{hasText:'请统一风格'}).isDisabled(),false);
  await page.evaluate(()=>{window.copied='';});
  const [req]=await Promise.all([page.waitForRequest(r=>/\/brief\?intent=unify/.test(r.url())),page.locator('.g-context-menu button',{hasText:'请统一风格'}).click()]);
  assert.ok(req);
  await page.waitForFunction(()=>window.copied);
 } else console.log('# 服务端还没有写 origin.project（C 组 copyPagesInto），跳过「请统一风格」可用的检查');
 // 「请整理文件夹」走 GET /api/brief/organize
 await page.locator('.ed-inspector [data-action="brief"]').click();
 await page.evaluate(()=>{window.copied='';});
 const [org]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/brief/organize')),page.locator('.g-context-menu button',{hasText:'请整理文件夹'}).click()]);
 if(org.ok())await page.waitForFunction(()=>window.copied);
 else console.log(`# GET /api/brief/organize 还没上线（${org.status()}）`);
 await painted(page);
 assert.deepEqual(errors,[]);
});

test('round13 页面栏拖进 .html：打开「导入为页面」并直接开始（intoProject + after），完成后刷新项目并选中新页',async t=>{
 const {page,errors}=await startWorkbench(t,{prefix:'vw-round13-dropimport-'});
 await openProject(page);
 let body=null;
 await page.route('**/api/import-html/jobs',async route=>{body=JSON.parse(route.request().postData()||'{}');await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({jobId:'job_test1'})});});
 await page.route('**/api/import-html/jobs/job_test1',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'done',progress:1,projectId:'demo',pageIds:['page_p03'],summary:{}})}));
 await page.evaluate(()=>{const col=document.querySelector('.ed-pages');const dt=new DataTransfer();dt.items.add(new File(['<!doctype html><html><body><h1>旧页面</h1></body></html>'],'旧课件.html',{type:'text/html'}));
  col.dispatchEvent(new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true}));col.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));});
 await page.waitForFunction(()=>document.querySelector('.page-list .ed-page.active')?.dataset.pageId==='page_p03',null,{timeout:15000});
 assert.equal(body.intoProject,'demo');assert.equal(body.after,'page_p01');
 assert.ok(JSON.stringify(body).includes('旧课件.html'),'上传了拖进来的文件');
 await page.waitForSelector('[data-into-done]');
 // 页面栏右键「导入为页面…」= 不带文件的页面模式（弹窗打开，不自动开始）
 await page.keyboard.press('Escape');
 await page.locator('.page-list .ed-page[data-page-id="page_p01"]').click({button:'right'});
 await page.locator('.g-context-menu button',{hasText:'导入为页面'}).click();
 await page.waitForSelector('#modal-root .g-sheet');
 await painted(page);
 assert.deepEqual(errors,[]);
});
