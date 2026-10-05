import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { validateProjectData } from '../src/validate.js';
import { scanResources, resolvePageRef } from '../web/page-marks.js';
import { filesFromDataTransfer } from '../web/import-html.js';

// 第 13 轮 · 拖进来导入 / 导入为页面：任务体带 intoProject、after 时，页面插进已有项目（素材、字体、原文件一起带），不新建项目；
// 弹窗可以带预选文件、直接开始；filesFromDataTransfer 把拖进来的文件 / 文件夹 / .zip 变成 [{ path, file }]。
const FX = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const EX = fileURLToPath(new URL('../examples/', import.meta.url));
const walk = d => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const snapshot = d => Object.fromEntries(walk(d).map(f => [relative(d, f), createHash('sha256').update(readFileSync(f)).digest('hex')]));
const fileEntry = (path, file) => ({ path, data: readFileSync(file).toString('base64') });
const folderFiles = () => walk(join(FX, 'folder')).map(f => fileEntry(`folder/${relative(join(FX, 'folder'), f).split('\\').join('/')}`, f));

let dir, server, base, changed = [];
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-round13-import-'));
  server = createServer({ dataDir: dir, importOptions: { onProjectChanged: id => changed.push(id) } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server?.listening) await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

const call = async (path, method = 'GET', body, retry = true) => {
  try { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; }
  catch (error) { if (retry && /ECONNRESET|socket/i.test(String(error.cause?.code || error.cause?.message))) return call(path, method, body, false); throw error; }
};
async function waitJob(jobId) {
  for (let i = 0; i < 900; i++) { const { body } = await call(`/api/import-html/jobs/${jobId}`); if (body.state !== 'running') return body; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('导入超时');
}
function makeProject(example, id, patch = {}) {
  const to = join(dir, 'projects', id);
  cpSync(join(EX, example), to, { recursive: true });
  const project = JSON.parse(readFileSync(join(to, 'project.json'), 'utf8'));
  Object.assign(project, { id, updatedAt: '2020-01-01T00:00:00.000Z' }, patch);
  writeFileSync(join(to, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return to;
}
const projectIds = () => readdirSync(join(dir, 'projects'));
const read = id => JSON.parse(readFileSync(join(dir, 'projects', id, 'project.json'), 'utf8'));

test('round13 import into project: folder pages inserted after the given page, assets and originals copied, no new project', async () => {
  const projectDir = makeProject('sample-deck', 'target-deck');
  const before = projectIds();
  const created = await call('/api/import-html/jobs', 'POST', { intoProject: 'target-deck', after: 'page_cover1', files: folderFiles() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = await waitJob(created.body.jobId);
  assert.equal(job.state, 'done', job.error);
  assert.equal(job.projectId, 'target-deck');
  assert.equal(job.summary.intoProject, true);
  assert.ok(job.pageIds.length >= 1);
  assert.deepEqual(projectIds(), before, '不新建项目');
  assert.deepEqual(changed, ['target-deck'], '写完调 onProjectChanged');
  assert.equal(existsSync(join(dir, '.import-tmp', created.body.jobId)), false, '临时文件已删');
  const project = read('target-deck');
  assert.notEqual(project.updatedAt, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(project.pages.map(p => p.id), ['page_cover1', ...job.pageIds, 'page_scene2', 'page_clip3']);
  const check = validateProjectData(project, { projectDir });
  assert.ok(check.ok, JSON.stringify(check.errors));
  for (const id of job.pageIds) {
    const page = project.pages.find(p => p.id === id);
    assert.equal(page.origin.file, 'index.html'); assert.equal(page.origin.project, undefined, '导入的页不算「拼进来的页」');
    assert.match(page.notes, /迁移说明/);
    const ref = /import\/[0-9]{8}-[0-9]{6}[^/]*\/index\.html/.exec(page.notes)?.[0];
    assert.ok(ref && existsSync(join(projectDir, ref)), `notes 里的原文件路径要指向目标项目里的文件：${page.notes}`);
    assert.equal(page.device, undefined);
    const html = readFileSync(join(projectDir, page.file), 'utf8');
    for (const r of scanResources(html)) { const rel = resolvePageRef(page.file, r); assert.ok(rel && existsSync(join(projectDir, rel)), `${page.file} 引用缺失：${r}`); }
  }
  assert.ok(project.assets.length > 2, '素材一起带进来并登记');
});

test('round13 import into project: missing / legacy / bad target and a vanished page fail in Chinese, target untouched', async () => {
  assert.equal((await call('/api/import-html/jobs', 'POST', { intoProject: '../x', files: folderFiles() })).status, 400);
  const missing = await waitJob((await call('/api/import-html/jobs', 'POST', { intoProject: 'no-such', files: [fileEntry('plain.html', join(FX, 'plain.html'))] })).body.jobId);
  assert.equal(missing.state, 'failed'); assert.match(missing.error, /找不到要导入进去的项目/);
  const legacyDir = makeProject('sample-deck', 'legacy-deck', { formatVersion: 2 });
  const legacyBefore = snapshot(legacyDir);
  const legacy = await waitJob((await call('/api/import-html/jobs', 'POST', { intoProject: 'legacy-deck', files: [fileEntry('plain.html', join(FX, 'plain.html'))] })).body.jobId);
  assert.equal(legacy.state, 'failed'); assert.match(legacy.error, /旧格式/);
  assert.deepEqual(snapshot(legacyDir), legacyBefore);
  const okDir = makeProject('sample-deck', 'gone-page');
  const okBefore = snapshot(okDir);
  const gone = await waitJob((await call('/api/import-html/jobs', 'POST', { intoProject: 'gone-page', after: 'page_nope', files: folderFiles() })).body.jobId);
  assert.equal(gone.state, 'failed'); assert.match(gone.error, /已经不存在/);
  assert.deepEqual(snapshot(okDir), okBefore, '失败时目标项目一个文件都不动');
  assert.ok(!projectIds().some(id => id.startsWith('import-')));
});

test('round13 import into a web project: kind follows the target, desktop + mobile pages appended at the end', async () => {
  makeProject('sample-web', 'target-web');
  const job = await waitJob((await call('/api/import-html/jobs', 'POST', { intoProject: 'target-web', after: null, files: folderFiles() })).body.jobId);
  assert.equal(job.state, 'done', job.error);
  const project = read('target-web');
  assert.deepEqual(project.pages.slice(0, 2).map(p => p.id), ['page_home_desk', 'page_home_mob']);
  assert.deepEqual(project.pages.slice(2).map(p => p.id), job.pageIds);
  assert.deepEqual(project.pages.slice(2).map(p => p.device).sort(), ['desktop', 'mobile']);
  assert.ok(validateProjectData(project, { projectDir: join(dir, 'projects', 'target-web') }).ok);
});

test('round13 filesFromDataTransfer: files, nested folders, .zip, junk skipped, nothing importable → []', async () => {
  const file = (name, text = 'x') => new File([text], name);
  const fileEntryOf = (name, f = file(name)) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(f) });
  const dirEntry = (name, children) => ({ isFile: false, isDirectory: true, name, createReader: () => { let done = false; return { readEntries: ok => { ok(done ? [] : children); done = true; } }; } });
  const dt = items => ({ items: items.map(e => ({ kind: 'file', webkitGetAsEntry: () => e, getAsFile: () => null })), files: [] });
  const tree = dirEntry('site', [fileEntryOf('index.html'), fileEntryOf('.DS_Store'), dirEntry('img', [fileEntryOf('a.png'), dirEntry('__MACOSX', [fileEntryOf('b.png')])])]);
  assert.deepEqual((await filesFromDataTransfer(dt([tree]))).map(e => e.path), ['site/index.html', 'site/img/a.png']);
  assert.deepEqual((await filesFromDataTransfer(dt([fileEntryOf('one.html')]))).map(e => e.path), ['one.html']);
  assert.deepEqual((await filesFromDataTransfer(dt([fileEntryOf('pack.zip'), fileEntryOf('note.txt')]))).map(e => e.path), ['pack.zip']);
  assert.deepEqual(await filesFromDataTransfer(dt([fileEntryOf('note.md'), fileEntryOf('pic.png')])), []);
  assert.deepEqual(await filesFromDataTransfer(null), []);
  // 没有 webkitGetAsEntry 的环境：用 files
  const plain = await filesFromDataTransfer({ items: [], files: [file('deck.html'), file('.DS_Store')] });
  assert.deepEqual(plain.map(e => e.path), ['deck.html']);
});

test('round13 import dialog: dropped files with autoStart — new project, and「导入为页面」into the open project', async t => {
  makeProject('sample-deck', 'dialog-deck');
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  const slides = readFileSync(join(FX, 'slides.html'), 'utf8');
  const folder = walk(join(FX, 'folder')).map(f => ({ path: `folder/${relative(join(FX, 'folder'), f).split('\\').join('/')}`, b64: readFileSync(f).toString('base64') }));
  await page.evaluate(() => {
    document.body.replaceChildren(); document.body.innerHTML = '<div id="modal-root"></div>';
    window.log = { done: [], created: [] };
    window.modal = html => { document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog">${html}</div></div>`; };
    window.closeModal = () => document.querySelector('#modal-root').replaceChildren();
    window.api = async (path, method = 'GET', body) => { const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; };
  });
  // 1) 拖进来一个文件夹（总览）：名称按文件夹名，直接开始，建新项目
  await page.evaluate(async folder => {
    const mod = await import('/import-html.js');
    const files = folder.map(e => ({ path: e.path, file: new File([Uint8Array.from(atob(e.b64), c => c.charCodeAt(0))], e.path.split('/').pop()) }));
    mod.openImportDialog({ api, modal, closeModal, files, autoStart: true, onDone: id => log.done.push(id), onCreated: id => log.created.push(id), pollMs: 100 });
  }, folder);
  assert.equal(await page.inputValue('input[name="name"]'), 'folder');
  await page.waitForSelector('.import-html__done:not([hidden])', { timeout: 120000 });
  assert.equal(await page.locator('[data-open]').isVisible(), true);
  const created = await page.evaluate(() => window.log.created);
  assert.equal(created.length, 1); assert.match(created[0], /^import-/);
  // 2) 导入为页面：标题、隐藏项目类型 / 画板 / 名称，完成「已导入 n 页」+「关闭」，onDone(projectId, pageIds)
  await page.evaluate(async slides => {
    window.log = { done: [], created: [] };
    const mod = await import('/import-html.js');
    mod.openImportDialog({ api, modal, closeModal, files: [{ path: 'slides.html', file: new File([slides], 'slides.html', { type: 'text/html' }) }], autoStart: true, intoProject: 'dialog-deck', after: 'page_cover1', onDone: (id, pageIds) => log.done.push([id, pageIds]), onCreated: id => log.created.push(id), pollMs: 100 });
  }, slides);
  assert.equal(await page.locator('.modal h2').innerText(), '导入为页面');
  await page.waitForSelector('.import-html__done:not([hidden])', { timeout: 120000 });
  assert.equal(await page.locator('[data-into-done]').innerText(), '已导入 3 页');
  assert.equal(await page.locator('[data-open]').isVisible(), false);
  assert.equal(await page.locator('.import-html__done [data-close]').innerText(), '关闭');
  for (const sel of ['[data-kind-field]', '[data-name-field]', '[data-deck-only]']) assert.equal(await page.locator(sel).first().isHidden(), true, sel);
  const log = await page.evaluate(() => window.log);
  assert.equal(log.done.length, 1); assert.equal(log.done[0][0], 'dialog-deck'); assert.equal(log.done[0][1].length, 3);
  const project = read('dialog-deck');
  assert.deepEqual(project.pages.map(p => p.id).slice(1, 4), log.done[0][1]);
  await page.click('.import-html__done [data-close]');
  assert.equal(await page.locator('.import-html').count(), 0);
  assert.deepEqual(errors, []);
});
