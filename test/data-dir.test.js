import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT, initDataDir, initProjectDir, listProjects, projectDir, resolveProject } from '../src/data-dir.js';

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('initDataDir 建出 projects、library/assets、library/fonts', () => {
  withTmp((tmp) => {
    const dataDir = join(tmp, 'data');
    const r = initDataDir(dataDir);
    for (const rel of Object.values(LAYOUT)) {
      assert.ok(statSync(join(dataDir, rel)).isDirectory(), `应存在 ${rel}`);
      assert.ok(r.created.includes(rel));
    }
    assert.equal(r.existed.length, 0);
  });
});

test('initDataDir 第二次调用全部是已存在', () => {
  withTmp((tmp) => {
    const dataDir = join(tmp, 'data');
    initDataDir(dataDir);
    const r = initDataDir(dataDir);
    assert.equal(r.created.length, 0);
    for (const rel of Object.values(LAYOUT)) assert.ok(r.existed.includes(rel));
  });
});

test('initProjectDir 建出 assets、fonts、versions', () => {
  withTmp((tmp) => {
    const dir = join(tmp, 'p');
    initProjectDir(dir);
    for (const s of ['assets', 'fonts', 'versions']) assert.ok(existsSync(join(dir, s)));
  });
});

test('resolveProject 支持项目编号和目录路径，没有 project.json 时抛错', () => {
  withTmp((tmp) => {
    const dataDir = join(tmp, 'data');
    initDataDir(dataDir);
    const dir = projectDir(dataDir, 'demo');
    mkdirSync(dir, { recursive: true });
    assert.throws(() => resolveProject('demo', dataDir), /找不到项目/);
    writeFileSync(join(dir, 'project.json'), '{}');
    assert.equal(resolveProject('demo', dataDir), dir);
    assert.equal(resolveProject(dir, dataDir), dir);
    assert.deepEqual(listProjects(dataDir), ['demo']);
  });
});
