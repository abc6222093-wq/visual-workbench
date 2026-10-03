// 第 5 轮：エイ 真机验收发现「内容拖不动」「拖的时候画面一闪一闪」。
// 拖不动：每页最上面盖着一张锁定的整页纸纹图，点哪儿都点在它上面，锁定元素不响应，下面的元素收不到点击。
// 闪：拖动时每移动一下都把整块画板拆掉重画。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

// 示例项目第 1 页：最上面加一张锁定的整页图（像纸纹），标题下面再垫一块不锁定的整页半透明形状（像暗角）
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'vw-drag-'));
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'projects/sample-deck/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  const page = project.pages[0];
  const title = page.elements.find(e => e.id === 'el_title1');
  page.elements.push(
    { id: 'el_test_grain', type: 'image', name: '纸纹', x: 0, y: 0, width: 1920, height: 1080, zIndex: 999, locked: true, opacity: 0.2, asset: 'asset_logo01', fit: 'cover' },
    { id: 'el_test_veil', type: 'shape', name: '暗角', x: 0, y: 0, width: 1920, height: 1080, zIndex: title.zIndex - 1, shape: 'rect', fill: '#00000022', stroke: null },
  );
  delete page.motion;
  writeFileSync(file, JSON.stringify(project, null, 2));
  return { dir, file };
}

async function open(t) {
  const { dir, file } = setup();
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const puts = [];
  page.on('request', r => { if (r.method() === 'PUT' && r.url().includes('/api/projects/sample-deck')) puts.push(Date.now()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  return { page, file, errors, puts };
}

const disk = file => JSON.parse(readFileSync(file, 'utf8')).pages[0].elements;
const el = (els, id) => els.find(e => e.id === id);

// 拖完等到这次修改真的写进文件
async function dragAndSave(page, from, dx, dy) {
  await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && r.ok()), drag(page, from, dx, dy)]);
}
async function drag(page, from, dx, dy, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  await page.mouse.up();
}

test('拖不动：最上面有锁定的整页图时，照样能直接按住下面的元素拖动', async t => {
  const { page, file, errors } = await open(t);
  const before = el(disk(file), 'el_title1');
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  const scale = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#artboard')).transform).a);
  // 标题上面压着纸纹（锁定）；标题本身在暗角形状之上，点标题文字的位置应选中标题
  await dragAndSave(page, { x: box.x + 20, y: box.y + box.height / 2 }, 200, 100);
  const after = el(disk(file), 'el_title1');
  assert.equal(after.x, before.x + Math.round(200 / scale));
  assert.equal(after.y, before.y + Math.round(100 / scale));
  assert.equal(el(disk(file), 'el_test_grain').x, 0, '锁定的纸纹不动');
  assert.deepEqual(errors, []);
});

test('拖不动：被整页形状盖住的元素，在图层里选中后按住它的位置拖，动的是它', async t => {
  const { page, file, errors } = await open(t);
  // 把暗角挪到标题上面，标题被盖住
  const p = JSON.parse(readFileSync(file, 'utf8'));
  el(p.pages[0].elements, 'el_test_veil').zIndex = 900;
  writeFileSync(file, JSON.stringify(p, null, 2));
  await page.reload();
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  await page.locator('[data-action="select"][data-id="el_title1"]').click();
  const before = el(disk(file), 'el_title1');
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  await dragAndSave(page, { x: box.x + 20, y: box.y + box.height / 2 }, -30, 0); // 往左挪一点，保证缩放把手还在画板里
  assert.notEqual(el(disk(file), 'el_title1').x, before.x, '选中的标题被拖动');
  assert.equal(el(disk(file), 'el_test_veil').x, 0, '盖在上面的形状没被拖');
  // 选中的元素在右下角的缩放把手也能用
  const handle = await page.locator('#artboard [data-resize="el_title1"][data-handle="se"]').boundingBox();
  const w0 = el(disk(file), 'el_title1').width;
  await dragAndSave(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 60, 0);
  assert.ok(el(disk(file), 'el_title1').width > w0, '缩放生效');
  assert.deepEqual(errors, []);
});

test('拖动不闪：拖的过程中不重画整块画板、不写文件，松手后只保存一次', async t => {
  const { page, file, errors, puts } = await open(t);
  await page.waitForTimeout(800); // 打开时可能有的保存先过去
  puts.length = 0;
  await page.evaluate(() => {
    window.__boardSwaps = 0;
    window.__node = document.querySelector('#artboard [data-element-id="el_title1"]');
    window.__startLeft = window.__node.style.left;
    new MutationObserver(list => { for (const m of list) window.__boardSwaps += m.addedNodes.length; }).observe(document.querySelector('#artboard-holder'), { childList: true });
  });
  const startLeft = await page.evaluate(() => window.__startLeft);
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  const from = { x: box.x + 20, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) { await page.mouse.move(from.x + i * 10, from.y + i * 4); await page.waitForTimeout(30); }
  const during = await page.evaluate(() => ({ swaps: window.__boardSwaps, same: window.__node === document.querySelector('#artboard [data-element-id="el_title1"]'), left: window.__node.style.left }));
  const putsDuring = puts.length;
  await page.waitForTimeout(900); // 按住不放超过自动保存的等待时间，也不该写文件
  const putsHeld = puts.length;
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#save-status')?.textContent === '已保存');
  await page.waitForTimeout(300);
  assert.equal(during.swaps, 0, '拖动中画板没有被重画');
  assert.equal(during.same, true, '拖动中元素还是同一个节点');
  assert.notEqual(during.left, startLeft, '拖动中画面上的元素跟着动');
  assert.equal(putsDuring, 0, '拖动中不保存');
  assert.equal(putsHeld, 0, '按住不放时不保存');
  assert.equal(puts.length, 1, '松手后只保存一次');
  assert.deepEqual(errors, []);
});
