import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../src/server.js';
import {launchBrowser} from '../src/browser.js';
import {initDataDir} from '../src/data-dir.js';
test('数据文件夹设置显示来源，拒绝无效路径，保存后提示重启',async t=>{
 const root=mkdtempSync(join(tmpdir(),'vw-settings-ui-')),dataDir=join(root,'data'),next=join(root,'next');initDataDir(next);
 const server=createServer({dataDir,configHome:join(root,'home'),configSource:'local'});let browser;
 t.after(async()=>{await browser?.close();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await launchBrowser();const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('button',{name:'数据文件夹',exact:true}).click();assert.match(await page.getByRole('dialog').textContent(),/本机设置/);
 await page.locator('input[name="dataDir"]').fill(join(root,'missing'));await page.getByRole('button',{name:'保存本机设置'}).click();await page.getByText(/数据目录无效/).waitFor();
 await page.locator('input[name="dataDir"]').fill(next);await page.getByRole('button',{name:'保存本机设置'}).click();await page.getByText(/本机设置已保存/).waitFor();assert.match(await page.locator('[data-folder-result]').textContent(),/重新双击启动/);
});
test('新鲜电脑标记在界面要求确认；确认后才显示总览',async t=>{
 const root=mkdtempSync(join(tmpdir(),'vw-session-ui-'));const first=createServer({dataDir:root,usageOptions:{hostname:'另一台 Mac'}}),second=createServer({dataDir:root,usageOptions:{hostname:'当前 Windows'}});let browser;
 t.after(async()=>{await browser?.close();await new Promise(r=>second.close(r));first.close();rmSync(root,{recursive:true,force:true});});
 await new Promise(r=>second.listen(0,'127.0.0.1',r));browser=await launchBrowser();const page=await browser.newPage();await page.goto(`http://127.0.0.1:${second.address().port}`);
 await page.getByRole('alertdialog').waitFor();assert.match(await page.getByRole('alertdialog').textContent(),/另一台 Mac 上的工作台还开着/);assert.equal(await page.getByText('项目总览',{exact:true}).count(),0);
 await page.getByRole('button',{name:'我已确认，继续使用'}).click();await page.getByRole('button',{name:'数据文件夹',exact:true}).waitFor();assert.equal(await page.getByRole('alertdialog').count(),0);
});
