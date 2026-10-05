// 第 12 轮收尾：导入的旧 HTML / 网页里的文字也要能拖动。
// 用户会把 agent 在别处做好的 HTML 设计（大多是绝对定位）导进来，她需要能挪文字：导入时文字标 text move color
// （和 v2 转换来的文字一样），在编辑画布上从框线拖动能产生 move 修改。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { scanMarks } from '../web/page-marks.js';
import { clickInFrame, painted } from './round12-editor-fixture.js';

// agent 在别处做好的一页设计：绝对定位的标题、说明、角标（span 直接含文字）
const DESIGN = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#f6f1e7;font-family:sans-serif}
h1{position:absolute;left:160px;top:140px;margin:0;font-size:96px;color:#1f2937}
p{position:absolute;left:160px;top:320px;margin:0;width:900px;font-size:40px;line-height:1.5;color:#374151}
.tag{position:absolute;right:160px;top:160px;font-size:28px;color:#9a3412}
</style></head><body><h1>秋季企划</h1><p>把 agent 在别处做好的设计导进来，用户只挪一挪文字。</p><span class="tag">草稿 · 第 1 版</span></body></html>`;

let dir, server, base, browser;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), '我的云端硬盘 导入可移动-'));
  server = createServer({ dataDir: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close().catch(() => {});
  if (server?.listening) await new Promise(r => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (path, method = 'GET', body) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
async function importDesign() {
  const created = await call('/api/import-html/jobs', 'POST', { name: '别处做好的设计', preset: 'slide-16x9', files: [{ path: 'design.html', data: Buffer.from(DESIGN).toString('base64') }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let job;
  for (let i = 0; i < 900; i++) { job = (await call(`/api/import-html/jobs/${created.body.jobId}`)).body; if (job.state !== 'running') break; await new Promise(r => setTimeout(r, 200)); }
  assert.equal(job.state, 'done', job.error);
  const projectDir = join(dir, 'projects', job.projectId);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  return { job, project, projectDir, html: project.pages.map(p => readFileSync(join(projectDir, p.file), 'utf8')) };
}

test('导入的 HTML：每一处文字都标 text move color（能改字、挪动、改色），迁移说明也这么写', async () => {
  const { project, html } = await importDesign();
  assert.equal(project.pages.length, 1);
  const texts = scanMarks(html[0]).items.filter(m => /^t\d+$/.test(m.id));
  assert.equal(texts.length, 3, JSON.stringify(scanMarks(html[0]).items));
  for (const m of texts) assert.deepEqual(m.caps, ['text', 'move', 'color'], `${m.id}（${m.tag}）`);
  assert.deepEqual(texts.map(m => m.tag), ['h1', 'p', 'span']);
  assert.match(project.pages[0].notes, /可改的文字 3 处（data-vw-id t1、t2…，能力 text move color）/);
});

test('编辑画布上：导入的文字从框线拖动 → move 修改写进修改单；点在字上仍是改字', { timeout: 120000 }, async t => {
  const { project, projectDir } = await importDesign();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  t.after(() => page.close());
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.locator(`[data-action="open"][data-id="${project.id}"]`).click();
  await page.waitForSelector('#artboard[data-ready="1"]', { timeout: 20000 }); await painted(page);
  const frame = await (await page.$('#artboard > iframe')).contentFrame();
  await frame.waitForSelector('[data-vw-id="t1"]'); await frame.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const outer = await page.locator('#artboard > iframe').evaluate(f => { const r = f.getBoundingClientRect(); return { x: r.left, y: r.top, scale: r.width / f.offsetWidth }; });
  const box = await frame.locator('[data-vw-id="t1"]').evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  // 先点一下选中，再从左框线（框内 2 个屏幕像素）拖
  await clickInFrame(page, '[data-vw-id="t1"]', { at: { x: 2 / outer.scale, y: box.h / 2 } });
  await page.waitForTimeout(200);
  const sx = outer.x + box.x * outer.scale + 2, sy = outer.y + (box.y + box.h / 2) * outer.scale;
  await page.mouse.move(sx, sy); await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 20, { steps: 6 }); await page.mouse.move(sx + 80, sy + 40, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存');
  let moved;
  for (let i = 0; i < 50 && !moved; i++) { moved = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')).pages[0].edits.find(e => e.kind === 'move' && e.target === 't1'); if (!moved) await page.waitForTimeout(100); }
  assert.ok(moved, '拖动导入的标题写进了 move 修改');
  assert.ok(moved.after.dx > 0 && moved.after.dy > 0, JSON.stringify(moved.after));
  assert.notEqual(await frame.locator('[data-vw-id="t1"]').evaluate(n => getComputedStyle(n).translate), 'none', '画布上标题已挪动');
  // 点在字中间：进入改字（不是拖动）
  await page.keyboard.press('Escape');
  await clickInFrame(page, '[data-vw-id="t2"]');
  await frame.waitForFunction(() => document.activeElement?.dataset.vwId === 't2', null, { timeout: 5000 });
  assert.equal(await frame.evaluate(() => document.activeElement.isContentEditable), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});
