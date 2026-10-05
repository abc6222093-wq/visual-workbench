// Safari 内核验证（第 10 轮 7d，第 12 轮更新清单）：用 Playwright 自带的 WebKit 跑编辑画布（隔离 iframe 里的修改）、窄窗口布局这几组浏览器测试。
// 用法：node scripts/test-webkit.js（先 npx playwright install webkit）；--list 只列清单。
// 不进 npm test：Actions 只装 Chromium，这组在本机按需跑。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { existsSync } from 'node:fs';

export const WEBKIT_TEST_FILES = Object.freeze([
  'test/round12-editor-canvas.test.js', // 编辑画布：隔离 iframe、选中工具条改字号、修改单撤销、贴图、文件变化重载
  'test/round12-editor-layout.test.js', // 窄窗口工具条一行、专注模式、折叠栏
  'test/image-tint.test.js',            // SVG 上传安全检查（贴图、素材库走同一条上传）
]);
export function webkitTestArgs() { return ['--test', ...WEBKIT_TEST_FILES]; }
export function webkitMissingMessage() {
  const path = (() => { try { return webkit.executablePath(); } catch { return null; } })();
  if (path && existsSync(path)) return null;
  return `没有找到 Playwright 的 WebKit（${path || '未知路径'}）。请在工作台文件夹运行：npx playwright install webkit`;
}
export function runWebkitTests({ spawn = spawnSync, cwd = fileURLToPath(new URL('../', import.meta.url)), env = process.env } = {}) {
  const result = spawn(process.execPath, webkitTestArgs(), { cwd, stdio: 'inherit', env: { ...env, VW_BROWSER: 'webkit' } });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--list')) console.log(WEBKIT_TEST_FILES.join('\n'));
  else {
    const missing = webkitMissingMessage();
    if (missing) { console.error(missing); process.exitCode = 1; }
    else process.exitCode = runWebkitTests();
  }
}
