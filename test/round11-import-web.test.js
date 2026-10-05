import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { startStatic } from '../src/import-html/analyze.js';
import { normalizeUrls, normalizeDevices } from '../src/import-html/web.js';

// 第 11 轮 · 导入网页：网址校验、全部跳过时失败、弹窗。第 12 轮起页面保留原网页，导入结果的断言在 test/round12-import.test.js
const SITE = fileURLToPath(new URL('./fixtures/web-site/', import.meta.url));
let dir, server, base, site, requests = [];
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-round11-import-'));
  server = createServer({ dataDir: dir, importOptions: { urlTimeout: 20000 } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  // 被抓取的「原网站」：记录收到的每个请求的方法与路径
  site = await startStatic(SITE, { onRequest: (method, path) => requests.push({ method, path }) });
});
after(async () => {
  if (server?.listening) await new Promise(r => server.close(r));
  if (site) await new Promise(r => site.server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (path, method = 'GET', body, retry = true) => {
  try { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; }
  catch (error) { if (retry && /ECONNRESET|socket/i.test(String(error.cause?.code || error.cause?.message))) return call(path, method, body, false); throw error; }
};
async function waitJob(jobId) {
  for (let i = 0; i < 900; i++) { const { body } = await call(`/api/import-html/jobs/${jobId}`); if (body.state !== 'running') return body; await new Promise(r => setTimeout(r, 200)); }
  throw new Error('导入超时');
}
test('round11 import helpers: urls and devices', () => {
  const { ok, bad } = normalizeUrls(['https://a.test/x', ' a.test/y ', 'https://a.test/x', 'ftp://a.test/', 'not a url', '']);
  assert.deepEqual(ok, ['https://a.test/x', 'https://a.test/y']);
  assert.deepEqual(bad.map(b => b.url), ['ftp://a.test/', 'not a url']);
  assert.deepEqual(normalizeDevices(['mobile', 'tv', 'mobile']), ['mobile']);
  assert.deepEqual(normalizeDevices(undefined), ['desktop', 'mobile']);
});


test('round11 import: all URLs skipped → the job fails with reasons; bad requests are rejected', async () => {
  const created = await call('/api/import-html/jobs', 'POST', { name: '全跳过', kind: 'web', urls: [`${site.origin}/members.html`, 'http://127.0.0.1:1/'], devices: ['desktop'] });
  assert.equal(created.status, 201);
  const job = await waitJob(created.body.jobId);
  assert.equal(job.state, 'failed'); assert.match(job.error, /没有导入任何网页/); assert.match(job.error, /需要登录/); assert.match(job.error, /连接不上|打不开/);
  assert.equal((await call('/api/import-html/jobs', 'POST', { name: 'x', kind: 'web', urls: [] })).status, 400);
  assert.equal((await call('/api/import-html/jobs', 'POST', { name: 'x', kind: 'web', urls: ['https://a.test/'], devices: ['tv'] })).status, 400);
  assert.equal((await call('/api/import-html/jobs', 'POST', { name: 'x', kind: 'poster', urls: ['https://a.test/'] })).status, 400);
});

test('round11 import dialog: web project from URLs shows device counts and skipped URLs', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(async () => {
    document.body.replaceChildren(); document.body.innerHTML = '<div id="modal-root"></div>';
    window.log = { done: [], created: [] };
    const modal = html => { document.querySelector('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog">${html}</div></div>`; };
    const api = async (path, method = 'GET', body) => { const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; };
    const mod = await import('/import-html.js');
    mod.openImportDialog({ api, modal, closeModal: () => document.querySelector('#modal-root').replaceChildren(), onDone: id => log.done.push(id), onCreated: id => log.created.push(id), pollMs: 100 });
  });
  assert.equal(await page.locator('select[name="preset"]').isVisible(), true);
  await page.check('input[name="kind"][value="web"]');
  assert.equal(await page.locator('select[name="preset"]').isVisible(), false, '网页不用选画板');
  await page.check('input[name="source"][value="urls"]');
  assert.equal(await page.locator('[data-start]').isDisabled(), true);
  await page.uncheck('input[name="mobile"]');
  await page.fill('textarea[name="urls"]', `${site.origin}/index.html\n${site.origin}/members.html`);
  assert.equal(await page.inputValue('input[name="name"]'), '127.0.0.1');
  await page.click('[data-start]');
  await page.waitForSelector('.import-html__done:not([hidden])', { timeout: 120000 });
  assert.equal(await page.locator('[data-sum="pages"]').innerText(), '1');
  assert.match(await page.locator('[data-sum="devices"]').innerText(), /电脑端 1 页，手机端 0 页/);
  assert.match(await page.locator('[data-sum="skipped"]').innerText(), /members\.html.*需要登录/);
  assert.match(await page.locator('[data-sum="texts"]').innerText(), /^\d+ 处$/);
  assert.ok(parseInt(await page.locator('[data-sum="texts"]').innerText(), 10) > 10);
  const created = await page.evaluate(() => window.log.created);
  const project = JSON.parse(readFileSync(join(dir, 'projects', created[0], 'project.json'), 'utf8'));
  assert.deepEqual(project.pages.map(p => p.device), ['desktop']);
  assert.deepEqual(errors, []);
});
