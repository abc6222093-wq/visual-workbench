import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchBrowser} from '../src/browser.js';
import {createServer} from './helpers/isolated-server.js';

async function open(t) {
  const dir=mkdtempSync(join(tmpdir(),'vw-sidebar-'));
  cpSync(new URL('../examples/sample-deck/',import.meta.url),join(dir,'projects/sample-deck'),{recursive:true,filter:name=>!String(name).includes('/versions')});
  const file=join(dir,'projects/sample-deck/project.json'),project=JSON.parse(readFileSync(file,'utf8'));
  project.pages[0].name='这是一个在缩略页面栏中无法完整显示的非常长的中文页面标题';
  writeFileSync(file,JSON.stringify(project));
  const server=createServer({dataDir:dir});let browser;
  t.after(async()=>{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function enter(){await page.goto(url);await page.locator('[data-action="open"][data-id="sample-deck"]').click();await page.waitForSelector('#artboard [data-element-id="el_title1"]');}
  await enter();return {page,enter,errors,name:project.pages[0].name};
}

test('左右面板独立折叠并持久化，同时折叠增加画布宽度',async t=>{
  const {page,enter,errors}=await open(t);
  const left=()=>page.locator('[data-action="toggle-pages"]'),right=()=>page.locator('[data-action="toggle-inspector"]');
  const width=()=>page.locator('#canvas-well').evaluate(n=>n.getBoundingClientRect().width);
  const collapsed=()=>page.locator('.ed-grid').evaluate(n=>({left:n.classList.contains('is-pages-collapsed'),right:n.classList.contains('is-inspector-collapsed')}));
  const initial=await width();assert.deepEqual(await collapsed(),{left:false,right:false});
  await left().click();assert.deepEqual(await collapsed(),{left:true,right:false});const leftWidth=await width();assert.ok(leftWidth>initial);
  await enter();assert.deepEqual(await collapsed(),{left:true,right:false});
  await left().click();await right().click();assert.deepEqual(await collapsed(),{left:false,right:true});
  await enter();assert.deepEqual(await collapsed(),{left:false,right:true});
  await left().click();assert.deepEqual(await collapsed(),{left:true,right:true});assert.ok(await width()>leftWidth);
  assert.deepEqual(await page.evaluate(()=>({left:localStorage.getItem('vw-pages-collapsed'),right:localStorage.getItem('vw-inspector-collapsed')})),{left:'true',right:'true'});
  await enter();assert.deepEqual(await collapsed(),{left:true,right:true});
  await left().click();await right().click();assert.deepEqual(await collapsed(),{left:false,right:false});assert.deepEqual(errors,[]);
});

test('页面列表为长标题提供完整提示',async t=>{
  const {page,name}=await open(t),button=page.locator('.ed-page__open').first();
  assert.equal(await button.getAttribute('title'),name);
  assert.equal(await page.locator('.ed-crumb').getAttribute('title'),name);
});
