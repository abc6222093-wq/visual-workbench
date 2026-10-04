// Safari 内核验证（第 10 轮 7d）：用 Playwright 自带的 WebKit 跑就地编辑文字、图片裁切、文字框自动长高、描边与图片颜色这几组浏览器测试。
// 用法：node scripts/test-webkit.js（先 npx playwright install webkit）；--list 只列清单。
// 不进 npm test：Actions 只装 Chromium，这组在本机按需跑。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { existsSync } from 'node:fs';

export const WEBKIT_TEST_FILES = Object.freeze([
  'test/round9-text-edit.test.js',   // 就地编辑文字（光标、拖选、换行、输入法）
  'test/round10-crop.test.js',       // 图片裁切：渲染、裁切工具、替换图片弹窗
  'test/round10-text-height.test.js',// 文字框自动长高的测量
  'test/round10-canvas.test.js',     // 编辑器里：自动长高校正、裁切、替换、旋转把手
  'test/text-style.test.js',         // 文字描边 / 阴影：编辑、放映、导出一致
  'test/image-tint.test.js',         // 图片重新着色
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
