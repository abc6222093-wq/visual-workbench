// 第 13 轮 H 组：总览走真实服务端接口（不假冒）——新建文件夹、右键移到…、拖到面包屑移出、从文案新建后总览显示「草稿 n 页」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';

test('总览（真实接口）：文件夹新建 / 移进 / 移出写进 project.json；从文案新建的项目显示草稿页数', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-round13-home-real-'));
  const server = createServer({ dataDir: dir });
  let browser;
  t.after(async () => { await browser?.close(); if (server.listening) await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [id, name] of [['r1', '真实一'], ['r2', '真实二']]) {
    const r = await fetch(url + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
    assert.equal(r.status, 201);
  }
  const folderOf = (id) => JSON.parse(readFileSync(join(dir, 'projects', id, 'project.json'), 'utf8')).folder || '';
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator('.hm-cell[data-project-id="r1"]').waitFor();
  // 新建文件夹
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.locator('[data-folder-form] input[name="name"]').fill('真实文件夹');
  await page.locator('[data-folder-form] [type="submit"]').click();
  await page.locator('.hm-cell--folder[data-folder="真实文件夹"]').waitFor();
  assert.equal(await page.locator('.hm-cell--folder small').innerText(), '0 个项目');
  // 右键移到…
  await page.locator('.hm-cell[data-project-id="r1"] > .hm-card').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移到…' }).click();
  await page.getByRole('menuitem', { name: '真实文件夹' }).click();
  await page.waitForFunction(() => !document.querySelector('.hm-grid > .hm-cell[data-project-id="r1"]'));
  assert.equal(folderOf('r1'), '真实文件夹');
  assert.equal(await page.locator('.hm-cell--folder small').innerText(), '1 个项目');
  // 进文件夹，拖到面包屑移出
  await page.locator('.hm-cell--folder > .hm-card').click();
  await page.locator('.hm-crumb').waitFor();
  await page.locator('.hm-cell[data-project-id="r1"] > .hm-card').dragTo(page.locator('.hm-crumb'));
  await page.waitForFunction(() => !document.querySelector('.hm-grid > .hm-cell[data-project-id="r1"]'));
  assert.equal(folderOf('r1'), '');
  await page.locator('.hm-crumb').click();
  await page.locator('.hm-grid > .hm-cell[data-project-id="r1"]').waitFor();
  // 从文案新建 → 打开项目 → 回总览看到「草稿 n 页」
  await page.locator('.ed-top [data-action="new"]').click();
  await page.getByLabel('从文案开始').check();
  await page.locator('#new-form textarea[name="draft"]').fill('# 文案项目\n\n## Page 1 ｜ 封面\n【核心信息】\n大标题：你好\n\n## Page 2 ｜ 第二页\n【核心信息】\n正文一行');
  await page.locator('#new-form [type="submit"]').click();
  await page.waitForSelector('#artboard > iframe', { state: 'attached' }); // 草稿页的 iframe 被编辑层盖住（B 组），只等它挂上
  const note = await page.locator('#toast').innerText();
  assert.ok(note.length > 0, '提示服务端说明的分页方式');
  await page.locator('.ed-rail [data-action="home"]').click();
  await page.locator('.hm-chip--draft').waitFor();
  assert.equal(await page.locator('.hm-chip--draft').innerText(), '草稿 2 页');
  assert.match(await page.locator('.hm-cell:has(.hm-chip--draft) strong').innerText(), /文案项目/);
  assert.deepEqual(errors, []);
});
