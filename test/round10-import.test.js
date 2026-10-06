import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { validateProjectData } from '../src/validate.js';
import { unzip } from '../src/import-html/zip.js';
import { deckData } from '../src/import-html/analyze.js';
import { cleanPath, pickEntry } from '../src/import-html/jobs.js';

const FX = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
let dir, server, base;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-round10-import-'));
  server = createServer({ dataDir: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server?.listening) await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });

// 空闲连接被服务端按 keep-alive 超时关掉时，fetch 偶尔复用到已断开的连接：遇到连接重置重发一次
const call = async (path, method = 'GET', body, retry = true) => {
  try { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; }
  catch (error) { if (retry && /ECONNRESET|socket/i.test(String(error.cause?.code || error.cause?.message))) return call(path, method, body, false); throw error; }
};
const fileEntry = (path, file) => ({ path, data: readFileSync(file).toString('base64') });
async function waitJob(jobId) {
  for (let i = 0; i < 600; i++) { const { body } = await call(`/api/import-html/jobs/${jobId}`); if (body.state !== 'running') return body; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('导入超时');
}
async function runImport(files, extra = {}) {
  const created = await call('/api/import-html/jobs', 'POST', { name: '导入测试', preset: 'slide-16x9', files, ...extra });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = await waitJob(created.body.jobId);
  assert.equal(job.state, 'done', job.error);
  const projectDir = join(dir, 'projects', job.projectId);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const check = validateProjectData(project, { projectDir });
  assert.ok(check.ok, JSON.stringify(check.errors));
  return { job, project, projectDir };
}
function zipOf(entries) { // 测试用：最简 zip 写法（deflate）
  const locals = [], centrals = []; let offset = 0;
  for (const { path, data } of entries) {
    const name = Buffer.from(path), comp = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, comp); centrals.push(central, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('round10 import helpers: zip, deck data, paths and entry', () => {
  const zip = zipOf([{ path: 'deck/index.html', data: Buffer.from('<h1>hi</h1>') }, { path: 'deck/img/a.png', data: Buffer.from([1, 2, 3]) }, { path: '__MACOSX/x', data: Buffer.from('x') }]);
  assert.deepEqual(unzip(zip).map(f => [f.path, f.data.length]), [['deck/index.html', 11], ['deck/img/a.png', 3]]);
  const deck = deckData('<script type="application/json" id="deck-data">{"slides":[{"html":"<html><body><img src=\\"__A_ASSET_0__\\"></body></html>"}],"assets":{"__A_ASSET_0__":"data:image/png;base64,AAAA"}}</script>');
  assert.equal(deck.slides.length, 1); assert.match(deck.slides[0], /data:image\/png;base64,AAAA/);
  assert.equal(deckData('<p>no deck</p>'), null);
  assert.throws(() => cleanPath('../x.html'), /路径/); assert.throws(() => cleanPath('/etc/passwd'), /路径/);
  assert.equal(pickEntry(['a/b.html', 'index.html', 'z.html']), 'index.html');
});

test('round10 import: unrecognized short page becomes one page holding the whole document (round12: kept as HTML)', async () => {
  const { job, project, projectDir } = await runImport([fileEntry('plain.html', join(FX, 'plain.html'))]);
  assert.equal(job.summary.method, 'fallback'); assert.equal(project.pages.length, 1);
  assert.match(job.summary.message, /没有识别出分页结构/);
  const html = readFileSync(join(projectDir, project.pages[0].file), 'utf8');
  assert.match(html, /<h1 data-vw-id="t1" data-vw="text move resize color"[^>]*>一个普通的短页面<\/h1>/);
  assert.match(html, /<p data-vw-id="t2" data-vw="text move resize color"[^>]*>没有分页结构<\/p>/);
});

test('round10 import: cancel stops a running job and leaves no project or temp files', async () => {
  const projectsBefore = readdirSync(join(dir, 'projects')).sort();
  const created = await call('/api/import-html/jobs', 'POST', { name: '要取消的', preset: 'slide-16x9', files: [fileEntry('reveal.html', join(FX, 'reveal.html'))] });
  assert.equal(created.status, 201);
  const cancelled = await call(`/api/import-html/jobs/${created.body.jobId}/cancel`, 'POST', {});
  assert.equal(cancelled.body.state, 'cancelled');
  for (let i = 0; i < 200 && readdirSync(join(dir, '.import-tmp')).length; i++) await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(readdirSync(join(dir, '.import-tmp')), []);
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await call(`/api/import-html/jobs/${created.body.jobId}`)).body.state, 'cancelled');
  assert.deepEqual(readdirSync(join(dir, 'projects')).sort(), projectsBefore);
  const bad = await call('/api/import-html/jobs', 'POST', { name: 'x', files: [{ path: '../evil.html', data: 'AAAA' }] });
  assert.equal(bad.status, 400);
  assert.equal((await call('/api/import-html/jobs/nope')).status, 404);
});

test('round10 import dialog: choose a file, see progress and summary, onDone gets the project id', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(async () => {
    document.body.replaceChildren(); document.body.innerHTML = '<div id="modal-root"></div>';
    window.log = { done: [], created: [], notices: [], steps: [] };
    const modal = html => { document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog">${html}</div></div>`; };
    const closeModal = () => document.querySelector('#modal-root').replaceChildren();
    const api = async (path, method = 'GET', body) => { const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; };
    const mod = await import('/import-html.js');
    window.guesses = [mod.guessArtboard('<style>.s{width:1920px;height:1080px}</style>'), mod.guessArtboard('<meta name="viewport" content="width=390">'), mod.guessArtboard('<div class="x" style="width:1280px;height:720px">'), mod.guessArtboard('<p>')];
    mod.openImportDialog({ api, modal, closeModal, notice: m => log.notices.push(m), onDone: id => log.done.push(id), onCreated: id => log.created.push(id), pollMs: 100 });
    new MutationObserver(() => { const s = document.querySelector('[data-step]')?.textContent; if (s && log.steps.at(-1) !== s) log.steps.push(s); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const guesses = await page.evaluate(() => window.guesses);
  assert.deepEqual(guesses.map(g => g && [g.preset, g.width, g.height]), [['slide-16x9', 1920, 1080], ['web-mobile', 390, 844], ['slide-16x9', 1920, 1080], null]);
  assert.equal(await page.locator('[data-start]').isDisabled(), true);
  await page.setInputFiles('input[name="file"]', join(FX, 'slides.html'));
  await page.waitForFunction(() => !document.querySelector('[data-start]').disabled);
  assert.equal(await page.inputValue('input[name="name"]'), 'slides');
  await page.waitForFunction(() => document.querySelector('[data-hint]').textContent.includes('自动识别'));
  assert.equal(await page.inputValue('select[name="preset"]'), 'slide-16x9');
  await page.click('[data-start]');
  await page.waitForSelector('.import-html__run:not([hidden])');
  await page.waitForSelector('.import-html__done:not([hidden])', { timeout: 120000 });
  assert.equal(await page.locator('[data-sum="pages"]').innerText(), '3');
  assert.equal(await page.locator('[data-sum="texts"]').innerText(), '6 处');
  assert.equal(await page.locator('[data-sum="images"]').innerText(), '2 张');
  const log = await page.evaluate(() => structuredClone(window.log));
  assert.ok(log.steps.some(s => /正在切出第 \d+ \/ 3 页|正在读取文件|正在上传/.test(s)), JSON.stringify(log.steps));
  assert.equal(log.created.length, 1);
  await page.click('[data-open]');
  const done = await page.evaluate(() => window.log.done);
  assert.deepEqual(done, log.created);
  assert.ok(existsSync(join(dir, 'projects', done[0], 'project.json')));
  assert.equal(await page.locator('.import-html').count(), 0, '打开项目时弹窗关闭');
  assert.deepEqual(errors, []);
});
