import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listVersions, saveVersion } from '../src/version.js';

const SAMPLE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-deck');

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

test('saveVersion 后 versions/ 多出一份，且含 meta.json', () => {
  withProject((dir) => {
    assert.equal(listVersions(dir).length, 0);
    const { versionDir } = saveVersion({ projectDir: dir, note: '第一版' });
    assert.equal(listVersions(dir).length, 1);
    assert.ok(existsSync(join(versionDir, 'meta.json')));
    assert.match(basename(versionDir), /^\d{8}-\d{6}(-\d+)?$/);
  });
});

test('版本里的 project.json、assets、fonts 与存版时逐文件内容一致，且不含 versions/', () => {
  withProject((dir) => {
    const { versionDir } = saveVersion({ projectDir: dir });
    const rels = ['project.json'];
    for (const sub of ['assets', 'fonts']) for (const f of readdirSync(join(dir, sub))) rels.push(`${sub}/${f}`);
    assert.ok(rels.length > 1);
    for (const rel of rels) {
      assert.ok(readFileSync(join(dir, rel)).equals(readFileSync(join(versionDir, rel))), `${rel} 内容应一致`);
    }
    assert.equal(existsSync(join(versionDir, 'versions')), false);
  });
});

test('meta.json 记录备注、存档人、项目编号和文件列表', () => {
  withProject((dir) => {
    const { versionDir, meta } = saveVersion({ projectDir: dir, note: '试存', by: 'claude' });
    const onDisk = JSON.parse(readFileSync(join(versionDir, 'meta.json'), 'utf8'));
    assert.deepEqual(onDisk, meta);
    assert.equal(onDisk.note, '试存');
    assert.equal(onDisk.by, 'claude');
    assert.equal(onDisk.projectId, 'sample-deck');
    assert.ok(onDisk.files.includes('project.json'));
    assert.ok(onDisk.files.includes('assets/logo.png'));
    assert.ok(onDisk.files.includes('fonts/Inter-OFL.txt'));
    assert.ok(!Number.isNaN(Date.parse(onDisk.savedAt)));
  });
});

test('连存两次，目录名不同', () => {
  withProject((dir) => {
    const a = saveVersion({ projectDir: dir, note: 'a' });
    const b = saveVersion({ projectDir: dir, note: 'b' });
    assert.notEqual(a.versionDir, b.versionDir);
    assert.equal(listVersions(dir).length, 2);
    // 第二份里不应嵌套第一份
    assert.equal(existsSync(join(b.versionDir, 'versions')), false);
  });
});
