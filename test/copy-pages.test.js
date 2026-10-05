// 复制页面（格式 v3）：页面文件 + 引用的资源 + 修改单；源项目只读。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyPages, copyPagesInto, parsePageList } from '../src/copy-pages.js';
import { validateProject } from '../src/validate.js';
// 格式 v3 的示例项目（测试自己生成，不依赖 examples/）：两页 HTML、一张照片、一个 logo、一份较大的字体
import { after as afterAll } from 'node:test';
import { mkdirSync as mkdirSample, writeFileSync as writeSample, mkdtempSync as mkdtempSample, rmSync as rmSample } from 'node:fs';
import { tmpdir as tmpSample } from 'node:os';
import { join as joinSample } from 'node:path';
function writeV3Sample(dir, id = 'sample-deck') {
  for (const sub of ['pages', 'assets', 'fonts']) mkdirSample(joinSample(dir, sub), { recursive: true });
  const font = Buffer.alloc(300_000); for (let i = 0; i < font.length; i++) font[i] = (i * 2654435761) >>> 24;
  writeSample(joinSample(dir, 'fonts/Inter-Variable.ttf'), font);
  writeSample(joinSample(dir, 'assets/photo-city.png'), Buffer.from('城市照片的内容'.repeat(50)));
  writeSample(joinSample(dir, 'assets/logo.png'), Buffer.from('logo'));
  writeSample(joinSample(dir, 'pages/page_cover.html'), '<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url(../fonts/Inter-Variable.ttf)} body{background:#123456;color:#fafafa}</style></head><body><h1 data-vw-id="title" data-vw="text move color">视觉工作台</h1><img data-vw-id="hero" data-vw="move resize crop" src="../assets/photo-city.png"></body></html>\n');
  writeSample(joinSample(dir, 'pages/page_two.html'), '<!doctype html><html><body><img data-vw-id="logo" data-vw="move" src="../assets/logo.png"><p data-vw-id="body" data-vw="text">第二页</p></body></html>\n');
  const now = '2026-10-01T12:00:00.000Z';
  const project = { format: 'visual-workbench/project', formatVersion: 3, id, name: '示例课件', createdAt: now, updatedAt: now,
    artboard: { preset: 'slide-16x9', width: 1920, height: 1080 },
    assets: [{ id: 'asset_photo', kind: 'image', file: 'assets/photo-city.png', name: '城市' }, { id: 'asset_logo', kind: 'image', file: 'assets/logo.png', name: 'logo' }],
    fonts: [{ id: 'font_inter', family: 'Inter', file: 'fonts/Inter-Variable.ttf', weight: 'variable' }],
    pages: [{ id: 'page_cover', name: '封面', file: 'pages/page_cover.html', motion: { steps: 1 }, edits: [] }, { id: 'page_two', name: '第二页', file: 'pages/page_two.html', edits: [] }] };
  writeSample(joinSample(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return dir;
}
const SAMPLE_ROOT = mkdtempSample(joinSample(tmpSample(), 'vw-sample-'));
afterAll(() => rmSample(SAMPLE_ROOT, { recursive: true, force: true }));
const SAMPLE = writeV3Sample(joinSample(SAMPLE_ROOT, 'sample-deck'));

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
function snapshot(dir, base = dir, out = new Map()) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) snapshot(abs, base, out);
    else out.set(abs.slice(base.length + 1).replaceAll('\\', '/'), readFileSync(abs));
  }
  return out;
}
/** 在样例上加：第 2 页引用一份样式表（样式表再引用字体和图），第 1 页有贴图修改单。 */
function richSource(tmp) {
  const dir = join(tmp, 'src');
  cpSync(SAMPLE, dir, { recursive: true });
  mkdirSync(join(dir, 'assets/css'), { recursive: true });
  writeFileSync(join(dir, 'assets/css/theme.css'), '@font-face{font-family:X;src:url("../../fonts/Inter-Variable.ttf")} .bg{background:url(../bg.png)}');
  writeFileSync(join(dir, 'assets/bg.png'), 'bg');
  writeFileSync(join(dir, 'assets/paste.png'), 'pasted');
  writeFileSync(join(dir, 'pages/page_two.html'), '<!doctype html><link rel="stylesheet" href="../assets/css/theme.css"><body class="bg"><img data-vw-id="logo" data-vw="move" src="../assets/logo.png"><p data-vw-id="body" data-vw="text">第二页</p></body>');
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
  p.assets.push({ id: 'asset_css', kind: 'file', file: 'assets/css/theme.css' }, { id: 'asset_bg', kind: 'image', file: 'assets/bg.png' }, { id: 'asset_paste', kind: 'image', file: 'assets/paste.png' });
  p.pages[0].edits = [{ id: 'ed_paste001', target: 'u_aaaa1111', kind: 'addImage', before: null, after: { asset: 'asset_paste', x: 1, y: 2, width: 30, height: 40 } }];
  writeFileSync(join(dir, 'project.json'), JSON.stringify(p, null, 2));
  return dir;
}
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('复制第 1、2 页成新项目：页面文件、引用的资源（含样式表里再引用的）都带上并登记，校验通过', () => {
  withTmp((tmp) => {
    const src = richSource(tmp);
    const dest = join(tmp, 'projects', 'copy');
    const r = copyPages({ srcProjectDir: src, pages: [1, 2], destProjectDir: dest, newId: 'copy' });
    const check = validateProject(dest);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual(r.project.pages.map((p) => p.id), ['page_cover', 'page_two']);
    for (const f of ['pages/page_cover.html', 'pages/page_two.html', 'assets/photo-city.png', 'assets/logo.png', 'assets/css/theme.css', 'assets/bg.png', 'assets/paste.png', 'fonts/Inter-Variable.ttf']) assert.ok(existsSync(join(dest, f)), f);
    assert.equal(r.project.formatVersion, 3);
    assert.equal(r.project.assets.find((a) => a.file === 'assets/photo-city.png').source.type, 'copied-from-project');
    assert.deepEqual(r.project.fonts.map((f) => f.id), ['font_inter']);
    assert.equal(r.project.pages[0].edits[0].after.asset, 'asset_paste');
  });
});

test('只复制第 2 页：只带这一页用到的资源', () => {
  withTmp((tmp) => {
    const src = richSource(tmp);
    const dest = join(tmp, 'projects', 'only-two');
    const r = copyPages({ srcProjectDir: src, pages: [2], destProjectDir: dest, newId: 'only-two', newName: '第二页单独' });
    assert.equal(r.project.name, '第二页单独');
    assert.equal(existsSync(join(dest, 'assets/photo-city.png')), false);
    assert.ok(r.project.assets.every((a) => a.file !== 'assets/photo-city.png'));
    assert.equal(validateProject(dest).ok, true);
  });
});

test('复制前后源项目所有文件内容完全一致', () => {
  withTmp((tmp) => {
    const src = richSource(tmp);
    const before = snapshot(src);
    copyPages({ srcProjectDir: src, pages: [1, 2], destProjectDir: join(tmp, 'projects', 'c'), newId: 'cc' });
    assert.deepEqual(snapshot(src), before);
  });
});

test('复制进已有项目：文件名冲突时改名并改写页面里的引用；页面、素材、修改单编号冲突时换新编号', () => {
  withTmp((tmp) => {
    const src = richSource(tmp);
    const destDir = join(tmp, 'dest');
    cpSync(SAMPLE, destDir, { recursive: true });
    writeFileSync(join(destDir, 'assets/logo.png'), '另一个 logo'); // 同名不同内容
    const dest = readJson(join(destDir, 'project.json'));
    dest.pages[1].edits = [{ id: 'ed_paste001', target: 'logo', kind: 'move', before: { x: 0, y: 0, width: 1, height: 1 }, after: { dx: 1, dy: 1 } }];
    const out = copyPagesInto({ srcDir: src, src: readJson(join(src, 'project.json')), pageIds: ['page_two', 'page_cover'], destDir, dest, after: 'page_cover' });
    assert.deepEqual(out.project.pages.map((p) => p.id).slice(0, 1), ['page_cover']);
    assert.equal(out.project.pages.length, 4);
    const [two, cover] = out.project.pages.slice(1, 3);
    assert.notEqual(two.id, 'page_two');
    assert.equal(two.file, `pages/${two.id}.html`);
    const html = readFileSync(join(destDir, two.file), 'utf8');
    assert.match(html, /src="\.\.\/assets\/logo-2\.png"/);
    assert.equal(readFileSync(join(destDir, 'assets/logo-2.png'), 'utf8'), 'logo');
    assert.equal(readFileSync(join(destDir, 'assets/logo.png'), 'utf8'), '另一个 logo');
    const logo2 = out.project.assets.find((a) => a.file === 'assets/logo-2.png');
    assert.ok(logo2 && logo2.id !== 'asset_logo');
    assert.notEqual(cover.edits[0].id, 'ed_paste001');
    // 相同内容的照片直接复用，不多出副本
    assert.equal(existsSync(join(destDir, 'assets/photo-city-2.png')), false);
    writeFileSync(join(destDir, 'project.json'), JSON.stringify(out.project, null, 2));
    const check = validateProject(destDir);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
  });
});

test('目标已存在、页码越界或重复、新编号不合法、源是旧格式时抛错，不留下目标目录', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'x1');
    mkdirSync(dest, { recursive: true });
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [1], destProjectDir: dest, newId: 'x1' }), /已存在/);
    for (const pages of [[0], [3], [1, 1], []]) {
      assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages, destProjectDir: join(tmp, 'projects', 'x2'), newId: 'x2' }));
      assert.equal(existsSync(join(tmp, 'projects', 'x2')), false);
    }
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [1], destProjectDir: join(tmp, 'projects', 'x3'), newId: 'Bad' }), /编号不合法/);
    const legacy = join(tmp, 'legacy');
    cpSync(SAMPLE, legacy, { recursive: true });
    writeFileSync(join(legacy, 'project.json'), JSON.stringify({ ...readJson(join(SAMPLE, 'project.json')), formatVersion: 2 }));
    assert.throws(() => copyPages({ srcProjectDir: legacy, pages: [1], destProjectDir: join(tmp, 'projects', 'x4'), newId: 'x4' }), /旧格式/);
  });
});

test('parsePageList 解析 1,3 与 1-2,3', () => {
  assert.deepEqual(parsePageList('1,3'), [1, 3]);
  assert.deepEqual(parsePageList('1-2,3'), [1, 2, 3]);
  assert.throws(() => parsePageList('3-1'), /写反/);
  assert.throws(() => parsePageList('a'), /无法识别/);
});
