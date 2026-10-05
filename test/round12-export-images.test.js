// 第 12 轮每页图片 / PDF：真浏览器打开 web/export-render.html，按「页面 + 修改单」跑完全部步骤后截图；
// 课件页 = 画板尺寸，网页页 = 整页高度；PDF 每页 MediaBox 按页面尺寸换算。只用临时目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { exportImages, exportPdf, safeFileName } from '../src/export/images.js';
import { buildPdf, jpegInfo } from '../src/export/pdf.js';
import { exportProject } from '../src/export/index.js';
import { launchBrowser } from '../src/browser.js';
import { makeDeck, makeWeb, cleanup, tmp, DECK_COVER } from './round12-export-fixture.test.js';

const AT = '2026-10-05T12:00:00.000Z';

async function hasBrowser(t) {
  try { const browser = await launchBrowser(); await browser.close(); return true; }
  catch (error) { if (error.code === 'NO_BROWSER') { t.skip('本机没有可用浏览器'); return false; } throw error; }
}
async function pixel(file, x, y) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (actual, expected, tol = 40) => actual.every((v, i) => Math.abs(v - expected[i]) <= tol);
const mediaBoxes = pdf => [...pdf.toString('latin1').matchAll(/\/MediaBox \[([^\]]+)\]/g)].map(m => m[1].trim().split(/\s+/).map(Number));

test('safeFileName 去掉文件名里的非法字符', () => {
  assert.equal(safeFileName('1 封面/目录: "A"?', 'p'), '1 封面-目录- -A--');
  assert.equal(safeFileName('', 'page_x'), 'page_x');
  assert.equal(safeFileName('  ...  ', 'page_y'), 'page_y');
});

test('PDF 写入器：xref 偏移、页数、MediaBox 正确', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegInfo(jpeg), { width: 3, height: 2, components: 3 });
  const pdf = buildPdf([{ jpeg, width: 1440, height: 810 }, { jpeg, width: 600, height: 300.5 }]);
  assert.deepEqual(mediaBoxes(pdf), [[0, 0, 1440, 810], [0, 0, 600, 300.5]]);
  const text = pdf.toString('latin1');
  const xref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
});

test('课件：每页一张画板尺寸的 PNG，画面是动效播完 + 修改单叠上之后；再导出一份 2 页 PDF', { timeout: 240000 }, async t => {
  if (!(await hasBrowser(t))) return;
  const { dir } = await makeDeck({ edits: [{ id: 'ed_bg0001', target: 'card', kind: 'background', at: AT, before: { background: '#3366ff' }, after: { background: '#ff8800' } }] });
  const out = tmp('vw-r12-img-out-');
  try {
    const { files } = await exportImages({ projectDir: dir, outDir: out });
    assert.deepEqual(files.map(file => basename(file.path)), ['01-封面.png', '02-第二页.png']);
    const meta = await sharp(files[0].path).metadata();
    assert.deepEqual([meta.width, meta.height], [640, 360]);
    assert.ok(near(await pixel(files[0].path, 60, 140), [0xff, 0x88, 0x00]), '修改单：卡片底色');
    assert.ok(near(await pixel(files[0].path, 220, 135), [0x00, 0xaa, 0x00]), '第 1 步之后 b1 出现');
    assert.ok(near(await pixel(files[0].path, 220, 195), [0x00, 0xaa, 0x00]), '第 2 步之后 b2 出现');
    assert.ok(near(await pixel(files[1].path, 600, 20), [0x22, 0x22, 0x22]), '第 2 页深色背景');
    assert.ok(near(await pixel(files[1].path, 65, 225), [0xff, 0x88, 0x00]), '第 2 页 CSS 背景图');
    const result = await exportProject({ projectDir: dir, kind: 'pdf', outDir: out });
    assert.equal(basename(result.files[0].path), '第十二轮课件.pdf');
    assert.deepEqual(mediaBoxes(readFileSync(result.files[0].path)), [[0, 0, 480, 270], [0, 0, 480, 270]]);
  } finally { cleanup(dir, out); }
});

test('导出的是动效全部播完后的最后一帧（包括没被 await 的动画）', { timeout: 120000 }, async t => {
  if (!(await hasBrowser(t))) return;
  const cover = `<!doctype html><html><head><style>body{background:#000}#p{position:absolute;left:0;top:0;width:200px;height:200px;background:#ff0000}</style></head>
<body><div id="p" data-vw-id="p" data-vw="background"></div><script type="module">
vw.motion({ step(index, ctx) { if (index === 0) document.getElementById('p').animate([{ backgroundColor: '#ff0000' }, { backgroundColor: '#00ff00' }], { duration: 600, fill: 'forwards' }); } });
</script></body></html>`;
  const { dir } = await makeDeck({ cover });
  const out = tmp('vw-r12-img-last-');
  try {
    const { files } = await exportImages({ projectDir: dir, outDir: out });
    assert.ok(near(await pixel(files[0].path, 100, 100), [0, 255, 0]), `播完动效应是绿色：${await pixel(files[0].path, 100, 100)}`);
    assert.ok(near(await pixel(files[0].path, 400, 300), [0, 0, 0]), '背景仍是黑色');
  } finally { cleanup(dir, out); }
});

test('网页项目：PNG 按整页高度（390×1200，不是窗口），PDF MediaBox 按页面尺寸换算', { timeout: 240000 }, async t => {
  if (!(await hasBrowser(t))) return;
  const { dir } = await makeWeb({ edits: [{ id: 'ed_wbg001', target: 's2', kind: 'background', at: AT, before: { background: '#ccddff' }, after: { background: '#112233' } }] });
  const out = tmp('vw-r12-img-web-');
  try {
    const { files } = await exportImages({ projectDir: dir, outDir: out });
    assert.deepEqual(files.map(file => basename(file.path)), ['01-首页.png']);
    const meta = await sharp(files[0].path).metadata();
    assert.deepEqual([meta.width, meta.height], [390, 1200]);
    assert.ok(near(await pixel(files[0].path, 200, 300), [0xff, 0xee, 0xcc]), '第一屏');
    assert.ok(near(await pixel(files[0].path, 200, 1000), [0x11, 0x22, 0x33]), '修改单：第二屏底色');
    const { file } = await exportPdf({ projectDir: dir, outFile: join(out, 'web.pdf') });
    assert.deepEqual(mediaBoxes(readFileSync(file)), [[0, 0, 292.5, 900]]);
  } finally { cleanup(dir, out); }
});

test('动效出错时拒绝导出，中文提示里有页面编号', { timeout: 120000 }, async t => {
  if (!(await hasBrowser(t))) return;
  const { dir } = await makeDeck({ cover: DECK_COVER.replace("const el = ctx.root.querySelector('.b' + (index + 1));", "throw new Error('故意出错');") });
  const out = tmp('vw-r12-img-err-');
  try {
    await assert.rejects(exportImages({ projectDir: dir, outDir: out }), error => {
      assert.match(error.message, /page_cover/);
      assert.match(error.message, /第 1 页.*动效出错/);
      assert.match(error.message, /故意出错/);
      return true;
    });
  } finally { cleanup(dir, out); }
});

test('动效卡住时按时限停下，中文提示里有页面编号', { timeout: 120000 }, async t => {
  if (!(await hasBrowser(t))) return;
  const { dir } = await makeDeck({ cover: DECK_COVER.replace("const el = ctx.root.querySelector('.b' + (index + 1));", 'await new Promise(() => {});') });
  const out = tmp('vw-r12-img-stuck-');
  try {
    await assert.rejects(exportImages({ projectDir: dir, outDir: out, timeout: 800 }), error => {
      assert.match(error.message, /page_cover/);
      assert.match(error.message, /超过 \d+ ms|超时/);
      return true;
    });
  } finally { cleanup(dir, out); }
});
