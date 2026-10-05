// 第 4 轮：编辑器里的「导出」弹窗 —— 选 PDF、看到正在导出、看到保存位置和文件大小、点「在访达中显示」。
// 导出器和访达都换成假的，不依赖真实导出、不真的打开访达。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from './helpers/isolated-server.js';

test('导出弹窗：选 PDF → 正在导出… → 显示保存位置、文件和大小 → 在访达中显示', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-export-ui-'));
  const calls = { export: [], reveal: [] };
  let release;
  const gate = new Promise(done => { release = done; });
  const server = createServer({
    dataDir: dir,
    exporter: async ({ projectDir, kind, outDir, name }) => {
      calls.export.push({ projectDir, kind, outDir, name });
      await gate; // 让界面停在「正在导出…」，测试看完再放行
      const path = join(outDir, `${name}.pdf`);
      writeFileSync(path, Buffer.alloc(1536 * 1024));
      return { kind, outDir, files: [{ path, bytes: 1536 * 1024 }] };
    },
    reveal: async path => { calls.reveal.push(path); },
  });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { release(); await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.locator('[data-action="export"]').click();
  await page.getByRole('heading', { name: '导出' }).waitFor();
  for (const label of ['放映版 HTML', '每页图片', 'PDF']) await page.locator('[data-action="export-kind"]', { hasText: label }).first().waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // 第 12 轮：画布是跨进程的隔离 iframe，弹窗画出来之前就点，点击会按旧画面送进 iframe

  await page.locator('[data-action="export-kind"][data-kind="images"]').click();
  assert.equal(await page.locator('[data-action="export-kind"][data-kind="images"]').getAttribute('aria-checked'), 'true');
  await page.locator('[data-action="export-kind"][data-kind="pdf"]').click();
  assert.equal(await page.locator('[data-action="export-kind"][data-kind="pdf"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-action="export-kind"][data-kind="images"]').getAttribute('aria-checked'), 'false');

  await page.locator('[data-action="export-start"]').click();
  await page.getByText('正在导出…').waitFor();
  assert.equal(await page.locator('[data-action="export-start"]').isDisabled(), true);
  release();

  await page.locator('#export-path').waitFor();
  assert.equal(calls.export.length, 1);
  assert.equal(calls.export[0].kind, 'pdf');
  const outDir = calls.export[0].outDir;
  assert.ok(outDir.startsWith(join(dir, 'exports', 'sample-deck') + sep));
  assert.equal(await page.locator('#export-path').textContent(), outDir);
  const row = page.locator('#export-files .g-row');
  assert.equal(await row.count(), 1);
  assert.match(await row.textContent(), /\.pdf/);
  assert.match(await row.textContent(), /1\.5 MB/);
  assert.deepEqual(readdirSync(outDir).length, 1);

  await page.locator('[data-action="reveal"]').click();
  for (let i = 0; i < 50 && !calls.reveal.length; i++) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(calls.reveal, [join(outDir, `${calls.export[0].name}.pdf`)]);
  assert.deepEqual(errors, []);
});

test('版本列表：删除按钮先确认，删掉后列表刷新', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-version-ui-'));
  const server = createServer({ dataDir: dir });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const save = note => fetch(`${base}/api/projects/sample-deck/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) }).then(r => r.json());
  const gone = await save('要删掉的版本');
  await save('留着的版本');
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.locator('.ed-inspector [data-action="versions"]').click();
  await page.getByText('要删掉的版本').waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // 第 12 轮：画布是跨进程的隔离 iframe，弹窗画出来之前就点，点击会按旧画面送进 iframe
  await page.locator(`[data-action="version-delete"][data-id="${gone.id}"]`).click();
  await page.getByRole('heading', { name: '删除这个版本？' }).waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // 第 12 轮：画布是跨进程的隔离 iframe，弹窗画出来之前就点，点击会按旧画面送进 iframe
  // 返回列表：什么都不删
  await page.locator('.g-sheet [data-action="versions"]').click();
  await page.getByText('要删掉的版本').waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // 第 12 轮：画布是跨进程的隔离 iframe，弹窗画出来之前就点，点击会按旧画面送进 iframe
  await page.locator(`[data-action="version-delete"][data-id="${gone.id}"]`).click();
  await page.getByRole('heading', { name: '删除这个版本？' }).waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-action="version-delete-confirm"]').click();
  await page.getByRole('heading', { name: '版本列表' }).waitFor();
  await page.getByText('留着的版本').waitFor();
  assert.equal(await page.getByText('要删掉的版本').count(), 0);
  const list = await fetch(`${base}/api/projects/sample-deck/versions`).then(r => r.json());
  assert.equal(list.some(v => v.id === gone.id), false);
  assert.match(await page.locator('#toast').textContent(), /版本已删除/);
  assert.deepEqual(errors, []);
});
