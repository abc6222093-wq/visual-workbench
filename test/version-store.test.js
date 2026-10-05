import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listVersions, restoreVersion, saveVersion, versionDiskUsage } from '../src/version.js';
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
const FONT = 'fonts/Inter-Variable.ttf';
const PHOTO = 'assets/photo-city.png';

function withProject(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try {
    const dir = join(tmp, 'projects', 'demo');
    cpSync(SAMPLE, dir, { recursive: true });
    return fn(dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 项目（或版本）目录里的普通文件相对路径，跳过 versions/、meta.json 和以 . 开头的名字。 */
function projectFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.name.startsWith('.')) continue;
      if (d === dir && (ent.name === 'versions' || ent.name === 'meta.json')) continue;
      const abs = join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(relative(dir, abs).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** 读出目录里全部项目文件的内容：{ 相对路径: Buffer } */
function snapshot(dir) {
  return Object.fromEntries(projectFiles(dir).map((rel) => [rel, readFileSync(join(dir, rel))]));
}

function assertSameFiles(actualDir, expectedDir, label) {
  const a = projectFiles(actualDir);
  const e = projectFiles(expectedDir);
  assert.deepEqual(a, e, `${label}：文件列表应一致`);
  for (const rel of e) {
    assert.ok(readFileSync(join(actualDir, rel)).equals(readFileSync(join(expectedDir, rel))), `${label}：${rel} 内容应一致`);
  }
}

function setName(dir, name) {
  const file = join(dir, 'project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.name = name;
  writeFileSync(file, JSON.stringify(project, null, 2) + '\n');
}

const readMeta = (versionDir) => JSON.parse(readFileSync(join(versionDir, 'meta.json'), 'utf8'));

/** 连存 5 版：每版之间改名，第 3 版前替换城市照片的内容。返回各版目录和第 3 版起的照片内容。 */
function saveFive(dir) {
  const newPhoto = Buffer.concat([Buffer.from('替换后的照片内容'), readFileSync(join(dir, PHOTO))]);
  const versions = [];
  for (let i = 1; i <= 5; i++) {
    setName(dir, `第 ${i} 版`);
    if (i === 3) writeFileSync(join(dir, PHOTO), newPhoto);
    versions.push(saveVersion({ projectDir: dir, note: `v${i}` }).versionDir);
  }
  return { versions, newPhoto };
}

test('连存 5 版：字体只占一份磁盘空间，被替换的素材前后版本各自独立', () => {
  withProject((dir) => {
    const oldPhoto = readFileSync(join(dir, PHOTO));
    const { versions, newPhoto } = saveFive(dir);

    const fontStats = versions.map((v) => statSync(join(v, FONT)));
    const ino = fontStats[0].ino;
    for (const st of fontStats) {
      assert.equal(st.ino, ino, '5 个版本里的字体应是同一个 inode');
      assert.ok(st.nlink >= 6, `字体的硬链接数应 >= 6，实际 ${st.nlink}`);
    }
    const meta = readMeta(versions[0]);
    assert.equal(meta.files[0], 'project.json');
    assert.match(meta.objects[FONT], /^[0-9a-f]{64}$/);
    assert.equal(statSync(join(dir, 'versions', '.objects', meta.objects[FONT])).ino, ino, '版本里的字体应链接到对象仓库');

    // 照片：第 1、2 版是旧内容，第 3～5 版是新内容
    const photoIno = versions.map((v) => statSync(join(v, PHOTO)).ino);
    assert.equal(photoIno[0], photoIno[1]);
    assert.notEqual(photoIno[1], photoIno[2], '替换前后的素材 inode 应不同');
    assert.equal(photoIno[2], photoIno[4]);
    for (const v of versions.slice(0, 2)) assert.ok(readFileSync(join(v, PHOTO)).equals(oldPhoto));
    for (const v of versions.slice(2)) assert.ok(readFileSync(join(v, PHOTO)).equals(newPhoto));

    // 空间：按路径算至少有 5 份字体；按 inode 去重后字体只算一次，其余文件总量远小于一份字体
    const fontSize = fontStats[0].size;
    const usage = versionDiskUsage(dir);
    assert.equal(usage.versions, 5);
    assert.ok(usage.apparentBytes >= fontSize * 5, `apparentBytes 应 >= 5 份字体，实际 ${usage.apparentBytes}`);
    assert.ok(usage.uniqueBytes >= fontSize, 'uniqueBytes 至少含一份字体');
    // 其余内容上限：除字体外的项目文件全部 × 5 版 + 一份新照片 + 5 个 meta.json（各取 64KB 上限）
    const others = projectFiles(SAMPLE).filter((f) => f !== FONT).reduce((s, f) => s + statSync(join(SAMPLE, f)).size, 0);
    const bound = fontSize + others * 5 + newPhoto.length + 5 * 65536;
    assert.ok(usage.uniqueBytes <= bound, `uniqueBytes 应 <= ${bound}，实际 ${usage.uniqueBytes}`);
    assert.ok(usage.uniqueBytes < fontSize * 2, `uniqueBytes 应明显小于两份字体，实际 ${usage.uniqueBytes}`);
    assert.ok(usage.uniqueBytes * 3 < usage.apparentBytes, '去重后应不到按路径计算的三分之一');
  });
});

test('逐个退回到 5 版中的每一版：校验通过，所有文件与该版一致，并自动存一份退回前备份', () => {
  withProject((dir) => {
    const { versions } = saveFive(dir);
    for (const v of versions) {
      const versionId = basename(v);
      const before = snapshot(dir);
      const countBefore = listVersions(dir).length;

      const out = restoreVersion({ projectDir: dir, versionId });

      assert.equal(out.restoredFrom, v);
      assert.deepEqual([...out.files].sort(), projectFiles(v));
      assert.equal(out.files[0], 'project.json');
      assert.equal(validateProject(dir).ok, true, `退回到 ${versionId} 后应校验通过`);
      assert.ok(readFileSync(join(dir, 'project.json')).equals(readFileSync(join(v, 'project.json'))), 'project.json 字节应一致');
      assertSameFiles(dir, v, `退回到 ${versionId}`);

      // 备份
      assert.equal(listVersions(dir).length, countBefore + 1, '退回后应多出一份版本');
      const backupMeta = readMeta(out.backup.versionDir);
      assert.deepEqual(backupMeta, out.backup.meta);
      assert.ok(backupMeta.note.startsWith('退回前'), `备份备注应以「退回前」开头：${backupMeta.note}`);
      assert.equal(backupMeta.by, 'system');
      assert.ok(readFileSync(join(out.backup.versionDir, 'project.json')).equals(before['project.json']), '备份应等于退回前的 project.json');
      assert.deepEqual(Object.keys(snapshot(out.backup.versionDir)), Object.keys(before));
    }
  });
});

test('退回后改写活动项目里的字体，不影响对象仓库和各版本', () => {
  withProject((dir) => {
    const original = readFileSync(join(dir, FONT));
    const { versions } = saveFive(dir);
    restoreVersion({ projectDir: dir, versionId: basename(versions[1]) });

    const activeIno = statSync(join(dir, FONT)).ino;
    assert.notEqual(activeIno, statSync(join(versions[1], FONT)).ino, '活动文件不能是对象的硬链接');
    writeFileSync(join(dir, FONT), Buffer.from('被改坏的字体'));

    for (const v of listVersions(dir)) {
      assert.ok(readFileSync(join(v, FONT)).equals(original), `${basename(v)} 里的字体应保持不变`);
    }
    const hash = readMeta(versions[1]).objects[FONT];
    assert.ok(readFileSync(join(dir, 'versions', '.objects', hash)).equals(original), '对象仓库里的字体应保持不变');
  });
});

test('退回时删除多出来的文件、恢复缺少的文件；assets/fonts 以外的新文件也会存进版本', () => {
  withProject((dir) => {
    const v1 = saveVersion({ projectDir: dir, note: '无代码' });

    mkdirSync(join(dir, 'code'));
    writeFileSync(join(dir, 'code', 'a.js'), 'export const a = 1;\n');
    const v2 = saveVersion({ projectDir: dir, note: '有代码' });
    assert.ok(v2.meta.files.includes('code/a.js'), '新增的代码文件应被存进版本');
    assert.match(v2.meta.objects['code/a.js'], /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(join(v2.versionDir, 'code', 'a.js'), 'utf8'), 'export const a = 1;\n');

    // 当前：删掉代码和标志，多一张素材
    rmSync(join(dir, 'code'), { recursive: true });
    unlinkSync(join(dir, 'assets', 'logo.png'));
    writeFileSync(join(dir, 'assets', 'extra.png'), 'extra');

    restoreVersion({ projectDir: dir, versionId: basename(v1.versionDir) });
    assert.equal(existsSync(join(dir, 'assets', 'extra.png')), false, '多出来的素材应被删除');
    assert.equal(existsSync(join(dir, 'code', 'a.js')), false);
    assert.ok(existsSync(join(dir, 'assets', 'logo.png')), '缺少的素材应被恢复');
    assertSameFiles(dir, v1.versionDir, '退回到无代码版');

    writeFileSync(join(dir, 'assets', 'extra.png'), 'extra');
    restoreVersion({ projectDir: dir, versionId: basename(v2.versionDir) });
    assert.equal(readFileSync(join(dir, 'code', 'a.js'), 'utf8'), 'export const a = 1;\n', '代码文件应被恢复');
    assert.equal(existsSync(join(dir, 'assets', 'extra.png')), false);
    assertSameFiles(dir, v2.versionDir, '退回到有代码版');
    assert.equal(validateProject(dir).ok, true);
  });
});

test('版本编号不合法、不存在或版本校验不通过时抛错，项目不变', () => {
  withProject((dir) => {
    saveVersion({ projectDir: dir });
    setName(dir, '当前未存的改动');
    const before = snapshot(dir);
    const count = listVersions(dir).length;

    for (const versionId of ['../demo', 'abc', '.objects', '20200101-0000', '20200101-000000/..', '', undefined]) {
      assert.throws(() => restoreVersion({ projectDir: dir, versionId }), /版本编号不合法/, `应拒绝：${versionId}`);
    }
    assert.throws(() => restoreVersion({ projectDir: dir, versionId: '19990101-000000' }), /找不到版本/);

    // 有目录但没有 project.json
    mkdirSync(join(dir, 'versions', '19990101-000001'));
    assert.throws(() => restoreVersion({ projectDir: dir, versionId: '19990101-000001' }), /没有 project\.json/);

    // 版本内容校验不通过（结构不对：没有页面）
    const bad = join(dir, 'versions', '19990101-000002');
    mkdirSync(bad);
    writeFileSync(join(bad, 'project.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf8')), pages: [] }));
    assert.throws(() => restoreVersion({ projectDir: dir, versionId: '19990101-000002' }), /校验未通过/);

    assert.deepEqual(snapshot(dir), before, '项目文件应不变');
    assert.equal(listVersions(dir).length, count + 2, '不应产生退回前备份');
  });
});

test('旧格式版本（完整复制、无 objects 字段）能被列出并退回', () => {
  withProject((dir) => {
    const old = join(dir, 'versions', '20200101-000000');
    mkdirSync(old, { recursive: true });
    for (const rel of ['project.json', 'pages', 'assets', 'fonts']) cpSync(join(dir, rel), join(old, rel), { recursive: true });
    const files = ['project.json', ...projectFiles(dir).filter((f) => f !== 'project.json')];
    writeFileSync(
      join(old, 'meta.json'),
      JSON.stringify({ savedAt: '2020-01-01T00:00:00.000Z', note: '旧版', by: 'agent', projectId: 'sample-deck', projectName: '旧', files }, null, 2) + '\n',
    );

    assert.deepEqual(listVersions(dir), [old]);
    setName(dir, '改过的名字');
    writeFileSync(join(dir, 'assets', 'extra.png'), 'extra');

    const out = restoreVersion({ projectDir: dir, versionId: '20200101-000000' });
    assert.equal(out.restoredFrom, old);
    assert.equal(validateProject(dir).ok, true);
    assertSameFiles(dir, old, '退回到旧格式版本');
    assert.equal(listVersions(dir).length, 2);
  });
});

test('listVersions 不包含 .objects', () => {
  withProject((dir) => {
    saveVersion({ projectDir: dir });
    saveVersion({ projectDir: dir });
    assert.ok(existsSync(join(dir, 'versions', '.objects')));
    const list = listVersions(dir);
    assert.equal(list.length, 2);
    for (const v of list) assert.ok(!basename(v).startsWith('.'), `不应列出 ${basename(v)}`);
    assert.equal(versionDiskUsage(dir).versions, 2);
  });
});

test('存版跳过以 . 开头的文件和符号链接', (t) => {
  withProject((dir) => {
    writeFileSync(join(dir, '.project-abc.tmp'), 'tmp');
    writeFileSync(join(dir, 'assets', '.DS_Store'), 'x');
    let linked = false;
    try { symlinkSync(join(dir, 'assets', 'logo.png'), join(dir, 'assets', 'link.png')); linked = true; }
    catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
      t.diagnostic('Windows 未授权创建符号链接；仅省略链接创建及链接专属断言，隐藏文件和存版断言继续执行');
    }
    const { versionDir, meta } = saveVersion({ projectDir: dir });
    assert.ok(!meta.files.some((f) => f.split('/').some((p) => p.startsWith('.'))), `不应包含隐藏文件：${meta.files}`);
    assert.equal(existsSync(join(versionDir, '.project-abc.tmp')), false);
    assert.equal(existsSync(join(versionDir, 'assets', '.DS_Store')), false);
    if (linked) {
      assert.ok(!meta.files.includes('assets/link.png'), '符号链接不应存进版本');
      assert.equal(existsSync(join(versionDir, 'assets', 'link.png')), false);
    }
    assert.deepEqual(meta.files, ['project.json', ...projectFiles(dir).filter((f) => f !== 'project.json')]);
    assert.deepEqual(Object.keys(meta.objects).sort(), [...meta.files].sort());
  });
});

test('网页项目（import/ 子目录、pages/）存版不报 EISDIR；退回时文件位置被目录占住（或反过来）也能退回', () => {
  withProject((dir) => {
    mkdirSync(join(dir, 'import', 'pages', 'site.html'), { recursive: true }); // 目录名像文件
    writeFileSync(join(dir, 'import', 'pages', 'site.html', 'index.html'), '<p>快照</p>');
    writeFileSync(join(dir, 'import', 'snap'), '原来是文件');
    mkdirSync(join(dir, 'import', 'dir'), { recursive: true });
    writeFileSync(join(dir, 'import', 'dir', 'a.txt'), '原来是目录里的文件');
    const v = saveVersion({ projectDir: dir, note: '网页项目' });
    assert.ok(v.meta.files.includes('import/pages/site.html/index.html'));
    assert.ok(v.meta.files.includes('pages/page_cover.html'));
    // 之后 import/snap 变成目录、import/dir 变成文件：rename 会撞上目录（EISDIR）或路径中间是文件（ENOTDIR）
    rmSync(join(dir, 'import', 'snap'));
    mkdirSync(join(dir, 'import', 'snap'));
    writeFileSync(join(dir, 'import', 'snap', 'x.html'), 'x');
    rmSync(join(dir, 'import', 'dir'), { recursive: true });
    writeFileSync(join(dir, 'import', 'dir'), '现在是文件');
    restoreVersion({ projectDir: dir, versionId: basename(v.versionDir) });
    assert.equal(readFileSync(join(dir, 'import', 'snap'), 'utf8'), '原来是文件');
    assert.equal(readFileSync(join(dir, 'import', 'dir', 'a.txt'), 'utf8'), '原来是目录里的文件');
    assert.equal(validateProject(dir).ok, true);
    // 被替换掉的内容在「退回前自动存档」里
    const backup = listVersions(dir).at(-1);
    assert.equal(readFileSync(join(backup, 'import', 'snap', 'x.html'), 'utf8'), 'x');
  });
});
