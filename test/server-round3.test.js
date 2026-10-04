// 第 3 轮：实时连接（推送）、agent 状态、版本退回、系列母版、给 agent 的开场白 —— 走真实的本地服务器接口。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { validateProject } from '../src/validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'examples', 'sample-deck');

async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-r3-'));
  const server = createServer({ dataDir: dir, port: 4173, watchPollMs: 100, ...options });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const streams = [];
  t.after(async () => {
    for (const s of streams) s.abort();
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, {
      method,
      headers: payload ? { 'content-type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  // 像浏览器的 EventSource 一样连上推送，把收到的事件存起来；next() 等到符合条件的事件（带超时）
  const listen = async (id) => {
    const control = new AbortController();
    streams.push(control);
    const response = await fetch(`${base}/api/projects/${id}/events`, { signal: control.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = [];
    const waiters = [];
    const feed = (event) => {
      events.push(event);
      for (const w of [...waiters]) if (w.match(event)) { waiters.splice(waiters.indexOf(w), 1); w.done(event); }
    };
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const name = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (name && data) feed({ event: name, ...JSON.parse(data) });
          }
        }
      } catch {}
    })();
    const next = (match, timeoutMs = 5000) => {
      const seen = events.find(match);
      if (seen) { events.splice(events.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('等待推送事件超时')), timeoutMs);
        waiters.push({ match, done: (e) => { clearTimeout(timer); events.splice(events.indexOf(e), 1); done(e); } });
      });
    };
    const quiet = (match, ms = 500) => new Promise((done) => setTimeout(() => done(!events.some(match)), ms));
    await next((e) => e.event === 'hello');
    return { next, quiet, events };
  };
  const installSample = (id) => {
    const target = join(dir, 'projects', id);
    cpSync(SAMPLE, target, { recursive: true });
    const file = join(target, 'project.json');
    const project = JSON.parse(readFileSync(file, 'utf8'));
    project.id = id;
    writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
    mkdirSync(join(target, 'versions'), { recursive: true });
    return target;
  };
  return { dir, base, request, listen, installSample };
}

test('实时连接：agent 在工作台外改 project.json，开着的界面收到更新和新的版本号', async (t) => {
  const { dir, request, listen } = await fixture(t);
  const made = await request('/api/projects', 'POST', { id: 'live', name: 'Live' });
  const stream = await listen('live');
  const file = join(dir, 'projects/live/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.name = 'agent 改过的名字';
  writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
  const event = await stream.next((e) => e.event === 'changed' && e.external === true);
  assert.ok(event.files.includes('project.json'));
  assert.notEqual(event.revision, made.body.revision);
  const loaded = await request('/api/projects/live');
  assert.equal(loaded.body.revision, event.revision);
  assert.equal(loaded.body.project.name, 'agent 改过的名字');
});

test('实时连接：agent 新增素材和动效代码文件，界面也收到更新', async (t) => {
  const { dir, request, listen } = await fixture(t);
  await request('/api/projects', 'POST', { id: 'files', name: 'Files' });
  const stream = await listen('files');
  writeFileSync(join(dir, 'projects/files/assets/new.png'), 'png bytes');
  const first = await stream.next((e) => e.event === 'changed' && e.files.includes('assets/new.png'));
  assert.equal(first.external, true);
  mkdirSync(join(dir, 'projects/files/code'), { recursive: true });
  writeFileSync(join(dir, 'projects/files/code/intro.js'), 'export default 1;');
  const second = await stream.next((e) => e.event === 'changed' && e.files.includes('code/intro.js'));
  assert.equal(second.external, true);
});

test('工作台自己保存（エイ 的修改）不算 agent：推送标记为非外部，agent 状态保持空闲', async (t) => {
  const { request, listen } = await fixture(t);
  const made = await request('/api/projects', 'POST', { id: 'mine', name: 'Mine' });
  const stream = await listen('mine');
  const saved = await request('/api/projects/mine', 'PUT', { project: { ...made.body.project, name: 'エイ 改的' }, revision: made.body.revision });
  assert.equal(saved.status, 200);
  const event = await stream.next((e) => e.event === 'changed');
  assert.equal(event.external, false);
  assert.equal(event.revision, saved.body.revision);
  assert.equal(await stream.quiet((e) => e.event === 'agent'), true);
});

test('agent 状态：外部改动时变成「正在改」，一段时间没有新改动后回到空闲；新连上的界面拿到当前状态', async (t) => {
  const { dir, request, listen } = await fixture(t, { agentIdleMs: 400 });
  await request('/api/projects', 'POST', { id: 'agent', name: 'Agent' });
  const stream = await listen('agent');
  const file = join(dir, 'projects/agent/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...project, name: '第一次改' }, null, 2) + '\n');
  const working = await stream.next((e) => e.event === 'agent');
  assert.equal(working.state, 'working');
  const idle = await stream.next((e) => e.event === 'agent');
  assert.equal(idle.state, 'idle');
});

test('版本退回：内容回到那一版，并自动多出一份「退回前」的版本', async (t) => {
  const { dir, request, installSample } = await fixture(t);
  const target = installSample('rollback');
  const first = await request('/api/projects/rollback/versions', 'POST', { note: '第一版' });
  assert.equal(first.status, 201);
  const original = readFileSync(join(target, 'project.json'));
  const loaded = await request('/api/projects/rollback');
  const edited = structuredClone(loaded.body.project);
  edited.pages[0].elements[1].text = 'エイ 后来改的标题';
  const saved = await request('/api/projects/rollback', 'PUT', { project: edited, revision: loaded.body.revision });
  assert.equal(saved.status, 200);
  const restored = await request(`/api/projects/rollback/versions/${first.body.id}/restore`, 'POST', {});
  assert.equal(restored.status, 200);
  assert.deepEqual(readFileSync(join(target, 'project.json')), original);
  assert.equal(restored.body.project.pages[0].elements[1].text, '视觉工作台');
  assert.equal(validateProject(target).ok, true);
  const versions = (await request('/api/projects/rollback/versions')).body;
  assert.equal(versions.length, 2);
  const backup = versions.find((v) => v.id === restored.body.backup.id);
  assert.match(backup.note, /^退回前/);
  assert.equal(backup.by, 'system');
  const kept = JSON.parse(readFileSync(join(dir, 'projects/rollback/versions', backup.id, 'project.json'), 'utf8'));
  assert.equal(kept.pages[0].elements[1].text, 'エイ 后来改的标题');
  assert.equal((await request('/api/projects/rollback/versions/20200101-000000/restore', 'POST', {})).status, 404);
  assert.equal((await request('/api/projects/rollback/versions/..%2F..%2Fx/restore', 'POST', {})).status, 400);
});

test('版本退回是工作台自己的操作：推送标记为非外部，不会被当成 agent 在改', async (t) => {
  const { request, listen, installSample } = await fixture(t);
  installSample('quiet');
  const first = await request('/api/projects/quiet/versions', 'POST', { note: '第一版' });
  const loaded = await request('/api/projects/quiet');
  const edited = { ...loaded.body.project, name: '改名' };
  await request('/api/projects/quiet', 'PUT', { project: edited, revision: loaded.body.revision });
  const stream = await listen('quiet');
  const restored = await request(`/api/projects/quiet/versions/${first.body.id}/restore`, 'POST', {});
  const event = await stream.next((e) => e.event === 'changed' && e.revision === restored.body.revision);
  assert.equal(event.external, false);
  assert.equal(await stream.quiet((e) => e.event === 'agent'), true);
});

test('通过接口连存 5 版：字体在磁盘上只有一份', async (t) => {
  const { dir, request, installSample } = await fixture(t);
  installSample('dedupe');
  const ids = [];
  for (let i = 1; i <= 5; i++) ids.push((await request('/api/projects/dedupe/versions', 'POST', { note: `第 ${i} 版` })).body.id);
  const inodes = new Set(ids.map((id) => statSync(join(dir, 'projects/dedupe/versions', id, 'fonts/Inter-Variable.ttf')).ino));
  assert.equal(inodes.size, 1);
  assert.equal((await request('/api/projects/dedupe/versions')).body.length, 5);
});

test('系列母版：标记、列表里看得到、从母版新建（不带页面内容，母版不变）', async (t) => {
  const { dir, request, installSample } = await fixture(t);
  const master = installSample('autumn-master');
  mkdirSync(join(master, 'code'), { recursive: true });
  writeFileSync(join(master, 'code/intro.js'), 'export const intro = 1;\n');
  const before = readFileSync(join(master, 'project.json'));
  assert.equal((await request('/api/projects', 'POST', { name: '第二讲', id: 'lesson-2', fromMaster: 'autumn-master' })).status, 400);
  assert.equal((await request('/api/projects/autumn-master/master', 'PUT', { master: true })).status, 200);
  assert.equal((await request('/api/projects')).body.find((p) => p.id === 'autumn-master').master, true);
  const made = await request('/api/projects', 'POST', { name: '第二讲', id: 'lesson-2', fromMaster: 'autumn-master' });
  assert.equal(made.status, 201);
  const target = join(dir, 'projects/lesson-2');
  assert.equal(validateProject(target).ok, true);
  const project = made.body.project;
  assert.equal(project.pages.length, 1);
  assert.deepEqual(project.pages[0].elements, []);
  assert.deepEqual(project.artboard, JSON.parse(before).artboard);
  assert.deepEqual(project.fonts.map((f) => f.id), ['font_inter']);
  assert.ok(existsSync(join(target, 'fonts/Inter-Variable.ttf')));
  assert.equal(readFileSync(join(target, 'code/intro.js'), 'utf8'), 'export const intro = 1;\n');
  assert.ok(JSON.parse(readFileSync(join(target, 'series.json'), 'utf8')).palette.length > 0);
  assert.deepEqual(readFileSync(join(master, 'project.json')), before);
  assert.equal((await request('/api/projects')).body.find((p) => p.id === 'lesson-2').master, false);
  assert.equal((await request('/api/projects/autumn-master/master', 'PUT', { master: false })).status, 200);
  assert.equal((await request('/api/projects')).body.find((p) => p.id === 'autumn-master').master, false);
});

test('给 agent 的开场白：包含代码文件夹、规则文档、项目编号和项目文件夹', async (t) => {
  const { dir, request } = await fixture(t);
  await request('/api/projects', 'POST', { id: 'autumn-deck', name: '秋季课程' });
  const { status, body } = await request('/api/projects/autumn-deck/brief');
  assert.equal(status, 200);
  for (const piece of [ROOT, join(ROOT, 'CLAUDE.md'), join(ROOT, 'AGENTS.md'), join(ROOT, 'docs/format.md'), 'autumn-deck', '秋季课程', join(dir, 'projects/autumn-deck'), 'npm run save-version -- autumn-deck', 'npm run validate'])
    assert.ok(body.text.includes(piece), `开场白里应该有：${piece}`);
});
