import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
import { execFile } from 'node:child_process';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { validateProjectData } from '../src/validate.js';
import { startStatic } from '../src/import-html/analyze.js';
import { scanMarks, scanResources, resolvePageRef } from '../web/page-marks.js';

// 第 12 轮 · 导入保留原网页：按页切开，每页一个 pages/<页面编号>.html（原 HTML、CSS、脚本、动画都在），
// 文字标 text move color、图片标 move resize crop，资源复制进 assets/ fonts/，原文件逐字节复制进 import/。
const FX = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const SITE = fileURLToPath(new URL('./fixtures/web-site/', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
// 动效检查（A 的 check-motion，真浏览器按「页面 + 修改单」放映、快进）；异步子进程，不卡住同进程里的测试服务
const checkMotion = projectDir => new Promise((resolve, reject) => execFile(process.execPath, [join(REPO, 'src/cli/check-motion.js'), projectDir], { encoding: 'utf8', timeout: 180000 }, (error, stdout, stderr) => (error ? reject(new Error(`check-motion 失败：${stderr}${stdout}`)) : resolve())));
const fileEntry = (path, file) => ({ path, data: readFileSync(file).toString('base64') });

let dir, server, base, site, browser, requests = [];
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vw-round12-import-'));
  server = createServer({ dataDir: dir, importOptions: { urlTimeout: 20000 } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  site = await startStatic(SITE, { onRequest: (method, path) => requests.push({ method, path }) });
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close().catch(() => {});
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
  const created = await call('/api/import-html/jobs', 'POST', { name: '导入测试', preset: 'slide-16x9', ...body });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const job = await waitJob(created.body.jobId);
  assert.equal(job.state, 'done', job.error);
  const projectDir = join(dir, 'projects', job.projectId);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const check = validateProjectData(project, { projectDir });
  assert.ok(check.ok, JSON.stringify(check.errors));
  assert.equal(project.formatVersion, 3);
  const html = project.pages.map(p => readFileSync(join(projectDir, p.file), 'utf8'));
  for (const [i, p] of project.pages.entries()) {
    assert.equal(p.file, `pages/${p.id}.html`); assert.deepEqual(p.edits, []); assert.equal(p.motion, undefined, '导入不生成动效');
    assert.match(p.notes, /迁移说明/);
    const marks = scanMarks(html[i]);
    assert.deepEqual([marks.duplicates, marks.invalidIds, marks.invalidCaps], [[], [], []]);
    // 页面引用的相对资源都在项目里并且登记了
    for (const ref of scanResources(html[i])) { const rel = resolvePageRef(p.file, ref); assert.ok(rel && existsSync(join(projectDir, rel)), `${p.file} 引用缺失：${ref}`); }
  }
  return { job, project, projectDir, html };
}
const items = html => scanMarks(html).items;
const texts = html => items(html).filter(m => m.caps.join(' ') === 'text move resize color');
const imgs = html => items(html).filter(m => m.tag === 'img');
/** 直接用浏览器打开生成的页面文件：没有页面错误；返回可见文字和动画数。 */
async function openPage(file, viewport = { width: 1920, height: 1080 }) {
  const page = await browser.newPage({ viewport });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => ({ animations: document.getAnimations().length, marked: [...document.querySelectorAll('[data-vw-id]')].map(e => e.getAttribute('data-vw-id')), fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')) }));
    return { errors, ...info };
  } finally { await page.close(); }
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

test('round12 import: deck-data JSON — each slide document kept whole, CSS animations kept, text and image marked', async () => {
  const src = join(FX, 'deck.html'), before = sha(src);
  const { job, project, projectDir, html } = await runImport({ files: [fileEntry('deck.html', src)] });
  assert.equal(sha(src), before, '原文件不能被修改');
  assert.equal(sha(join(projectDir, 'import', 'deck.html')), before, 'import/ 里是逐字节相同的原文件');
  assert.equal(readdirSync(join(projectDir, 'import')).some(n => n.startsWith('__vw_slide')), false);
  assert.equal(job.summary.method, 'deck'); assert.equal(project.kind, 'deck'); assert.equal(project.pages.length, 2);
  assert.deepEqual(project.pages.map(p => p.name), ['课件第一页', '课件第二页']);
  for (const h of html) { assert.match(h, /@keyframes rise/); assert.match(h, /animation:rise 1\.5s/); }
  assert.deepEqual(texts(html[0]).map(m => m.id), ['t1', 't2']);
  assert.match(html[0], /<h1 data-vw-id="t1" data-vw="text move resize color" data-vw-origin="h1">课件第一页<\/h1>/);
  assert.deepEqual(imgs(html[0]).map(m => [m.id, m.caps.join(' ')]), [['i1', 'move resize crop']]);
  assert.equal(project.assets.length, 1); assert.equal(project.assets[0].kind, 'image'); assert.match(html[0], new RegExp(`src="\\.\\./${project.assets[0].file}"`));
  assert.doesNotMatch(html[0], /data:image/, '内嵌图片复制进 assets/');
  assert.match(project.pages[0].notes, /CSS 动画 rise/); assert.match(project.pages[0].notes, /课件 JSON/);
  assert.deepEqual(job.summary.animations.sort(), ['fade', 'rise']);
  const run = await openPage(join(projectDir, project.pages[0].file));
  assert.deepEqual(run.errors, []); assert.ok(run.animations >= 2, '原来的 CSS 动画照常播放'); assert.deepEqual(run.marked, ['bg1', 't1', 't2', 'i1'], '第 12 轮修正：body 的底色标成整页背景 bg1');
  await checkMotion(projectDir);
});

test('round12 import: <section class="slide"> deck — one section per page, ancestors and inline formatting kept', async () => {
  const { job, project, projectDir, html } = await runImport({ files: [fileEntry('slides.html', join(FX, 'slides.html'))] });
  assert.equal(job.summary.method, 'generic'); assert.equal(project.pages.length, 3);
  assert.deepEqual(project.pages.map(p => p.name), ['第一页标题', '第二页标题', '第三页标题']);
  for (const h of html) { assert.match(h, /@keyframes drop/); assert.equal((h.match(/<section/g) || []).length, 1, '只留这一页的 section'); }
  // 第 12 轮修正：这一页的根有底色，标成整页背景（只能改颜色），标记跟在 data-vw-import-page 后面
  assert.match(html[1], /<section class="slide two" data-vw-import-page="" data-vw-id="bg2" data-vw="background" data-vw-origin="section:nth-of-type\(2\)">/);
  assert.match(html[0], /这是第一页的段落，<strong>重点<\/strong>文字合并在一起。/, '行内格式保留在文字里');
  assert.deepEqual(project.pages.map((p, i) => imgs(html[i]).length), [1, 0, 1]);
  assert.equal(project.assets.length, 1, '同一张图只登记一次');
  assert.deepEqual(texts(html[1]).map(m => m.origin), ['section:nth-of-type(2) > h1', 'section:nth-of-type(2) > p']);
  for (const [i, p] of project.pages.entries()) { const run = await openPage(join(projectDir, p.file)); assert.deepEqual(run.errors, [], p.file); assert.ok(run.animations >= 1); }
});

test('round12 import: reveal.js — nested sections, fragments shown, CDN kept and listed, zoomed to the artboard', async () => {
  const { job, project, projectDir, html } = await runImport({ files: [fileEntry('reveal.html', join(FX, 'reveal.html'))] });
  assert.equal(job.summary.method, 'reveal'); assert.equal(project.pages.length, 4);
  assert.deepEqual(html.map(h => texts(h).length), [2, 2, 1, 1]);
  assert.match(html[0], /class="fragment visible"[^>]*>逐步出现的一句/);
  assert.match(html[2], /<canvas id="c"/); assert.match(html[2], /getElementById\('c'\)/, '内联脚本保留');
  assert.match(html[0], /\[data-vw-import-page\]\{zoom:2\}/); assert.match(html[0], /<div class="reveal"><div class="slides">/);
  assert.ok(job.summary.remote.some(u => u.includes('cdn.jsdelivr.net')), '没下载到的 CDN 列在摘要里');
  assert.match(project.pages[0].notes, /没下载到的网络地址.*cdn\.jsdelivr\.net/); assert.match(project.pages[0].notes, /fragment/);
  assert.match(html[0], /src="https:\/\/cdn\.jsdelivr\.net\/npm\/reveal\.js\/dist\/reveal\.js"/, '下不到的外链保留原样');
  for (const p of project.pages) assert.deepEqual((await openPage(join(projectDir, p.file))).errors, [], p.file);
  await checkMotion(projectDir);
});

test('round12 import: 100vh screens — @font-face copied into fonts/, missing network font listed, background image copied', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-round12-scroll-'));
  try {
    const font = readFileSync(join(REPO, 'examples/sample-deck/fonts/Inter-Variable.ttf')).toString('base64');
    writeFileSync(join(tmp, 'scroll.html'), readFileSync(join(FX, 'scroll-template.html'), 'utf8').replace('__INTER_TTF__', font));
    const { job, project, projectDir, html } = await runImport({ files: [fileEntry('scroll.html', join(tmp, 'scroll.html'))] });
    assert.equal(job.summary.method, 'scroll'); assert.equal(project.pages.length, 3);
    assert.deepEqual(project.fonts.map(f => [f.family, f.weight]), [['InterImport', 'variable']]);
    assert.match(html[0], new RegExp(`url\\("\\.\\./${project.fonts[0].file}"\\)`));
    assert.deepEqual(job.summary.missingFonts, ['RemoteFont']); assert.match(project.pages[0].notes, /缺失字体.*RemoteFont/);
    assert.match(html[1], /\.hero\{background-image:url\("\.\.\/assets\/[^"]+\.png"\)/);
    assert.equal(project.assets.filter(a => a.kind === 'image').length, 1);
    assert.deepEqual(html.map(h => texts(h).map(m => m.id)), [['t1', 't2'], ['t1'], ['t1', 't2']]);
    const run = await openPage(join(projectDir, project.pages[0].file));
    assert.deepEqual(run.errors, []); assert.ok(run.fonts.includes('InterImport'), '字体从 ../fonts/ 加载成功');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('round12 import: no page structure — fallback cuts the whole document by artboard height', async () => {
  const { job, project, projectDir, html } = await runImport({ files: [fileEntry('long.html', join(FX, 'long.html'))] });
  assert.equal(job.summary.method, 'fallback'); assert.equal(project.pages.length, 3); assert.match(job.summary.message, /保底/);
  assert.doesNotMatch(html[0], /margin-top:-/);
  assert.match(html[1], /body\{margin-top:-1080px!important/); assert.match(html[2], /body\{margin-top:-2160px!important/);
  for (const h of html) { assert.match(h, /@keyframes glow/); assert.match(h, /第三屏才看得到的文字/); }
  assert.match(project.pages[1].notes, /保底切分/);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  try {
    await page.goto(pathToFileURL(join(projectDir, project.pages[2].file)).href);
    const top = await page.evaluate(() => document.querySelector('.late').getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 1080, `第 3 页露出第三屏：${top}`);
  } finally { await page.close(); }
});

test('round12 import: folder with relative paths and the same folder as .zip — CSS and images copied, originals unchanged', async () => {
  const files = walk(join(FX, 'folder')).map(f => ({ path: 'folder/' + relative(join(FX, 'folder'), f).split('\\').join('/'), file: f }));
  const before = files.map(f => sha(f.file));
  const check = ({ project, projectDir, html }) => {
    assert.equal(project.pages.length, 2);
    for (const h of html) assert.match(h, /<link rel="stylesheet" href="\.\.\/assets\/style\.css">/);
    assert.deepEqual(html.map(h => imgs(h).length), [1, 2]);
    assert.deepEqual(project.assets.map(a => [a.file, a.kind]).sort(), [['assets/other.png', 'image'], ['assets/photo.png', 'image'], ['assets/style.css', 'file']]);
    for (const f of files) assert.equal(sha(join(projectDir, 'import', f.path.slice('folder/'.length))), sha(f.file), f.path);
    assert.ok(existsSync(join(projectDir, 'import', 'README.md')));
  };
  check(await runImport({ files: files.map(f => fileEntry(f.path, f.file)) }));
  const zip = zipOf(files.map(f => ({ path: f.path, data: readFileSync(f.file) })));
  check(await runImport({ files: [{ path: 'folder.zip', data: zip.toString('base64') }] }));
  assert.deepEqual(files.map(f => sha(f.file)), before);
});

test('round12 import: local web folder — desktop + mobile pages of the original file, origin selectors find the original elements', async () => {
  const files = walk(SITE).map(f => ({ path: 'web-site/' + relative(SITE, f).split('\\').join('/'), file: f })), before = files.map(f => sha(f.file));
  const { job, project, projectDir, html } = await runImport({ name: '晨光书店', kind: 'web', files: files.map(f => fileEntry(f.path, f.file)) });
  assert.equal(project.kind, 'web'); assert.deepEqual(project.artboard, { preset: 'web-desktop', width: 1440, height: 900 });
  assert.deepEqual(project.pages.map(p => [p.name, p.device, p.size.width]), [['晨光书店 · 电脑端', 'desktop', 1440], ['晨光书店 · 手机端', 'mobile', 390]]);
  assert.ok(project.pages[0].size.height >= 2300 && project.pages[0].size.height <= 2600, `电脑端整页高 ${project.pages[0].size.height}`);
  assert.ok(project.pages[1].size.height > project.pages[0].size.height);
  assert.match(html[0], /<link rel="stylesheet" href="\.\.\/assets\/site\.css">/); assert.match(html[0], /<script>/, '本地文件的脚本保留');
  assert.deepEqual(job.summary.devices, { desktop: 1, mobile: 1 });
  const marks = items(html[0]);
  assert.ok(marks.some(m => m.tag === 'h1') && marks.some(m => m.tag === 'button') && marks.filter(m => m.tag === 'h3').length === 3);
  assert.equal(marks.some(m => m.tag === 'div' && m.caps.includes('text')), false, '卡片容器不当文字');
  // origin 选择器在原网页里唯一并指向同一个标签
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(site.origin + '/index.html');
    const found = await page.evaluate(list => list.map(o => { const all = document.querySelectorAll(o); return [all.length, all[0]?.localName]; }), marks.map(m => m.origin));
    found.forEach(([n, tag], i) => { assert.equal(n, 1, marks[i].origin); assert.equal(tag, marks[i].tag); });
  } finally { await page.close(); }
  for (const f of files) assert.equal(sha(join(projectDir, 'import', f.path.slice('web-site/'.length))), sha(f.file), f.path);
  assert.deepEqual(files.map(f => sha(f.file)), before);
  assert.deepEqual((await openPage(join(projectDir, project.pages[1].file), { width: 390, height: 844 })).errors, []);
});

test('round12 import: URLs from a local test site — current DOM with inlined styles, images downloaded, GET only, login pages skipped', async () => {
  requests = [];
  const urls = [`${site.origin}/index.html`, `${site.origin}/members.html`, `${site.origin}/account.html`];
  const { job, project, projectDir, html } = await runImport({ name: '网址导入', kind: 'web', urls, devices: ['desktop', 'mobile'] });
  assert.deepEqual(project.pages.map(p => [p.device, p.origin.url]), [['desktop', urls[0]], ['mobile', urls[0]]]);
  for (const h of html) {
    assert.doesNotMatch(h, /<script/i, '网址抓取不保留脚本');
    assert.match(h, /<style data-vw-from="[^"]*site\.css">[\s\S]*\.site-nav/, '样式表内联');
    assert.match(h, /src="\.\.\/assets\/logo\.svg"/, '图片下载进 assets/');
  }
  assert.deepEqual(project.assets.map(a => [a.file, a.kind]), [['assets/logo.svg', 'image']]);
  const reason = url => job.summary.skipped.find(s => s.url === url)?.reason || '';
  assert.match(reason(urls[1]), /需要登录.*密码/); assert.match(reason(urls[2]), /需要登录.*登录页/);
  assert.match(project.description, /members\.html/); assert.match(project.description, /account\.html/);
  assert.match(project.pages[0].notes, /跳过的网址[\s\S]*members\.html[\s\S]*account\.html/);
  assert.ok(existsSync(join(projectDir, 'import', 'pages', '01-desktop.html')));
  const source = JSON.parse(readFileSync(join(projectDir, 'import', 'source.json'), 'utf8'));
  assert.deepEqual(source.pages.map(p => p.device), ['desktop', 'mobile']); assert.equal(source.skipped.length, 2);
  assert.ok(requests.length > 0);
  assert.deepEqual(requests.filter(r => r.method !== 'GET'), [], JSON.stringify(requests));
  const allowed = /^\/(index\.html|members\.html|account\.html|css\/site\.css|img\/logo\.svg|favicon\.ico|login(\?.*)?)$/;
  assert.deepEqual(requests.filter(r => !allowed.test(r.path)), [], JSON.stringify(requests));
  assert.deepEqual((await openPage(join(projectDir, project.pages[0].file), { width: 1440, height: 900 })).errors, []);
});
