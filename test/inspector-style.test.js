// 第 5 轮：右侧「基础编辑」里的新属性 —— 文字描边、投影，图片重新着色（颜色 / 原色）；以及导入 SVG 素材。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from './helpers/isolated-server.js';

async function open(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-inspector-style-'));
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
  return { page, file, dir, errors };
}
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const onDisk = (file, id) => read(file).pages[0].elements.find(e => e.id === id);
// 等到磁盘上的值变成想要的样子（自动保存有 0.6 秒延迟）
async function until(check, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (error) { if (Date.now() > end) throw error; }
    await new Promise(r => setTimeout(r, 100));
  }
}
async function setField(page, prop, value) {
  const input = page.locator(`.ed-props [data-prop="${prop}"]`);
  await input.fill(String(value));
  if ((await input.getAttribute('type')) !== 'color') await input.press('Enter').then(() => input.evaluate(n => n.blur()).catch(() => {}));
}

test('文字描边和投影：在右侧改，磁盘上是嵌套的值；「无」和粗细 0 清掉', async t => {
  const { page, file, errors } = await open(t);
  await page.locator('[data-action="select"][data-id="el_title1"]').click();
  assert.equal(await page.locator('.ed-props [data-action="clear-style"][data-clear="shadow"]').isDisabled(), true);
  // 失去焦点不会把框里的默认值写进去
  await page.locator('.ed-props [data-prop="shadow.x"]').focus();
  await page.locator('.ed-props [data-prop="shadow.y"]').focus();
  await page.waitForTimeout(800);
  assert.equal(onDisk(file, 'el_title1').shadow ?? null, null);

  await setField(page, 'stroke.color', '#ff0000');
  await setField(page, 'stroke.width', 6);
  await setField(page, 'shadow.color', '#112233');
  await setField(page, 'shadow.x', 5);
  await setField(page, 'shadow.y', 6);
  await setField(page, 'shadow.blur', 10);
  await until(() => {
    const e = onDisk(file, 'el_title1');
    assert.deepEqual(e.stroke, { color: '#ff0000', width: 6 });
    assert.deepEqual(e.shadow, { color: '#11223366', x: 5, y: 6, blur: 10 });
  });
  // 画板上的文字节点也变了（render.js 画描边和投影）
  const style = await page.locator('#artboard [data-element-id="el_title1"]').evaluate(n => { const s = getComputedStyle(n); return { stroke: s.webkitTextStrokeWidth, shadow: s.textShadow }; });
  assert.equal(style.stroke, '6px');
  assert.match(style.shadow, /5px 6px 10px/);
  // 能撤销
  assert.equal(await page.locator('[data-action="undo"]').isDisabled(), false);

  await page.locator('.ed-props [data-action="clear-style"][data-clear="shadow"]').click();
  await setField(page, 'stroke.width', 0);
  await until(() => {
    const e = onDisk(file, 'el_title1');
    assert.equal(e.shadow, null);
    assert.equal(e.stroke, null);
  });

  // 多选两段文字：一起改描边颜色；选中的图片不受影响
  await page.locator('[data-action="select"][data-id="el_subtitle1"]').click();
  await page.locator('[data-action="select"][data-id="el_bullet1"]').click({ modifiers: ['Shift'] });
  await page.locator('[data-action="select"][data-id="el_logo1"]').click({ modifiers: ['Shift'] });
  await setField(page, 'stroke.color', '#0000ff');
  await until(() => {
    assert.deepEqual(onDisk(file, 'el_subtitle1').stroke, { color: '#0000ff', width: 2 });
    assert.deepEqual(onDisk(file, 'el_bullet1').stroke, { color: '#0000ff', width: 2 });
  });
  assert.equal(onDisk(file, 'el_logo1').stroke, undefined);
  assert.deepEqual(errors, []);
});

test('图片颜色：设 tint、「原色」清掉', async t => {
  const { page, file, errors } = await open(t);
  await page.locator('[data-action="select"][data-id="el_logo1"]').click();
  assert.equal(await page.locator('.ed-props [data-prop="stroke.color"]').count(), 0, '图片没有描边');
  await setField(page, 'tint', '#00ff00');
  await until(() => assert.equal(onDisk(file, 'el_logo1').tint, '#00ff00'));
  const color = await page.locator('#artboard [data-element-id="el_logo1"] [data-vw-tint]').evaluate(n => getComputedStyle(n).backgroundColor);
  assert.equal(color, 'rgb(0, 255, 0)');
  await page.locator('.ed-props [data-action="clear-style"][data-clear="tint"]').click();
  await until(() => assert.equal(onDisk(file, 'el_logo1').tint, null));
  assert.equal(await page.locator('#artboard [data-element-id="el_logo1"] img').count(), 1, '原色：又是普通图片');
  assert.deepEqual(errors, []);
});

test('导入 SVG：原样存进项目素材，放进页面', async t => {
  const { page, file, dir, errors } = await open(t);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" rx="8" fill="#222"/></svg>';
  const count = read(file).assets.length;
  await page.setInputFiles('#file-picker', { name: 'mark.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  const asset = await until(() => {
    const project = read(file);
    assert.equal(project.assets.length, count + 1);
    const a = project.assets.at(-1);
    assert.match(a.file, /\.svg$/);
    assert.ok(project.pages[0].elements.some(e => e.type === 'image' && e.asset === a.id), '放进了当前页');
    return a;
  });
  assert.deepEqual([asset.width, asset.height], [120, 60]);
  assert.equal(readFileSync(join(dir, 'projects/sample-deck', asset.file), 'utf8'), svg, '矢量原样保存，没有转成位图');
  assert.ok(existsSync(join(dir, 'projects/sample-deck', asset.file)));
  assert.deepEqual(errors, []);
});
