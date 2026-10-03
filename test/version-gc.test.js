import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTO_BACKUP_KEEP,
  collectGarbage,
  deleteVersion,
  listVersions,
  restoreVersion,
  saveVersion,
  versionDiskUsage,
} from '../src/version.js';

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-deck');

function withProject(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vwgc-'));
  try {
    const dir = join(tmp, 'projects', 'demo');
    cpSync(SAMPLE, dir, { recursive: true });
    return fn(dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const idOf = (v) => basename(v.versionDir);
const objs = (dir) => readdirSync(join(dir, 'versions', '.objects')).filter((n) => !n.startsWith('.'));
const hashOf = (v, rel) => v.meta.objects[rel];
const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

test('删除 v1：只被它引用的对象被回收，共享对象保留，v2/v3 仍可退回', () =>
  withProject((dir) => {
    put(dir, 'assets/a-only.txt', 'AAAA-unique-to-v1');
    const v1 = saveVersion({ projectDir: dir, note: 'v1', by: 'user' });
    rmSync(join(dir, 'assets/a-only.txt'));
    put(dir, 'assets/b.txt', 'BBBB-in-v2-v3');
    const v2 = saveVersion({ projectDir: dir, note: 'v2', by: 'agent' });
    const v3 = saveVersion({ projectDir: dir, note: 'v3', by: 'user' });
    const hA = hashOf(v1, 'assets/a-only.txt');
    const hB = hashOf(v2, 'assets/b.txt');
    const before = versionDiskUsage(dir).uniqueBytes;

    const r = deleteVersion({ projectDir: dir, versionId: idOf(v1) });
    assert.equal(r.removed, idOf(v1));
    assert.deepEqual(r.removedObjects.includes(hA), true);
    assert.equal(r.removedObjects.includes(hB), false);
    assert.ok(r.freedBytes > 0);
    assert.equal(existsSync(join(dir, 'versions', '.objects', hA)), false);
    assert.equal(existsSync(join(dir, 'versions', '.objects', hB)), true);
    assert.ok(versionDiskUsage(dir).uniqueBytes < before);
    assert.equal(listVersions(dir).length, 2);

    for (const v of [v2, v3]) {
      const saved = readFileSync(join(v.versionDir, 'assets/b.txt'));
      restoreVersion({ projectDir: dir, versionId: idOf(v) });
      assert.deepEqual(readFileSync(join(dir, 'assets/b.txt')), saved);
      assert.equal(readFileSync(join(dir, 'assets/b.txt'), 'utf8'), 'BBBB-in-v2-v3');
    }
  }));

test('连续退回 12 次：只留最近 10 个自动存档，用户/agent 版本不动', () =>
  withProject((dir) => {
    const u = saveVersion({ projectDir: dir, note: 'u', by: 'user' });
    put(dir, 'assets/x.txt', 'X');
    const a = saveVersion({ projectDir: dir, note: 'a', by: 'agent' });
    const backups = [];
    for (let i = 0; i < 12; i++) {
      // 每次让当前状态不同，使自动存档各有独立对象
      put(dir, 'assets/tmp.txt', `state-${i}`);
      const r = restoreVersion({ projectDir: dir, versionId: idOf(i % 2 ? u : a) });
      backups.push({ id: idOf(r.backup), hash: r.backup.meta.objects['assets/tmp.txt'] });
    }
    assert.equal(AUTO_BACKUP_KEEP, 10);
    const metas = listVersions(dir).map((v) => ({ id: basename(v), m: JSON.parse(readFileSync(join(v, 'meta.json'), 'utf8')) }));
    const autos = metas.filter((x) => x.m.by === 'system');
    assert.equal(autos.length, 10);
    // 版本编号被删后会被复用，所以按内容（每次状态不同的 tmp.txt）判断留下的是最近 10 个
    assert.deepEqual(autos.map((x) => x.m.objects['assets/tmp.txt']).sort(), backups.slice(2).map((b) => b.hash).sort());
    assert.ok(metas.some((x) => x.id === idOf(u)) && metas.some((x) => x.id === idOf(a)));
    // 被裁掉的两个存档独有的对象已消失
    for (const b of backups.slice(0, 2)) assert.equal(existsSync(join(dir, 'versions', '.objects', b.hash)), false);
    // 剩下的每个版本都能退回
    // 每次退回又会产生并裁剪自动存档，所以先确认该版本还在
    for (const { id } of metas) {
      if (!existsSync(join(dir, 'versions', id))) continue;
      restoreVersion({ projectDir: dir, versionId: id });
    }
  }));

test('deleteVersion 拒绝不存在与恶意编号', () =>
  withProject((dir) => {
    saveVersion({ projectDir: dir, note: 'v', by: 'user' });
    for (const bad of ['20000101-000000', '../x', '.objects', '', '../../etc', 'a/b', undefined]) {
      assert.throws(() => deleteVersion({ projectDir: dir, versionId: bad }), /版本/);
    }
    assert.ok(existsSync(join(dir, 'versions', '.objects')));
  }));

test('collectGarbage：没有 versions 或 .objects 时不报错；清理过期临时文件', () =>
  withProject((dir) => {
    assert.deepEqual(collectGarbage({ projectDir: dir }), { freedBytes: 0, removedObjects: [] });
    mkdirSync(join(dir, 'versions'));
    assert.deepEqual(collectGarbage({ projectDir: dir }).removedObjects, []);
    saveVersion({ projectDir: dir, note: 'v', by: 'user' });
    const old = join(dir, 'versions', '.objects', '.object-aaaa.tmp');
    const fresh = join(dir, 'versions', '.objects', '.object-bbbb.tmp');
    writeFileSync(old, 'x');
    writeFileSync(fresh, 'y');
    const t = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(old, t, t);
    collectGarbage({ projectDir: dir });
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
  }));
