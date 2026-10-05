// 第 12 轮修正 · 整页背景：页面文件把 <body> 标成只可改颜色后，画布上点空白仍是取消选中、不悬停框住整页；页面底色从工具条「页面底色」改。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkbench, openProject, clickInFrame, v3Project } from './round12-editor-fixture.js';

const HTML = `<!doctype html><html><head><style>body{margin:0;background:#fde9d9}h1{position:absolute;left:120px;top:100px;margin:0;font-size:96px}</style></head>
<body data-vw-id="page_bg" data-vw="background"><h1 data-vw-id="title" data-vw="text move color">标题</h1></body></html>`;

test('整页背景：点空白取消选中而不是选中 body；工具条给「页面底色」，改色写进修改单', async (t) => {
  const { page } = await startWorkbench(t, { projects: [v3Project({ pages: ['第1页'] })], html: () => HTML, prefix: '我的云端硬盘 测试-' });
  await openProject(page);
  await page.waitForSelector('#artboard[data-ready="1"]');
  const bar = page.locator('.ed-quickbar');
  await page.waitForFunction(() => { const b = document.querySelector('.ed-quickbar'); return b && !b.hidden && b.querySelector('[data-q="background"]'); });
  assert.equal(await bar.locator('[data-q="background"]').inputValue(), '#fde9d9');
  // 点标题 → 选中标题（工具条换成标题的字号 / 颜色）；点空白 → 取消选中，工具条回到页面底色，而不是选中 body
  await clickInFrame(page, 'h1', { at: { x: 2, y: 2 } });
  await page.waitForFunction(() => document.querySelector('.ed-quickbar [data-q="fontSize"]'));
  await clickInFrame(page, 'body', { at: { x: 900, y: 900 } });
  await page.waitForFunction(() => document.querySelector('.ed-quickbar [data-mark="page_bg"]'));
  const frame = await (await page.$('#artboard > iframe')).contentFrame();
  assert.equal(await frame.evaluate(() => document.querySelector('vw-ui').shadowRoot.querySelector('.sel').hidden), true, '没有东西被选中');
  // 悬停空白处不出框
  await page.mouse.move(400, 500);
  assert.equal(await frame.evaluate(() => document.querySelector('vw-ui').shadowRoot.querySelector('.hover').hidden), true);
  // 改页面底色
  await bar.locator('[data-q="background"]').evaluate((input) => { input.value = '#112233'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('.ed-quickbar [data-q="background"]')?.value === '#112233');
  const bg = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(17, 34, 51)');
  // 等自动保存落盘
  let edits = [];
  for (let i = 0; i < 50 && !edits.length; i++) { await new Promise((r) => setTimeout(r, 200)); edits = await page.evaluate(async () => (await (await fetch(`/api/projects/demo`)).json()).project.pages[0].edits); }
  assert.deepEqual(edits.map((e) => [e.target, e.kind, e.after.background]), [['page_bg', 'background', '#112233']]);
});
