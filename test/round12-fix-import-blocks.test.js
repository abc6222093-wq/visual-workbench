// 第 12 轮修正 · 纯色色块也要标出来：
// 导入旧 HTML / 导入网页时，有可见底色、自身没有直接文字、不是图片的块标 data-vw="move resize background"（b1、b2…）；
// 整页背景（html、body、这一页的根和它的祖先，或盒子 ≥ 页面 95% 的块）只标 background（bg1、bg2…）。
// v2 转换：矩形 / 椭圆形状照旧带 move resize background，页面底色写在 body 上，标 data-vw-id="page_bg" data-vw="background"。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { startStatic } from '../src/import-html/analyze.js';
import { validateProjectData } from '../src/validate.js';
import { convertV2Project } from '../src/convert-v2.js';
import { scanMarks } from '../web/page-marks.js';

const FX = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const WEB = fileURLToPath(new URL('./fixtures/web-blocks/', import.meta.url));
const V2 = fileURLToPath(new URL('./fixtures/v2-projects/v2-deck/', import.meta.url));
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

let dir, server, base, site;
before(async () => {
  // 数据目录路径含中文和空格（用户的数据目录在网盘的「我的云端硬盘」里）
  dir = mkdtempSync(join(tmpdir(), '我的云端硬盘 色块-'));
  server = createServer({ dataDir: dir, importOptions: { urlTimeout: 20000 } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  site = await startStatic(WEB);
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
async function runImport(body) {
  const created = await call('/api/import-html/jobs', 'POST', { name: '色块 导入', preset: 'slide-16x9', ...body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let job;
  for (let i = 0; i < 900; i++) { ({ body: job } = await call(`/api/import-html/jobs/${created.body.jobId}`)); if (job.state !== 'running') break; await new Promise(r => setTimeout(r, 200)); }
  assert.equal(job.state, 'done', job.error);
  const projectDir = join(dir, 'projects', job.projectId);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const check = validateProjectData(project, { projectDir });
  assert.ok(check.ok, JSON.stringify(check.errors));
  const html = project.pages.map(p => readFileSync(join(projectDir, p.file), 'utf8'));
  for (const h of html) { const m = scanMarks(h); assert.deepEqual([m.duplicates, m.invalidIds, m.invalidCaps], [[], [], []]); assert.doesNotMatch(h, /data-vw-tmp/, '临时编号要去掉'); }
  return { job, project, html };
}
const fileEntry = (path, file) => ({ path, data: readFileSync(file).toString('base64') });
// [编号, 标签, 能力, 原网页定位]
const marks = html => scanMarks(html).items.map(m => [m.id, m.tag, m.caps.join(' '), m.origin]);
const byOrigin = (html, origin) => marks(html).find(m => m[3] === origin);

test('导入旧 HTML：色条、卡片底、印章、渐变圆点标 move resize background，整页背景只标 background，文字和图片照旧', async () => {
  const { job, project, html } = await runImport({ files: [fileEntry('blocks.html', join(FX, 'blocks.html'))] });
  assert.equal(job.summary.method, 'generic'); assert.equal(project.pages.length, 2);
  assert.deepEqual(marks(html[0]), [
    ['bg1', 'body', 'background', 'body'],
    ['bg2', 'section', 'background', 'section:nth-of-type(1)'], // 这一页的根
    ['bg3', 'div', 'background', 'div.overlay'], // 铺满整页的装饰层：只改颜色
    ['b1', 'div', 'move resize background', 'div.bar'],
    ['b2', 'div', 'move resize background', 'div.card'],
    ['t1', 'h3', 'text move color', 'h3'],
    ['t2', 'p', 'text move color', 'p'],
    ['b3', 'span', 'move resize background', 'span.seal'],
    ['b4', 'i', 'move resize background', 'i.dot'],
    ['b5', 'b', 'move resize background', 'b.chip'],
    ['i1', 'img', 'move resize crop', 'img'],
  ]);
  // 背景是图片的、透明的容器、不显示的、没有尺寸的都不标
  for (const cls of ['photo', 'wrap', 'ghost', 'zero']) assert.match(html[0], new RegExp(`<div class="${cls}">`), cls);
  assert.deepEqual(marks(html[1]), [['bg1', 'body', 'background', 'body'], ['bg2', 'section', 'background', 'section:nth-of-type(2)'], ['t1', 'h1', 'text move color', 'h1']]);
  assert.match(project.pages[0].notes, /纯色色块 5 个（b1、b2…，能力 move resize background），整页背景 3 处/);
  assert.equal(job.summary.blocks, 5); assert.equal(job.summary.backgrounds, 5);
});

test('导入网页（本地文件）：导航栏、首屏、卡片、圆点是色块；铺满整页的外层容器和 body 只标 background', async () => {
  const files = walk(WEB).map(f => ({ path: 'web-blocks/' + relative(WEB, f).split('\\').join('/'), file: f }));
  const { project, html } = await runImport({ name: '色块网页', kind: 'web', devices: ['desktop'], files: files.map(f => fileEntry(f.path, f.file)) });
  assert.equal(project.kind, 'web');
  assert.deepEqual(marks(html[0]).filter(m => m[2] !== 'text move color'), [
    ['bg1', 'body', 'background', 'body'],
    ['bg2', 'div', 'background', 'div.page'], // 铺满整页的外层容器
    ['b1', 'nav', 'move resize background', 'nav.nav'],
    ['b2', 'section', 'move resize background', 'section.hero'],
    ['b3', 'span', 'move resize background', 'span.badge'],
    ['b4', 'div', 'move resize background', 'div > div:nth-of-type(1) > div:nth-of-type(1)'],
    ['b5', 'div', 'move resize background', 'div > div:nth-of-type(1) > div:nth-of-type(2)'],
  ]);
  // 卡片里的文字照旧
  assert.ok(marks(html[0]).filter(m => m[2] === 'text move color').map(m => m[1]).join(' ').includes('h3 p h3 p'));
});

test('导入网页（网址）：抓当前画面时同样标出色块和整页背景', async () => {
  const { project, html } = await runImport({ name: '色块网址', kind: 'web', devices: ['desktop'], urls: [`${site.origin}/index.html`] });
  assert.equal(project.pages.length, 1);
  assert.deepEqual(marks(html[0]).filter(m => m[2] !== 'text move color').map(m => m.slice(0, 3)), [
    ['bg1', 'body', 'background'], ['bg2', 'div', 'background'],
    ['b1', 'nav', 'move resize background'], ['b2', 'section', 'move resize background'], ['b3', 'span', 'move resize background'],
    ['b4', 'div', 'move resize background'], ['b5', 'div', 'move resize background'],
  ]);
});

test('v2 转换：page_shapes3 的矩形 / 椭圆带 move resize background，页面底色（body）带 background', async t => {
  const tmp = mkdtempSync(join(tmpdir(), '我的云端硬盘 转换-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const projectDir = join(tmp, 'v2-deck');
  cpSync(V2, projectDir, { recursive: true });
  const result = await convertV2Project({ projectDir });
  assert.equal(result.converted, true);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  for (const page of project.pages) {
    const html = readFileSync(join(projectDir, page.file), 'utf8');
    assert.match(html, /<body data-vw-id="page_bg" data-vw="background">/, `${page.id} 的页面底色`);
    if (page.id !== 'page_shapes3') continue;
    const m = scanMarks(html).marks;
    for (const id of ['el_shp1', 'el_shp2', 'el_grp1bg', 'el_g1dot', 'el_grp1']) assert.deepEqual(m.get(id), ['move', 'resize', 'background'], id);
    assert.deepEqual(m.get('page_bg'), ['background']);
  }
});
