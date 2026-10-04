import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WINDOWS_TEST_FILES, windowsTestArgs, runWindowsTests } from '../scripts/test-windows.js';
const repo = fileURLToPath(new URL('../', import.meta.url));
const expected = ['browser','config','data-dir','export-images','launcher','machine-config','platform','portable-export-name','project-management','shutdown','session','sync-conflicts','two-devices-server','version-gc','version-store','version','watch','windows-test-selection'].map(name => `test/${name}.test.js`);

test('Windows selection is explicit, unique, real and includes browser/PNG/PDF integration', () => {
  assert.deepEqual(WINDOWS_TEST_FILES, expected);
  assert.equal(new Set(WINDOWS_TEST_FILES).size, WINDOWS_TEST_FILES.length);
  for (const file of WINDOWS_TEST_FILES) assert.ok(existsSync(join(repo, file)), `${file} must exist`);
  assert.deepEqual(windowsTestArgs(), ['--test', ...expected]);
  const exporter = readFileSync(join(repo, 'test/export-images.test.js'), 'utf8');
  assert.match(exporter, /await exportImages\(/);
  assert.match(exporter, /await exportPdf\(/);
});

test('Windows command uses current Node, exact file arguments and preserves failure status', () => {
  let received;
  const status = runWindowsTests({ cwd: repo, spawn: (...args) => { received = args; return { status: 7 }; } });
  assert.equal(status, 7);
  assert.equal(received[0], process.execPath);
  assert.deepEqual(received[1], windowsTestArgs());
  assert.equal(received[2].cwd, repo);
  assert.equal(received[2].stdio, 'inherit');
  assert.equal(runWindowsTests({ spawn: () => ({ status: null }) }), 1);
  assert.throws(() => runWindowsTests({ spawn: () => ({ error: new Error('spawn failed') }) }), /spawn failed/);
});

test('CI gives every test to both macOS and Ubuntu and limits Windows to the explicit suite', () => {
  const workflow = readFileSync(join(repo, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /os: \[ubuntu-latest, macos-latest, windows-latest\]/);
  // 第 9 轮仓库公开后恢复：推送和 PR 都自动运行，保留手动触发。
  assert.match(workflow, /^on:\r?\n(?:[ \t]+\S.*\r?\n)*?[ \t]+push:/m);
  assert.match(workflow, /^on:\r?\n(?:[ \t]+\S.*\r?\n)*?[ \t]+pull_request:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: runner\.os != 'Windows'\s+run: npm test/);
  assert.match(workflow, /if: runner\.os == 'Windows'\s+run: node scripts\/test-windows\.js/);
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.js"');
  const all = [];
  function discover(dir, relative = 'test') { for (const entry of readdirSync(dir, {withFileTypes:true})) { const path = `${relative}/${entry.name}`; if (entry.isDirectory()) discover(join(dir,entry.name),path); else if (entry.name.endsWith('.test.js')) all.push(path); } }
  discover(join(repo,'test'));
  assert.ok(all.length >= WINDOWS_TEST_FILES.length);
  for (const file of WINDOWS_TEST_FILES) assert.ok(all.includes(file));
  // npm's recursive glob covers every discovered test on both full-suite OSes;
  // no named allowlist can silently leave a newly added test without a runner.
  for (const file of all) assert.match(file, /^test\/.+\.test\.js$/);
});
