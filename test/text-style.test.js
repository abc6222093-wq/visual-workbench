// 文字描边（stroke）与阴影（shadow）：格式校验，以及编辑 / 放映 / 导出放映版 / 导出图片四处画面一致。
// 只用临时目录，不碰真实数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { validateProjectData, ERROR_CODES } from '../src/validate.js';
import { createServer } from '../src/server.js';
import { launchBrowser } from '../src/browser.js';
import { exportHtml } from '../src/export/html.js';
import { exportImages } from '../src/export/images.js';

const NOW = '2026-10-01T12:00:00.000Z';
const STROKE = { color: '#ff0000', width: 16 };
const SHADOW = { color: '#0000ff', x: 40, y: 40, blur: 0 };

function baseProject(text = {}) {
  return {
    format: 'visual-workbench/project', formatVersion: 2, id: 'text-style', name: '描边测试', createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'custom', width: 800, height: 450 },
    assets: [], fonts: [],
    pages: [{
      id: 'page_text01', name: '描边', background: '#ffffff',
      elements: [
        { id: 'el_stroke1', type: 'text', x: 40, y: 40, width: 440, height: 340, zIndex: 1, text: 'H', fontSize: 240, fontWeight: 900, color: '#ffffff', stroke: STROKE, shadow: SHADOW, ...text },
        { id: 'el_plain1', type: 'text', x: 520, y: 40, width: 240, height: 100, zIndex: 2, text: '原样', fontSize: 40, color: '#000000' },
      ],
    }],
  };
}

// ---------- 格式 ----------
test('格式：stroke / shadow 合法值通过，null 通过，不写也通过', () => {
  for (const change of [{}, { stroke: null, shadow: null }, { stroke: { color: '#00000080', width: 0 } }, { shadow: { color: '#123456', x: -3.5, y: 0, blur: 12 } }]) {
    const result = validateProjectData(baseProject(change));
    assert.equal(result.ok, true, `${JSON.stringify(change)}: ${JSON.stringify(result.errors)}`);
  }
  const old = baseProject();
  delete old.pages[0].elements[0].stroke; delete old.pages[0].elements[0].shadow;
  assert.equal(validateProjectData(old).ok, true);
});

test('格式：负线宽、负模糊、坏颜色、缺字段、多余字段都报 SCHEMA', () => {
  const bad = [
    { stroke: { color: '#ff0000', width: -1 } },
    { stroke: { color: 'red', width: 2 } },
    { stroke: { color: '#ff0000' } },
    { stroke: { color: '#ff0000', width: 2, style: 'dashed' } },
    { stroke: '#ff0000' },
    { shadow: { color: '#000000', x: 0, y: 0, blur: -2 } },
    { shadow: { color: '#0000', x: 0, y: 0, blur: 2 } },
    { shadow: { color: '#000000', x: 0, y: 0 } },
    { shadow: { color: '#000000', x: 0, y: 0, blur: 1, spread: 2 } },
    { shadow: { color: '#000000', x: '1', y: 0, blur: 1 } },
  ];
  for (const change of bad) {
    const result = validateProjectData(baseProject(change));
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.ok(result.errors.length && result.errors.every(error => error.code === ERROR_CODES.SCHEMA), JSON.stringify(result.errors));
  }
});

// ---------- 四处画面一致 ----------
function decodePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 签名');
  let pos = 8, width, height, depth, colorType, interlace;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('latin1', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  assert.equal(depth, 8); assert.equal(interlace, 0); assert.ok(colorType === 2 || colorType === 6, `颜色类型 ${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row * stride + i - bpp] : 0;
      const b = row ? out[(row - 1) * stride + i] : 0;
      const c = row && i >= bpp ? out[(row - 1) * stride + i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row * stride + i] = value & 0xff;
    }
  }
  return { width, height, pixel: (x, y) => { const at = y * stride + x * bpp; return [out[at], out[at + 1], out[at + 2]]; } };
}
const near = (actual, expected, tolerance = 8) => actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
// 在区域里数接近某颜色的像素
function count(png, [x0, y0, x1, y1], color) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (near(png.pixel(x, y), color, 24)) n++;
  return n;
}

const readText = (root, id) => {
  const style = getComputedStyle(root.querySelector(`[data-element-id="${id}"]`));
  return { strokeWidth: style.webkitTextStrokeWidth, strokeColor: style.webkitTextStrokeColor, shadow: style.textShadow, paintOrder: style.paintOrder };
};
const STYLED = { strokeWidth: '16px', strokeColor: 'rgb(255, 0, 0)', shadow: 'rgb(0, 0, 255) 40px 40px 0px' };
const PLAIN = { strokeWidth: '0px', shadow: 'none' };

function assertStyled(actual, where, expected = STYLED) {
  assert.equal(actual.strokeWidth, expected.strokeWidth, `${where} 描边宽`);
  assert.equal(actual.strokeColor, expected.strokeColor, `${where} 描边色`);
  assert.equal(actual.shadow, expected.shadow, `${where} 阴影`);
  assert.match(actual.paintOrder, /^stroke/, `${where} paint-order`);
}
function assertPlain(actual, where) {
  assert.equal(actual.strokeWidth, PLAIN.strokeWidth, `${where} 旧文字不该有描边`);
  assert.equal(actual.shadow, PLAIN.shadow, `${where} 旧文字不该有阴影`);
  assert.equal(actual.paintOrder, 'normal', `${where} 旧文字 paint-order 不变`);
}

test('描边与阴影：编辑、放映、导出放映版、导出图片画面一致；没设的文字照旧', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-text-style-'));
  const server = createServer({ dataDir });
  const projectDir = join(dataDir, 'projects/text-style');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(baseProject(), null, 2));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  try { browser = await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') return t.skip('本机没有可用浏览器'); throw error; }

  // (编辑)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="text-style"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_stroke1"]');
  assertStyled(await page.$eval('#artboard', readText, 'el_stroke1'), '编辑');
  assertPlain(await page.$eval('#artboard', readText, 'el_plain1'), '编辑');
  assert.doesNotMatch(await page.$eval('#artboard [data-element-id="el_plain1"]', n => n.getAttribute('style')), /text-stroke|text-shadow|paint-order/);
  // (放映)
  await page.locator('[data-action="play"]').click();
  await page.waitForSelector('#player-stage [data-element-id="el_stroke1"]');
  assertStyled(await page.$eval('#player-stage', readText, 'el_stroke1'), '放映');
  assertPlain(await page.$eval('#player-stage', readText, 'el_plain1'), '放映');
  assert.deepEqual(errors, []);
  await page.close();

  const out = mkdtempSync(join(tmpdir(), 'vw-text-style-out-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  // (导出放映版) file:// 打开
  const html = await exportHtml({ projectDir, outFile: join(out, 'deck.html') });
  const exported = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await exported.route('**/*', route => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  await exported.goto(pathToFileURL(html.file).href);
  await exported.waitForSelector('#vw-stage [data-element-id="el_stroke1"]');
  assertStyled(await exported.$eval('#vw-stage', readText, 'el_stroke1'), '放映版');
  assertPlain(await exported.$eval('#vw-stage', readText, 'el_plain1'), '放映版');
  await exported.close();

  // (导出图片) 白字白底：红色只可能来自描边，蓝色只可能来自阴影
  const images = await exportImages({ projectDir, outDir: join(out, 'png') });
  const png = decodePng(readFileSync(images.files[0].path));
  const red = count(png, [40, 40, 520, 450], [255, 0, 0]);
  const blue = count(png, [40, 40, 560, 450], [0, 0, 255]);
  assert.ok(red > 300, `描边红色像素只有 ${red} 个`);
  assert.ok(blue > 300, `阴影蓝色像素只有 ${blue} 个`);
  // 白色填充盖在描边上（paint-order: stroke fill）：字形中间仍有白色
  const white = count(png, [60, 60, 480, 380], [255, 255, 255]);
  assert.ok(white > 1000);

  // 改描边颜色、去掉阴影（模拟检查器），重新打开后各处跟着变
  const file = join(projectDir, 'project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.pages[0].elements[0].stroke = { color: '#00ff00', width: 10 };
  project.pages[0].elements[0].shadow = null;
  writeFileSync(file, JSON.stringify(project, null, 2));
  const again = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await again.goto(`http://127.0.0.1:${server.address().port}`);
  await again.locator('[data-action="open"][data-id="text-style"]').click();
  await again.waitForSelector('#artboard [data-element-id="el_stroke1"]');
  const changed = await again.$eval('#artboard', readText, 'el_stroke1');
  assert.deepEqual([changed.strokeWidth, changed.strokeColor, changed.shadow], ['10px', 'rgb(0, 255, 0)', 'none']);
  await again.close();
  const png2 = decodePng(readFileSync((await exportImages({ projectDir, outDir: join(out, 'png2') })).files[0].path));
  assert.ok(count(png2, [40, 40, 520, 450], [0, 255, 0]) > 200, '改色后图片里是绿色描边');
  assert.equal(count(png2, [40, 40, 560, 450], [255, 0, 0]), 0, '旧的红色描边不再出现');
  assert.equal(count(png2, [40, 40, 560, 450], [0, 0, 255]), 0, '阴影已去掉');
});
