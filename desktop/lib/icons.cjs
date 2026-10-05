'use strict';
/*
 * 手写 ICO（Windows）与 ICNS（Mac）容器：里面直接放 PNG 数据。
 * 同时提供解析函数，测试用它检查生成的文件头和尺寸表。
 */

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// ICNS 的 PNG 类型码 → 像素尺寸
const ICNS_TYPES = { ic11: 32, ic12: 64, ic07: 128, ic13: 256, ic08: 256, ic14: 512, ic09: 512, ic10: 1024 };

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('不是 PNG 数据');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** images: [{ size, png }]，size 1–256 */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, o);
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1);
    entries.writeUInt8(0, o + 2); entries.writeUInt8(0, o + 3);
    entries.writeUInt16LE(1, o + 4); entries.writeUInt16LE(32, o + 6);
    entries.writeUInt32LE(png.length, o + 8); entries.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map((x) => x.png)]);
}

function parseIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('不是 ICO 文件');
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const size = buf.readUInt8(o) || 256;
    const length = buf.readUInt32LE(o + 8), offset = buf.readUInt32LE(o + 12);
    const png = buf.subarray(offset, offset + length);
    out.push({ size, bpp: buf.readUInt16LE(o + 6), length, offset, png: pngSize(png) });
  }
  return out;
}

/** images: [{ type: 'ic10', png }] */
function buildIcns(images) {
  const chunks = images.map(({ type, png }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii'); h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii'); head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

function parseIcns(buf) {
  if (buf.toString('ascii', 0, 4) !== 'icns') throw new Error('不是 ICNS 文件');
  const total = buf.readUInt32BE(4);
  if (total !== buf.length) throw new Error('ICNS 长度不对');
  const out = [];
  for (let o = 8; o < total;) {
    const type = buf.toString('ascii', o, o + 4), length = buf.readUInt32BE(o + 4);
    if (length < 8 || o + length > total) throw new Error('ICNS 块长度不对');
    out.push({ type, length, png: pngSize(buf.subarray(o + 8, o + length)) });
    o += length;
  }
  return out;
}

module.exports = { ICO_SIZES, ICNS_TYPES, pngSize, buildIco, parseIco, buildIcns, parseIcns };
