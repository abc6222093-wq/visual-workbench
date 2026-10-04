// 第 11 轮 · 桌面应用图标：手写 ICO / ICNS 容器的写法与已提交的图标文件
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const icons = require('../desktop/lib/icons.cjs');
const build = (name) => readFileSync(fileURLToPath(new URL(`../desktop/build/${name}`, import.meta.url)));

function fakePng(w, h, extra = 10) {
  const b = Buffer.alloc(24 + extra);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

test('ICO 容器：头、目录项（256 记作 0）、偏移与 PNG 尺寸', () => {
  const images = [16, 48, 256].map((size) => ({ size, png: fakePng(size, size, size % 7) }));
  const ico = icons.buildIco(images);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.equal(ico.readUInt8(6 + 2 * 16), 0, '256 像素写成 0');
  const parsed = icons.parseIco(ico);
  assert.deepEqual(parsed.map((x) => x.size), [16, 48, 256]);
  assert.equal(parsed[0].offset, 6 + 3 * 16);
  assert.equal(parsed[1].offset, parsed[0].offset + parsed[0].length);
  assert.ok(parsed.every((x) => x.bpp === 32 && x.png.width === x.size));
  assert.throws(() => icons.parseIco(Buffer.from([0, 0, 2, 0, 0, 0])));
});

test('ICNS 容器：icns 头 + 总长度 + 各块类型与长度', () => {
  const icns = icons.buildIcns([{ type: 'ic07', png: fakePng(128, 128) }, { type: 'ic10', png: fakePng(1024, 1024, 3) }]);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const parsed = icons.parseIcns(icns);
  assert.deepEqual(parsed.map((x) => [x.type, x.png.width]), [['ic07', 128], ['ic10', 1024]]);
  assert.equal(parsed[0].length, fakePng(128, 128).length + 8);
  const broken = Buffer.from(icns); broken.writeUInt32BE(icns.length + 1, 4);
  assert.throws(() => icons.parseIcns(broken));
});

test('已提交的图标：icon.png 1024、icon.ico 16–256、icon.icns 含 ic07–ic14', () => {
  assert.deepEqual(icons.pngSize(build('icon.png')), { width: 1024, height: 1024 });
  const ico = icons.parseIco(build('icon.ico'));
  assert.deepEqual(ico.map((x) => x.size), icons.ICO_SIZES);
  for (const x of ico) assert.deepEqual(x.png, { width: x.size, height: x.size });
  const icns = icons.parseIcns(build('icon.icns'));
  assert.deepEqual(icns.map((x) => x.type).sort(), Object.keys(icons.ICNS_TYPES).sort());
  for (const x of icns) assert.equal(x.png.width, icons.ICNS_TYPES[x.type]);
});
