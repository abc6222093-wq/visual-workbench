import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { WEBKIT_TEST_FILES, webkitTestArgs, runWebkitTests } from '../scripts/test-webkit.js';
const repo = fileURLToPath(new URL('../', import.meta.url));

test('WebKit selection covers text editing, crop, auto height, stroke and tint, and every file exists', () => {
  for (const name of ['round9-text-edit', 'round10-crop', 'round10-text-height', 'round10-canvas', 'text-style', 'image-tint']) assert.ok(WEBKIT_TEST_FILES.includes(`test/${name}.test.js`), name);
  assert.equal(new Set(WEBKIT_TEST_FILES).size, WEBKIT_TEST_FILES.length);
  for (const file of WEBKIT_TEST_FILES) assert.ok(existsSync(join(repo, file)), `${file} must exist`);
  assert.deepEqual(webkitTestArgs(), ['--test', ...WEBKIT_TEST_FILES]);
});

test('WebKit runner forces VW_BROWSER=webkit, uses current Node and keeps the exit status', () => {
  let received;
  const status = runWebkitTests({ cwd: repo, env: { PATH: 'x' }, spawn: (...args) => { received = args; return { status: 3 }; } });
  assert.equal(status, 3);
  assert.equal(received[0], process.execPath);
  assert.deepEqual(received[1], webkitTestArgs());
  assert.equal(received[2].env.VW_BROWSER, 'webkit');
  assert.equal(received[2].env.PATH, 'x');
  assert.equal(runWebkitTests({ spawn: () => ({ status: null }) }), 1);
});
