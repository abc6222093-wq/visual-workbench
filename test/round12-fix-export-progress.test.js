// 第 12 轮修正 · 导出进度与取消（任务 8，docs/round12-contract.md 约定 2）：
// POST /api/projects/:id/export 带 progressId → GET …/export/progress/:progressId 收 progress / done（SSE），
// POST …/export/cancel/:progressId 取消 → 409 { error:'已取消导出', cancelled:true }，半成品文件夹删掉。
// 数据目录含中文和空格；真导出（图片）每截完一页报一次进度；命令行打印进度行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { makeDeck, cleanup } from './round12-export-fixture.test.js';
import { browserCandidates } from '../src/browser.js';

const EXPORT_CLI = fileURLToPath(new URL('../src/cli/export.js', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));

async function fixture(t, exporter) {
  const dataDir = mkdtempSync(join(tmpdir(), '我的云端硬盘 导出进度-'));
  const deck = await makeDeck();
  cpSync(deck.dir, join(dataDir, 'projects', 'r12-deck'), { recursive: true });
  cleanup(deck.dir);
  const server = createServer({ dataDir, watchPollMs: 100, ...(exporter ? { exporter } : {}) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise(done => server.close(done)); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { dataDir, base, request };
}

/** 读 SSE 直到 done 事件（或流结束）；onEvent 每收到一条调用一次 */
async function readEvents(url, onEvent = () => {}) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!event) continue;
      const item = { event, data: JSON.parse(data) };
      events.push(item);
      await onEvent(item);
      if (event === 'done') return events;
    }
  }
  return events;
}

test('假导出器：先连 SSE 再导出，收到全部 progress 和 done；导出器拿到 onProgress / signal', async t => {
  let received;
  const { base, request } = await fixture(t, async options => {
    received = options;
    for (let i = 1; i <= 3; i++) { options.onProgress({ current: i, total: 3, label: `正在导出第 ${i} / 3 页` }); await wait(20); }
    const file = join(options.outDir, 'x.html'); writeFileSync(file, 'x');
    return { kind: options.kind, outDir: options.outDir, files: [{ path: file, bytes: 1 }] };
  });
  const id = 'prog_0001-abc';
  const events = readEvents(`${base}/api/projects/r12-deck/export/progress/${id}`);
  await wait(100);
  const r = await request('/api/projects/r12-deck/export', 'POST', { kind: 'html', progressId: id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(typeof received.onProgress, 'function');
  assert.ok(received.signal && received.signal.aborted === false);
  assert.deepEqual(await events, [
    { event: 'progress', data: { current: 1, total: 3, label: '正在导出第 1 / 3 页' } },
    { event: 'progress', data: { current: 2, total: 3, label: '正在导出第 2 / 3 页' } },
    { event: 'progress', data: { current: 3, total: 3, label: '正在导出第 3 / 3 页' } },
    { event: 'done', data: { ok: true } },
  ]);
  // 晚连上的 SSE：重放已有进度，并立刻收到 done
  const late = await readEvents(`${base}/api/projects/r12-deck/export/progress/${id}`);
  assert.equal(late.length, 4);
  assert.deepEqual(late.at(-1), { event: 'done', data: { ok: true } });
  // 同一个编号不能再用
  assert.equal((await request('/api/projects/r12-deck/export', 'POST', { kind: 'html', progressId: id })).status, 409);
});

test('SSE 晚于 POST 连上：先发生的进度会补发；不带 progressId 时导出器的参数和以前一样', async t => {
  let release; const gate = new Promise(r => { release = r; });
  const calls = [];
  const { base, request } = await fixture(t, async options => {
    calls.push(Object.keys(options).sort());
    if (options.onProgress) { options.onProgress({ current: 1, total: 2, label: '正在导出第 1 / 2 页' }); await gate; options.onProgress({ current: 2, total: 2, label: '正在导出第 2 / 2 页' }); }
    const file = join(options.outDir, 'x.png'); writeFileSync(file, 'x');
    return { kind: options.kind, outDir: options.outDir, files: [{ path: file, bytes: 1 }] };
  });
  const id = 'late-sse-0002';
  const post = request('/api/projects/r12-deck/export', 'POST', { kind: 'images', progressId: id });
  await wait(150);
  const events = readEvents(`${base}/api/projects/r12-deck/export/progress/${id}`, item => { if (item.event === 'progress' && item.data.current === 1) release(); });
  assert.equal((await post).status, 201);
  assert.deepEqual((await events).map(e => e.event === 'done' ? 'done' : e.data.current), [1, 2, 'done']);
  const plain = await request('/api/projects/r12-deck/export', 'POST', { kind: 'pdf' });
  assert.equal(plain.status, 201);
  assert.deepEqual(calls[1], ['kind', 'name', 'outDir', 'projectDir']);
  for (const bad of ['short', 'has space 123', 'x'.repeat(65), 'ab/cd/efgh']) {
    assert.equal((await request('/api/projects/r12-deck/export', 'POST', { kind: 'pdf', progressId: bad })).status, 400, bad);
  }
  assert.equal((await fetch(`${base}/api/projects/r12-deck/export/progress/short`)).status, 400);
});

test('取消：导出器等 signal 后抛 cancelled → POST 返回 409、半成品文件夹删掉、SSE 收到 done cancelled', async t => {
  let outDir;
  const { base, dataDir, request } = await fixture(t, async options => {
    outDir = options.outDir;
    writeFileSync(join(outDir, '01-半成品.png'), 'x');
    options.onProgress({ current: 1, total: 5, label: '正在导出第 1 / 5 页' });
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    throw Object.assign(new Error('已取消导出'), { cancelled: true });
  });
  const id = 'cancel-0003';
  const events = readEvents(`${base}/api/projects/r12-deck/export/progress/${id}`, async item => {
    if (item.event === 'progress') assert.deepEqual(await request(`/api/projects/r12-deck/export/cancel/${id}`, 'POST'), { status: 200, body: { cancelled: true } });
  });
  await wait(100);
  const r = await request('/api/projects/r12-deck/export', 'POST', { kind: 'images', progressId: id });
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: '已取消导出', cancelled: true });
  assert.ok(outDir && !existsSync(outDir), '半成品文件夹已删除');
  assert.deepEqual(readdirSync(join(dataDir, 'exports', 'r12-deck')), []);
  assert.deepEqual((await events).at(-1), { event: 'done', data: { ok: false, error: '已取消导出', cancelled: true } });
  // 导出器不理会取消、照样做完：仍按取消处理
  const stubborn = await fixture(t, async options => { await wait(200); const file = join(options.outDir, 'x.pdf'); writeFileSync(file, 'x'); return { kind: options.kind, outDir: options.outDir, files: [{ path: file, bytes: 1 }] }; });
  const post = stubborn.request('/api/projects/r12-deck/export', 'POST', { kind: 'pdf', progressId: 'stubborn-04' });
  await wait(50);
  await stubborn.request('/api/projects/r12-deck/export/cancel/stubborn-04', 'POST');
  assert.equal((await post).status, 409);
  assert.deepEqual(readdirSync(join(stubborn.dataDir, 'exports', 'r12-deck')), []);
  // 失败：done 带错误
  const broken = await fixture(t, async () => { throw new Error('坏了'); });
  const failed = broken.request('/api/projects/r12-deck/export', 'POST', { kind: 'pdf', progressId: 'broken-005' });
  const doneEvents = await readEvents(`${broken.base}/api/projects/r12-deck/export/progress/broken-005`);
  assert.equal((await failed).status, 500);
  assert.deepEqual(doneEvents.at(-1), { event: 'done', data: { ok: false, error: '导出失败：坏了', cancelled: false } });
});

const hasBrowser = () => browserCandidates().length > 0;

test('真导出（每页图片，2 页）：每截完一页收到一条进度；导出 HTML 按页报进度再报打包、写入', { timeout: 180000 }, async t => {
  if (!hasBrowser()) return t.skip('本机没有可用浏览器');
  const { base, request } = await fixture(t);
  const events = readEvents(`${base}/api/projects/r12-deck/export/progress/real-images-1`);
  await wait(50);
  const r = await request('/api/projects/r12-deck/export', 'POST', { kind: 'images', progressId: 'real-images-1' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.files.length, 2);
  const list = await events;
  const progress = list.filter(e => e.event === 'progress').map(e => e.data);
  assert.deepEqual(progress, [{ current: 1, total: 2, label: '正在导出第 1 / 2 页' }, { current: 2, total: 2, label: '正在导出第 2 / 2 页' }]);
  assert.deepEqual(list.at(-1), { event: 'done', data: { ok: true } });
  const html = readEvents(`${base}/api/projects/r12-deck/export/progress/real-html-02`);
  await wait(50);
  assert.equal((await request('/api/projects/r12-deck/export', 'POST', { kind: 'html', progressId: 'real-html-02' })).status, 201);
  const labels = (await html).filter(e => e.event === 'progress').map(e => e.data.label);
  assert.deepEqual(labels.slice(0, 2), ['正在导出第 1 / 2 页', '正在导出第 2 / 2 页']);
  assert.ok(labels.some(l => /打包/.test(l)) && labels.some(l => /写入文件/.test(l)), labels.join());
});

test('真导出取消（PDF）：第一页截完后取消，后台浏览器停下，返回 409，导出文件夹删掉', { timeout: 180000 }, async t => {
  if (!hasBrowser()) return t.skip('本机没有可用浏览器');
  const { base, dataDir, request } = await fixture(t);
  const id = 'real-cancel-pdf';
  const events = readEvents(`${base}/api/projects/r12-deck/export/progress/${id}`, async item => { if (item.event === 'progress' && item.data.current === 1) await request(`/api/projects/r12-deck/export/cancel/${id}`, 'POST'); });
  await wait(50);
  const started = Date.now();
  const r = await request('/api/projects/r12-deck/export', 'POST', { kind: 'pdf', progressId: id });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.cancelled, true);
  assert.ok(Date.now() - started < 60000);
  assert.deepEqual(readdirSync(join(dataDir, 'exports', 'r12-deck')), []);
  assert.equal((await events).at(-1).data.cancelled, true);
});

test('npm run export 在终端打印进度行', { timeout: 60000 }, async () => {
  const deck = await makeDeck();
  const dataDir = mkdtempSync(join(tmpdir(), '我的云端硬盘 命令行-'));
  try {
    const result = spawnSync(process.execPath, [EXPORT_CLI, deck.dir, '--html', '--data-dir', dataDir], { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /正在导出第 1 \/ 2 页\n.*正在导出第 2 \/ 2 页/);
    assert.match(result.stdout, /正在写入文件/);
  } finally { cleanup(deck.dir, dataDir); }
});
