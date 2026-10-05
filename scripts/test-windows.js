// Deliberately explicit: Windows focuses on system integration, while both
// macOS and Ubuntu run npm test (the complete test/**/*.test.js suite).
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WINDOWS_TEST_FILES = Object.freeze([
  'test/browser.test.js',
  'test/config.test.js',
  'test/data-dir.test.js',
  'test/export-images.test.js', // Real browser rendering, PNG pixels and PDF output.
  'test/launcher.test.js',
  'test/machine-config.test.js',
  'test/platform.test.js',
  'test/portable-export-name.test.js',
  'test/project-management.test.js', // Cross-platform move/copy/restore and retention.
  'test/round11-changes-handoff.test.js', // Handoff bundle: change list and real PNG comparison images.
  'test/round11-desktop-core.test.js', // Desktop shell logic without electron.
  'test/round11-desktop-icons.test.js',
  'test/round11-handoff-route.test.js',
  'test/shutdown.test.js', // Release the session and close pending HTTP writes.
  'test/session.test.js',
  'test/sync-conflicts.test.js',
  'test/two-devices-server.test.js',
  'test/version-gc.test.js',
  'test/version-store.test.js',
  'test/version.test.js',
  'test/watch.test.js',
  'test/windows-test-selection.test.js',
]);

export function windowsTestArgs() { return ['--test', ...WINDOWS_TEST_FILES]; }
export function runWindowsTests({ spawn = spawnSync, cwd = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  const result = spawn(process.execPath, windowsTestArgs(), { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--list')) console.log(WINDOWS_TEST_FILES.join('\n'));
  else process.exitCode = runWindowsTests();
}
