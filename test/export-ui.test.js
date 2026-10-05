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

// 第 12 轮修正（任务 8）：导出弹窗显示进度条（「正在导出第 2 / 3 页」）和「取消导出」；取消后弹窗显示「已取消」。
// 进度走 docs/round12-contract.md 约定 2：界面先连 GET /export/progress/<编号>（SSE），再 POST /export（带 progressId）。
async function exportFixture(t, exporter) {
  const dir = mkdtempSync(join(tmpdir(), '我的云端硬盘 导出进度-'));
  const server = createServer({ dataDir: dir, exporter, reveal: async () => {} });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.locator('[data-action="export"]').click();
  await page.getByRole('heading', { name: '导出' }).waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-action="export-kind"][data-kind="pdf"]').click();
  return { dir, page, errors };
}

test('导出弹窗：进度条跟着导出器的进度走（正在导出第 2 / 3 页），完成后照旧显示文件位置', async t => {
  let release, reached;
  const gate = new Promise(done => { release = done; });
  const atTwo = new Promise(done => { reached = done; });
  const seen = [];
  const { page, errors } = await exportFixture(t, async ({ kind, outDir, name, onProgress, signal }) => {
    seen.push({ onProgress: typeof onProgress, signal: !!signal });
    onProgress({ current: 1, total: 3, label: '正在导出第 1 / 3 页' });
    onProgress({ current: 2, total: 3, label: '正在导出第 2 / 3 页' });
    reached();
    await gate;
    onProgress({ current: 3, total: 3, label: '正在写入文件' });
    const path = join(outDir, `${name}.pdf`);
    writeFileSync(path, Buffer.alloc(2048));
    return { kind, outDir, files: [{ path, bytes: 2048 }] };
  });
  t.after(() => release());
  await page.locator('[data-action="export-start"]').click();
  await atTwo;
  await page.waitForFunction(() => document.querySelector('#export-progress-label')?.textContent === '正在导出第 2 / 3 页');
  const bar = await page.locator('#export-progress-bar').evaluate(n => ({ value: n.value, max: n.max }));
  assert.deepEqual(bar, { value: 2, max: 3 });
  assert.equal(await page.locator('[data-action="export-start"]').isDisabled(), true);
  assert.equal(await page.locator('[data-action="export-cancel"]').isDisabled(), false, '导出中可以取消');
  assert.equal((await page.locator('[data-action="export-cancel"]').textContent()).trim(), '取消导出');
  assert.deepEqual(seen, [{ onProgress: 'function', signal: true }], '界面发了 progressId，导出器拿到 onProgress 和 signal');
  release();
  await page.locator('#export-path').waitFor();
  assert.match(await page.locator('#export-files .g-row').textContent(), /\.pdf/);
  assert.deepEqual(errors, []);
});

test('导出弹窗：点「取消导出」→ 导出器收到取消 → 弹窗显示「已取消」，半成品文件夹被删掉', async t => {
  let started;
  const running = new Promise(done => { started = done; });
  let outDirSeen = null;
  const { page, errors } = await exportFixture(t, async ({ outDir, name, onProgress, signal }) => {
    outDirSeen = outDir;
    writeFileSync(join(outDir, `${name}-1.png`), Buffer.alloc(16)); // 半成品
    onProgress({ current: 1, total: 3, label: '正在导出第 1 / 3 页' });
    started();
    await new Promise(done => { if (signal.aborted) done(); else signal.addEventListener('abort', done, { once: true }); });
    const error = new Error('已取消导出'); error.cancelled = true; throw error;
  });
  await page.locator('[data-action="export-start"]').click();
  await running;
  await page.waitForFunction(() => document.querySelector('#export-progress-label')?.textContent === '正在导出第 1 / 3 页');
  await page.locator('[data-action="export-cancel"]').click();
  await page.waitForFunction(() => document.querySelector('#export-progress-label')?.textContent === '已取消');
  assert.equal(await page.locator('#export-path').count(), 0, '没有显示「已导出」');
  assert.equal(await page.locator('[data-action="export-start"]').isDisabled(), false, '取消后可以重新导出');
  const { existsSync } = await import('node:fs');
  assert.ok(outDirSeen && !existsSync(outDirSeen), '取消后删掉了半成品文件夹');
  assert.deepEqual(errors, []);
});

test('导出弹窗（只测界面，接口用 page.route 假冒）：先连进度流再发导出，导出请求带 progressId，取消发到 cancel 接口', async t => {
  const dir = mkdtempSync(join(tmpdir(), '我的云端硬盘 导出界面-'));
  const server = createServer({ dataDir: dir });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const order = [];
  let finishExport;
  const exportDone = new Promise(done => { finishExport = done; });
  await page.route(/\/api\/projects\/sample-deck\/export\/progress\/[A-Za-z0-9_-]+$/, route => {
    order.push('progress');
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: `event: progress\ndata: ${JSON.stringify({ current: 2, total: 5, label: '' })}\n\n` });
  });
  await page.route(/\/api\/projects\/sample-deck\/export\/cancel\/[A-Za-z0-9_-]+$/, route => { order.push('cancel'); finishExport(); route.fulfill({ status: 200, contentType: 'application/json', body: '{"cancelled":true}' }); });
  await page.route(/\/api\/projects\/sample-deck\/export$/, async route => {
    order.push(`export:${JSON.parse(route.request().postData()).progressId ? 'id' : 'no-id'}`);
    await exportDone;
    route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '已取消导出', cancelled: true }) });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.locator('[data-action="export"]').click();
  await page.getByRole('heading', { name: '导出' }).waitFor();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('[data-action="export-start"]').click();
  // 没有 label 时界面自己写「正在导出第 2 / 5 页」
  await page.waitForFunction(() => document.querySelector('#export-progress-label')?.textContent === '正在导出第 2 / 5 页');
  assert.deepEqual(await page.locator('#export-progress-bar').evaluate(n => [n.value, n.max]), [2, 5]);
  await page.locator('[data-action="export-cancel"]').click();
  await page.waitForFunction(() => document.querySelector('#export-progress-label')?.textContent === '已取消');
  assert.deepEqual(order.slice(0, 2), ['progress', 'export:id']);
  assert.ok(order.includes('cancel'));
});
