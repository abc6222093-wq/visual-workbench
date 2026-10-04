import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { validateProjectData } from '../src/validate.js';
import { startStatic } from '../src/import-html/analyze.js';
import { nestGroups } from '../src/import-html/build.js';
import { normalizeUrls, normalizeDevices } from '../src/import-html/web.js';

// 第 11 轮 · 导入网页：本地文件夹 / 网址两种来源，电脑端 + 手机端各一页，组件成分组，origin 能定位回原网页，只读（只有 GET）
const SITE = fileURLToPath(new URL('./fixtures/web-site/', import.meta.url));
const LEGACY = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const siteFiles = () => walk(SITE).map(f => ({ path: 'web-site/' + relative(SITE, f).split('\\').join('/'), file: f }));
const REPO = fileURLToPath(new URL('..', import.meta.url));
// 异步跑动效检查：测试服务和它在同一进程，不能用同步子进程卡住服务
const checkMotion = projectDir => new Promise((resolve, reject) => execFile(process.execPath, [join(REPO, 'src/cli/check-motion.js'), projectDir], { encoding: 'utf8', timeout: 180000 }, (error, stdout, stderr) => (error ? reject(new Error(`check-motion 失败：${stderr}${stdout}`)) : resolve())));
const all = list => list.flatMap(e => [e, ...(e.type === 'group' ? all(e.children) : [])]);

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
async function runImport(body) {
  const created = await call('/api/import-html/jobs', 'POST', body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = await waitJob(created.body.jobId);
  assert.equal(job.state, 'done', job.error);
  const projectDir = join(dir, 'projects', job.projectId);
  const text = readFileSync(join(projectDir, 'project.json'), 'utf8'), project = JSON.parse(text);
  const check = validateProjectData(project, { projectDir });
  assert.ok(check.ok, JSON.stringify(check.errors));
  return { job, project, projectDir, text };
}

test('round11 import helpers: urls, devices, nested groups', () => {
  const { ok, bad } = normalizeUrls(['https://a.test/x', ' a.test/y ', 'https://a.test/x', 'ftp://a.test/', 'not a url', '']);
  assert.deepEqual(ok, ['https://a.test/x', 'https://a.test/y']);
  assert.deepEqual(bad.map(b => b.url), ['ftp://a.test/', 'not a url']);
  assert.deepEqual(normalizeDevices(['mobile', 'tv', 'mobile']), ['mobile']);
  assert.deepEqual(normalizeDevices(undefined), ['desktop', 'mobile']);
  const el = (id, x, y) => ({ id, type: 'shape', x, y, width: 10, height: 10 });
  const out = nestGroups([
    { el: el('a', 0, 0), groups: [] },
    { el: el('b', 100, 100), groups: ['g1'] }, { el: el('c', 120, 130), groups: ['g1', 'g2'] }, { el: el('d', 150, 100), groups: ['g1', 'g2'] },
    { el: el('e', 500, 500), groups: ['g3'] }, // 只有一个子元素：去掉外壳
  ], { g1: { name: '卡片', origin: { selector: 'div.card', tag: 'div' } } });
  assert.deepEqual(out.map(e => e.id ?? e.type), ['a', out[1].id, 'e']);
  const g1 = out[1];
  assert.equal(g1.type, 'group'); assert.equal(g1.name, '卡片'); assert.deepEqual([g1.x, g1.y, g1.width, g1.height], [100, 100, 60, 40]);
  assert.deepEqual(g1.origin, { selector: 'div.card', tag: 'div' });
  assert.equal(g1.children[0].id, 'b'); assert.deepEqual([g1.children[0].x, g1.children[0].y], [0, 0]);
  const g2 = g1.children[1]; assert.equal(g2.type, 'group'); assert.deepEqual([g2.x, g2.y], [20, 0]); assert.deepEqual(g2.children.map(c => [c.x, c.y]), [[0, 30], [30, 0]]);
  assert.deepEqual(out.map(e => e.zIndex), [1, 2, 3]);
});

test('round11 import: local folder as a web project (desktop + mobile, groups, origin, baseline)', async t => {
  const files = siteFiles(), before = files.map(f => sha(f.file));
  const { job, project, projectDir, text } = await runImport({ name: '晨光书店', kind: 'web', files: files.map(f => ({ path: f.path, data: readFileSync(f.file).toString('base64') })) });
  assert.equal(project.kind, 'web'); assert.deepEqual(project.artboard, { preset: 'web-desktop', width: 1440, height: 900 });
  assert.deepEqual(project.pages.map(p => p.device), ['desktop', 'mobile']);
  assert.deepEqual(project.pages.map(p => p.name), ['晨光书店 · 电脑端', '晨光书店 · 手机端']);
  const [desk, mob] = project.pages;
  assert.equal(desk.size.width, 1440); assert.equal(mob.size.width, 390);
  assert.ok(desk.size.height >= 2300 && desk.size.height <= 2600, `电脑端整页高 ${desk.size.height}`);
  assert.ok(mob.size.height > desk.size.height, `手机端卡片竖排，更长：${mob.size.height}`);
  assert.equal(desk.origin.file, 'index.html'); assert.ok(desk.origin.capturedAt);
  assert.deepEqual(job.summary.devices, { desktop: 1, mobile: 1 }); assert.ok(job.summary.groups >= 8, `分组 ${job.summary.groups}`);
  // 导航栏是分组（页顶、整宽），底层是背景形状
  const nav = desk.elements.find(e => e.type === 'group' && e.origin?.tag === 'nav');
  assert.ok(nav, '导航栏是分组'); assert.equal(nav.name.startsWith('导航栏'), true); assert.equal(nav.y, 0); assert.equal(nav.width, 1440);
  assert.equal(nav.children[0].type, 'shape'); assert.equal(nav.children[0].fill, '#1f2937'); assert.equal(nav.children[0].zIndex, 1);
  assert.deepEqual(nav.children.filter(c => c.type === 'text').map(c => c.text), ['新书', '关于我们', '会员专区']);
  // 按钮是分组：圆角背景 + 文字
  const btn = all(desk.elements).find(e => e.type === 'group' && e.name.startsWith('按钮'));
  assert.ok(btn); assert.equal(btn.children[0].fill, '#b45309'); assert.ok(btn.children[0].cornerRadius > 20); assert.equal(btn.children[1].text, '浏览新书');
  // 每个元素都有 origin；文字元素带原文
  for (const el of all(desk.elements)) { assert.ok(el.origin?.selector, `${el.name} 缺 origin`); if (el.type === 'text') assert.equal(el.origin.text, el.text.slice(0, 80)); }
  // 在原网页里逐个验证选择器：唯一、并且指向同一个标签；3 张卡片各是一个分组
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(site.origin + '/index.html');
  const groups = all(desk.elements).filter(e => e.type === 'group');
  const checks = await page.evaluate(list => list.map(o => { const found = document.querySelectorAll(o.selector); return { n: found.length, tag: found[0]?.localName, card: found[0]?.classList.contains('card') }; }), all(desk.elements).map(e => e.origin));
  checks.forEach((c, i) => { assert.equal(c.n, 1, `选择器不唯一：${all(desk.elements)[i].origin.selector}`); assert.equal(c.tag, all(desk.elements)[i].origin.tag); });
  const cards = groups.filter(g => checks[all(desk.elements).indexOf(g)].card);
  assert.equal(cards.length, 3, '3 张卡片各是一个分组');
  for (const card of cards) {
    assert.equal(card.children[0].type, 'shape'); assert.equal(card.children[0].fill, '#ffffff'); assert.equal(card.children[0].cornerRadius, 16); assert.deepEqual(card.children[0].stroke, { color: '#e5e7eb', width: 2 });
    assert.deepEqual(card.children.slice(1).map(c => c.type), ['text', 'text']);
    assert.deepEqual([card.children[0].x, card.children[0].y], [0, 0], '子元素相对分组');
  }
  assert.deepEqual(cards.map(c => c.children[1].text), ['山中来信', '海边的数学课', '城市夜行']);
  assert.ok(all(mob.elements).filter(e => e.type === 'group' && e.name.startsWith('卡片')).length === 3, '手机端也有 3 张卡片分组');
  // 素材：logo（svg）登记一次
  assert.equal(project.assets.filter(a => a.file.endsWith('.svg')).length, 1);
  // baseline.json 与 project.json 一致；原文件逐字节相同
  assert.equal(readFileSync(join(projectDir, 'import', 'baseline.json'), 'utf8'), text);
  for (const f of files) assert.equal(sha(join(projectDir, 'import', f.path.slice('web-site/'.length))), sha(f.file), f.path);
  assert.deepEqual(files.map(f => sha(f.file)), before);
  assert.match(desk.notes, /网页导入/); assert.match(desk.notes, /baseline\.json/);
  await checkMotion(projectDir);
});

test('round11 import: URLs from a local test site — read-only GET, login pages skipped', async () => {
  requests = [];
  const urls = [`${site.origin}/index.html`, `${site.origin}/members.html`, `${site.origin}/account.html`, 'not a url'];
  const { job, project, projectDir } = await runImport({ name: '网址导入', kind: 'web', urls, devices: ['desktop', 'mobile'] });
  assert.equal(project.kind, 'web'); assert.equal(project.pages.length, 2);
  assert.deepEqual(project.pages.map(p => [p.device, p.size.width, p.origin.url]), [['desktop', 1440, urls[0]], ['mobile', 390, urls[0]]]);
  assert.ok(project.pages[0].size.height >= 2300);
  assert.ok(project.pages[0].elements.some(e => e.type === 'group' && e.origin?.tag === 'nav'));
  // 图片从抓取到的响应里取，不另外下载
  assert.equal(project.assets.filter(a => a.file.endsWith('.svg')).length, 1);
  const skipped = job.summary.skipped;
  const reason = url => skipped.find(s => s.url === url)?.reason || '';
  assert.match(reason(urls[1]), /需要登录.*密码/);
  assert.match(reason(urls[2]), /需要登录.*登录页/);
  assert.match(reason('not a url'), /网址格式不正确/);
  assert.deepEqual(skipped.find(s => s.url === urls[1]).devices, ['desktop', 'mobile']);
  assert.match(project.description, /members\.html/); assert.match(project.description, /account\.html/);
  assert.match(project.pages[0].notes, /跳过的网址/);
  // 快照与来源记录
  assert.ok(existsSync(join(projectDir, 'import', 'pages', '01-desktop.html')));
  assert.ok(existsSync(join(projectDir, 'import', 'pages', '02-mobile.html')));
  const source = JSON.parse(readFileSync(join(projectDir, 'import', 'source.json'), 'utf8'));
  assert.deepEqual(source.pages.map(p => p.device), ['desktop', 'mobile']); assert.equal(source.skipped.length, 3);
  assert.equal(readFileSync(join(projectDir, 'import', 'baseline.json'), 'utf8'), readFileSync(join(projectDir, 'project.json'), 'utf8'));
  // 只读：原网站只收到 GET，没有打点、表单提交，也没有登录页以外的意外访问
  assert.ok(requests.length > 0);
  assert.deepEqual(requests.filter(r => r.method !== 'GET'), [], JSON.stringify(requests));
  const allowed = /^\/(index\.html|members\.html|account\.html|css\/site\.css|img\/logo\.svg|favicon\.ico|login(\?.*)?)$/;
  assert.deepEqual(requests.filter(r => !allowed.test(r.path)), [], JSON.stringify(requests));
  assert.ok(requests.some(r => r.path.startsWith('/login')), '跳转登录页那一下是 GET');
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

test('round11 import: deck import keeps its shape, adds origin and baseline.json', async () => {
  const { project, projectDir, text } = await runImport({ name: '课件', preset: 'slide-16x9', files: [{ path: 'slides.html', data: readFileSync(join(LEGACY, 'slides.html')).toString('base64') }] });
  assert.equal(project.kind, undefined); assert.equal(project.pages.length, 3);
  for (const p of project.pages) { assert.equal(p.device, undefined); assert.equal(p.size, undefined); assert.equal(p.origin.file, 'slides.html'); }
  assert.equal(project.pages.flatMap(p => p.elements).some(e => e.type === 'group'), false, '课件不分组');
  const title = project.pages[0].elements.find(e => e.text === '第一页标题');
  assert.equal(title.origin.tag, 'h1'); assert.equal(title.origin.text, '第一页标题');
  assert.equal(readFileSync(join(projectDir, 'import', 'baseline.json'), 'utf8'), text);
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
  assert.ok(Number(await page.locator('[data-sum="groups"]').innerText()) > 0);
  const created = await page.evaluate(() => window.log.created);
  const project = JSON.parse(readFileSync(join(dir, 'projects', created[0], 'project.json'), 'utf8'));
  assert.deepEqual(project.pages.map(p => p.device), ['desktop']);
  assert.deepEqual(errors, []);
});
