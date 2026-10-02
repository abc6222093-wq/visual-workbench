// 第 4 轮：导出接口、在访达中显示、删除版本 —— 走真实的本地服务器接口（导出器、访达都换成假的）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.js';
import * as versionStore from '../src/version.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'examples', 'sample-deck');

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-export-'));
  const calls = { export: [], reveal: [] };
  const exporter = options.exporter || (async ({ projectDir, kind, outDir, name }) => {
    calls.export.push({ projectDir, kind, outDir, name });
    const file = join(outDir, `${name}.${kind === 'images' ? 'png' : kind}`);
    writeFileSync(file, 'x'.repeat(2048));
    return { kind, outDir, files: [{ path: file, bytes: 2048 }] };
  });
  const server = createServer({ dataDir: dir, watchPollMs: 100, exporter, reveal: async path => { calls.reveal.push(path); } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise(done => server.close(done)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const install = id => {
    const target = join(dir, 'projects', id);
    cpSync(SAMPLE, target, { recursive: true });
    mkdirSync(join(target, 'versions'), { recursive: true });
    const file = join(target, 'project.json');
    const project = JSON.parse(readFileSync(file, 'utf8'));
    project.id = id;
    writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
    return target;
  };
  return { dir, base, request, install, calls };
}

test('导出：调用导出器，输出放在 数据目录/exports/<项目>/<时间>-<类型>/，不在项目文件夹里', async t => {
  const { dir, request, install, calls } = await fixture(t);
  const projectDir = install('demo');
  const r = await request('/api/projects/demo/export', 'POST', { kind: 'pdf' });
  assert.equal(r.status, 201);
  assert.equal(r.body.kind, 'pdf');
  const root = join(dir, 'exports', 'demo') + sep;
  assert.ok(r.body.outDir.startsWith(root), r.body.outDir);
  assert.match(r.body.outDir.slice(root.length), /^\d{8}-\d{6}-pdf$/);
  assert.ok(!r.body.outDir.startsWith(projectDir + sep));
  assert.equal(calls.export.length, 1);
  assert.equal(calls.export[0].projectDir, projectDir);
  assert.equal(calls.export[0].outDir, r.body.outDir);
  assert.equal(calls.export[0].name, JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')).name);
  assert.equal(r.body.files.length, 1);
  assert.equal(r.body.files[0].bytes, 2048);
  assert.ok(r.body.files[0].path.startsWith(r.body.outDir + sep));
  assert.equal(r.body.files[0].name, `${calls.export[0].name}.pdf`);
  // 同一秒再导出一次也不会覆盖上一次
  const again = await request('/api/projects/demo/export', 'POST', { kind: 'pdf' });
  assert.equal(again.status, 201);
  assert.notEqual(again.body.outDir, r.body.outDir);
  assert.ok(existsSync(r.body.files[0].path));
  // 项目文件夹里没有多出导出文件
  assert.deepEqual(readdirSync(projectDir).sort(), ['assets', 'fonts', 'project.json', 'README.md', 'versions'].sort());
});

test('导出：类型不对 → 400；项目不存在 → 404；导出器出错 → 500 且清掉空文件夹', async t => {
  const { dir, request, install, calls } = await fixture(t);
  install('demo');
  for (const kind of [undefined, 'zip', 'HTML', '']) {
    const r = await request('/api/projects/demo/export', 'POST', { kind });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /导出类型/);
  }
  assert.equal(calls.export.length, 0);
  assert.equal((await request('/api/projects/nope/export', 'POST', { kind: 'pdf' })).status, 404);
  assert.equal((await request('/api/projects/Bad..id/export', 'POST', { kind: 'pdf' })).status, 400);

  const failing = await fixture(t, { exporter: async () => { throw new Error('浏览器打不开'); } });
  failing.install('demo');
  const r = await failing.request('/api/projects/demo/export', 'POST', { kind: 'images' });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /导出失败：浏览器打不开/);
  assert.deepEqual(readdirSync(join(failing.dir, 'exports', 'demo')), []);
  assert.ok(dir);
});

test('在访达中显示：只允许 exports 里面的路径', async t => {
  const { dir, request, install, calls } = await fixture(t);
  const projectDir = install('demo');
  const out = (await request('/api/projects/demo/export', 'POST', { kind: 'html' })).body;
  let r = await request('/api/reveal', 'POST', { path: out.files[0].path });
  assert.equal(r.status, 200);
  r = await request('/api/reveal', 'POST', { path: out.outDir });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.reveal, [out.files[0].path, out.outDir]);

  const rejected = [
    '/etc',
    '/etc/passwd',
    join(dir, 'exports'),
    join(dir, 'exports', '..', 'projects', 'demo', 'project.json'),
    `${out.outDir}/../../../projects/demo`,
    projectDir,
    join(projectDir, 'project.json'),
    '',
    42,
  ];
  for (const path of rejected) {
    const res = await request('/api/reveal', 'POST', { path });
    assert.ok([400, 403].includes(res.status), `${path} → ${res.status}`);
  }
  // 不存在的文件 → 404
  assert.equal((await request('/api/reveal', 'POST', { path: join(out.outDir, 'missing.pdf') })).status, 404);
  // exports 里的符号链接指向外面 → 拒绝
  symlinkSync(projectDir, join(dir, 'exports', 'demo', 'escape'));
  assert.equal((await request('/api/reveal', 'POST', { path: join(dir, 'exports', 'demo', 'escape') })).status, 403);
  assert.equal((await request('/api/reveal', 'POST', { path: join(dir, 'exports', 'demo', 'escape', 'project.json') })).status, 403);
  assert.equal(calls.reveal.length, 2);
});

test('删除版本：编号校验、找不到 → 404；有 deleteVersion 时真的删掉', async t => {
  const { request, install } = await fixture(t);
  const projectDir = install('demo');
  for (const vid of ['bad', '2026-10-02', '..', '20261002-1200']) {
    const r = await request(`/api/projects/demo/versions/${encodeURIComponent(vid)}`, 'DELETE');
    assert.equal(r.status, vid === '..' ? 404 : 400, vid);
  }
  assert.equal((await request('/api/projects/demo/versions/20200101-000000', 'DELETE')).status, 404);
  const saved = await request('/api/projects/demo/versions', 'POST', { note: '要删掉的' });
  assert.equal(saved.status, 201);
  const keep = await request('/api/projects/demo/versions', 'POST', { note: '留着的' });
  const r = await request(`/api/projects/demo/versions/${saved.body.id}`, 'DELETE');
  if (typeof versionStore.deleteVersion !== 'function') {
    assert.equal(r.status, 501);
    assert.match(r.body.error, /还不能删除版本/);
    t.diagnostic('src/version.js 还没有 deleteVersion：只测了校验和提示');
    return;
  }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, saved.body.id);
  assert.ok(!existsSync(join(projectDir, 'versions', saved.body.id)));
  const list = (await request('/api/projects/demo/versions')).body.map(v => v.id);
  assert.ok(!list.includes(saved.body.id));
  assert.ok(list.includes(keep.body.id));
});
