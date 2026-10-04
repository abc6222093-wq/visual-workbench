// 图片重新着色（tint）：格式校验、SVG 上传安全检查、编辑 / 放映 / 导出放映版 / 导出图片四处画面一致。
// 只用临时目录，不碰真实数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { validateProjectData, ERROR_CODES } from '../src/validate.js';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { exportHtml } from '../src/export/html.js';
import { exportImages } from '../src/export/images.js';

const NOW = '2026-10-01T12:00:00.000Z';
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000000"/></svg>';
const b64 = text => Buffer.from(text).toString('base64');

function baseProject({ tint = '#1e90ff', assetFile = 'assets/logo.svg' } = {}) {
  return {
    format: 'visual-workbench/project', formatVersion: 2, id: 'tint-demo', name: '着色测试', createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'custom', width: 800, height: 450 },
    assets: [{ id: 'asset_logo01', kind: 'image', file: assetFile, name: '标志', width: 100, height: 100, pendingLayout: false, addedAt: NOW }],
    fonts: [],
    pages: [{
      id: 'page_tint01', name: '着色', background: '#ffffff',
      elements: [
        { id: 'el_logo1', type: 'image', x: 500, y: 50, width: 200, height: 200, zIndex: 2, asset: 'asset_logo01', fit: 'contain', tint },
        { id: 'el_plain1', type: 'image', x: 40, y: 300, width: 100, height: 100, zIndex: 1, asset: 'asset_logo01', fit: 'contain' },
      ],
    }],
  };
}

// ---------- 格式 ----------
test('格式：tint 是颜色或 null；坏颜色、坏类型报 SCHEMA', () => {
  for (const tint of ['#1e90ff', '#1E90FF80', null]) {
    const result = validateProjectData(baseProject({ tint }));
    assert.equal(result.ok, true, `${tint}: ${JSON.stringify(result.errors)}`);
  }
  for (const tint of ['blue', '#12345', 12, { color: '#ffffff' }]) {
    const result = validateProjectData(baseProject({ tint }));
    assert.equal(result.ok, false, String(tint));
    assert.ok(result.errors.every(error => error.code === ERROR_CODES.SCHEMA), JSON.stringify(result.errors));
  }
  // tint 只属于图片：放到形状上是多余字段
  const project = baseProject();
  project.pages[0].elements.push({ id: 'el_box1', type: 'shape', shape: 'rect', x: 0, y: 0, width: 10, height: 10, zIndex: 0, fill: '#000000', tint: '#ffffff' });
  assert.ok(validateProjectData(project).errors.some(error => error.code === ERROR_CODES.SCHEMA));
});

test('格式：JPEG 素材设 tint 报 TINT_NEEDS_ALPHA（扩展名或文件内容判断），不设 tint 不报', () => {
  const jpeg = validateProjectData(baseProject({ assetFile: 'assets/photo.JPG' }));
  assert.equal(jpeg.ok, false);
  const error = jpeg.errors.find(item => item.code === ERROR_CODES.TINT_NEEDS_ALPHA);
  assert.ok(error, JSON.stringify(jpeg.errors));
  assert.equal(error.path, '/pages/0/elements/0/tint');
  assert.match(error.message, /JPEG/);
  assert.match(error.message, /el_logo1/);
  assert.equal(validateProjectData(baseProject({ assetFile: 'assets/photo.jpg', tint: null })).ok, true);

  // 扩展名不是 jpg，但文件其实是 JPEG：给了项目文件夹时按文件开头判断
  const dir = mkdtempSync(join(tmpdir(), 'vw-tint-jpeg-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/photo.png'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
    const disguised = validateProjectData(baseProject({ assetFile: 'assets/photo.png' }), { projectDir: dir });
    assert.ok(disguised.errors.some(item => item.code === ERROR_CODES.TINT_NEEDS_ALPHA));
    writeFileSync(join(dir, 'assets/logo.svg'), LOGO_SVG);
    assert.equal(validateProjectData(baseProject(), { projectDir: dir }).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- SVG 上传 ----------
async function serverFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-tint-server-'));
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { dir, base, request };
}

test('SVG 上传：干净的 SVG 可以上传，尺寸取自 viewBox / width、height，服务时带 CSP', async t => {
  const { base, request } = await serverFixture(t);
  assert.equal((await request('/api/projects', 'POST', { id: 'svg-up', name: 'SVG', preset: 'custom', width: 800, height: 450 })).status, 201);
  const up = await request('/api/projects/svg-up/assets', 'POST', { name: 'logo.svg', data: `data:image/svg+xml;base64,${b64(LOGO_SVG)}` });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.match(up.body.asset.file, /^assets\/[0-9a-f-]+\.svg$/);
  assert.equal(up.body.asset.width, 100);
  assert.equal(up.body.asset.height, 100);
  const served = await fetch(`${base}/data/projects/svg-up/${up.body.asset.file}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /^image\/svg\+xml/);
  assert.equal(served.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(await served.text(), LOGO_SVG);
  // PNG 不带 SVG 的 CSP
  const sized = '<svg xmlns="http://www.w3.org/2000/svg" width="240px" height="80" viewBox="0 0 30 10"><rect width="30" height="10"/></svg>';
  const second = await request('/api/projects/svg-up/assets', 'POST', { name: 'wide.svg', data: `data:image/svg+xml;base64,${b64(sized)}`, revision: up.body.revision });
  assert.equal(second.status, 201);
  assert.deepEqual([second.body.asset.width, second.body.asset.height], [240, 80]);
  // 公共素材库也收 SVG，不传尺寸时自己读
  const lib = await request('/api/library', 'POST', { name: 'logo.svg', data: `data:image/svg+xml;base64,${b64(LOGO_SVG)}` });
  assert.equal(lib.status, 201, JSON.stringify(lib.body));
  assert.deepEqual([lib.body.width, lib.body.height], [100, 100]);
  const libServed = await fetch(base + lib.body.url);
  assert.equal(libServed.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
});

test('SVG 上传：带脚本、事件属性、javascript:、foreignObject、外部链接的一律拒绝（中文提示）', async t => {
  const { request } = await serverFixture(t);
  assert.equal((await request('/api/projects', 'POST', { id: 'svg-bad', name: 'SVG', preset: 'custom', width: 800, height: 450 })).status, 201);
  const bad = {
    script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    onload: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    onclick: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" onClick = "x()"/></svg>',
    javascript: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
    foreignObject: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
    external: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.com/a.png"/></svg>',
    notSvg: '<html><body>hi</body></html>',
  };
  for (const [name, svg] of Object.entries(bad)) {
    const response = await request('/api/projects/svg-bad/assets', 'POST', { name: `${name}.svg`, data: `data:image/svg+xml;base64,${b64(svg)}` });
    assert.equal(response.status, 400, name);
    assert.match(response.body.error, /[一-鿿]/, `${name}: ${response.body.error}`);
  }
  const project = (await request('/api/projects/svg-bad')).body.project;
  assert.deepEqual(project.assets, []);
  const lib = await request('/api/library', 'POST', { name: 'x.svg', data: `data:image/svg+xml;base64,${b64(bad.onload)}`, width: 1, height: 1 });
  assert.equal(lib.status, 400);
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
const near = (actual, expected, tolerance = 6) => actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// 在页面里读重新着色图片的样子
const readTint = (root, id) => {
  const node = root.querySelector(`[data-element-id="${id}"]`);
  const child = node?.firstElementChild;
  if (!child) return null;
  const style = getComputedStyle(child);
  return { tag: child.tagName, background: style.backgroundColor, mask: style.maskImage || style.webkitMaskImage, webkitMask: style.webkitMaskImage, maskSize: style.maskSize || style.webkitMaskSize };
};

test('重新着色：编辑、放映、导出放映版、导出图片画面一致；改颜色后四处都跟着变', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-tint-ui-'));
  const server = createServer({ dataDir });
  const projectDir = join(dataDir, 'projects/tint-demo');
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  writeFileSync(join(projectDir, 'assets/logo.svg'), LOGO_SVG);
  const file = join(projectDir, 'project.json');
  writeFileSync(file, JSON.stringify(baseProject(), null, 2));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dataDir, { recursive: true, force: true }); });
  try { browser = await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') return t.skip('本机没有可用浏览器'); throw error; }

  const check = async (color, round) => {
    const expected = `rgb(${rgb(color).join(', ')})`;
    // (编辑) 工作台画板
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-action="open"][data-id="tint-demo"]').click();
    await page.waitForSelector('#artboard [data-element-id="el_logo1"] > div');
    const editor = await page.$eval('#artboard', readTint, 'el_logo1');
    assert.equal(editor.tag, 'DIV', round);
    assert.equal(editor.background, expected, round);
    assert.match(editor.mask, /^url\(/, round);
    assert.match(editor.webkitMask, /^url\(/, round);
    assert.equal(editor.maskSize, 'contain');
    assert.equal(await page.evaluate(() => document.querySelector('#artboard [data-element-id="el_plain1"] > img')?.tagName), 'IMG', '没设 tint 的图片照旧用 <img>');
    // (放映)
    await page.locator('[data-action="play"]').click();
    await page.waitForSelector('#player-stage [data-element-id="el_logo1"] > div');
    const playback = await page.$eval('#player-stage', readTint, 'el_logo1');
    assert.equal(playback.background, expected, round);
    assert.match(playback.mask, /^url\(/);
    assert.deepEqual(errors, []);
    await page.close();

    // (导出放映版) file:// 打开，素材是内嵌的 data:image/svg+xml
    const out = mkdtempSync(join(tmpdir(), 'vw-tint-export-'));
    try {
      const html = await exportHtml({ projectDir, outFile: join(out, 'deck.html') });
      assert.deepEqual(html.warnings, []);
      assert.match(readFileSync(html.file, 'utf8'), /data:image\/svg\+xml;base64,/);
      const exported = await browser.newPage({ viewport: { width: 800, height: 450 } });
      const blocked = [];
      await exported.route('**/*', route => (/^(file|data|blob):/.test(route.request().url()) ? route.continue() : (blocked.push(route.request().url()), route.abort())));
      await exported.goto(pathToFileURL(html.file).href);
      await exported.waitForSelector('#vw-stage [data-element-id="el_logo1"] > div');
      const exportedTint = await exported.$eval('#vw-stage', readTint, 'el_logo1');
      assert.equal(exportedTint.background, expected, round);
      assert.match(exportedTint.mask, /^url\("data:image\/svg\+xml;base64,/);
      // 遮罩真的生效：截图里圆心是着色，框的角落是白底
      const box = await exported.locator('#vw-stage [data-element-id="el_logo1"]').boundingBox();
      const shot = decodePng(await exported.screenshot({ type: 'png' }));
      assert.ok(near(shot.pixel(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)), rgb(color)), `放映版圆心应是 ${color}`);
      assert.ok(near(shot.pixel(Math.round(box.x + 3), Math.round(box.y + 3)), [255, 255, 255]), '放映版框角应透出白底');
      assert.deepEqual(blocked, []);
      await exported.close();

      // (导出图片) 每页一张 PNG：圆心取色 = tint，框角 = 白底
      const images = await exportImages({ projectDir, outDir: join(out, 'png') });
      const png = decodePng(readFileSync(images.files[0].path));
      assert.deepEqual([png.width, png.height], [800, 450]);
      assert.ok(near(png.pixel(600, 150), rgb(color)), `图片圆心 ${png.pixel(600, 150)} 应是 ${color}`);
      assert.ok(near(png.pixel(504, 54), [255, 255, 255]), `图片框角 ${png.pixel(504, 54)} 应是白色`);
      assert.ok(near(png.pixel(90, 350), [0, 0, 0]), '没设 tint 的同一个标志保持原色（黑）');
    } finally { rmSync(out, { recursive: true, force: true }); }
  };

  await check('#1e90ff', '初始颜色');
  // 模拟检查器改颜色：改 project.json 后重新打开
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.pages[0].elements[0].tint = '#e11d48';
  writeFileSync(file, JSON.stringify(project, null, 2));
  await check('#e11d48', '改色之后');
});
