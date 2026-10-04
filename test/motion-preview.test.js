// 第 4 轮：编辑器里「预览动效」—— 在画板上面的临时层里播完本页动效，播完拿掉；项目（内存里和磁盘上）一点不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from './helpers/isolated-server.js';

test('预览动效：临时层里真的播了，播完 / Esc / 再点按钮都会收起，项目和画板不变', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-motion-preview-'));
  const server = createServer({ dataDir: dir });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'projects/sample-deck/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.pages[0].elements.find(e => e.id === 'el_title1').x = 321;
  project.pages[0].motion = { steps: 2, source: `export default ctx => {
    const {node,base}=ctx.element('el_title1'); node.style.opacity='0.5';
    return {async step(index){node.style.left=(base.x+(index+1)*10)+'px'; node.dataset.previewStep=String(index); await ctx.timer(700);},
      transition({to}){to.dataset.transitionRan='1';}};
  }` };
  project.pages[1].motion = { steps: 1, source: 'export default () => ({ step(){throw new Error("intentional preview failure")} })' };
  delete project.pages[2].motion;
  writeFileSync(file, JSON.stringify(project, null, 2));
  const diskBefore = readFileSync(file, 'utf8');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');

  const styles = () => page.evaluate(() => ({
    board: document.querySelector('#artboard').getAttribute('style'),
    nodes: Object.fromEntries([...document.querySelectorAll('#artboard [data-element-id]')].map(n => [n.dataset.elementId, n.getAttribute('style')])),
  }));
  // 编辑器内存里的项目：借「下载我的副本」把 S.project 原样拿出来
  const memory = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'export-local'; b.hidden = true; document.querySelector('#app').append(b); b.click(); b.remove(); }),
    ]);
    return JSON.parse(readFileSync(await download.path(), 'utf8'));
  };
  const before = await styles();
  const memoryBefore = await memory();
  assert.equal(before.nodes.el_title1.includes('left: 321px'), true);

  // 1. 播完整页：中途能看到 step 改了临时层里的节点，编辑器画板不动
  const button = page.locator('[data-action="preview-motion"]');
  await button.click();
  await page.waitForSelector('#artboard-holder [data-motion-preview] [data-page-id="page_cover1"]');
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('[data-motion-preview] [data-element-id="el_title1"]')?.style.left === '331px');
  assert.equal(await page.locator('[data-motion-preview] [data-element-id="el_title1"]').evaluate(n => n.style.opacity), '0.5');
  assert.equal(await page.locator('#artboard').evaluate(n => n.style.visibility), 'hidden');
  assert.deepEqual((await styles()).nodes, before.nodes);
  // 预览中点画板不会选中元素（临时层挡住了）
  await page.locator('[data-motion-preview]').click({ position: { x: 40, y: 40 } });
  await page.waitForFunction(() => document.querySelector('[data-motion-preview] [data-element-id="el_title1"]')?.style.left === '341px');
  await page.waitForFunction(() => !document.querySelector('[data-motion-preview]'), null, { timeout: 15000 });
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await styles(), before);
  assert.equal(await page.locator('#artboard [data-transition-ran]').count(), 0);
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);

  // 2. Esc 提前结束
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-motion-preview] [data-element-id="el_title1"]')?.style.left === '331px');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-motion-preview]'));
  assert.deepEqual(await styles(), before);

  // 3. 再点一次按钮提前结束
  await button.click();
  await page.waitForSelector('[data-motion-preview]');
  await button.click();
  await page.waitForFunction(() => !document.querySelector('[data-motion-preview]'));
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await styles(), before);

  // 4. 动效出错：提示中文错误，临时层收起
  await page.locator('[data-action="switch"][data-id="page_scene2"]').click();
  await page.locator('[data-action="preview-motion"]').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('intentional preview failure'));
  assert.match(await page.locator('#toast').textContent(), /^动效错误：/);
  await page.waitForFunction(() => !document.querySelector('[data-motion-preview]'));

  // 5. 没有动效的页面：只提示
  await page.locator('[data-action="switch"][data-id="page_clip3"]').click();
  await page.locator('[data-action="preview-motion"]').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === '这一页还没有动效');
  assert.equal(await page.locator('[data-motion-preview]').count(), 0);

  // 回到第一页：重画后画板仍是原样；内存和磁盘上的项目都没变
  await page.locator('[data-action="switch"][data-id="page_cover1"]').click();
  assert.deepEqual(await styles(), before);
  assert.deepEqual(await memory(), memoryBefore);
  await page.waitForTimeout(900); // 超过自动保存的等待时间
  assert.equal(readFileSync(file, 'utf8'), diskBefore);
  assert.deepEqual(errors, []);
});
