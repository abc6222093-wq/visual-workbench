import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_FILE } from '../src/data-dir.js';
import { blankPage, createFromMaster, extractPalette, readMasters, setMaster } from '../src/master.js';
import { validateProject } from '../src/validate.js';

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-deck');
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

test('blankPage：默认白底空白页，可传入背景', () => {
  assert.deepEqual(blankPage(), { id: 'page_first', name: '第 1 页', background: '#ffffff', elements: [] });
  assert.equal(blankPage('#000000').background, '#000000');
});

// ---------- 从母版新建 ----------

test('createFromMaster：新项目校验通过，只有一页空白页，背景与画板来自母版', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const master = JSON.parse(readFileSync(join(masterDir, 'project.json'), 'utf8'));
    const r = create(tmp, masterDir);
    const v = validateProject(r.destProjectDir);
    assert.equal(v.ok, true, JSON.stringify(v.errors));

    const p = JSON.parse(readFileSync(join(r.destProjectDir, 'project.json'), 'utf8'));
    assert.deepEqual(p, r.project);
    assert.equal(p.id, 'series-two');
    assert.equal(p.name, '系列第二讲');
    assert.equal(p.format, master.format);
    assert.equal(p.formatVersion, master.formatVersion);
    assert.equal(p.createdAt, '2026-10-02T08:00:00.000Z');
    assert.equal(p.updatedAt, p.createdAt);
    assert.deepEqual(p.artboard, master.artboard);
    assert.equal(p.pages.length, 1);
    assert.deepEqual(p.pages[0].elements, []);
    assert.equal(p.pages[0].motion, undefined); // 格式 v2：空白页没有动效
    assert.deepEqual(p.pages[0].background, master.pages[0].background);
    for (const d of ['assets', 'fonts', 'versions']) assert.ok(existsSync(join(r.destProjectDir, d)), `${d}/ 应存在`);
  });
});

test('createFromMaster：带走全部字体登记与文件（含许可证 Inter-OFL.txt）', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const master = JSON.parse(readFileSync(join(masterDir, 'project.json'), 'utf8'));
    const r = create(tmp, masterDir);
    assert.deepEqual(r.project.fonts, master.fonts);
    assert.deepEqual(r.copiedFonts, ['font_inter']);
    for (const rel of ['fonts/Inter-Variable.ttf', 'fonts/Inter-OFL.txt']) {
      assert.deepEqual(readFileSync(join(r.destProjectDir, rel)), readFileSync(join(masterDir, rel)), `${rel} 应一致`);
    }
  });
});

test('createFromMaster：只带素材库来的素材，文件存在且 pendingLayout 为 false', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const r = create(tmp, masterDir);
    assert.deepEqual(r.project.assets.map((a) => a.id), ['asset_logo01']);
    assert.deepEqual(r.copiedAssets, ['asset_logo01']);
    const a = r.project.assets[0];
    assert.equal(a.pendingLayout, false);
    assert.equal(a.source.type, 'library');
    assert.ok(existsSync(join(r.destProjectDir, a.file)));
    assert.equal(existsSync(join(r.destProjectDir, 'assets', 'photo-city.png')), false);
    assert.equal(existsSync(join(r.destProjectDir, 'assets', 'new-photo.png')), false);
  });
});

test('createFromMaster：复制动效代码等附属文件，不复制 versions/ 与隐藏文件', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const r = create(tmp, masterDir);
    assert.deepEqual(r.copiedExtra, ['README.md', 'code/intro.js', 'motion/a/b.js']); // README.md 来自示例项目，也是附属文件
    for (const rel of r.copiedExtra) {
      assert.deepEqual(readFileSync(join(r.destProjectDir, rel)), readFileSync(join(masterDir, rel)), `${rel} 应一致`);
    }
    assert.deepEqual(readdirSync(join(r.destProjectDir, 'versions')), []);
    assert.equal(existsSync(join(r.destProjectDir, '.hidden')), false);
  });
});

test('createFromMaster：附属文件里的符号链接被跳过', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    symlinkSync(join(masterDir, 'code', 'intro.js'), join(masterDir, 'code', 'link.js'));
    symlinkSync(join(masterDir, 'motion'), join(masterDir, 'motion-link'));
    const r = create(tmp, masterDir);
    assert.deepEqual(r.copiedExtra, ['README.md', 'code/intro.js', 'motion/a/b.js']); // README.md 来自示例项目，也是附属文件
    assert.equal(existsSync(join(r.destProjectDir, 'code', 'link.js')), false);
    assert.equal(existsSync(join(r.destProjectDir, 'motion-link')), false);
  });
});

test('createFromMaster：写出 series.json（来源与配色）', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const r = create(tmp, masterDir);
    const raw = readFileSync(join(r.destProjectDir, 'series.json'), 'utf8');
    assert.ok(raw.endsWith('\n'));
    const s = JSON.parse(raw);
    assert.equal(raw, JSON.stringify(s, null, 2) + '\n');
    assert.equal(s.master, 'sample-deck');
    assert.equal(s.masterName, '示例课件 · 格式演示');
    assert.equal(s.createdFromAt, '2026-10-02T08:00:00.000Z');
    assert.ok(Array.isArray(s.palette) && s.palette.length > 0);
    for (const c of s.palette) assert.match(c, COLOR_RE);
    assert.deepEqual(s.palette, r.palette);
  });
});

test('createFromMaster：母版自带的 series.json 被新文件覆盖', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    writeFileSync(join(masterDir, 'series.json'), JSON.stringify({ master: 'old-master' }));
    const r = create(tmp, masterDir);
    const s = JSON.parse(readFileSync(join(r.destProjectDir, 'series.json'), 'utf8'));
    assert.equal(s.master, 'sample-deck');
  });
});

test('createFromMaster：母版所有文件逐字节不变', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const before = snapshot(masterDir);
    create(tmp, masterDir);
    assert.deepEqual(snapshot(masterDir), before);
  });
});

test('createFromMaster：之后修改新项目，母版对应文件不变（互不影响）', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const before = snapshot(masterDir);
    const r = create(tmp, masterDir);
    writeFileSync(join(r.destProjectDir, 'fonts', 'Inter-Variable.ttf'), 'changed');
    writeFileSync(join(r.destProjectDir, 'code', 'intro.js'), 'changed');
    writeFileSync(join(r.destProjectDir, 'motion', 'a', 'b.js'), 'changed');
    writeFileSync(join(r.destProjectDir, 'assets', 'logo.png'), 'changed');
    assert.deepEqual(snapshot(masterDir), before);
  });
});

test('createFromMaster：目标已存在时抛错，不覆盖也不删除', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    const dest = join(tmp, 'projects', 'series-two');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'keep.txt'), 'keep');
    assert.throws(() => create(tmp, masterDir), /已存在/);
    assert.deepEqual(readdirSync(dest), ['keep.txt']);
  });
});

test('createFromMaster：newId 不合法或 newName 为空时抛错，不留下新目录', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    for (const bad of ['Bad_ID', '-abc', 'a', '']) {
      const dest = join(tmp, 'projects', 'x-bad');
      assert.throws(() => create(tmp, masterDir, { newId: bad, destProjectDir: dest }), /编号不合法/);
      assert.equal(existsSync(dest), false);
    }
    for (const name of ['', '   ', undefined]) {
      assert.throws(() => create(tmp, masterDir, { newName: name }), /名称不能为空/);
      assert.equal(existsSync(join(tmp, 'projects', 'series-two')), false);
    }
  });
});

test('createFromMaster：母版字体文件缺失时抛错并清理新目录', () => {
  withTmp((tmp) => {
    const masterDir = makeMaster(tmp);
    rmSync(join(masterDir, 'fonts', 'Inter-Variable.ttf'));
    assert.throws(() => create(tmp, masterDir), /字体文件不存在/);
    assert.equal(existsSync(join(tmp, 'projects', 'series-two')), false);
  });
});

// ---------- 配色提取 ----------

test('extractPalette：按次数排序、去重、统一小写、含渐变色标', () => {
  const project = {
    pages: [
      {
        background: '#FFFFFF',
        elements: [
          { type: 'text', color: '#111111' },
          { type: 'text', color: '#111111' },
          { type: 'shape', fill: '#AA0000', stroke: { color: '#00BB00', width: 1 } },
          {
            type: 'group',
            children: [{ type: 'text', color: '#111111' }, { type: 'shape', fill: null, stroke: null }],
          },
        ],
      },
      {
        background: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#FfFfFf' }, { offset: 1, color: '#123456CC' }] },
        elements: [
          { type: 'shape', fill: { type: 'radial', stops: [{ offset: 0, color: '#aa0000' }, { offset: 1, color: '#ABCDEF' }] } },
          { type: 'image', asset: 'x' },
        ],
      },
    ],
  };
  // #111111×3，#ffffff×2，#aa0000×2（首次出现在 #ffffff 之后），其余各 1 次按首次出现顺序
  assert.deepEqual(extractPalette(project), ['#111111', '#ffffff', '#aa0000', '#00bb00', '#123456cc', '#abcdef']);
  assert.deepEqual(extractPalette(project, 2), ['#111111', '#ffffff']);
  assert.deepEqual(extractPalette({ pages: [] }), []);
});

test('extractPalette：sample-deck 的配色都是合法小写颜色且不重复', () => {
  const sample = JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf8'));
  const palette = extractPalette(sample);
  assert.ok(palette.length > 0 && palette.length <= 12);
  assert.equal(new Set(palette).size, palette.length);
  for (const c of palette) assert.match(c, COLOR_RE);
  assert.equal(palette[0], '#ffffff');
});
