import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_FILE } from '../src/data-dir.js';
import { blankPage, createFromMaster, extractPalette, readMasters, setMaster } from '../src/master.js';
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
const COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 读出目录下所有文件内容（相对路径 -> Buffer） */
function snapshot(dir, base = dir, out = new Map()) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) snapshot(abs, base, out);
    else out.set(abs.slice(base.length + 1), readFileSync(abs));
  }
  return out;
}

/** 把 sample-deck 复制进临时目录当母版，并加上动效代码、版本、隐藏文件等附属内容。 */
function makeMaster(tmp) {
  const masterDir = join(tmp, 'projects', 'sample-deck');
  cpSync(SAMPLE, masterDir, { recursive: true });
  // 母版第 1 页有一条修改单；有一张素材库来的图（页面没引用，也要带走）和一个字体许可证文件
  const project = JSON.parse(readFileSync(join(masterDir, 'project.json'), 'utf8'));
  project.pages[0].edits = [{ id: 'ed_master01', target: 'title', kind: 'color', before: { color: '#fafafa' }, after: { color: '#ff0000' } }];
  writeFileSync(join(masterDir, 'assets/lib.png'), 'library image');
  writeFileSync(join(masterDir, 'assets/unused.png'), 'not from library');
  project.assets.push({ id: 'asset_lib', kind: 'image', file: 'assets/lib.png', source: { type: 'library', from: 'lib.png' } }, { id: 'asset_unused', kind: 'image', file: 'assets/unused.png', source: { type: 'upload' } });
  writeFileSync(join(masterDir, 'fonts/Inter-OFL.txt'), 'OFL');
  project.fonts[0].license = 'fonts/Inter-OFL.txt';
  writeFileSync(join(masterDir, 'project.json'), JSON.stringify(project, null, 2));
  mkdirSync(join(masterDir, 'import'), { recursive: true });
  writeFileSync(join(masterDir, 'import', 'old.html'), '<p>old</p>');
  mkdirSync(join(masterDir, 'code'), { recursive: true });
  writeFileSync(join(masterDir, 'code', 'intro.js'), 'export const intro = 1;\n');
  mkdirSync(join(masterDir, 'motion', 'a'), { recursive: true });
  writeFileSync(join(masterDir, 'motion', 'a', 'b.js'), 'export default () => "b";\n');
  mkdirSync(join(masterDir, 'versions', 'v1'), { recursive: true });
  writeFileSync(join(masterDir, 'versions', 'v1', 'meta.json'), '{}\n');
  writeFileSync(join(masterDir, '.hidden'), 'secret\n');
  return masterDir;
}

function create(tmp, masterDir, extra = {}) {
  return createFromMaster({
    masterDir,
    destProjectDir: join(tmp, 'projects', 'series-two'),
    newId: 'series-two',
    newName: '系列第二讲',
    now: new Date('2026-10-02T08:00:00.000Z'),
    ...extra,
  });
}

// ---------- 母版标记 ----------

test('readMasters：状态文件不存在时返回 []', () => {
  withTmp((tmp) => {
    assert.deepEqual(readMasters(tmp), []);
  });
});

test('setMaster：设置、取消、去重、排序', () => {
  withTmp((tmp) => {
    assert.deepEqual(setMaster(tmp, 'zeta-deck', true), ['zeta-deck']);
    assert.deepEqual(setMaster(tmp, 'alpha-deck', true), ['alpha-deck', 'zeta-deck']);
    assert.deepEqual(setMaster(tmp, 'alpha-deck', true), ['alpha-deck', 'zeta-deck']);
    assert.deepEqual(readMasters(tmp), ['alpha-deck', 'zeta-deck']);
    assert.deepEqual(setMaster(tmp, 'zeta-deck', false), ['alpha-deck']);
    assert.deepEqual(setMaster(tmp, 'not-there', false), ['alpha-deck']);
    assert.deepEqual(readMasters(tmp), ['alpha-deck']);
    // 原子写：不留临时文件
    assert.deepEqual(readdirSync(tmp), [STATE_FILE]);
  });
});

test('readMasters：状态文件损坏时返回 []', () => {
  withTmp((tmp) => {
    writeFileSync(join(tmp, STATE_FILE), '{ 坏掉的 json');
    assert.deepEqual(readMasters(tmp), []);
    writeFileSync(join(tmp, STATE_FILE), JSON.stringify({ masters: 'abc' }));
    assert.deepEqual(readMasters(tmp), []);
    // 损坏时也能重新写入
    assert.deepEqual(setMaster(tmp, 'sample-deck', true), ['sample-deck']);
  });
});

test('setMaster：保留状态文件里的未知字段', () => {
  withTmp((tmp) => {
    writeFileSync(join(tmp, STATE_FILE), JSON.stringify({ masters: ['b-deck', 'b-deck'], theme: 'dark', nested: { a: 1 } }));
    assert.deepEqual(readMasters(tmp), ['b-deck', 'b-deck']);
    assert.deepEqual(setMaster(tmp, 'a-deck', true), ['a-deck', 'b-deck']);
    const data = JSON.parse(readFileSync(join(tmp, STATE_FILE), 'utf8'));
    assert.deepEqual(data, { masters: ['a-deck', 'b-deck'], theme: 'dark', nested: { a: 1 } });
  });
});

test('blankPage：v3 空白页条目，页面文件在 pages/ 下', () => {
  assert.deepEqual(blankPage(), { id: 'page_first', name: '第 1 页', file: 'pages/page_first.html', edits: [] });
});

// ---------- 从母版新建 ----------

test('createFromMaster：新项目校验通过；起始页 = 母版第 1 页的副本（文件、资源、修改单），画板来自母版', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const { project, destProjectDir } = create(tmp, masterDir);
    const check = validateProject(destProjectDir);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.equal(project.formatVersion, 3);
    assert.equal(project.pages.length, 1);
    assert.equal(project.pages[0].id, 'page_cover');
    assert.equal(readFileSync(join(destProjectDir, 'pages/page_cover.html'), 'utf8'), readFileSync(join(masterDir, 'pages/page_cover.html'), 'utf8'));
    assert.equal(project.pages[0].edits[0].after.color, '#ff0000');
    assert.ok(existsSync(join(destProjectDir, 'assets/photo-city.png')));
    assert.ok(project.assets.some((a) => a.file === 'assets/photo-city.png'));
    assert.deepEqual(project.artboard, JSON.parse(readFileSync(join(masterDir, 'project.json'), 'utf8')).artboard);
    assert.equal(project.id, 'series-two');
    assert.equal(project.name, '系列第二讲');
  });
});

test('createFromMaster：带走全部字体与许可证；只带素材库来的素材和起始页用到的素材', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const { project, destProjectDir } = create(tmp, masterDir);
    assert.deepEqual(project.fonts.map((f) => f.id), ['font_inter']);
    assert.ok(existsSync(join(destProjectDir, 'fonts/Inter-Variable.ttf')));
    assert.ok(existsSync(join(destProjectDir, 'fonts/Inter-OFL.txt')));
    const ids = project.assets.map((a) => a.id).sort();
    assert.ok(ids.includes('asset_lib'));
    assert.ok(!ids.includes('asset_unused'));
    assert.ok(!ids.includes('asset_logo'), '第 2 页的素材不带');
    assert.equal(existsSync(join(destProjectDir, 'assets/unused.png')), false);
    for (const a of project.assets) assert.equal(a.pendingLayout, undefined);
  });
});

test('createFromMaster：series.json 记 master、palette、pages，母版各页 HTML 复制到 series/pages/ 做参考', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const { destProjectDir, palette } = create(tmp, masterDir);
    const series = JSON.parse(readFileSync(join(destProjectDir, 'series.json'), 'utf8'));
    assert.equal(series.master, 'sample-deck');
    assert.equal(series.motions, undefined);
    assert.deepEqual(series.pages, [
      { pageId: 'page_cover', name: '封面', file: 'series/pages/page_cover.html' },
      { pageId: 'page_two', name: '第二页', file: 'series/pages/page_two.html' },
    ]);
    for (const p of series.pages) assert.equal(readFileSync(join(destProjectDir, p.file), 'utf8'), readFileSync(join(masterDir, 'pages', `${p.pageId}.html`), 'utf8'));
    assert.deepEqual(series.palette, palette);
    assert.ok(palette.includes('#123456') && palette.includes('#fafafa'));
    for (const c of palette) assert.match(c, COLOR_RE);
  });
});

test('createFromMaster：复制附属文件，不复制 versions/、import/、隐藏文件，母版的 pages/ 不混进新项目', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const { destProjectDir, copiedExtra } = create(tmp, masterDir);
    assert.deepEqual(copiedExtra, ['code/intro.js', 'motion/a/b.js']);
    assert.equal(existsSync(join(destProjectDir, 'versions', 'v1')), false);
    assert.equal(existsSync(join(destProjectDir, 'import')), false);
    assert.equal(existsSync(join(destProjectDir, '.hidden')), false);
    assert.deepEqual(readdirSync(join(destProjectDir, 'pages')), ['page_cover.html']);
  });
});

test('createFromMaster：附属文件里的符号链接被跳过', (t) => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    try { symlinkSync(join(masterDir, 'code', 'intro.js'), join(masterDir, 'code', 'link.js')); }
    catch (e) { if (process.platform !== 'win32' || e.code !== 'EPERM') throw e; t.diagnostic('Windows 无法创建符号链接，跳过'); return; }
    const { destProjectDir } = create(tmp, masterDir);
    assert.equal(existsSync(join(destProjectDir, 'code', 'link.js')), false);
  });
});

test('createFromMaster：母版所有文件逐字节不变；之后改新项目也不影响母版', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const before = snapshot(masterDir);
    const { destProjectDir } = create(tmp, masterDir);
    writeFileSync(join(destProjectDir, 'pages/page_cover.html'), '<p>改了</p>');
    writeFileSync(join(destProjectDir, 'fonts/Inter-Variable.ttf'), 'changed');
    assert.deepEqual(snapshot(masterDir), before);
  });
});

test('createFromMaster：目标已存在、编号不合法、名称为空、母版是旧格式时抛错，不留下新目录', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const dest = join(tmp, 'projects', 'series-two');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'keep.txt'), 'keep');
    assert.throws(() => create(tmp, masterDir), /已存在/);
    assert.equal(readFileSync(join(dest, 'keep.txt'), 'utf8'), 'keep');
    rmSync(dest, { recursive: true });
    assert.throws(() => create(tmp, masterDir, { newId: 'Bad Id' }), /编号不合法/);
    assert.throws(() => create(tmp, masterDir, { newName: '  ' }), /名称不能为空/);
    const file = join(masterDir, 'project.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), formatVersion: 2 }));
    assert.throws(() => create(tmp, masterDir), /旧格式/);
    assert.equal(existsSync(dest), false);
  });
});

test('createFromMaster：母版字体文件缺失时抛错并清理新目录', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    rmSync(join(masterDir, 'fonts/Inter-Variable.ttf'));
    assert.throws(() => create(tmp, masterDir), /字体文件不存在/);
    assert.equal(existsSync(join(tmp, 'projects', 'series-two')), false);
  });
});

test('extractPalette：设计卡片颜色 + 页面里的十六进制颜色，按次数排序、去重、统一小写', () => {
  withTmp((tmp) => {
    const dir = join(tmp, 'p');
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages/page_a.html'), '<style>a{color:#ABC} b{color:#aabbcc} c{background:#112233}</style>');
    const project = { designCard: { colors: ['#112233'] }, pages: [{ id: 'page_a', file: 'pages/page_a.html' }] };
    assert.deepEqual(extractPalette(project, 12, dir), ['#112233', '#aabbcc']); // 次数相同按首次出现（卡片在前）
    assert.deepEqual(extractPalette(project), ['#112233']);
    assert.deepEqual(extractPalette({}), []);
  });
});
