// 第 5 轮：专注模式 —— 藏起顶栏和左右面板，画板放大；再点一次或按 Esc 回来。专注模式里照样能拖动。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

test('专注模式：面板藏起、画板变大；Esc 恢复；专注模式里能拖动', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-focus-'));
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'projects/sample-deck/project.json');
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  await page.waitForTimeout(800);

  const scale = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#artboard')).transform).a);
  const panels = ['.ed-top', '.ed-pages', '.ed-inspector', '.ed-rail'];
  const visible = async () => Object.fromEntries(await Promise.all(panels.map(async s => [s, await page.locator(s).isVisible()])));
  const before = await scale();
  assert.deepEqual(Object.values(await visible()), [true, true, true, true]);
  assert.equal(await page.locator('.ed-focus-exit').count(), 0);

  await page.locator('.ed-toolbar [data-action="focus"]').click();
  assert.deepEqual(Object.values(await visible()), [false, false, false, false], '顶栏和左右面板都藏起来');
  const focused = await scale();
  assert.ok(focused > before, `画板放大（${before} → ${focused}）`);
  assert.equal(await page.locator('.ed-focus-exit [data-action="focus"]').isVisible(), true, '有一个浮着的退出钮');

  // 专注模式里拖动标题
  const x0 = JSON.parse(readFileSync(file, 'utf8')).pages[0].elements.find(e => e.id === 'el_title1').x;
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  const from = { x: box.x + 20, y: box.y + box.height / 2 };
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.ok());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 15 * i, from.y);
  await page.mouse.up();
  await saved;
  const x1 = JSON.parse(readFileSync(file, 'utf8')).pages[0].elements.find(e => e.id === 'el_title1').x;
  assert.equal(x1, x0 + Math.round(150 / focused));
  assert.deepEqual(Object.values(await visible()), [false, false, false, false], '拖完还在专注模式');

  // Esc 退出：面板回来，缩放回到原来
  await page.keyboard.press('Escape');
  assert.deepEqual(Object.values(await visible()), [true, true, true, true]);
  assert.equal(await scale(), before);
  assert.equal(await page.locator('.ed-focus-exit').count(), 0);

  // 浮着的退出钮也能退出
  await page.locator('.ed-toolbar [data-action="focus"]').click();
  await page.locator('.ed-focus-exit [data-action="focus"]').click();
  assert.deepEqual(Object.values(await visible()), [true, true, true, true]);
  assert.deepEqual(errors, []);
});
