import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { detectSyncConflicts } from '../src/sync-conflicts.js';

test('lists likely sync copies recursively, skips versions and symlinks, preserves files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-conflicts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['project.json', 'project (1).json', 'assets/photo.png', 'assets/photo(2).png', 'assets/lesson (1).png', 'assets/photo (conflicted copy).png', '冲突副本.json', '競合コピー.json', 'versions/project (1).json']) {
    mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), '{}');
  }
  try { symlinkSync(join(dir, 'assets'), join(dir, 'conflict-link')); }
  catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.diagnostic('Windows 未授权创建符号链接；仅省略链接创建，冲突检测与文件保留断言继续执行');
  }
  const expected = ['assets/photo (conflicted copy).png', 'assets/photo(2).png', 'project (1).json', '冲突副本.json', '競合コピー.json'].sort();
  assert.deepEqual(detectSyncConflicts(dir), expected);
  assert.deepEqual(detectSyncConflicts(dir), expected);
});
