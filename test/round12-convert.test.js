// 第 12 轮：旧项目（v2）转换为 v3。
// 夹具在 test/fixtures/v2-projects/，参考图 reference/<项目>/<页面编号>.png 是用第 11 轮代码（c9da515）的
// `npm run export -- <项目> --images` 画的。这里转换后用真浏览器打开页面文件，跑完全部动效步骤再截图，逐像素对比。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { convertV2Project } from '../src/convert-v2.js';
import { scanMarks } from '../web/page-marks.js';
import { launchBrowser } from '../src/browser.js';
import { temporaryHome } from './helpers/temporary-home.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test/fixtures/v2-projects');
const NOW = new Date('2026-10-05T00:00:00.000Z');
// 参考图是 macOS 上的 Chrome 画的；Linux 的字体栅格化（hinting / 抗锯齿）不同，文字边缘会有成片的细微差别，所以 Linux 放宽到 8%，其他系统仍是 1%
const MAX_DIFF = process.platform === 'linux' ? 0.08 : 0.01;
const CHANNEL_TOLERANCE = 24; // 单个像素四个通道里最大差超过这个值才算不同（抗锯齿的细微差别不算）

function copyFixture(t, name) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-convert-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const projectDir = join(dir, name);
  cpSync(join(FIXTURES, name), projectDir, { recursive: true });
  return projectDir;
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const pageHtml = (projectDir, page) => readFileSync(join(projectDir, page.file), 'utf8');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };

// 有页面运行时（web/page-runtime.js）就照工作台的方式在 sandbox iframe 里跑；还没就绪时用一个最小替身直接打开页面文件、按顺序跑 init 和每一步。
const RUNTIME_FILE = join(ROOT, 'web/page-runtime.js');
const RUNTIME_STUB = 'window.vw = { motion(handlers) { window.__vwHandlers = handlers; } };';

// 照工作台的做法把页面放进 sandbox iframe（web/page-frame.js 的 buildSrcdoc 注入运行时），play 模式：ready → 快进到最后一步 → 等画面静止
async function playInFrame(tab, srcdoc, size) {
  return tab.evaluate(({ srcdoc, size }) => new Promise((resolve, reject) => {
    const errors = [];
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = `border:0;display:block;width:${size.width}px;height:${size.height}px`;
    const timer = setTimeout(() => reject(new Error('页面运行时超时')), 20000);
    const send = m => frame.contentWindow.postMessage(m, '*');
    addEventListener('message', event => {
      if (event.source !== frame.contentWindow) return;
      const m = event.data;
      if (!m || typeof m.vw !== 'string') return;
      if (m.vw === 'error') errors.push(`${m.phase}: ${m.message}`);
      if (m.vw === 'ready') send({ vw: 'toEnd' });
      if (m.vw === 'step-done') send({ vw: 'settle', timeout: 5000 });
      if (m.vw === 'settled') { clearTimeout(timer); resolve(errors); }
    });
    frame.srcdoc = srcdoc;
    document.body.append(frame);
  }), { srcdoc, size });
}

async function playWithStub(tab, steps) {
  await tab.evaluate(async steps => {
    await document.fonts.ready;
    const handlers = window.__vwHandlers;
    if (!handlers) return;
    const abort = new AbortController();
    let current = -1;
    const ctx = {
      root: document.body, signal: abort.signal, fast: false,
      get step() { return current; },
      animate: (node, keyframes, options) => node.animate(keyframes, options).finished,
      timer: ms => new Promise(r => setTimeout(r, ms)),
      importModule: path => import(new URL(path, location.origin).href),
    };
    await handlers.init?.(ctx);
    for (let i = 0; i < steps; i++) { current = i; await handlers.step(i, ctx); }
    const finite = a => Number.isFinite(a.effect?.getComputedTiming?.().endTime);
    await Promise.all(document.getAnimations().filter(finite).map(a => a.finished));
    await new Promise(r => setTimeout(r, 100));
  }, steps);
  return [];
}

async function renderPages(browser, projectDir, project, diagnostic = () => {}) {
  const shots = new Map();
  let runtimeText = existsSync(RUNTIME_FILE) ? readFileSync(RUNTIME_FILE, 'utf8') : null;
  let buildSrcdoc = null;
  if (runtimeText) {
    try { ({ buildSrcdoc } = await import('../web/page-frame.js')); }
    catch (error) { diagnostic(`web/page-frame.js 还不能加载（${error.message}），改用最小替身`); runtimeText = null; }
  }
  // 本地静态服务：/project/… 是项目文件夹，/vendor/… 是 web/vendor；页面在 null 源 iframe 里，字体和模块要 CORS
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/host.html') { res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end('<!doctype html><html><body style="margin:0"></body></html>'); }
    const file = path.startsWith('/vendor/') ? join(ROOT, 'web', path) : path.startsWith('/project/') ? join(projectDir, path.slice('/project/'.length)) : '';
    if (!file || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const ORIGIN = `http://127.0.0.1:${server.address().port}`;
  try {
  for (const page of project.pages) {
    const size = project.kind === 'web' ? page.size : project.artboard;
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
    if (!runtimeText) await context.addInitScript(RUNTIME_STUB);
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', e => errors.push(e.message));
    let shot;
    if (runtimeText) {
      await tab.goto(`${ORIGIN}/host.html`);
      const srcdoc = buildSrcdoc({ html: pageHtml(projectDir, page), mode: 'play', project, page, edits: [], baseHref: `${ORIGIN}/project/pages/`, runtimeText, fast: true });
      errors.push(...await playInFrame(tab, srcdoc, size));
      shot = await tab.locator('iframe').screenshot({ type: 'png' });
    } else {
      await tab.goto(`${ORIGIN}/project/${page.file}`, { waitUntil: 'load' });
      errors.push(...await playWithStub(tab, page.motion?.steps || 0));
      shot = await tab.screenshot({ fullPage: project.kind === 'web', type: 'png' });
    }
    assert.deepEqual(errors, [], `${page.id} 页面脚本出错`);
    shots.set(page.id, shot);
    await context.close();
  }
  } finally { server.close(); }
  return shots;
}

async function diffRatio(actualPng, expectedFile) {
  const a = await sharp(actualPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(expectedFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(a.info.width, b.info.width, '宽度不同');
  assert.equal(a.info.height, b.info.height, '高度不同');
  let different = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let max = 0;
    for (let c = 0; c < 4; c++) max = Math.max(max, Math.abs(a.data[i + c] - b.data[i + c]));
    if (max > CHANNEL_TOLERANCE) different++;
  }
  return different / (a.info.width * a.info.height);
}

// 第 12 轮校验器（C）就绪后 schema 的 formatVersion 是 3；之前只断言结构
function v3ValidatorReady() {
  try { return readJson(join(ROOT, 'schema/project.schema.json')).properties?.formatVersion?.const === 3; } catch { return false; }
}

function assertStructure(projectDir, before, result) {
  const project = readJson(join(projectDir, 'project.json'));
  assert.equal(result.converted, true);
  assert.equal(project.formatVersion, 3);
  assert.equal(project.kind, before.kind === 'web' ? 'web' : 'deck');
  assert.equal(project.updatedAt, NOW.toISOString());
  assert.ok(project.assets.every(a => a.kind === 'image' && !('pendingLayout' in a) && !('source' in a)));
  assert.deepEqual(project.fonts, before.fonts);
  // 自动存版
  const meta = readJson(join(result.versionDir, 'meta.json'));
  assert.equal(meta.note, '转换为 v3 前自动存版');
  assert.equal(meta.auto, 'convert-v3');
  assert.equal(readJson(join(result.versionDir, 'project.json')).formatVersion, 2);
  for (const [i, page] of project.pages.entries()) {
    const old = before.pages[i];
    assert.equal(page.id, old.id);
    assert.equal(page.file, `pages/${old.id}.html`);
    assert.deepEqual(page.edits, []);
    for (const key of ['elements', 'background', 'outline', 'variantOf']) assert.ok(!(key in page), `${page.id} 还留着 ${key}`);
    if (old.motion) assert.deepEqual(page.motion, { steps: old.motion.steps });
    if (before.kind === 'web') { assert.deepEqual(page.device, old.device); assert.deepEqual(page.size, old.size); }
    const { marks, duplicates, invalidIds } = scanMarks(pageHtml(projectDir, page));
    assert.deepEqual(duplicates, []); assert.deepEqual(invalidIds, []);
    const walk = list => { for (const el of list) { walk(el.children || []); const caps = marks.get(el.id); assert.ok(caps, `${el.id} 没有标记`);
      if (el.locked) assert.deepEqual(caps, []);
      else if (el.type === 'text') assert.deepEqual(caps, ['text', 'move', 'color']);
      else if (el.type === 'image' && !el.tint && !el.flipX && !el.flipY) assert.deepEqual(caps, ['move', 'resize', 'crop']);
      else if (el.type === 'shape') assert.deepEqual(caps, ['move', 'resize', ...(el.fill && ['rect', 'ellipse'].includes(el.shape || 'rect') ? ['background'] : [])]);
      else assert.ok(caps.includes('move') && caps.includes('resize'));
    } };
    walk(old.elements);
  }
  return project;
}

for (const name of ['v2-deck', 'v2-web']) {
  test(`转换 ${name}：结构、标记、自动存版，画面与第 11 轮导出逐像素一致`, async t => {
    const projectDir = copyFixture(t, name);
    const before = readJson(join(projectDir, 'project.json'));
    const result = await convertV2Project({ projectDir, now: NOW });
    const project = assertStructure(projectDir, before, result);

    if (name === 'v2-deck') {
      const motionPage = project.pages.find(p => p.id === 'page_motion4');
      assert.match(motionPage.notes, /原换页效果（transition）未搬，需 agent 用 leave 重写/);
      const html = pageHtml(projectDir, motionPage);
      assert.match(html, /vw\.motion\(/);
      assert.match(html, /\/vendor\/anime\.esm\.min\.js/); // 字面量路径留着，导出能打包
      assert.ok(!/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/.test(html.split(/<body[^>]*>/)[1]), '源码不能提前结束脚本');
      assert.ok(!project.pages.find(p => p.id === 'page_text1').notes, '没有动效的页面不加迁移说明');
    } else {
      assert.match(pageHtml(projectDir, project.pages[0]), /data-vw-origin="main h1"/);
      assert.deepEqual(project.pages[0].origin, before.pages[0].origin);
    }

    if (v3ValidatorReady()) {
      const { validateProject } = await import('../src/validate.js');
      const report = validateProject(projectDir);
      assert.ok(report.ok, JSON.stringify(report.errors || report, null, 2));
    } else t.diagnostic('v3 校验器还没就绪，只断言了结构');

    // 再转一次：已经是 v3，不动
    assert.deepEqual(await convertV2Project({ projectDir }), { converted: false, formatVersion: 3 });

    let browser;
    try { browser = await launchBrowser(); }
    catch (error) { if (error.code === 'NO_BROWSER') return t.skip('本机没有可用浏览器'); throw error; }
    t.after(() => browser.close());
    if (browser.vwEngine !== 'chromium') return t.skip('像素对比需要 Chromium（裁切用 object-view-box）');
    const shots = await renderPages(browser, projectDir, project, message => t.diagnostic(message));
    for (const page of project.pages) {
      const ratio = await diffRatio(shots.get(page.id), join(FIXTURES, 'reference', name, `${page.id}.png`));
      t.diagnostic(`${name} ${page.id} 差异像素 ${(ratio * 100).toFixed(3)}%`);
      assert.ok(ratio <= MAX_DIFF, `${name} ${page.id} 差异像素 ${(ratio * 100).toFixed(2)}% 超过 ${MAX_DIFF * 100}%`);
    }
  });
}

for (const [name, pattern] of [['v2-bad-source', /motion\.source 不是动效代码文本/], ['v2-bad-asset', /引用了不存在的素材：asset_missing/]]) {
  test(`转换失败（${name}）：项目文件逐字节不变，不产生 pages/`, async t => {
    const projectDir = copyFixture(t, name);
    const before = readFileSync(join(projectDir, 'project.json'));
    await assert.rejects(convertV2Project({ projectDir, now: NOW }), error => {
      assert.match(error.message, pattern);
      assert.match(error.message, /项目保持原样/);
      return true;
    });
    assert.ok(readFileSync(join(projectDir, 'project.json')).equals(before));
    assert.ok(!existsSync(join(projectDir, 'pages')));
    assert.equal(readdirSync(join(projectDir, 'versions')).filter(n => !n.startsWith('.')).length, 1, '自动存版仍然做了');
  });
}

test('npm run convert：按路径转换，第二次提示不用转换', t => {
  const projectDir = copyFixture(t, 'v2-web');
  const home = temporaryHome(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home, VW_DATA_DIR: join(home, 'data') };
  const run = () => spawnSync(process.execPath, [join(ROOT, 'src/cli/convert.js'), projectDir], { env, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /已转换为 v3/);
  assert.equal(readJson(join(projectDir, 'project.json')).formatVersion, 3);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /不用转换/);
  const bad = spawnSync(process.execPath, [join(ROOT, 'src/cli/convert.js')], { env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /用法/);
});

// 页面运行时和 iframe 外壳（子智能体 A）都能加载时才跑动效检查
const runtimeReady = existsSync(join(ROOT, 'web/page-runtime.js')) && await import('../web/page-frame.js').then(() => true, () => false);
test('动效检查：转换后的项目能跑通（页面运行时就绪后）', { skip: !runtimeReady && '页面运行时（web/page-runtime.js / web/page-frame.js）还没就绪' }, t => {
  const projectDir = copyFixture(t, 'v2-deck');
  return convertV2Project({ projectDir, now: NOW }).then(() => {
    const home = temporaryHome(t);
    // check-motion 只按项目路径工作、不读本机配置；保留真实 HOME 是为了让 Playwright 找到它装在用户缓存目录里的浏览器（CI 上没有系统 Chrome）
    const env = { ...process.env, VW_DATA_DIR: join(home, 'data') };
    const run = spawnSync(process.execPath, [join(ROOT, 'src/cli/check-motion.js'), projectDir], { env, encoding: 'utf8', timeout: 180000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  });
});
