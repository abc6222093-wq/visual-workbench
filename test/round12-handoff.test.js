// 第 12 轮：交接包 = 修改单。改动清单（按页、按目标、data-vw-origin、大白话 + 精确数值、对不上单列）、
// changes.json、复制给agent.txt、compare/ 改前 / 改后 / 对比图。只用临时目录与临时 home。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildChanges, exportHandoff, defaultHandoffDir, editRows } from '../src/export/changes.js';
import { makeDeck, makeWeb, cleanup, tmp } from './round12-export-fixture.test.js';
import { launchBrowser } from '../src/browser.js';

const CLI = fileURLToPath(new URL('../src/cli/export-changes.js', import.meta.url));
const AT = '2026-10-05T12:00:00.000Z';

/** 挪动、缩放、改色、改底色、改字、贴图、裁切，外加两条对不上的 */
export const EDITS = [
  { id: 'ed_text01', target: 'title', kind: 'text', at: AT, before: { html: '你好<b>世界</b>', text: '你好世界' }, after: { html: '你好<b>世界</b>！', text: '你好世界！' } },
  { id: 'ed_color1', target: 'title', kind: 'color', at: AT, before: { color: '#111111' }, after: { color: '#ff0000' } },
  { id: 'ed_move01', target: 'card', kind: 'move', at: AT, before: { x: 40, y: 120, width: 120, height: 80 }, after: { dx: 200, dy: 100 } },
  { id: 'ed_size01', target: 'card', kind: 'resize', at: AT, before: { width: 120, height: 80 }, after: { width: 160, height: 120 } },
  { id: 'ed_bg0001', target: 'card', kind: 'background', at: AT, before: { background: '#3366ff' }, after: { background: '#ff8800' } },
  { id: 'ed_crop01', target: 'hero', kind: 'crop', at: AT, before: { crop: null }, after: { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } } },
  { id: 'ed_add001', target: 'u_abcd1234', kind: 'addImage', at: AT, before: null, after: { asset: 'asset_paste', x: 500, y: 300, width: 60, height: 40 } },
  { id: 'ed_ghost1', target: 'ghost', kind: 'text', at: AT, before: { html: '旧', text: '旧' }, after: { html: '新', text: '新' } },
  { id: 'ed_nocap1', target: 'b1', kind: 'color', at: AT, before: { color: '#000000' }, after: { color: '#ffffff' } },
];

const readHtml = dir => page => { try { return readFileSync(join(dir, page.file), 'utf8'); } catch { return null; } };

test('buildChanges：按页、按目标，带 data-vw-origin、大白话、精确数值；对不上的单列', async () => {
  const { dir, project } = await makeDeck({ edits: EDITS });
  try {
    const changes = buildChanges(project, readHtml(dir));
    assert.equal(changes.summary.pages, 2);
    assert.equal(changes.summary.changedPages, 1);
    assert.equal(changes.summary.edits, 7);
    assert.equal(changes.summary.stale, 2);
    assert.equal(changes.summary.targets, 4);
    const [cover, second] = changes.pages;
    assert.equal(second.status, 'unchanged');
    assert.deepEqual(cover.targets.map(t => t.target), ['title', 'card', 'hero', 'u_abcd1234']);
    const card = cover.targets.find(t => t.target === 'card');
    assert.equal(card.origin, 'main .card');
    assert.equal(card.tag, 'div');
    assert.deepEqual(card.edits.map(e => e.kind), ['background', 'move', 'resize']);
    assert.match(card.edits[1].description, /右移 200px、下移 100px/);
    assert.deepEqual(card.edits[1].rows.at(-1), { label: '位置 x, y', before: '40, 120', after: '240, 220' });
    assert.deepEqual(card.edits[2].rows, [{ label: '宽', before: '120px', after: '160px' }, { label: '高', before: '80px', after: '120px' }]);
    const title = cover.targets[0];
    assert.equal(title.origin, 'header h1');
    assert.deepEqual(title.edits.map(e => e.kind), ['text', 'color']);
    assert.ok(title.edits[0].rows.some(r => r.label === 'HTML' && r.after === '你好<b>世界</b>！'));
    const pasted = cover.targets.at(-1);
    assert.equal(pasted.userImage, true);
    assert.equal(pasted.asset.file, 'assets/paste.png');
    assert.deepEqual(cover.stale.map(s => s.target), ['ghost', 'b1']);
    assert.match(cover.stale[0].reason, /找不到「ghost」/);
    assert.match(cover.stale[1].reason, /没有给「文字颜色」/);
    assert.deepEqual(editRows(EDITS[5]), [{ label: '裁切（源图比例）', before: '不裁', after: 'x 50%，y 0%，宽 50%，高 100%' }]);
  } finally { cleanup(dir); }
});

test('exportHandoff（不出图）：文件列表、清单内容、changes.json、复制给agent 文案；课件项目也能导，没有基准也行', async () => {
  const { dir } = await makeDeck({ edits: EDITS });
  const out = join(tmp('vw-r12-handoff-out-'), 'h');
  try {
    assert.equal(existsSync(join(dir, 'import')), false);
    const result = await exportHandoff({ projectDir: dir, outDir: out, images: false, now: () => new Date(AT) });
    assert.deepEqual(result.files, ['改动清单.md', 'changes.json', '复制给agent.txt']);
    const md = readFileSync(join(out, '改动清单.md'), 'utf8');
    for (const s of [
      '## 总览', '共 2 页，1 页有改动：4 个元素、7 条修改；另有 2 条对不上', '## 第 1 页 · 封面', '`data-vw-origin="main .card"`',
      '「card」右移 200px、下移 100px', '| 位置 x, y | 40, 120 | 240, 220 |', '| 底色 | #3366ff | #ff8800 |', '| 文字颜色 | #111111 | #ff0000 |',
      '「title」文字从「你好世界」改成「你好世界！」', '新增图片「u_abcd1234」', '用户贴进来的图片', '### 对不上的条目', '第 2 页 · 第二页：本页无改动',
    ]) assert.ok(md.includes(s), `清单里应有：${s}\n${md}`);
    const json = JSON.parse(readFileSync(join(out, 'changes.json'), 'utf8'));
    assert.equal(json.format, 'visual-workbench/changes');
    assert.equal(json.version, 2);
    assert.equal(json.kind, 'deck');
    assert.equal(json.pages[0].targets[1].edits[1].after.dx, 200);
    assert.equal(json.pages[0].stale.length, 2);
    const text = readFileSync(join(out, '复制给agent.txt'), 'utf8');
    assert.equal(text, result.agentText);
    assert.match(text, /^请按改动清单修改网站代码：/);
    assert.match(text, /只改清单列出的元素和属性/);
    assert.match(text, /data-vw-origin \/ data-vw-id 定位/);
    assert.ok(text.includes(join(out, '改动清单.md')));
  } finally { cleanup(dir, join(out, '..')); }
});

test('修改单是空的：照样出清单，写明没有需要改的地方，不出对比图', async () => {
  const { dir } = await makeWeb();
  const out = join(tmp('vw-r12-handoff-empty-'), 'h');
  let called = false;
  try {
    const result = await exportHandoff({ projectDir: dir, outDir: out, shooter: async () => { called = true; return {}; } });
    assert.equal(called, false);
    assert.equal(result.summary.edits, 0);
    assert.match(readFileSync(join(out, '改动清单.md'), 'utf8'), /修改单是空的/);
  } finally { cleanup(dir, join(out, '..')); }
});

test('CLI：--no-images 打印清单路径和复制给 agent 的文字；defaultHandoffDir 命名', async () => {
  const { dir } = await makeWeb({ edits: [{ id: 'ed_wcolor', target: 'headline', kind: 'color', at: AT, before: { color: '#222222' }, after: { color: '#00aa00' } }] });
  const out = join(tmp('vw-r12-handoff-cli-'), 'h');
  try {
    const run = spawnSync(process.execPath, [CLI, dir, '--out', out, '--no-images'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(join(out, '改动清单.md')));
    assert.match(run.stdout, /请按改动清单修改网站代码/);
    const md = readFileSync(join(out, '改动清单.md'), 'utf8');
    assert.ok(md.includes('来源网址 https://example.test/'));
    assert.ok(md.includes('`data-vw-origin="section.hero h1"`'));
    assert.ok(md.includes('第 1 页 · 手机端 · 首页'));
    const bad = spawnSync(process.execPath, [CLI, dir, '--wat'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
    assert.equal(defaultHandoffDir('/data', 'p1', new Date(2026, 9, 4, 9, 5, 7)), join('/data', 'exports', 'p1', 'handoff-20261004-090507'));
  } finally { cleanup(dir, join(out, '..')); }
});

async function pixel(buffer, x, y) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const near = (actual, expected, tol = 40) => actual.every((v, i) => Math.abs(v - expected[i]) <= tol);

test('真实浏览器出对比图：改后图里挪动 / 改底色 / 裁切 / 贴图都在对应位置', { timeout: 240000 }, async t => {
  try { const browser = await launchBrowser(); await browser.close(); }
  catch (error) { if (error.code === 'NO_BROWSER') return t.skip('本机没有可用浏览器'); throw error; }
  const { dir } = await makeDeck({ edits: EDITS });
  const out = join(tmp('vw-r12-handoff-img-'), 'h');
  try {
    const result = await exportHandoff({ projectDir: dir, outDir: out });
    assert.deepEqual(readdirSync(join(out, 'compare')).sort(), ['01-page-对比.png', '01-page-改前.png', '01-page-改后.png']);
    assert.ok(result.files.includes('compare/01-page-对比.png'));
    const before = readFileSync(join(out, 'compare/01-page-改前.png'));
    const after = readFileSync(join(out, 'compare/01-page-改后.png'));
    const both = await sharp(join(out, 'compare/01-page-对比.png')).metadata();
    assert.deepEqual([both.width, both.height], [640 * 2 + 24, 360 + 40]);
    // 卡片：改前在原位是蓝色；改后原位空白，挪到 (240,220) 起、160×120、底色橙
    assert.ok(near(await pixel(before, 60, 140), [0x33, 0x66, 0xff]), '改前卡片原位是蓝色');
    assert.ok(near(await pixel(after, 60, 140), [255, 255, 255]), '改后卡片原位空了');
    assert.ok(near(await pixel(after, 380, 330), [0xff, 0x88, 0x00]), '改后卡片在新位置、新尺寸、橙色');
    assert.ok(near(await pixel(before, 380, 330), [255, 255, 255]), '改前新位置是空白');
    // 图片：改前左半红；裁切到右半后整张是蓝
    assert.ok(near(await pixel(before, 420, 200), [255, 0, 0]), '改前图片左边红');
    assert.ok(near(await pixel(after, 420, 200), [0, 0, 255]), '改后裁切成右半（蓝）');
    // 贴进来的图：(500,300) 60×40 绿
    assert.ok(near(await pixel(after, 530, 320), [0, 255, 0]), '改后贴图在');
    assert.ok(near(await pixel(before, 530, 320), [255, 255, 255]), '改前没有贴图');
    const md = readFileSync(join(out, '改动清单.md'), 'utf8');
    assert.ok(md.includes('对比图：compare/01-page-改前.png、compare/01-page-改后.png、compare/01-page-对比.png'));
  } finally { cleanup(dir, join(out, '..')); }
});
