// 后退到上一页：显示那一页最后一步完成后的画面（像 PowerPoint）；前进仍从第 0 步开始
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';
import { exportHtml } from '../src/export/html.js';
import { createPlayback } from '../web/playback.js';

const SAMPLE = fileURLToPath(new URL('../examples/sample-deck/', import.meta.url));

// 第 1 页：初始化把标题藏起来；第 1 步淡入，第 2 步等一会儿再右移 100px（都用带 fill 的动画）
const PAGE1 = `export default async function (ctx) {
  const { node } = ctx.element('el_title1');
  const pose = node.style.transform || '';
  node.style.opacity = '0';
  return {
    async step(index) {
      if (index === 0) {
        await ctx.animate(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: 'forwards' });
      } else {
        await ctx.timer(400);
        await ctx.animate(node, [{ transform: pose + ' translateX(0px)' }, { transform: pose + ' translateX(100px)' }], { duration: 600, fill: 'forwards' });
      }
      node.dataset.done = String(index);
    }
  };
}`;
// 第 2 页：一步，卡片初始隐藏；换页时记下方向，以及那一刻目标页标题是否已经是结束画面
const PAGE2 = `export default async function (ctx) {
  const { node } = ctx.element('el_card2a');
  node.style.opacity = '0';
  return {
    async step() { await ctx.animate(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }); },
    async transition({ to, direction }) {
      to.dataset.arrival = String(direction);
      const title = to.querySelector('[data-element-id="el_title1"]');
      if (title) to.dataset.titleOpacityAtTransition = getComputedStyle(title).opacity;
    }
  };
}`;

function writeProject(dir) {
  cpSync(SAMPLE, dir, { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.pages[0].motion = { steps: 2, source: PAGE1 };
  project.pages[1].motion = { steps: 1, source: PAGE2 };
  project.pages[2].motion = { steps: 0, source: 'export default () => ({})' };
  writeFileSync(file, JSON.stringify(project, null, 2));
  return project;
}

async function openBrowser(t) {
  try { return await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') { t.skip('本机没有可用浏览器'); return null; } throw error; }
}

// 读舞台上唯一一张页面的状态
function stageState(page, stageSelector) {
  return page.evaluate(selector => {
    const boards = [...document.querySelectorAll(`${selector} [data-page-id]`)];
    const board = boards[0];
    const title = board?.querySelector('[data-element-id="el_title1"]');
    const card = board?.querySelector('[data-element-id="el_card2a"]');
    return {
      count: boards.length,
      pageId: board?.dataset.pageId,
      visibility: board?.style.visibility,
      arrival: board?.dataset.arrival,
      titleOpacityAtTransition: board?.dataset.titleOpacityAtTransition,
      titleOpacity: title && getComputedStyle(title).opacity,
      titleTransform: title && getComputedStyle(title).transform,
      titleDone: title?.dataset.done,
      cardOpacity: card && getComputedStyle(card).opacity
    };
  }, stageSelector);
}

// 等到舞台上只剩一张可见页面，且满足条件（stageState 的字段）
function until(page, stage, expected) {
  return page.waitForFunction(({ stage, expected }) => {
    const boards = [...document.querySelectorAll(`${stage} [data-page-id]`)];
    if (boards.length !== 1 || boards[0].style.visibility !== 'visible') return false;
    const board = boards[0];
    const title = board.querySelector('[data-element-id="el_title1"]');
    const card = board.querySelector('[data-element-id="el_card2a"]');
    const animating = board.getAnimations({ subtree: true }).some(a => a.playState === 'running' || a.playState === 'pending');
    const now = { pageId: board.dataset.pageId, titleDone: title?.dataset.done, titleOpacity: title && getComputedStyle(title).opacity, cardOpacity: card && getComputedStyle(card).opacity, animating };
    return Object.entries(expected).every(([key, value]) => now[key] === value);
  }, { stage, expected }, { timeout: 15000 });
}

// 共用的放映流程：前进播完第 1 页 → 第 2 页 → ← 回第 1 页（结束画面）→ → 直接到第 2 页（从第 0 步开始）
async function exercise({ page, stage, counter, idle, total }) {
  const state = () => stageState(page, stage);
  const wait = expected => until(page, stage, expected).then(idle);
  await wait({ pageId: 'page_cover1', titleOpacity: '0' });
  let s = await state();
  const startTransform = s.titleTransform;
  await page.keyboard.press('ArrowRight');
  await wait({ titleDone: '0', titleOpacity: '1', animating: false });
  await page.keyboard.press('ArrowRight');
  await wait({ titleDone: '1', animating: false });
  s = await state();
  const endTransform = s.titleTransform;
  assert.notEqual(endTransform, startTransform);
  await page.keyboard.press('ArrowRight');
  await wait({ pageId: 'page_scene2' });
  s = await state();
  assert.equal(s.cardOpacity, '0', '前进进入第 2 页：从第 0 步开始，卡片仍隐藏');
  assert.equal(await page.textContent(counter), `2 / ${total}`);

  // ← 回到第 1 页：页面一出现就是最后一步完成后的画面，没有重播
  const started = Date.now();
  await page.keyboard.press('ArrowLeft');
  await until(page, stage, { pageId: 'page_cover1' });
  const elapsed = Date.now() - started;
  s = await state();
  assert.equal(s.count, 1);
  assert.equal(s.arrival, '-1');
  assert.equal(s.titleOpacityAtTransition, '1', '换页效果开始前，上一页已经快进到结束画面');
  assert.equal(s.titleOpacity, '1');
  assert.equal(s.titleTransform, endTransform);
  assert.equal(s.titleDone, '1');
  assert.ok(elapsed < 1000, `后退用了 ${elapsed} ms，像是在重播动效`);
  await idle();
  assert.equal(await page.textContent(counter), `1 / ${total}`);

  // 下一次 → 直接去第 2 页，而且第 2 页从第 0 步开始
  await page.keyboard.press('ArrowRight');
  await wait({ pageId: 'page_scene2' });
  s = await state();
  assert.equal(s.cardOpacity, '0');
  assert.equal(await page.textContent(counter), `2 / ${total}`);
  await page.keyboard.press('ArrowRight');
  await wait({ cardOpacity: '1', animating: false });

  // 第 2 页播完步骤后按 ←：照旧去上一页（显示结束画面）
  await page.keyboard.press('ArrowLeft');
  await wait({ pageId: 'page_cover1' });
  s = await state();
  assert.equal(s.titleOpacity, '1');
  assert.equal(s.titleTransform, endTransform);
}

test('工作台放映：← 回到上一页显示结束画面，→ 直接去下一页并从第 0 步开始', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const dir = mkdtempSync(join(tmpdir(), 'vw-back-nav-'));
  const project = writeProject(join(dir, 'projects/sample-deck'));
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.locator('[data-action="play"]').click();
  await page.waitForSelector('#player-stage [data-page-id="page_cover1"]');
  // 工作台没有公开的忙碌标志：条件满足后再等一会儿，让换页 / 步骤的收尾跑完
  const idle = () => page.waitForTimeout(300);
  await exercise({ page, stage: '#player-stage', counter: '#player-page', idle, total: project.pages.length });
  assert.deepEqual(errors, []);
});

test('导出的放映文件：← 回到上一页显示结束画面，→ 直接去下一页并从第 0 步开始', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const dir = mkdtempSync(join(tmpdir(), 'vw-back-nav-export-'));
  t.after(async () => { await browser.close(); rmSync(dir, { recursive: true, force: true }); });
  const project = writeProject(join(dir, 'project'));
  const { file } = await exportHtml({ projectDir: join(dir, 'project'), outFile: join(dir, 'deck.html') });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => window.vwReady);
  const idle = () => page.waitForFunction(() => !window.vwPlayer.busy, null, { timeout: 15000 });
  await exercise({ page, stage: '#vw-stage', counter: '#vw-counter', idle, total: project.pages.length });
  assert.deepEqual(errors, []);
});

test('快进：步骤里的长 timer 立即完成，nextStep 等于步骤数', async () => {
  const source = `export default async function(ctx) {
    const {node}=ctx.element('item');
    await ctx.timer(10000);
    return { async step(index) { await ctx.timer(10000); await ctx.animate(node, [], { duration: 10000 }); node.style.left=(index+1)*10+'px'; } };
  }`;
  const node = { style: {}, animate: () => ({ finished: new Promise(() => {}), cancel() {}, effect: { getComputedTiming: () => ({ endTime: 10000 }) }, finish() { this.finished = Promise.resolve(); } }) };
  const root = { style: { visibility: 'visible' }, querySelector: () => node };
  const project = { id: 'p', formatVersion: 2, pages: [] };
  const page = { id: 'one', elements: [{ id: 'item', type: 'shape', x: 0, y: 0, width: 10, height: 10 }], motion: { steps: 3, source } };
  project.pages = [page];
  const started = Date.now();
  const playback = createPlayback(project, page, { root, startAtEnd: true });
  assert.equal(root.style.visibility, 'hidden', '快进期间页面隐藏');
  await playback.ready;
  assert.ok(Date.now() - started < 1000, `快进用了 ${Date.now() - started} ms`);
  assert.equal(playback.getState().nextStep, 3);
  assert.equal(node.style.left, '30px');
  assert.equal(root.style.visibility, 'visible', '快进完成后恢复显示');
  assert.equal(playback.next(), false);
  await playback.destroy();
});

test('快进途中出错：通过 onError 报告，ready 不失败，页面照常显示', async () => {
  const source = `export default () => ({ step(index) { if (index === 1) throw new Error('boom'); } })`;
  const root = { style: { visibility: '' }, querySelector: () => null };
  const project = { id: 'p', formatVersion: 2, pages: [] };
  const page = { id: 'one', elements: [], motion: { steps: 3, source } };
  project.pages = [page];
  const errors = [];
  const playback = createPlayback(project, page, { root, startAtEnd: true, onError: error => errors.push(error.message) });
  await playback.ready;
  assert.deepEqual(errors, ['boom']);
  assert.equal(playback.getState().nextStep, 3);
  assert.equal(root.style.visibility, '');
  await playback.destroy();
});
