'use strict';
/*
 * 桌面应用的编辑菜单与右键菜单（纯逻辑，可在没有 electron 的环境里单测）。
 * - 应用菜单里的「编辑」用 Electron 的 role：Mac 上 Cmd+X/C/V/A/Z 在所有输入框（含页面 iframe 里的改字）都能用。
 * - 右键：只在可编辑区域（输入框、改字中的元素）弹原生菜单：剪切、复制、粘贴、全选，按 editFlags 设可用；
 *   非编辑区有选中文字时只给「复制」；其他地方不弹（工作台自己的玻璃菜单处理）。
 */

function editSubmenu() {
  return [
    { role: 'undo', label: '撤销' },
    { role: 'redo', label: '重做' },
    { type: 'separator' },
    { role: 'cut', label: '剪切' },
    { role: 'copy', label: '复制' },
    { role: 'paste', label: '粘贴' },
    { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
    { role: 'delete', label: '删除' },
    { role: 'selectAll', label: '全选' },
  ];
}

/** 应用菜单模板。isMac 时第一项是应用菜单。 */
function appMenuTemplate(isMac) {
  return [
    ...(isMac ? [{ label: '视觉工作台', submenu: [{ role: 'about', label: '关于视觉工作台' }, { type: 'separator' }, { role: 'hide', label: '隐藏' }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' }, { type: 'separator' }, { role: 'quit', label: '关闭工作台' }] }] : []),
    { label: '编辑', role: 'editMenu', submenu: editSubmenu() },
    { label: '显示', submenu: [{ role: 'reload', label: '重新载入' }, { role: 'toggleDevTools', label: '开发者工具', accelerator: isMac ? 'Alt+Command+I' : 'F12' }, { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭工作台' }] },
  ];
}

/**
 * 右键菜单模板（context-menu 事件的 params → 菜单项数组；返回 null 表示不弹）。
 * @param {{isEditable?: boolean, selectionText?: string, editFlags?: object}} params
 */
function contextMenuTemplate(params = {}) {
  const flags = params.editFlags || {};
  if (params.isEditable) {
    return [
      { role: 'cut', label: '剪切', enabled: !!flags.canCut },
      { role: 'copy', label: '复制', enabled: !!flags.canCopy },
      { role: 'paste', label: '粘贴', enabled: !!flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: '全选', enabled: flags.canSelectAll !== false },
    ];
  }
  if (typeof params.selectionText === 'string' && params.selectionText.trim()) {
    return [{ role: 'copy', label: '复制', enabled: flags.canCopy !== false }];
  }
  return null;
}

const CONTENTS_METHOD = { cut: 'cut', copy: 'copy', paste: 'paste', selectAll: 'selectAll' };
/**
 * 把右键菜单项绑定到窗口的 webContents：role 保留（Electron 按 role 执行：Mac 走系统的 copy: 等动作，
 * 其他系统调用聚焦的 webContents 的 copy() 等，作用于聚焦的 frame，也就是页面 iframe 里正在改字的那一处）；
 * 再加一个 click 兜底——只有 role 执行不了（例如拿不到聚焦的 webContents）时 Electron 才会调用它，调用 contents 对应的方法。
 */
function bindToContents(template, contents) {
  return (template || []).map((item) => {
    const method = item && CONTENTS_METHOD[item.role];
    if (!method || !contents || typeof contents[method] !== 'function') return item;
    return { ...item, click: () => contents[method]() };
  });
}

module.exports = { editSubmenu, appMenuTemplate, contextMenuTemplate, bindToContents };
