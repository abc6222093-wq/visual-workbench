// 第 12 轮修正 · 桌面应用里右键不能复制粘贴（纯逻辑 + 读源码，不需要安装 electron）
// 原因：右键菜单是第 12 轮才加进 desktop/ 的，用户装的应用是第 11 轮制作的，新代码不在她的应用里；
// 本轮应用在 User-Agent 末尾带上 VisualWorkbenchDesktop/<版本>，工作台据此提示「应用是旧版本，要重新制作」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const menu = require('../desktop/lib/edit-menu.cjs');
const core = require('../desktop/lib/core.cjs');
const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../desktop/package-lock.json', import.meta.url), 'utf8'));

test('右键菜单模板：可编辑时有剪切 / 复制 / 粘贴 / 全选（role），按 editFlags 设可用；只选中文字给复制；其他不弹', () => {
  for (const flags of [{ canCut: true, canCopy: true, canPaste: true, canSelectAll: true }, { canCut: false, canCopy: false, canPaste: true, canSelectAll: false }]) {
    const items = menu.contextMenuTemplate({ isEditable: true, editFlags: flags });
    const byRole = Object.fromEntries(items.filter(i => i.role).map(i => [i.role, i.enabled]));
    assert.deepEqual(byRole, { cut: flags.canCut, copy: flags.canCopy, paste: flags.canPaste, selectAll: flags.canSelectAll });
  }
  assert.deepEqual(menu.contextMenuTemplate({ isEditable: false, selectionText: '选中的字', editFlags: { canCopy: true } }).map(i => [i.role, i.label]), [['copy', '复制']]);
  assert.equal(menu.contextMenuTemplate({ isEditable: false, selectionText: '  ' }), null);
  assert.equal(menu.contextMenuTemplate({ isEditable: false }), null);
});

test('右键菜单项绑定到窗口的 webContents：role 保留，role 执行不了时退回调用 contents.cut / copy / paste / selectAll', () => {
  const calls = [];
  const contents = { cut: () => calls.push('cut'), copy: () => calls.push('copy'), paste: () => calls.push('paste'), selectAll: () => calls.push('selectAll') };
  const items = menu.bindToContents(menu.contextMenuTemplate({ isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }), contents);
  assert.deepEqual(items.filter(i => i.role).map(i => i.role), ['cut', 'copy', 'paste', 'selectAll']);
  for (const item of items) if (item.role) item.click();
  assert.deepEqual(calls, ['cut', 'copy', 'paste', 'selectAll']);
  assert.equal(items.find(i => i.type === 'separator').click, undefined);
  // 应用菜单的「编辑」照旧只用 role（Mac 上 Cmd+C / V 靠它）
  const edit = menu.appMenuTemplate(true).find(m => m.label === '编辑');
  assert.ok(edit.submenu.filter(i => i.role).every(i => typeof i.click !== 'function'));
});

test('main.cjs：popup 传 frame（沙箱 iframe 里改字时的右键）、菜单项绑定 contents', () => {
  assert.match(main, /\.popup\(\{[^}]*frame: params\.frame/);
  assert.match(main, /bindToContents\(template, contents\)/);
  assert.match(main, /on\('context-menu'/);
});

test('User-Agent 末尾带 VisualWorkbenchDesktop/<desktop/package.json 的版本>，版本 0.2.0', () => {
  assert.equal(pkg.version, '0.2.0');
  assert.equal(lock.version, '0.2.0'); assert.equal(lock.packages[''].version, '0.2.0');
  assert.match(main, /setUserAgent\(/);
  assert.match(main, /require\('\.\/package\.json'\)\.version/);
  const ua = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Electron/44.5.1 Safari/537.36';
  assert.equal(core.desktopUserAgent(ua, '0.2.0'), `${ua} VisualWorkbenchDesktop/0.2.0`);
  assert.equal(core.desktopUserAgent(core.desktopUserAgent(ua, '0.2.0'), '0.2.0'), `${ua} VisualWorkbenchDesktop/0.2.0`, '不重复追加');
  assert.equal(core.desktopUserAgent(`${ua} VisualWorkbenchDesktop/0.1.9`, '0.2.0'), `${ua} VisualWorkbenchDesktop/0.2.0`, '旧标记换成新版本');
});
