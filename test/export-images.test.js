// 导出图片 / PDF：真实打开后台浏览器渲染。只用临时目录，不碰真实数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { exportImages, exportPdf, safeFileName } from '../src/export/images.js';
import { buildPdf, jpegInfo } from '../src/export/pdf.js';

const SAMPLE = fileURLToPath(new URL('../examples/sample-deck/', import.meta.url));

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 复制示例项目到临时目录，再按需改 project.json
function tempProject(t, change) {
  const dir = tempDir(t, 'vw-export-project-');
  cpSync(SAMPLE, dir, { recursive: true });
  const file = join(dir, 'project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  change(project);
  writeFileSync(file, JSON.stringify(project, null, 2));
  return dir;
}

// 极简 PNG 解码：读 IHDR，合并 IDAT 解压，按行去掉滤波，返回取像素的函数（只支持 8 位 RGB / RGBA，不隔行）
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
  const pixel = (x, y) => {
    assert.equal(depth, 8); assert.equal(interlace, 0); assert.ok(colorType === 2 || colorType === 6, `颜色类型 ${colorType}`);
    const bpp = colorType === 6 ? 4 : 3;
    const raw = decodePng.cache.get(buffer) || inflateSync(Buffer.concat(idat));
    const stride = width * bpp;
    if (!decodePng.cache.has(buffer)) {
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
      decodePng.cache.set(buffer, out);
    }
    const out = decodePng.cache.get(buffer);
    const at = y * stride + x * bpp;
    return [out[at], out[at + 1], out[at + 2]];
  };
  return { width, height, pixel };
}
decodePng.cache = new Map();

// 检查 PDF 结构：每个 xref 偏移都指向「N 0 obj」，返回页面的 MediaBox 列表
function inspectPdf(buffer) {
  const text = buffer.toString('latin1');
  assert.ok(text.startsWith('%PDF-'), '以 %PDF- 开头');
  assert.ok(text.trimEnd().endsWith('%%EOF'), '以 %%EOF 结尾');
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref 指向 xref 表');
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(startxref));
  const count = Number(head[1]);
  const entries = text.slice(startxref + head[0].length).split('\n').slice(0, count);
  for (let id = 1; id < count; id++) {
    assert.equal(entries[id].length, 19, 'xref 每行 20 字节（含换行）');
    const offset = Number(entries[id].slice(0, 10));
    assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`, `对象 ${id} 的偏移正确`);
  }
  assert.match(text, new RegExp(`/Size ${count} `));
  const pages = [...text.matchAll(/\/Type \/Page(?!s)\b[^]*?\/MediaBox \[([^\]]+)\]/g)].map(m => m[1].trim().split(/\s+/).map(Number));
  return { pages };
}

test('safeFileName 去掉文件名里的非法字符', () => {
  assert.equal(safeFileName('1 封面/目录: "A"?', 'p'), '1 封面-目录- -A--');
  assert.equal(safeFileName('', 'page_x'), 'page_x');
  assert.equal(safeFileName('  ...  ', 'page_y'), 'page_y');
});

test('PDF 写入器：xref 偏移、页数、MediaBox 正确', () => {
  // 1×1 的最小 JPEG 只用来测结构：只需 SOI + SOF0
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual(jpegInfo(jpeg), { width: 3, height: 2, components: 3 });
  const { pages } = inspectPdf(buildPdf([{ jpeg, width: 1440, height: 810 }, { jpeg, width: 600, height: 300.5 }]));
  assert.deepEqual(pages, [[0, 0, 1440, 810], [0, 0, 600, 300.5]]);
});

test('示例项目：每页一张 1920×1080 PNG，再导出一份 3 页 PDF', { timeout: 240000 }, async t => {
  const out = tempDir(t, 'vw-export-out-');
  const { files } = await exportImages({ projectDir: SAMPLE, outDir: out });
  assert.equal(files.length, 3);
  assert.match(files[0].path, /\/01-1 封面：逐项出现与擦拭换页\.png$/);
  assert.match(files[2].path, /\/03-/);
  for (const file of files) {
    assert.ok(existsSync(file.path));
    assert.equal(statSync(file.path).size, file.bytes);
    assert.ok(file.bytes > 20000, `${file.path} 太小：${file.bytes}`);
    const png = readFileSync(file.path);
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 1920);
    assert.equal(png.readUInt32BE(20), 1080);
  }

  const pdfFile = join(out, 'sub', 'deck.pdf');
  const result = await exportPdf({ projectDir: SAMPLE, outFile: pdfFile });
  assert.equal(result.file, pdfFile);
  const pdf = readFileSync(pdfFile);
  assert.equal(result.bytes, pdf.length);
  const { pages } = inspectPdf(pdf);
  assert.equal(pages.length, 3);
  for (const box of pages) assert.deepEqual(box, [0, 0, 1440, 810]);
  assert.equal((pdf.toString('latin1').match(/\/Filter \/DCTDecode/g) || []).length, 3);
});

test('导出的是动效全部播完后的最后一帧（包括没被 await 的动画）', { timeout: 120000 }, async t => {
  const probe = { id: 'el_probe', type: 'shape', name: '探针', x: 0, y: 0, width: 200, height: 200, zIndex: 999, shape: 'rect', fill: '#ff0000', stroke: null };
  // step(0) 只启动动画、不等它结束；step(1) 什么都不做。导出要等动画自己播完
  const source = `export default async function (ctx) {
    const { node } = ctx.element('el_probe2');
    return { async step(index) { if (index === 0) ctx.animate(node, [{ backgroundColor: '#ff0000' }, { backgroundColor: '#00ff00' }], { duration: 600, fill: 'forwards' }); } };
  }`;
  const dir = tempProject(t, project => {
    project.pages = [
      { id: 'page_static', name: '静态', background: '#000000', elements: [{ ...probe }] },
      { id: 'page_moving', name: '有动效', background: '#000000', elements: [{ ...probe, id: 'el_probe2' }], motion: { steps: 2, source } },
    ];
  });
  const out = tempDir(t, 'vw-export-out-');
  const { files } = await exportImages({ projectDir: dir, outDir: out });
  const [still, moved] = files.map(file => decodePng(readFileSync(file.path)));
  assert.equal(still.width, 1920);
  const [r1, g1] = still.pixel(100, 100);
  const [r2, g2] = moved.pixel(100, 100);
  assert.ok(r1 > 200 && g1 < 50, `静态页应是红色：${still.pixel(100, 100)}`);
  assert.ok(r2 < 50 && g2 > 200, `播完动效应是绿色：${moved.pixel(100, 100)}`);
  assert.deepEqual(moved.pixel(1000, 600).slice(0, 3).map(v => v < 20), [true, true, true], '背景仍是黑色');
});

test('动效出错时拒绝导出，中文提示里有页面编号', { timeout: 120000 }, async t => {
  const dir = tempProject(t, project => {
    project.pages[1].motion = { steps: 1, source: "export default () => ({ step() { throw new Error('故意出错') } })" };
  });
  const out = tempDir(t, 'vw-export-out-');
  await assert.rejects(exportImages({ projectDir: dir, outDir: out }), error => {
    assert.match(error.message, /page_scene2/);
    assert.match(error.message, /第 2 页.*动效出错/);
    assert.match(error.message, /故意出错/);
    return true;
  });
});

test('动效卡住时按时限停下，中文提示里有页面编号', { timeout: 120000 }, async t => {
  const dir = tempProject(t, project => {
    project.pages = [project.pages[2]];
    project.pages[0].motion = { steps: 1, source: 'export default () => ({ step() { return new Promise(() => {}) } })' };
  });
  const out = tempDir(t, 'vw-export-out-');
  await assert.rejects(exportImages({ projectDir: dir, outDir: out, timeout: 800 }), error => {
    assert.match(error.message, /page_clip3/);
    assert.match(error.message, /第 1 步超过 800 ms/);
    return true;
  });
});
