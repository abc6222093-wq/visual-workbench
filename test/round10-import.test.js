import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { validateProjectData } from '../src/validate.js';
import { unzip } from '../src/import-html/zip.js';
import { deckData } from '../src/import-html/analyze.js';
import { cleanPath, pickEntry } from '../src/import-html/jobs.js';

const FX = fileURLToPath(new URL('./fixtures/legacy-html/', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = dir => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
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
const texts = page => page.elements.filter(e => e.type === 'text').map(e => e.text).sort();
const images = page => page.elements.filter(e => e.type === 'image');
const shots = page => images(page).filter(e => e.name.startsWith('[截图]'));
// 异步跑动效检查：测试服务和它在同一进程，不能用同步子进程卡住服务
const checkMotion = projectDir => new Promise((resolve, reject) => execFile(process.execPath, [join(REPO, 'src/cli/check-motion.js'), projectDir], { encoding: 'utf8', timeout: 180000 }, (error, stdout, stderr) => (error ? reject(new Error(`check-motion 失败：${stderr}${stdout}`)) : resolve())));
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

test('round10 import: <section class="slide"> deck with title, paragraph, data: image and background color', async () => {
  const src = join(FX, 'slides.html'), before = sha(src);
  const { job, project, projectDir } = await runImport([fileEntry('slides.html', src)]);
  assert.equal(sha(src), before, '原文件不能被修改');
  assert.equal(job.summary.method, 'generic'); assert.equal(job.summary.pages, 3); assert.equal(project.pages.length, 3);
  assert.deepEqual(texts(project.pages[0]), ['第一页标题', '这是第一页的段落，重点文字合并在一起。']);
  assert.deepEqual(texts(project.pages[1]), ['第二页标题', '第二页的段落\n第二行']);
  assert.deepEqual(project.pages.map(p => images(p).length), [1, 0, 1]);
  assert.equal(project.assets.length, 1, '同一张图只登记一次');
  assert.equal(project.assets[0].pendingLayout, false); assert.deepEqual(project.assets[0].source, { type: 'upload' });
  assert.deepEqual(project.pages.map(p => p.background), ['#1e3a8a', '#065f46', '#1e3a8a']);
  assert.equal(project.pages[0].name, '第一页标题');
  const title = project.pages[0].elements.find(e => e.text === '第一页标题');
  assert.equal(title.fontSize, 96); assert.equal(title.fontWeight, 700); assert.equal(title.color, '#ffffff'); assert.equal(title.x, 160);
  assert.match(project.pages[0].notes, /迁移说明/); assert.match(project.pages[0].notes, /页面容器/); assert.match(project.pages[0].notes, /重写 motion/);
  assert.equal(sha(join(projectDir, 'import', 'slides.html')), before);
  assert.match(readFileSync(join(projectDir, 'import', 'README.md'), 'utf8'), /旧 HTML 导入/);
  const brief = await call(`/api/projects/${job.projectId}/brief`);
  assert.match(brief.body.text, /旧 HTML 导入的项目/); assert.match(brief.body.text, /重写每页 motion/);
  await checkMotion(projectDir);
});

test('round10 import: reveal.js nested sections and canvas screenshot', async () => {
  const { job, project, projectDir } = await runImport([fileEntry('reveal.html', join(FX, 'reveal.html'))]);
  assert.equal(job.summary.method, 'reveal'); assert.equal(project.pages.length, 4);
  assert.deepEqual(project.pages.map(texts), [['Reveal 封面', '逐步出现的一句'], ['嵌套第一页', '纵向一'], ['纵向二'], ['结束页']]);
  assert.deepEqual(project.pages.map(p => shots(p).length), [0, 0, 1, 0]);
  assert.equal(job.summary.shots, 1); assert.equal(job.summary.shotReasons.canvas, 1);
  const shot = shots(project.pages[2])[0];
  assert.equal(shot.width, 800); assert.equal(shot.height, 400); // 960 宽的幻灯片放大到 1920
  assert.match(project.pages[2].notes, /canvas/); assert.match(project.pages[0].notes, /fragment/); assert.match(project.pages[0].notes, /reveal/);
  await checkMotion(projectDir);
});

test('round10 import: 100vh screens with data: @font-face, missing network font and background-image', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-round10-scroll-'));
  try {
    const font = readFileSync(join(REPO, 'examples/sample-deck/fonts/Inter-Variable.ttf')).toString('base64');
    writeFileSync(join(tmp, 'scroll.html'), readFileSync(join(FX, 'scroll-template.html'), 'utf8').replace('__INTER_TTF__', font));
    const { job, project, projectDir } = await runImport([fileEntry('scroll.html', join(tmp, 'scroll.html'))]);
    assert.equal(job.summary.method, 'scroll'); assert.equal(project.pages.length, 3);
    assert.deepEqual(project.pages.map(texts), [['Screen One', 'first screen text'], ['Screen Two'], ['Screen Three', 'third screen text']]);
    assert.equal(project.fonts.length, 1); assert.equal(project.fonts[0].family, 'InterImport'); assert.equal(project.fonts[0].weight, 'variable');
    assert.ok(existsSync(join(projectDir, project.fonts[0].file)));
    const heading = project.pages[0].elements.find(e => e.text === 'Screen One'); assert.equal(heading.font, project.fonts[0].id);
    assert.equal(project.pages[0].elements.find(e => e.text === 'first screen text').font, null);
    assert.deepEqual(job.summary.missingFonts, ['RemoteFont']); assert.match(project.pages[0].notes, /缺失字体.*RemoteFont/);
    assert.deepEqual(project.pages.map(p => p.background), ['#fef3c7', '#fef3c7', '#fef3c7']);
    const bg = images(project.pages[1]); assert.equal(bg.length, 1); assert.equal(bg[0].locked, true); assert.equal(bg[0].width, 1920); assert.ok(bg[0].zIndex < Math.min(...project.pages[1].elements.filter(e => e !== bg[0]).map(e => e.zIndex)));
    await checkMotion(projectDir);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('round10 import: deck-data JSON slides with asset placeholders and CSS animation', async () => {
  const { job, project } = await runImport([fileEntry('deck.html', join(FX, 'deck.html'))]);
  assert.equal(job.summary.method, 'deck'); assert.equal(project.pages.length, 2);
  assert.deepEqual(project.pages.map(texts), [['动画文字一', '课件第一页'], ['动画文字二', '课件第二页']]);
  assert.deepEqual(project.pages.map(p => images(p).length), [1, 0]);
  const text = project.pages[0].elements.find(e => e.text === '课件第一页'); assert.equal(text.opacity, undefined, '动画播完后文字完全显示'); assert.equal(text.y < 120, true);
  assert.match(project.pages[0].notes, /CSS 动画 rise/); assert.match(project.pages[0].notes, /课件 JSON/);
  assert.equal(project.pages[0].background, '#0f172a');
});

test('round10 import: transform matrix rules, rotation, tinted mask, gradient mask, blend and @font-face placeholders', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-round10-transform-'));
  try {
    const font = readFileSync(join(REPO, 'examples/sample-deck/fonts/Inter-Variable.ttf')).toString('base64');
    writeFileSync(join(tmp, 'transforms.html'), readFileSync(join(FX, 'transforms-template.html'), 'utf8').replace('__INTER_TTF__', font));
    const { job, project, projectDir } = await runImport([fileEntry('transforms.html', join(tmp, 'transforms.html'))]);
    assert.equal(job.summary.method, 'deck'); const page = project.pages[0], els = page.elements;
    // 资产表是纯字符串数组、@font-face 写 src:url(__T_ASSET_0__)：字体登记，weight 没写记 400，文字指向它
    assert.deepEqual(project.fonts.map(f => [f.family, f.weight]), [['Display', 400]]);
    const center = els.find(e => e.text === '居中标题'); assert.ok(center, '居中 translate 的文字不截图');
    assert.equal(center.font, project.fonts[0].id); assert.ok(Math.abs(center.x + center.width / 2 - 960) < 2, `居中位置 ${center.x}`);
    assert.equal(texts(page).includes('编辑文字'), false, '舞台外的播放器按钮不算页面内容');
    const tilt = els.find(e => e.text === '旋转卡片'); assert.equal(tilt.rotation, -8);
    assert.equal(els.find(e => e.type === 'shape' && e.fill === '#f4c430').rotation, -8);
    assert.deepEqual(shots(page).map(e => e.name), ['[截图] transform']); // 只有斜切的块截图
    assert.equal(els.find(e => e.fill === '#e76f51').width, 300); // scaleX 进度条按实际宽度
    assert.equal(els.find(e => e.text === '放大文字').fontSize, 60); // scale(1.5) 的文字字号放大
    const logo = els.find(e => e.tint); assert.equal(logo.tint, '#c0392b'); assert.equal(logo.fit, 'contain');
    const fade = els.find(e => e.effects?.mask); assert.deepEqual(fade.effects.mask.stops.map(s => s.opacity), [0, 1, 1]); assert.equal(fade.effects.mask.angle, 90);
    assert.equal(els.find(e => e.fill === '#7eddd2').effects.blend, 'multiply');
    assert.equal(job.summary.missingImages, 0);
    await checkMotion(projectDir);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('round10 import: folder with relative image paths, and the same folder as a .zip', async () => {
  const files = walk(join(FX, 'folder')).map(f => ({ path: 'folder/' + relative(join(FX, 'folder'), f).split('\\').join('/'), file: f }));
  const before = files.map(f => sha(f.file));
  const check = ({ project, projectDir, job }) => {
    assert.equal(job.summary.pages, 2);
    assert.deepEqual(project.pages.map(texts), [['文件夹第一页'], ['文件夹第二页']]);
    assert.deepEqual(project.pages.map(p => images(p).length), [1, 2]);
    assert.equal(project.assets.length, 2);
    for (const rel of ['index.html', 'img/photo.png', 'img/other.png', 'css/style.css', 'README.md']) assert.ok(existsSync(join(projectDir, 'import', rel)), rel);
  };
  check(await runImport(files.map(f => fileEntry(f.path, f.file))));
  const zip = zipOf(files.map(f => ({ path: f.path, data: readFileSync(f.file) })));
  check(await runImport([{ path: 'folder.zip', data: zip.toString('base64') }]));
  assert.deepEqual(files.map(f => sha(f.file)), before);
});

test('round10 import: unrecognized page falls back to one page with a Chinese explanation', async () => {
  const { job, project } = await runImport([fileEntry('plain.html', join(FX, 'plain.html'))]);
  assert.equal(job.summary.method, 'fallback'); assert.equal(project.pages.length, 1);
  assert.match(job.summary.message, /没有识别出分页结构/);
  assert.deepEqual(texts(project.pages[0]), ['一个普通的短页面', '没有分页结构']);
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
  assert.equal(await page.locator('[data-sum="shots"]').innerText(), '0');
  const log = await page.evaluate(() => structuredClone(window.log));
  assert.ok(log.steps.some(s => /正在分析第 \d+ \/ 3 页|正在读取文件|正在上传/.test(s)), JSON.stringify(log.steps));
  assert.equal(log.created.length, 1);
  await page.click('[data-open]');
  const done = await page.evaluate(() => window.log.done);
  assert.deepEqual(done, log.created);
  assert.ok(existsSync(join(dir, 'projects', done[0], 'project.json')));
  assert.equal(await page.locator('.import-html').count(), 0, '打开项目时弹窗关闭');
  assert.deepEqual(errors, []);
});
