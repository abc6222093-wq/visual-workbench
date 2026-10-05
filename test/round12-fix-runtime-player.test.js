// 第 12 轮修正：独立放映页在真实服务下能打开（以前 player.js 直接读 /data/projects/<id>/project.json，真实服务不提供 → 404）。
// 用真实服务（临时数据目录，路径含中文和空格、临时 home），v3 多屏项目 + v2 项目（从放映页直接打开，服务先自动转换）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { until } from './round12-runtime-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STEPS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>.item{position:absolute;left:100px;width:100px;height:50px;background:#c00}</style></head><body>
<div id="a" class="item" style="top:100px" data-vw-id="a" data-vw="move"></div>
<div id="b" class="item" style="top:200px"></div>
<script>
window.__log = [];
vw.motion({
  init(ctx) { __log.push('init:' + ctx.fast); for (const el of document.querySelectorAll('.item')) el.style.opacity = '0'; },
  async step(i, ctx) { __log.push('step' + i); const el = document.querySelectorAll('.item')[i]; await ctx.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' }); el.style.opacity = '1'; }
});
</script></body></html>`;
const PLAIN_PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1 data-vw-id="t" data-vw="text">第二页</h1></body></html>';

let root, dataDir, server, origin, browser;
test.before(async () => {
  root = mkdtempSync(join(tmpdir(), '我的云端硬盘 测试-'));
  dataDir = join(root, '视觉 工作台 数据');
  const dir = join(dataDir, 'projects', 'play-v3');
  mkdirSync(join(dir, 'pages'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'pages', 'page_one.html'), STEPS_PAGE);
  writeFileSync(join(dir, 'pages', 'page_two.html'), PLAIN_PAGE);
  const now = '2026-10-05T12:00:00.000Z';
  writeFileSync(join(dir, 'project.json'), JSON.stringify({
    format: 'visual-workbench/project', formatVersion: 3, id: 'play-v3', name: '放映测试', createdAt: now, updatedAt: now,
    artboard: { preset: 'custom', width: 960, height: 540 }, assets: [], fonts: [],
    pages: [
      { id: 'page_one', name: '一', file: 'pages/page_one.html', edits: [], motion: { steps: 2 } },
      { id: 'page_two', name: '二', file: 'pages/page_two.html', edits: [] }
    ]
  }, null, 2));
  cpSync(join(HERE, 'fixtures/v2-projects/v2-deck'), join(dataDir, 'projects', 'v2-deck'), { recursive: true });
  server = createServer({ dataDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
test.after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(r => server.close(r));
  rmSync(root, { recursive: true, force: true });
});

async function openPlayer(t, query) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/player.html?${query}`);
  await until(() => page.evaluate(() => {
    const m = document.getElementById('message');
    return (m.hidden && window.__vwPlayback) || /无法放映|缺少|还没有页面/.test(m.textContent) ? true : false;
  }), { timeout: 15000, label: '放映页就绪' });
  const message = await page.evaluate(() => ({ hidden: document.getElementById('message').hidden, text: document.getElementById('message').textContent }));
  assert.equal(message.hidden, true, `放映页提示：${message.text}`);
  return { page, errors };
}
const visibleFrame = async page => (await page.$('#stage iframe:not([aria-hidden])')).contentFrame();

test('真实服务：放映页打开 v3 项目，点击推进、翻页、往回翻停在最后一步', async t => {
  const { page, errors } = await openPlayer(t, 'project=play-v3&page=page_one');
  const state = () => page.evaluate(() => { const s = window.__vwPlayback.getState(); return { index: s.index, pageId: s.pageId, nextStep: s.nextStep, total: s.total }; });
  const idle = () => until(() => page.evaluate(() => !window.__vwPlayback.isBusy()), { label: '空闲' });
  assert.deepEqual(await state(), { index: 0, pageId: 'page_one', nextStep: 0, total: 2 });
  await page.mouse.click(600, 400);
  await until(async () => (await state()).nextStep === 1, { label: '点击走一步' });
  await idle();
  await page.mouse.click(600, 400);
  await until(async () => (await state()).nextStep === 2, { label: '再走一步' });
  await idle();
  await page.keyboard.press('ArrowRight');
  await until(async () => (await state()).index === 1, { label: '翻到第 2 页' });
  await idle();
  assert.deepEqual(await state(), { index: 1, pageId: 'page_two', nextStep: 0, total: 0 });
  await page.keyboard.press('ArrowLeft');
  await until(async () => (await state()).index === 0, { label: '回到第 1 页' });
  await idle();
  assert.deepEqual(await state(), { index: 0, pageId: 'page_one', nextStep: 2, total: 2 }, '回上一页停在最后一步');
  const frame = await visibleFrame(page);
  assert.deepEqual(await frame.evaluate(() => [...document.querySelectorAll('.item')].map(el => getComputedStyle(el).opacity)), ['1', '1']);
  assert.deepEqual(errors, []);
});

test('真实服务：放映页直接打开 v2 项目（服务先自动转换）也能放映', async t => {
  const { page, errors } = await openPlayer(t, 'project=v2-deck');
  const s = await page.evaluate(() => window.__vwPlayback.getState());
  assert.equal(s.index, 0);
  assert.equal(s.count, 4);
  assert.equal(s.pageId, 'page_text1');
  const frame = await visibleFrame(page);
  assert.match(await frame.evaluate(() => document.body.textContent), /Hello Workbench/);
  await page.evaluate(() => window.__vwPlayback.goTo('page_motion4'));
  await until(() => page.evaluate(() => window.__vwPlayback.getState().pageId === 'page_motion4' && !window.__vwPlayback.isBusy()), { label: '跳到动效页' });
  const motion = await page.evaluate(() => window.__vwPlayback.getState());
  assert.equal(motion.total, 2);
  await page.mouse.click(600, 400);
  await until(() => page.evaluate(() => window.__vwPlayback.getState().nextStep === 1), { label: '动效页走一步' });
  assert.deepEqual(errors, []);
});
