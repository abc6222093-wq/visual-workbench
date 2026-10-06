// 第 15–16 轮导出：两种用途（印刷版 300 dpi PNG / 线上版 1 倍 JPEG）的图片、PDF、放映版 HTML；PPTX 图片版与可改字版（不分用途）。
// 用 round12-export-fixture 的小课件（640×360，2 页），保持测试快。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { makeDeck, cleanup, tmp } from './round12-export-fixture.test.js';
import { exportProject } from '../src/export/index.js';

const W = 640, H = 360, K = 300 / 96;
async function withDeck(t) {
  const { dir } = await makeDeck();
  const out = tmp('vw-round16-export-');
  t.after(() => { cleanup(dir); rmSync(out, { recursive: true, force: true }); });
  return { dir, out };
}

test('round16 导出图片：印刷版 PNG 300 dpi、线上版 JPEG 1 倍、不给用途和原来一样', async t => {
  const { dir, out } = await withDeck(t);
  const print = await exportProject({ projectDir: dir, kind: 'images', outDir: out, purpose: 'print' });
  assert.equal(print.files.length, 2);
  for (const f of print.files) {
    assert.match(f.path, /（印刷版）[\\/][^\\/]+\.png$/);
    const m = await sharp(f.path).metadata();
    assert.equal(m.format, 'png');
    assert.equal(m.width, Math.round(W * K)); assert.equal(m.height, Math.round(H * K));
  }
  const web = await exportProject({ projectDir: dir, kind: 'images', outDir: out, purpose: 'web' });
  for (const f of web.files) {
    assert.match(f.path, /（线上版）[\\/][^\\/]+\.jpe?g$/);
    const m = await sharp(f.path).metadata();
    assert.equal(m.format, 'jpeg'); assert.equal(m.width, W); assert.equal(m.height, H);
  }
  const plainDir = join(out, 'plain');
  const plain = await exportProject({ projectDir: dir, kind: 'images', outDir: plainDir });
  assert.equal(plain.files.length, 2);
  for (const f of plain.files) {
    assert.doesNotMatch(f.path, /印刷版|线上版/);
    const m = await sharp(f.path).metadata();
    assert.equal(m.format, 'png'); assert.equal(m.width, W);
  }
});

test('round16 导出 PDF 与放映版：两种用途都能生成，文件名带用途，印刷版 PDF 更大', async t => {
  const { dir, out } = await withDeck(t);
  const pp = await exportProject({ projectDir: dir, kind: 'pdf', outDir: out, purpose: 'print' });
  const pw = await exportProject({ projectDir: dir, kind: 'pdf', outDir: out, purpose: 'web' });
  assert.match(basename(pp.files[0].path), /（印刷版）\.pdf$/);
  assert.match(basename(pw.files[0].path), /（线上版）\.pdf$/);
  for (const r of [pp, pw]) assert.equal(readFileSync(r.files[0].path).subarray(0, 5).toString(), '%PDF-');
  assert.ok(pp.files[0].bytes > pw.files[0].bytes, `印刷版 ${pp.files[0].bytes} 应大于线上版 ${pw.files[0].bytes}`);
  const hp = await exportProject({ projectDir: dir, kind: 'html', outDir: out, purpose: 'print' });
  const hw = await exportProject({ projectDir: dir, kind: 'html', outDir: out, purpose: 'web' });
  const h0 = await exportProject({ projectDir: dir, kind: 'html', outDir: join(out, 'plain') });
  assert.match(basename(hp.files[0].path), /（印刷版）\.html$/);
  assert.match(basename(hw.files[0].path), /（线上版）\.html$/);
  assert.doesNotMatch(basename(h0.files[0].path), /印刷版|线上版/);
  for (const r of [hp, hw, h0]) assert.match(readFileSync(r.files[0].path, 'utf8'), /^<!doctype html>/i);
});

async function slides(file) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  return { zip, names, xml: await Promise.all(names.map(n => zip.file(n).async('string'))) };
}

test('round16 PPTX：图片版没有文本框；可改字版有标了 text 的文字、字号位置字体；不分用途', async t => {
  const { dir, out } = await withDeck(t);
  const img = await exportProject({ projectDir: dir, kind: 'pptx', pptxMode: 'image', outDir: out });
  const ed = await exportProject({ projectDir: dir, kind: 'pptx', pptxMode: 'editable', outDir: out });
  for (const r of [img, ed]) {
    assert.equal(r.files.length, 1);
    assert.match(r.files[0].path, /\.pptx$/);
    assert.doesNotMatch(basename(r.files[0].path), /印刷版|线上版/);
    assert.equal(r.purpose, undefined);
  }
  assert.notEqual(img.files[0].path, ed.files[0].path);
  const a = await slides(img.files[0].path);
  assert.deepEqual(a.names, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
  for (const x of a.xml) { assert.doesNotMatch(x, /<a:t>/); assert.match(x, /<p:pic>/); }
  const b = await slides(ed.files[0].path);
  assert.equal(b.names.length, 2);
  const s1 = b.xml[0];
  const texts = [...s1.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]).join('');
  assert.match(texts, /你好/); assert.match(texts, /世界/);
  // 标题 font-size 40px = 30pt（sz 以 1/100 pt 计）；字体用页面的 font-family 第一个具体字体名
  assert.match(s1, /sz="3000"/);
  assert.match(s1, /typeface="Fixture Sans"/);
  // 位置：left 40px → 40/96 in = 381000 EMU（允许 ±2px 误差）
  const sp = s1.split('<p:sp>').find(x => x.includes('你好'));
  const off = /<a:off x="(\d+)" y="(\d+)"/.exec(sp);
  assert.ok(off, '文本框有位置');
  assert.ok(Math.abs(Number(off[1]) - 381000) < 2 * 9525, `x=${off[1]}`);
  assert.match(b.xml[1], /<a:t>/, '第 2 页的文字也是文本框');
});
