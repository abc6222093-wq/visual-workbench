// 第 12 轮 · 桌面应用的编辑菜单与右键菜单（纯逻辑，不需要安装 electron）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const menu = require('../desktop/lib/edit-menu.cjs');

test('应用菜单：有「编辑」（role editMenu），含撤销、重做、剪切、复制、粘贴、全选；Mac 上第一项是应用菜单', () => {
  for (const isMac of [true, false]) {
    const template = menu.appMenuTemplate(isMac);
    const edit = template.find((m) => m.label === '编辑');
    assert.equal(edit.role, 'editMenu');
    const roles = edit.submenu.map((i) => i.role).filter(Boolean);
    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) assert.ok(roles.includes(role), role);
    assert.equal(template[0].label === '视觉工作台', isMac);
  }
});

test('右键：可编辑区域弹剪切 / 复制 / 粘贴 / 全选，按 editFlags 设可用；非编辑区不弹，有选中文字只给复制', () => {
  const items = menu.contextMenuTemplate({ isEditable: true, editFlags: { canCut: false, canCopy: true, canPaste: true, canSelectAll: true } });
  const byRole = Object.fromEntries(items.filter((i) => i.role).map((i) => [i.role, i.enabled]));
  assert.deepEqual(byRole, { cut: false, copy: true, paste: true, selectAll: true });
  assert.deepEqual(items.map((i) => i.label || i.type), ['剪切', '复制', '粘贴', 'separator', '全选']);
  assert.equal(menu.contextMenuTemplate({ isEditable: false, selectionText: '' }), null);
  assert.equal(menu.contextMenuTemplate({}), null);
  assert.deepEqual(menu.contextMenuTemplate({ isEditable: false, selectionText: '一段字', editFlags: { canCopy: true } }).map((i) => i.role), ['copy']);
});

test('主进程接上了编辑菜单和 context-menu', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /require\('\.\/lib\/edit-menu\.cjs'\)/);
  assert.match(main, /appMenuTemplate\(/);
  assert.match(main, /on\('context-menu'/);
  assert.match(main, /contextMenuTemplate\(params\)/);
});
