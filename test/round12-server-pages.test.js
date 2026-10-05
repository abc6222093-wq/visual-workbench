// 第 12 轮：服务器——新建 v3 项目、页面整理接口、旧格式打开时转换、静态内容 CORS、页面脚本（null 源）不能改数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';
import { validateProject } from '../src/validate.js';
import { listVersions } from '../src/version.js';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-r12s-'));
  const server = createServer({ dataDir: dir, port: 4173, watchPollMs: 100 });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...headers }, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { dir, base, request };
}
const pageOp = (request, id, revision, body) => request(`/api/projects/${id}/pages`, 'POST', { revision, ...body });

test('新建项目：课件一页空白页文件；网页项目两页（电脑端 / 手机端），都通过完整校验', async (t) => {
  const { dir, request } = await fixture(t);
  const deck = await request('/api/projects', 'POST', { id: 'deck', name: '课件', preset: 'poster-a4' });
  assert.equal(deck.status, 201);
  assert.equal(deck.body.project.formatVersion, 3);
  assert.deepEqual(deck.body.project.pages, [{ id: 'page_first', name: '第 1 页', file: 'pages/page_first.html', edits: [] }]);
  assert.match(readFileSync(join(dir, 'projects/deck/pages/page_first.html'), 'utf8'), /<body>\s*<\/body>/);
  assert.equal(validateProject(join(dir, 'projects/deck')).ok, true);
  const web = await request('/api/projects', 'POST', { id: 'site', name: '网站', kind: 'web' });
  assert.equal(web.status, 201);
  const pages = web.body.project.pages;
  assert.deepEqual(pages.map((p) => [p.device, p.size.width]), [['desktop', 1440], ['mobile', 390]]);
  for (const p of pages) assert.ok(existsSync(join(dir, 'projects/site', p.file)));
  assert.equal(validateProject(join(dir, 'projects/site')).ok, true);
});

test('页面整理：新建（插在指定页后）、复制（文件和修改单一起，新编号）、删除（至少留一页，先存版）', async (t) => {
  const { dir, request } = await fixture(t);
  let { body } = await request('/api/projects', 'POST', { id: 'ops', name: '整理' });
  const root = join(dir, 'projects/ops');
  // 第 1 页写点内容和一条修改单
  writeFileSync(join(root, 'pages/page_first.html'), '<h1 data-vw-id="title" data-vw="text move">标题</h1>');
  const loaded = await request('/api/projects/ops');
  const project = loaded.body.project;
  project.pages[0].edits = [{ id: 'ed_first001', target: 'title', kind: 'move', before: { x: 0, y: 0, width: 10, height: 10 }, after: { dx: 3, dy: 4 } }];
  body = (await request('/api/projects/ops', 'PUT', { project, revision: loaded.body.revision })).body;

  assert.equal((await pageOp(request, 'ops', 'stale', { op: 'create' })).status, 409);
  const created = await pageOp(request, 'ops', body.revision, { op: 'create', name: '第二页' });
  assert.equal(created.status, 200);
  assert.equal(created.body.project.pages[1].name, '第二页');
  const newId = created.body.pageIds[0];
  assert.match(newId, /^page_/);
  assert.ok(existsSync(join(root, `pages/${newId}.html`)));
  const inserted = await pageOp(request, 'ops', created.body.revision, { op: 'create', after: 'page_first' });
  assert.deepEqual(inserted.body.project.pages.map((p) => p.id).filter((id) => id !== 'page_first').at(-1), newId);
  assert.equal(inserted.body.project.pages[1].id, inserted.body.pageIds[0]);
  assert.equal(inserted.body.project.pages[1].name, '第 3 页');

  const dup = await pageOp(request, 'ops', inserted.body.revision, { op: 'duplicate', pageIds: ['page_first'] });
  assert.equal(dup.status, 200);
  const copy = dup.body.project.pages[1];
  assert.equal(copy.name, '第 1 页 副本');
  assert.notEqual(copy.id, 'page_first');
  assert.equal(readFileSync(join(root, copy.file), 'utf8'), readFileSync(join(root, 'pages/page_first.html'), 'utf8'));
  assert.equal(copy.edits[0].target, 'title');
  assert.notEqual(copy.edits[0].id, 'ed_first001');

  const ids = dup.body.project.pages.map((p) => p.id);
  assert.equal((await pageOp(request, 'ops', dup.body.revision, { op: 'delete', pageIds: ids })).status, 400);
  assert.equal((await pageOp(request, 'ops', dup.body.revision, { op: 'delete', pageIds: ['page_none'] })).status, 400);
  const versionsBefore = listVersions(root).length;
  const deleted = await pageOp(request, 'ops', dup.body.revision, { op: 'delete', pageIds: [copy.id, newId] });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.project.pages.length, 2);
  assert.equal(existsSync(join(root, copy.file)), false);
  assert.equal(existsSync(join(root, `pages/${newId}.html`)), false);
  assert.equal(listVersions(root).length, versionsBefore + 1);
  assert.ok(existsSync(join(listVersions(root).at(-1), copy.file)), '删除前的版本里有被删的页面文件');
  assert.equal((await pageOp(request, 'ops', deleted.body.revision, { op: 'spin' })).status, 400);
  assert.equal(validateProject(root).ok, true);
});

test('页面整理：网页项目新建页带 device / size；copy-from 跨项目复制页面和资源', async (t) => {
  const { dir, request } = await fixture(t);
  const site = (await request('/api/projects', 'POST', { id: 'site', name: '网站', kind: 'web' })).body;
  const mob = await pageOp(request, 'site', site.revision, { op: 'create', device: 'mobile' });
  assert.equal(mob.status, 200);
  const page = mob.body.project.pages.at(-1);
  assert.deepEqual([page.device, page.size], ['mobile', { width: 390, height: 844 }]);
  assert.equal((await pageOp(request, 'site', mob.body.revision, { op: 'create', device: 'tv' })).status, 400);

  const src = (await request('/api/projects', 'POST', { id: 'src', name: '来源' })).body;
  const srcRoot = join(dir, 'projects/src');
  writeFileSync(join(srcRoot, 'assets/pic.png'), 'pic');
  writeFileSync(join(srcRoot, 'pages/page_first.html'), '<img data-vw-id="pic" data-vw="move" src="../assets/pic.png">');
  const sp = src.project; sp.assets = [{ id: 'asset_pic', kind: 'image', file: 'assets/pic.png' }];
  await request('/api/projects/src', 'PUT', { project: sp, revision: src.revision });

  const deck = (await request('/api/projects', 'POST', { id: 'deck', name: '课件' })).body;
  writeFileSync(join(dir, 'projects/deck/assets/pic.png'), '不一样的图');
  const copied = await pageOp(request, 'deck', deck.revision, { op: 'copy-from', fromProject: 'src', pageIds: ['page_first'] });
  assert.equal(copied.status, 200, JSON.stringify(copied.body));
  const newPage = copied.body.project.pages[1];
  assert.notEqual(newPage.id, 'page_first');
  assert.match(readFileSync(join(dir, 'projects/deck', newPage.file), 'utf8'), /\.\.\/assets\/pic-2\.png/);
  assert.ok(copied.body.project.assets.some((a) => a.file === 'assets/pic-2.png'));
  assert.equal(validateProject(join(dir, 'projects/deck')).ok, true);
  assert.equal((await pageOp(request, 'deck', copied.body.revision, { op: 'copy-from', fromProject: 'deck', pageIds: ['page_first'] })).status, 400);
  assert.equal((await pageOp(request, 'deck', copied.body.revision, { op: 'copy-from', fromProject: 'src', pageIds: ['page_x'] })).status, 400);
  // 复制到网页项目：页面补上 device / size
  const toWeb = await pageOp(request, 'site', mob.body.revision, { op: 'copy-from', fromProject: 'src', pageIds: ['page_first'] });
  assert.equal(toWeb.status, 200);
  assert.equal(toWeb.body.project.pages.at(-1).device, 'desktop');
});

test('旧格式：总览照常列出并标 legacy；打开时转换为 v3（先自动存版）；转换失败 409、项目原样', async (t) => {
  const { dir, request } = await fixture(t);
  const legacyDir = join(dir, 'projects/old-deck');
  mkdirSync(join(legacyDir, 'assets'), { recursive: true });
  mkdirSync(join(legacyDir, 'fonts'), { recursive: true });
  const now = '2026-01-01T00:00:00.000Z';
  const v2 = { format: 'visual-workbench/project', formatVersion: 2, id: 'old-deck', name: '旧课件', createdAt: now, updatedAt: now, artboard: { preset: 'slide-16x9', width: 1920, height: 1080 }, assets: [], fonts: [],
    pages: [{ id: 'page_cover', name: '封面', background: '#ffffff', elements: [{ id: 'el_title01', type: 'text', x: 100, y: 100, width: 600, height: 80, zIndex: 1, text: '旧标题', fontSize: 48, color: '#111111' }] }] };
  writeFileSync(join(legacyDir, 'project.json'), JSON.stringify(v2, null, 2));
  const list = (await request('/api/projects')).body;
  assert.equal(list.find((p) => p.id === 'old-deck').legacy, true);
  assert.equal(JSON.parse(readFileSync(join(legacyDir, 'project.json'), 'utf8')).formatVersion, 2, '列表不转换');
  const opened = await request('/api/projects/old-deck');
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.project.formatVersion, 3);
  assert.ok(existsSync(join(legacyDir, opened.body.project.pages[0].file)));
  assert.ok(listVersions(legacyDir).length >= 1, '转换前自动存版');
  assert.equal((await request('/api/projects')).body.find((p) => p.id === 'old-deck').legacy, undefined);

  const brokenDir = join(dir, 'projects/broken');
  mkdirSync(brokenDir, { recursive: true });
  const broken = JSON.stringify({ ...v2, id: 'broken', pages: 'not pages' });
  writeFileSync(join(brokenDir, 'project.json'), broken);
  const failed = await request('/api/projects/broken');
  assert.equal(failed.status, 409);
  assert.match(failed.body.error, /[一-龥]/);
  assert.equal(readFileSync(join(brokenDir, 'project.json'), 'utf8'), broken);
});

test('静态内容带 CORS；页面文件以 text/html 提供并被 CSP sandbox 隔离；页面脚本（Origin: null）能读不能改', async (t) => {
  const { dir, base, request } = await fixture(t);
  const made = (await request('/api/projects', 'POST', { id: 'cors', name: 'CORS' })).body;
  mkdirSync(join(dir, 'projects/cors/assets/js'), { recursive: true });
  writeFileSync(join(dir, 'projects/cors/assets/js/lib.js'), 'export default 1;');
  const page = await fetch(`${base}/data/projects/cors/pages/page_first.html`, { headers: { Origin: 'null' } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('access-control-allow-origin'), '*');
  assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.match(page.headers.get('cache-control'), /no-cache/);
  const nested = await fetch(`${base}/data/projects/cors/assets/js/lib.js`, { headers: { Origin: 'null' } });
  assert.equal(nested.status, 200);
  assert.match(nested.headers.get('content-type'), /javascript/);
  assert.equal(nested.headers.get('access-control-allow-origin'), '*');
  const ui = await fetch(`${base}/index.html`);
  assert.equal(ui.headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(`${base}/data/projects/cors/project.json`)).status, 404);
  assert.equal((await fetch(`${base}/data/projects/cors/versions/x`)).status, 404);
  for (const [path, method] of [['/api/projects/cors', 'PUT'], ['/api/projects/cors/pages', 'POST'], ['/api/projects/cors', 'PATCH'], ['/api/projects/cors', 'DELETE']]) {
    const r = await request(path, method, { revision: made.revision, op: 'create', name: 'x' }, { Origin: 'null' });
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.error, '页面里的脚本不能修改工作台数据');
  }
  assert.equal((await request('/api/projects', 'GET', undefined, { Origin: 'null' })).status, 403, '页面脚本读不到 /api/');
  assert.deepEqual(readdirSync(join(dir, 'projects/cors/pages')), ['page_first.html']);
});

test('「复制给 agent」：?pageIds 只写当前页；旧大纲路由已删除', async (t) => {
  const { dir, request } = await fixture(t);
  const made = (await request('/api/projects', 'POST', { id: 'brief', name: '说明' })).body;
  await pageOp(request, 'brief', made.revision, { op: 'create', name: '第二页' });
  const all = await request('/api/projects/brief/brief');
  assert.equal(all.status, 200);
  assert.match(all.body.text, /全部 2 页/);
  const one = await request('/api/projects/brief/brief?pageIds=page_first');
  assert.match(one.body.text, /只处理下面 1 页/);
  assert.ok(one.body.text.includes(join(dir, 'projects/brief/pages/page_first.html')));
  assert.equal((await request('/api/projects/brief/outline/brief')).status, 404);
  assert.equal((await request('/api/projects/brief/outline/apply', 'POST', {})).status, 404);
});
