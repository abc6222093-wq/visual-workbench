import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserCandidates, launchBrowser, NO_BROWSER_MESSAGE } from '../src/browser.js';

const repo = fileURLToPath(new URL('..', import.meta.url));

test('浏览器顺序：Mac 上装的 Chrome 优先，其次 Edge，之后才是 Playwright 自带的', () => {
  const present = new Set(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Users/x/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
  const list = browserCandidates({ platform: 'darwin', home: '/Users/x', exists: (p) => present.has(p), only: '' });
  assert.deepEqual(list.slice(0, 2).map((c) => c.name), ['Google Chrome', 'Microsoft Edge']);
  assert.equal(list[0].executablePath, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
});

test('一个浏览器都没有：给中文说明和解决办法', async () => {
  process.env.VW_BROWSER = 'none';
  try {
    await assert.rejects(launchBrowser(), (error) => error.code === 'NO_BROWSER' && error.message === NO_BROWSER_MESSAGE);
  } finally { delete process.env.VW_BROWSER; }
  assert.match(NO_BROWSER_MESSAGE, /Google Chrome/);
  assert.match(NO_BROWSER_MESSAGE, /npx playwright install chromium/);
});

test('check-motion 找不到浏览器时只输出中文提示，不出现英文报错', () => {
  const r = spawnSync(process.execPath, ['src/cli/check-motion.js', 'examples/sample-deck'], { cwd: repo, encoding: 'utf8', env: { ...process.env, VW_BROWSER: 'none' } });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), NO_BROWSER_MESSAGE);
  assert.doesNotMatch(r.stdout + r.stderr, /Executable|playwright install\b(?! chromium)|Error/);
});

test('Windows 系统和用户 Chrome、Edge 按顺序查找，路径环境可注入', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\日本 用户\\AppData\\Local' };
  const paths = new Set(['C:\\Users\\日本 用户\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']);
  const candidates = browserCandidates({ platform: 'win32', env, exists: (p) => paths.has(p), only: '' });
  assert.deepEqual(candidates.map((c) => c.name), ['Google Chrome', 'Microsoft Edge']);
  assert.equal(candidates[0].executablePath, [...paths][0]);
});
