// 第 10 轮图片裁切的导出：放映版 HTML、导出图片、编辑器画面、PDF 四处像素一致；放映版按裁切后的放大倍数压缩图片；动效检查通过。
// 只用临时目录和临时 home。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { exportHtml, neededScale } from '../src/export/html.js';
import { exportImages, exportPdf } from '../src/export/images.js';

const NOW = '2026-10-04T12:00:00.000Z';
const W = 800, H = 450;
// 源图 400×200 的 4×2 色块（每块 100×100），裁切后哪块落在哪里一眼可辨
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8000', '#000000'];
async function blocks(scale = 1) {
  const size = 100 * scale;
  const tiles = await Promise.all(COLORS.map(color => sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer()));
  return sharp({ create: { width: 4 * size, height: 2 * size, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 4) * size, top: Math.floor(i / 4) * size }))).png().toBuffer();
}
function project() {
  const image = (id, extra) => ({ id, type: 'image', zIndex: 1, asset: 'asset_blocks1', fit: 'cover', ...extra });
  return {
    format: 'visual-workbench/project', formatVersion: 2, id: 'crop-export', name: '裁切导出', createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'custom', width: W, height: H }, fonts: [],
    assets: [
      { id: 'asset_blocks1', kind: 'image', file: 'assets/blocks.png', name: '色块', width: 400, height: 200, pendingLayout: false, addedAt: NOW },
      { id: 'asset_big01', kind: 'image', file: 'assets/big.png', name: '大图', width: 1600, height: 800, pendingLayout: false, addedAt: NOW },
    ],
    pages: [
      { id: 'page_crop01', name: '裁切', background: '#ffffff', elements: [
        // 取源图中间 2×1 块（绿、蓝 / 青、橙），放大 2 倍
        image('el_crop1', { x: 40, y: 40, width: 400, height: 200, crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }),
        // 右下单块（黑）+ 水平翻转 + 半透明
        image('el_crop2', { x: 480, y: 40, width: 120, height: 120, crop: { x: 0.75, y: 0.5, width: 0.25, height: 0.5 }, flipX: true, opacity: 0.5 }),
        // 左上 2×2 块拉伸（裁切块比例与框不同）
        image('el_crop3', { x: 480, y: 200, width: 280, height: 140, crop: { x: 0, y: 0, width: 0.5, height: 1 } }),
      ] },
      { id: 'page_motion1', name: '动效', background: '#ffffff', elements: [image('el_crop4', { x: 100, y: 100, width: 300, height: 150, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }),
        // 大图缩小显示：导出放映版时压缩（压缩后的重采样边缘与原图略有差别，所以不放在逐像素比较的第 1 页）
        { id: 'el_big01', type: 'image', x: 40, y: 300, width: 200, height: 100, zIndex: 1, asset: 'asset_big01', fit: 'cover', crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }],
        motion: { steps: 1, source: "export default async function(ctx){const el=ctx.element('el_crop4');return {async step(){await ctx.animate(el.node,[{transform:'translateX(0px)'},{transform:`translateX(${el.base.width/10}px)`},{transform:'translateX(0px)'}],{duration:200}).finished;}};}" } },
    ],
  };
}
const raw = async buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
function diff(a, b) {
  assert.equal(a.info.width, b.info.width); assert.equal(a.info.height, b.info.height);
  let max = 0, sum = 0; const where = [];
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); max = Math.max(max, d); sum += d; if (d > 2 && where.length < 20) where.push([(i / 3 | 0) % a.info.width, (i / 3 / a.info.width) | 0, d]); }
  return { max, mean: sum / a.data.length, where };
}
const at = (img, x, y) => [...img.data.subarray((y * img.info.width + x) * 3, (y * img.info.width + x) * 3 + 3)];
const near = (a, b, tol = 10) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('round10 crop: neededScale 按裁切后的放大倍数算', () => {
  assert.equal(neededScale({ width: 200, height: 100, crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }, 1600, 800), 0.25);
  assert.equal(neededScale({ width: 400, height: 100, crop: { x: 0, y: 0, width: 0.5, height: 1 } }, 400, 200), 2);
  assert.equal(neededScale({ width: 400, height: 100, fit: 'contain', crop: null }, 400, 200), 0.5);
});

test('round10 crop: 导出 HTML / 图片 / PDF 与编辑器画面像素一致，动效检查通过', { timeout: 240000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-round10-crop-export-')), home = mkdtempSync(join(tmpdir(), 'vw-round10-crop-home-'));
  const projectDir = join(dir, 'projects', 'crop-export');
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  writeFileSync(join(projectDir, 'assets/blocks.png'), await blocks());
  writeFileSync(join(projectDir, 'assets/big.png'), await blocks(4));
  const data = project();
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(data, null, 2));
  const server = createServer({ dataDir: dir, configHome: home });
  let browser;
  t.after(async () => { await browser?.close(); if (server.listening) await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });

  const html = await exportHtml({ projectDir, outFile: join(dir, 'exports', 'deck.html') });
  const source = readFileSync(html.file, 'utf8');
  assert.match(source, /"crop"/);
  // 大图在画板上只需要 1/4：压缩到 400×200
  assert.match(html.items.find(item => item.name === 'assets/big.png').note, /^400×200（原图 1600×800）/);
  assert.match(html.items.find(item => item.name === 'assets/blocks.png').note, /^400×200 /, '放大使用的图不缩');
  const images = await exportImages({ projectDir, outDir: join(dir, 'exports', 'images') });
  assert.equal(images.files.length, 2);
  const png = await raw(readFileSync(images.files[0].path));
  assert.equal(png.info.width, W); assert.equal(png.info.height, H);
  // 画面内容：el_crop1 左半绿、右半蓝（上）/ 青、橙（下）；el_crop2 黑块半透明 → 灰；el_crop3 红绿 / 品红青拉伸
  for (const [x, y, color] of [[100, 80, [0, 255, 0]], [400, 80, [0, 0, 255]], [100, 200, [0, 255, 255]], [400, 200, [255, 128, 0]], [540, 100, [128, 128, 128]],
    [500, 220, [255, 0, 0]], [740, 220, [0, 255, 0]], [500, 320, [255, 0, 255]], [740, 320, [0, 255, 255]], [460, 100, [255, 255, 255]], [100, 260, [255, 255, 255]]]) {
    assert.ok(near(at(png, x, y), color), `(${x},${y}) = ${at(png, x, y)}，应为 ${color}`);
  }

  const second = await raw(readFileSync(images.files[1].path)); // 第 2 页：动效播完；大图取右下四分之一（橙、黑）
  for (const [x, y, color] of [[100, 350, [255, 128, 0]], [200, 350, [0, 0, 0]], [200, 220, [0, 255, 255]], [380, 220, [255, 128, 0]], [200, 120, [0, 255, 0]]]) assert.ok(near(at(second, x, y), color), `第 2 页 (${x},${y}) = ${at(second, x, y)}`);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await launchBrowser();
  // 放映版 HTML：离线打开，截图与导出图片逐像素一致
  const offline = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const blocked = [];
  await offline.route('**/*', route => /^(file|data|blob):/.test(route.request().url()) ? route.continue() : (blocked.push(route.request().url()), route.abort()));
  await offline.goto(pathToFileURL(html.file).href);
  await offline.waitForSelector('#vw-stage [data-element-id="el_crop1"] img');
  await offline.waitForFunction(() => [...document.querySelectorAll('#vw-stage img')].every(img => img.complete && img.naturalWidth));
  const shot = await raw(await offline.locator('#vw-stage .vw-artboard').screenshot({ style: '#vw-counter, #vw-toast { visibility: hidden !important; }' }));
  const playback = diff(shot, png);
  assert.ok(playback.max <= 2, `放映版与导出图片差异 ${JSON.stringify(playback)}`);
  assert.deepEqual(blocked, []);

  // 编辑器画面：renderPage 直接画同一页
  const editor = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await editor.goto(`http://127.0.0.1:${server.address().port}/vw-round10-blank`);
  await editor.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>');
  await editor.evaluate(async project => {
    const { renderPage } = await import('/render.js');
    const root = renderPage(project, project.pages[0], { assetBase: '/data/projects/crop-export' });
    document.body.append(root);
    await Promise.all([...root.querySelectorAll('img')].map(img => img.decode()));
  }, data);
  const edited = await raw(await editor.locator('.vw-artboard').screenshot());
  const editorDiff = diff(edited, png);
  assert.ok(editorDiff.max <= 40 && editorDiff.mean < 0.5, `编辑器与导出图片差异 ${JSON.stringify(editorDiff)}`); // 编辑器用原图、导出版可能用压缩后的图：只允许边缘的极小差别

  // PDF：每页一张 JPEG，第 1 页与 PNG 一致（JPEG 有损，按平均误差和色块取样比较）
  const pdf = await exportPdf({ projectDir, outFile: join(dir, 'exports', 'deck.pdf') });
  const bytes = readFileSync(pdf.file), text = bytes.toString('latin1');
  const streams = [...text.matchAll(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)];
  assert.equal(streams.length, 2);
  const start = streams[0].index + streams[0][0].length;
  const jpeg = await raw(bytes.subarray(start, start + Number(streams[0][1])));
  const pdfDiff = diff(jpeg, png);
  assert.ok(pdfDiff.mean < 3, `PDF 与导出图片差异 ${JSON.stringify(pdfDiff)}`);
  for (const [x, y] of [[100, 80], [400, 200], [540, 100], [740, 320], [200, 380]]) assert.ok(near(at(jpeg, x, y), at(png, x, y), 12), `PDF (${x},${y})`);

  // 动效检查（真浏览器逐页跑）
  const cli = fileURLToPath(new URL('../src/cli/check-motion.js', import.meta.url));
  // 不改 HOME：Playwright 的浏览器缓存在真实 HOME 下；check-motion 不读工作台配置，无需隔离
  const check = spawnSync(process.execPath, [cli, projectDir], { encoding: 'utf8', timeout: 120000 });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const validate = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli/validate.js', import.meta.url)), projectDir], { encoding: 'utf8', timeout: 60000 });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
});
