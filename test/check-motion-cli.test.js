import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const cli = new URL('../src/cli/check-motion.js', import.meta.url);
const run = args => spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: 'utf8', timeout: 10000 });
test('CLI rejects invalid flags and timeout values before starting browser', () => {
  const badFlag = run(['--unknown']);
  assert.equal(badFlag.status, 1);
  assert.match(badFlag.stderr, /未知参数/);
  const badTimeout = run(['--timeout-ms', '0']);
  assert.equal(badTimeout.status, 1);
  assert.match(badTimeout.stderr, /正整数/);
  const missingValue = run(['--total-timeout-ms']);
  assert.equal(missingValue.status, 1);
  assert.match(missingValue.stderr, /正整数/);
});
test('CLI reports missing and malformed project JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-check-args-'));
  try {
    const absent = run([join(dir, 'missing')]);
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /无法读取项目/);
    writeFileSync(join(dir, 'project.json'), '{broken');
    const malformed = run([join(dir, 'project.json')]);
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /无法读取项目/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI reports a stuck page and continues checking later pages', t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-check-stuck-'));
  try {
    cpSync(new URL('../examples/sample-deck/', import.meta.url), dir, { recursive: true, filter: name => !String(name).includes('/versions') });
    const project = JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));
    project.pages[0].motion = { steps: 0, source: 'while (true) {}' };
    project.pages[1].motion = { steps: 0, source: 'export default () => ({})' };
    project.pages[2].motion = { steps: 0, source: 'export default () => ({})' };
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project));
    const result = spawnSync(process.execPath, [fileURLToPath(cli), dir, '--timeout-ms', '100', '--total-timeout-ms', '1000'], { encoding: 'utf8', timeout: 30000 });
    if (/listen EPERM/.test(result.stderr)) t.skip('本地沙箱禁止监听 loopback');
    else {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /page_cover1.*总时限/);
      assert.match(result.stdout, /page_scene2.*原项目/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
