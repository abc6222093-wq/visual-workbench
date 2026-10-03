// 第 5 轮：编辑器「步骤视图」—— 画板显示第 k 步之后的样子，方便给后出现的文字排版。
// 切换步骤只改画板 DOM，不改项目（内存里和磁盘上）；在步骤视图里拖动照样改元素自己的 x，并停在这一步。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

// 第 1 页两步：开头藏起副标题和第三条要点；第 1 步副标题出现、标题往右移 100；第 2 步标题往下移 50、第三条要点出现
const SOURCE = `export default ctx => {
  const sub = ctx.element('el_subtitle1').node, b3 = ctx.element('el_bullet3').node, title = ctx.element('el_title1').node;
  const pose = title.style.transform;
  sub.style.opacity = '0';
  b3.style.visibility = 'hidden';
  return { async step(index) {
    if (index === 0) {
      sub.style.opacity = '1';
      await ctx.animate(title, [{ transform: pose + ' translate(0px, 0px)' }, { transform: pose + ' translate(100px, 0px)' }], { duration: 600, fill: 'forwards' });
    } else {
      b3.style.visibility = 'visible';
      await ctx.animate(title, [{ transform: pose + ' translate(100px, 0px)' }, { transform: pose + ' translate(100px, 50px)' }], { duration: 600, fill: 'forwards' });
      await ctx.timer(500);
    }
  } };
}`;

async function open(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-step-view-'));
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'projects/sample-deck/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.pages[0].motion = { steps: 2, source: SOURCE };
  project.pages[1].motion = { steps: 1, source: 'export default () => ({ step(){ throw new Error("intentional step view failure") } })' };
  writeFileSync(file, JSON.stringify(project, null, 2));
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  await page.waitForTimeout(800); // 打开时可能有的保存先过去
  return { page, file, errors };
}

// 画板上某个元素现在的样子：动效写的位移（transform 矩阵的平移）、透明度、是否可见
const look = (page, id) => page.locator(`#artboard [data-element-id="${id}"]`).evaluate(node => {
  const style = getComputedStyle(node), m = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
  return { tx: Math.round(m.e), ty: Math.round(m.f), opacity: style.opacity, visibility: style.visibility, translate: node.style.translate };
});
async function choose(page, value) {
  await page.locator('[data-step-view]').selectOption(String(value));
  if (value) await page.waitForSelector(`#artboard[data-step-shown="${value}"]`);
  else await page.waitForFunction(() => !document.querySelector('#artboard').dataset.stepShown);
}
// 编辑器内存里的项目：借「下载我的副本」把 S.project 原样拿出来（同 motion-preview.test.js）
async function memory(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => { const b = document.createElement('button'); b.dataset.action = 'export-local'; b.hidden = true; document.querySelector('#app').append(b); b.click(); b.remove(); }),
  ]);
  return JSON.parse(readFileSync(await download.path(), 'utf8'));
}

test('步骤视图：静止显示所有元素；第 k 步后按动效显示；来回切换不改项目', async t => {
  const { page, file, errors } = await open(t);
  const diskBefore = readFileSync(file, 'utf8');
  const memoryBefore = await memory(page);
  const select = page.locator('[data-step-view]');
  assert.deepEqual(await select.locator('option').allTextContents(), ['静止', '第 1 步后', '第 2 步后']);
  assert.equal(await select.inputValue(), '0');

  // 静止：和以前一样，放映开头会藏起来的副标题、第三条要点都看得见
  const still = { title: await look(page, 'el_title1'), sub: await look(page, 'el_subtitle1'), b3: await look(page, 'el_bullet3') };
  assert.equal(still.sub.opacity, '1');
  assert.equal(still.b3.visibility, 'visible');
  assert.deepEqual([still.title.tx, still.title.ty], [0, 0]);

  await choose(page, 1);
  const one = { title: await look(page, 'el_title1'), sub: await look(page, 'el_subtitle1'), b3: await look(page, 'el_bullet3') };
  assert.deepEqual([one.title.tx, one.title.ty], [100, 0], '第 1 步后标题在动效移到的位置');
  assert.equal(one.sub.opacity, '1', '第 1 步让副标题出现');
  assert.equal(one.b3.visibility, 'hidden', '第三条要点要到第 2 步才出现');

  await choose(page, 2);
  const two = { title: await look(page, 'el_title1'), b3: await look(page, 'el_bullet3') };
  assert.deepEqual([two.title.tx, two.title.ty], [100, 50]);
  assert.equal(two.b3.visibility, 'visible');

  await choose(page, 0);
  assert.deepEqual(await look(page, 'el_title1'), still.title);
  assert.deepEqual(await look(page, 'el_bullet3'), still.b3);

  // 切换步骤不进撤销记录、不保存
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), true);
  assert.deepEqual(await memory(page), memoryBefore);
  await page.waitForTimeout(900); // 超过自动保存的等待时间
  assert.equal(readFileSync(file, 'utf8'), diskBefore);
  assert.deepEqual(errors, []);
});

test('步骤视图：拖动改元素自己的 x，松手后仍停在这一步、动效从新位置重新快进', async t => {
  const { page, file, errors } = await open(t);
  const xBefore = JSON.parse(readFileSync(file, 'utf8')).pages[0].elements.find(e => e.id === 'el_title1').x;
  await choose(page, 1);
  const scale = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#artboard')).transform).a);
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  const from = { x: box.x + 30, y: box.y + box.height / 2 };
  const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.ok());
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + 20 * i, from.y);
  const during = await look(page, 'el_title1');
  await page.mouse.up();
  await saved;
  assert.notEqual(during.translate, '', '拖动中节点跟着指针动');
  assert.equal(during.tx, 100, '拖动中动效的位移还在');
  const xAfter = JSON.parse(readFileSync(file, 'utf8')).pages[0].elements.find(e => e.id === 'el_title1').x;
  assert.equal(xAfter, xBefore + Math.round(200 / scale), '磁盘上的 x 改了拖动的距离');
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  assert.equal(await page.locator('[data-step-view]').inputValue(), '1', '松手后仍是第 1 步后');
  const after = await look(page, 'el_title1');
  assert.deepEqual([after.tx, after.translate], [100, ''], '重画后动效从新位置重新快进');
  assert.equal(await page.locator('#artboard [data-element-id="el_title1"]').evaluate(n => n.style.left), `${xAfter}px`);
  assert.equal(await page.locator('#artboard [data-resize="el_title1"]').count(), 1, '选中框和缩放把手还在');
  assert.deepEqual(errors, []);
});

test('步骤视图：换页、放映、预览都回到静止；动效出错提示并回到静止', async t => {
  const { page, errors } = await open(t);
  await choose(page, 2);
  // 预览动效：先回到静止
  await page.locator('[data-action="preview-motion"]').click();
  assert.equal(await page.locator('[data-step-view]').inputValue(), '0');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[data-motion-preview]'));
  assert.equal(await page.locator('#artboard').evaluate(n => n.dataset.stepShown || ''), '');
  // 换页：回到静止
  await choose(page, 1);
  await page.locator('[data-action="switch"][data-id="page_scene2"]').click();
  await page.locator('[data-action="switch"][data-id="page_cover1"]').click();
  assert.equal(await page.locator('[data-step-view]').inputValue(), '0');
  // 放映回来：静止
  await choose(page, 1);
  await page.locator('[data-action="play"]').click();
  await page.waitForSelector('.player');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  assert.equal(await page.locator('[data-step-view]').inputValue(), '0');
  assert.deepEqual([(await look(page, 'el_title1')).tx], [0]);
  // 动效出错：中文提示，回到静止
  await page.locator('[data-action="switch"][data-id="page_scene2"]').click();
  await page.locator('[data-step-view]').selectOption('1');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('intentional step view failure'));
  assert.match(await page.locator('#toast').textContent(), /^动效错误：/);
  await page.waitForFunction(() => document.querySelector('[data-step-view]').value === '0');
  assert.equal(await page.locator('#artboard').evaluate(n => n.style.visibility), '');
  assert.deepEqual(errors, []);
});
