// 第 13 轮：文件夹、整理备份、项目列表新字段、「请整理文件夹」开场白、字体库接口与字体库文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-r13o-'));
  const server = createServer({ dataDir: dir, port: 4173, watchPollMs: 100 });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload ? JSON.stringify(payload) : undefined });
    const text = await r.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, headers: r.headers };
  };
  return { dir, base, request };
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('文件夹：新建（名字规则）、列表含空文件夹与数量、项目移进移出、重命名带着项目、删除把项目移到根', async (t) => {
  const { dir, request } = await fixture(t);
  writeFileSync(join(dir, 'workbench-state.json'), JSON.stringify({ masters: [], other: 1 }));
  for (const id of ['aa', 'bb']) assert.equal((await request('/api/projects', 'POST', { id, name: id })).status, 201);
  assert.deepEqual((await request('/api/folders')).body, { folders: [], backup: null });
  const made = await request('/api/folders', 'POST', { name: '  秋季课  ' });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.folders, [{ name: '秋季课', count: 0 }]);
  for (const bad of ['', '   ', 'a/b', 'a\\b', 'x'.repeat(61)]) assert.equal((await request('/api/folders', 'POST', { name: bad })).status, 400, bad);
  assert.equal((await request('/api/folders', 'POST', { name: '秋季课' })).status, 409);
  const state = readJson(join(dir, 'workbench-state.json'));
  assert.deepEqual(state.folders, ['秋季课']);
  assert.equal(state.other, 1, '状态文件的其他字段保留');

  // PATCH 项目：folder 移进；文件夹不存在自动登记；"" 移出；name 和 folder 可以单独改
  const moved = await request('/api/projects/aa', 'PATCH', { folder: '秋季课' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.project.folder, '秋季课');
  assert.equal(moved.body.project.name, 'aa');
  assert.equal((await request('/api/projects/bb', 'PATCH', { folder: '新文件夹', name: '改名了' })).body.project.name, '改名了');
  assert.deepEqual(readJson(join(dir, 'workbench-state.json')).folders, ['秋季课', '新文件夹']);
  assert.equal((await request('/api/projects/bb', 'PATCH', { folder: 'a/b' })).status, 400);
  assert.equal((await request('/api/projects/bb', 'PATCH', {})).status, 400);
  const list = (await request('/api/projects')).body;
  assert.deepEqual(list.map((p) => [p.id, p.folder, p.drafts]), [['aa', '秋季课', 0], ['bb', '新文件夹', 0]]);
  assert.equal('designCard' in list[0], false);
  assert.deepEqual((await request('/api/folders')).body.folders, [{ name: '秋季课', count: 1 }, { name: '新文件夹', count: 1 }]);
  const out = await request('/api/projects/bb', 'PATCH', { folder: '' });
  assert.equal('folder' in out.body.project, false);
  assert.equal((await request('/api/projects')).body[1].folder, '');

  // 重命名文件夹：里面的项目一起改；重名 409；不存在 404
  const renamed = await request(`/api/folders/${encodeURIComponent('秋季课')}`, 'PATCH', { name: '2026 秋' });
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.body.folders, [{ name: '2026 秋', count: 1 }, { name: '新文件夹', count: 0 }]);
  assert.equal(readJson(join(dir, 'projects/aa/project.json')).folder, '2026 秋');
  assert.equal((await request(`/api/folders/${encodeURIComponent('2026 秋')}`, 'PATCH', { name: '新文件夹' })).status, 409);
  assert.equal((await request('/api/folders/nope', 'PATCH', { name: 'x' })).status, 404);

  // 删除：项目移到根，项目不删
  const removed = await request(`/api/folders/${encodeURIComponent('2026 秋')}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.folders, [{ name: '新文件夹', count: 0 }]);
  assert.equal('folder' in readJson(join(dir, 'projects/aa/project.json')), false);
  assert.ok(existsSync(join(dir, 'projects/aa/project.json')));
  assert.equal((await request('/api/folders/nope', 'DELETE')).status, 404);
});

test('项目列表带设计卡片和草稿页数', async (t) => {
  const { dir, request } = await fixture(t);
  await request('/api/projects', 'POST', { id: 'cc', name: 'cc' });
  const file = join(dir, 'projects/cc/project.json');
  const p = readJson(file);
  p.designCard = { direction: '纸感', concept: '一句话', colors: ['#112233'], fonts: ['Inter'], traits: ['留白'], at: '2026-10-06T00:00:00.000Z' };
  writeFileSync(file, JSON.stringify(p));
  const draft = await request('/api/projects', 'POST', { id: 'dd', draft: '# 草稿\n## Page 1\n第一页\n## Page 2\n第二页' });
  assert.equal(draft.status, 201);
  const list = (await request('/api/projects')).body;
  assert.deepEqual(list.find((x) => x.id === 'cc').designCard, p.designCard);
  assert.equal(list.find((x) => x.id === 'dd').drafts, 2);
});

test('整理备份：记录原状、恢复名称 / 文件夹 / 文件夹列表后删掉备份；没有备份恢复 404', async (t) => {
  const { dir, request } = await fixture(t);
  for (const id of ['aa', 'bb']) await request('/api/projects', 'POST', { id, name: `原名 ${id}` });
  await request('/api/folders', 'POST', { name: '旧文件夹' });
  await request('/api/projects/aa', 'PATCH', { folder: '旧文件夹' });
  assert.deepEqual((await request('/api/organize')).body, { backup: null });
  assert.equal((await request('/api/organize/restore', 'POST')).status, 404);
  const b = await request('/api/organize/backup', 'POST');
  assert.equal(b.status, 200);
  assert.ok(Date.parse(b.body.at));
  const backup = readJson(join(dir, 'organize-backup.json'));
  assert.deepEqual(backup.folders, ['旧文件夹']);
  assert.deepEqual(backup.projects, { aa: { name: '原名 aa', folder: '旧文件夹' }, bb: { name: '原名 bb', folder: '' } });
  assert.deepEqual((await request('/api/organize')).body, { backup: { at: b.body.at } });
  assert.deepEqual((await request('/api/folders')).body.backup, { at: b.body.at });

  // agent 整理
  await request('/api/projects/aa', 'PATCH', { name: '2026-10-05 新名', folder: '' });
  await request('/api/projects/bb', 'PATCH', { folder: '新的' });
  await request(`/api/folders/${encodeURIComponent('旧文件夹')}`, 'DELETE');
  const r = await request('/api/organize/restore', 'POST');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { restored: 2 });
  const aa = readJson(join(dir, 'projects/aa/project.json')), bb = readJson(join(dir, 'projects/bb/project.json'));
  assert.equal(aa.name, '原名 aa'); assert.equal(aa.folder, '旧文件夹');
  assert.equal(bb.name, '原名 bb'); assert.equal('folder' in bb, false);
  assert.deepEqual(readJson(join(dir, 'workbench-state.json')).folders, ['旧文件夹']);
  assert.equal(existsSync(join(dir, 'organize-backup.json')), false);
  assert.deepEqual((await request('/api/organize')).body, { backup: null });
});

test('「请整理文件夹」开场白：现有文件夹、全部项目、先 begin 再整理、不删项目、日期 + 简短名、设计卡片提醒', async (t) => {
  const { dir, request } = await fixture(t);
  await request('/api/projects', 'POST', { id: 'aa', name: '课表' });
  await request('/api/projects/aa', 'PATCH', { folder: '课件' });
  await request('/api/folders', 'POST', { name: '空的' });
  const r = await request('/api/brief/organize');
  assert.equal(r.status, 200);
  const text = r.body.text;
  for (const piece of [dir, '课件（1 个项目）', '空的（0 个项目）', 'aa「课表」', '文件夹：课件', 'npm run organize -- begin', 'npm run organize -- move', 'npm run organize -- rename', 'npm run organize -- folder', '不删除任何项目', '日期 + 简短名', '退回整理前', 'designCard'])
    assert.ok(text.includes(piece), `应包含：${piece}\n${text}`);
  assert.doesNotMatch(text, /undefined/);
});

test('字体库：GET /api/fonts 返回 fontsApi；字体文件带 CORS；拒绝 .. 和符号链接；页面脚本（null 源）能读', async (t) => {
  const { dir, request, base } = await fixture(t);
  const fonts = await request('/api/fonts');
  assert.equal(fonts.status, 200);
  assert.ok(Array.isArray(fonts.body.families));
  assert.equal(typeof fonts.body.dir, 'string');
  mkdirSync(join(dir, 'library/fonts/zcool'), { recursive: true });
  writeFileSync(join(dir, 'library/fonts/zcool/ZCOOLXiaoWei-Regular.ttf'), Buffer.from('fontdata'));
  const ok = await fetch(`${base}/data/library/fonts/zcool/ZCOOLXiaoWei-Regular.ttf`, { headers: { origin: 'null' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  assert.match(ok.headers.get('content-type'), /font\/ttf/);
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), 'fontdata');
  assert.equal((await fetch(`${base}/data/library/fonts/zcool/missing.ttf`)).status, 404);
  assert.notEqual((await fetch(`${base}/data/library/fonts/zcool/%2E%2E/%2E%2E/workbench-state.json`)).status, 200);
  assert.notEqual((await fetch(`${base}/data/library/fonts/..%2F..%2Fworkbench-state.json`)).status, 200);
  const outside = join(dir, 'secret.ttf'); writeFileSync(outside, 'secret');
  symlinkSync(outside, join(dir, 'library/fonts/zcool/link.ttf'));
  assert.equal((await fetch(`${base}/data/library/fonts/zcool/link.ttf`)).status, 403);
  symlinkSync(join(dir, 'projects'), join(dir, 'library/fonts/dirlink'));
  assert.equal((await fetch(`${base}/data/library/fonts/dirlink/x.ttf`)).status, 403);
});
