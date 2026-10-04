// 第 11 轮：网页项目导出按每页自己的尺寸（PNG / PDF / 放映版 HTML）。只用临时目录，不碰真实数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportImages, exportPdf } from '../src/export/images.js';
import { exportHtml } from '../src/export/html.js';
import { launchBrowser } from '../src/browser.js';

const SAMPLE_WEB = fileURLToPath(new URL('../examples/sample-web/', import.meta.url));

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const noBrowser = (t, error) => { if (error.code === 'NO_BROWSER') { t.skip('本机没有可用浏览器'); return true; } return false; };
const pngSize = buffer => ({ width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) });

test('网页项目导出 PNG：电脑端 1440×2400、手机端 390×3000（整页，不是窗口）', async t => {
  const out = tempDir(t, 'vw-r11-png-');
  let files;
  try { ({ files } = await exportImages({ projectDir: SAMPLE_WEB, outDir: out })); }
  catch (error) { if (noBrowser(t, error)) return; throw error; }
  assert.equal(files.length, 2);
  assert.deepEqual(pngSize(readFileSync(files[0].path)), { width: 1440, height: 2400 });
  assert.deepEqual(pngSize(readFileSync(files[1].path)), { width: 390, height: 3000 });
});

test('网页项目导出 PDF：每页 MediaBox 按自己的尺寸换算（1 px = 0.75 pt）', async t => {
  const out = tempDir(t, 'vw-r11-pdf-');
  let file;
  try { ({ file } = await exportPdf({ projectDir: SAMPLE_WEB, outFile: join(out, 'web.pdf') })); }
  catch (error) { if (noBrowser(t, error)) return; throw error; }
  const boxes = [...readFileSync(file).toString('latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(boxes, [[1080, 1800], [292.5, 2250]]);
});

test('网页项目放映版 HTML：能离线打开，每页画板按自己的尺寸，按窗口宽度缩放并可上下滚动', async t => {
  const out = tempDir(t, 'vw-r11-html-');
  const { file, warnings } = await exportHtml({ projectDir: SAMPLE_WEB, outFile: join(out, 'web.html') });
  assert.deepEqual(warnings, []);
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) { if (noBrowser(t, error)) return; throw error; }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const blocked = [];
    await page.route('**/*', route => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : (blocked.push(route.request().url()), route.abort())));
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => window.vwReady);
    const idle = () => page.waitForFunction(() => !window.vwPlayer.busy, null, { timeout: 15000 });
    const board = () => page.evaluate(() => {
      const root = document.querySelector('#vw-stage [data-page-id]');
      const stage = document.getElementById('vw-stage');
      const box = root.getBoundingClientRect();
      return { id: root.dataset.pageId, css: [root.style.width, root.style.height], width: box.width, height: box.height, scroll: stage.scrollHeight, client: stage.clientHeight };
    });
    await idle();
    const first = await board();
    assert.equal(first.id, 'page_home_desk');
    assert.deepEqual(first.css, ['1440px', '2400px']);
    // 1440×900 的窗口刚好放下电脑端窗口：缩放 1，整页 2400 高，可以滚动
    assert.ok(Math.abs(first.width - 1440) < 1.5 && Math.abs(first.height - 2400) < 1.5, `电脑端画板 ${first.width}×${first.height}`);
    assert.ok(first.scroll >= 2399 && first.scroll > first.client, '整页可上下滚动');
    await page.evaluate(() => window.vwPlayer.advance());
    await idle();
    const second = await board();
    assert.equal(second.id, 'page_home_mob');
    assert.deepEqual(second.css, ['390px', '3000px']);
    // 手机端窗口 390×844 缩放到 1440×900 内：比例 900/844
    const scale = Math.min(1440 / 390, 900 / 844);
    assert.ok(Math.abs(second.width - 390 * scale) < 1.5 && Math.abs(second.height - 3000 * scale) < 1.5, `手机端画板 ${second.width}×${second.height}`);
    assert.equal(await page.textContent('#vw-counter'), '2 / 2');
    // 内嵌自检照常通过
    const check = await page.evaluate(() => window.vwCheckMotion());
    assert.equal(check.ok, true);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    await context.close();
  } finally { await browser.close(); }
});
