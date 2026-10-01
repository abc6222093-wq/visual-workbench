import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPages, parsePageList } from '../src/copy-pages.js';
import { validateProject } from '../src/validate.js';

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-deck');

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

test('复制 [1,3] 到新项目：新项目校验通过', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'demo-copy');
    const r = copyPages({ srcProjectDir: SAMPLE, pages: [1, 3], destProjectDir: dest, newId: 'demo-copy' });
    const v = validateProject(dest);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(r.project.id, 'demo-copy');
    assert.equal(r.project.name, '示例课件 · 格式演示（副本）');
    assert.deepEqual(r.project.pages.map((p) => p.id), ['page_cover1', 'page_clip3']);
    assert.equal(r.project.createdAt, r.project.updatedAt);
  });
});

test('assets 只含第 1、3 页用到的素材，且文件都存在，来源改为 copied-from-project', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'demo-copy');
    const r = copyPages({ srcProjectDir: SAMPLE, pages: [1, 3], destProjectDir: dest, newId: 'demo-copy' });
    assert.deepEqual(r.project.assets.map((a) => a.id).sort(), ['asset_city01', 'asset_logo01']);
    assert.deepEqual(r.copiedAssets.sort(), ['asset_city01', 'asset_logo01']);
    for (const a of r.project.assets) {
      assert.ok(existsSync(join(dest, a.file)), `${a.file} 应存在`);
      assert.deepEqual(a.source, { type: 'copied-from-project', from: `sample-deck/${a.id}` });
      assert.equal(a.pendingLayout, false);
    }
    assert.equal(existsSync(join(dest, 'assets', 'new-photo.png')), false);
  });
});

test('fonts 含 font_inter 及其许可证文件 Inter-OFL.txt', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'demo-copy');
    const r = copyPages({ srcProjectDir: SAMPLE, pages: [1, 3], destProjectDir: dest, newId: 'demo-copy' });
    assert.deepEqual(r.project.fonts.map((f) => f.id), ['font_inter']);
    assert.deepEqual(r.copiedFonts, ['font_inter']);
    assert.ok(existsSync(join(dest, 'fonts', 'Inter-Variable.ttf')));
    assert.ok(existsSync(join(dest, 'fonts', 'Inter-OFL.txt')));
  });
});

test('复制前后源项目所有文件内容完全一致', () => {
  withTmp((tmp) => {
    const before = snapshot(SAMPLE);
    const dest = join(tmp, 'projects', 'demo-copy');
    copyPages({ srcProjectDir: SAMPLE, pages: [1, 3], destProjectDir: dest, newId: 'demo-copy' });
    const after = snapshot(SAMPLE);
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
    for (const [rel, buf] of before) assert.ok(buf.equals(after.get(rel)), `${rel} 不应被修改`);
    assert.ok(before.has('project.json'));
    assert.ok(before.has('assets/photo-city.png'));
  });
});

test('目标已存在时抛错，且不动已有内容', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'demo-copy');
    mkdirSync(dest, { recursive: true });
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [1], destProjectDir: dest, newId: 'demo-copy' }), /已存在/);
    assert.ok(existsSync(dest));
    assert.equal(readdirSync(dest).length, 0);
  });
});

test('页码越界或重复抛错，且不会留下目标目录', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'demo-copy');
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [4], destProjectDir: dest, newId: 'demo-copy' }), /越界/);
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [0], destProjectDir: dest, newId: 'demo-copy' }), /越界/);
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [1, 1], destProjectDir: dest, newId: 'demo-copy' }), /重复/);
    assert.equal(existsSync(dest), false);
  });
});

test('新项目编号不合法时抛错', () => {
  withTmp((tmp) => {
    assert.throws(() => copyPages({ srcProjectDir: SAMPLE, pages: [1], destProjectDir: join(tmp, 'x'), newId: 'Bad_ID' }), /编号不合法/);
  });
});

test('自定义名称生效；只选第 2 页时只带该页用到的素材', () => {
  withTmp((tmp) => {
    const dest = join(tmp, 'projects', 'only2');
    const r = copyPages({ srcProjectDir: SAMPLE, pages: [2], destProjectDir: dest, newId: 'only2', newName: '第二页' });
    assert.equal(r.project.name, '第二页');
    assert.deepEqual(r.project.assets.map((a) => a.id), ['asset_city01']);
    assert.equal(validateProject(dest).ok, true);
  });
});

test('parsePageList 解析 1,3 与 1-2,3', () => {
  assert.deepEqual(parsePageList('1,3'), [1, 3]);
  assert.deepEqual(parsePageList('1-2,3'), [1, 2, 3]);
  assert.deepEqual(parsePageList(' 2 '), [2]);
  assert.throws(() => parsePageList('a'), /无法识别/);
  assert.throws(() => parsePageList('3-1'), /写反/);
  assert.throws(() => parsePageList(''), /不能为空/);
});
