'use strict';
/*
 * 视觉工作台 · 桌面应用壳（Electron 主进程）。
 * 只做接线：找仓库 → 用系统 Node 启动 <仓库>/src/server.js（或连上已在跑的本仓库服务）→
 * 窗口打开 http://127.0.0.1:4173 → 关窗口时先保存、再 POST /api/shutdown、等服务退出。
 * 判断逻辑都在 lib/core.cjs（可单测）。工作台代码不打进应用包，git pull 后不用重新制作应用。
 *
 * 自测：electron . --smoke  —— 服务就绪、页面加载完成后走正常关闭流程，成功退出码 0，超时退出码 1。
 */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('./lib/core.cjs');
const editMenu = require('./lib/edit-menu.cjs');

const SMOKE = process.argv.includes('--smoke');
const SMOKE_TIMEOUT_MS = 90_000;
const READY_TIMEOUT_MS = 30_000;

app.setName('视觉工作台');

let logFile = null;
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try { if (logFile) fs.appendFileSync(logFile, line + '\n'); } catch {}
}

if (!app.requestSingleInstanceLock()) {
  // 已经开着：second-instance 会在原来那个进程里把窗口叫到前面，这里直接退出
  console.log('视觉工作台已经开着，已把窗口叫到前面。');
  app.exit(SMOKE ? 2 : 0);
  return;
}

let win = null;
let child = null;
let childExited = false;
let ownChild = false;
let closing = false;
let smokeDataDir = null;
let stderrTail = '';

function bringToFront() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
app.on('second-instance', bringToFront);
app.on('activate', bringToFront); // Mac：点程序坞里的图标

function showError(message, detail) {
  log('错误：', message.replace(/\n/g, ' '));
  if (SMOKE) return;
  dialog.showMessageBoxSync({ type: 'error', title: '视觉工作台', message, detail, buttons: ['好'] });
}

function setMenu() {
  // 编辑菜单用 role：Mac 上 Cmd+X/C/V/A/Z 在所有输入框可用（没有这个菜单，快捷键在 Mac 上不生效）
  Menu.setApplicationMenu(Menu.buildFromTemplate(editMenu.appMenuTemplate(process.platform === 'darwin')));
}

/** 右键：可编辑区域弹原生的剪切 / 复制 / 粘贴 / 全选；非编辑区不弹（页面 iframe 里的改字也走这里）。 */
function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const template = editMenu.contextMenuTemplate(params);
    if (!template) return;
    Menu.buildFromTemplate(template).popup({ window: win || undefined, frame: params.frame || undefined });
  });
}

/** 找仓库；找不到就让用户选文件夹，写进 ~/.visual-workbench/desktop.json。 */
async function findRepo() {
  for (;;) {
    const found = core.resolveRepoDir({ appDir: app.getAppPath() });
    if (found.repoDir) { log('仓库：', found.repoDir, '（来自', found.source + '）'); return found.repoDir; }
    if (SMOKE) { showError(core.missingRepoChinese(found.tried)); return null; }
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: '视觉工作台', message: '找不到视觉工作台的代码文件夹', detail: core.missingRepoChinese(found.tried), buttons: ['选择文件夹', '退出'], defaultId: 0, cancelId: 1 });
    if (choice !== 0) return null;
    const picked = dialog.showOpenDialogSync({ title: '选择视觉工作台的代码文件夹', properties: ['openDirectory'] });
    if (!picked || !picked[0]) return null;
    if (!core.isRepoDir(picked[0])) { dialog.showMessageBoxSync({ type: 'error', title: '视觉工作台', message: '这个文件夹里没有 src/server.js，不是视觉工作台的代码文件夹。', buttons: ['重新选择'] }); continue; }
    const file = core.userDesktopConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ repoDir: picked[0] }, null, 2) + '\n');
  }
}

function childEnv() {
  const env = { ...process.env, VW_OPEN_BROWSER: '0' };
  // Windows 的环境变量名不分大小写，原来叫 Path 就改 Path，避免出现两个
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  env[key] = core.augmentedPath(process.platform, { PATH: env[key], ...pick(env, ['ProgramFiles', 'LOCALAPPDATA', 'APPDATA', 'NVM_SYMLINK']) });
  delete env.ELECTRON_RUN_AS_NODE;
  if (SMOKE) {
    // 自测用临时数据目录，不碰用户真实数据
    smokeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-desktop-smoke-'));
    for (const rel of ['projects', 'library/assets', 'library/fonts', 'exports']) fs.mkdirSync(path.join(smokeDataDir, rel), { recursive: true });
    env.VW_DATA_DIR = smokeDataDir;
  }
  return env;
}
function pick(obj, keys) { const out = {}; for (const k of keys) if (obj[k]) out[k] = obj[k]; return out; }

/** 准备好服务：连上已有的或自己启动。成功返回 true。 */
async function ensureServer(repoDir) {
  const env = childEnv();
  let fingerprint = null;
  try { fingerprint = core.codeFingerprint(repoDir); } catch {}
  const health = await core.readHealth(fetch);
  const state = core.classifyPort({ health, portBusy: health ? true : await core.isPortBusy(), repoDir, fingerprint });
  log('4173 端口状态：', state);
  if (state === 'foreign') { showError(core.portBusyChinese); return false; }
  if (state === 'ours') { ownChild = false; log('已连上正在运行的工作台（pid', health.pid + '），关闭窗口时不结束它的进程'); return true; }
  if (state === 'stale') {
    // 本仓库的旧服务（代码已更新）：正常关闭它，再启动新的
    log('工作台代码已更新，正常关闭旧服务');
    await postShutdown();
    if (!(await core.waitFor(async () => !(await core.isPortBusy()), { timeoutMs: 5000 }))) { showError(core.portBusyChinese); return false; }
  }
  const node = core.checkNode({ env, execImpl: execFileSync });
  if (!node.ok) {
    log('Node 检查失败，版本：', node.version);
    if (!SMOKE && dialog.showMessageBoxSync({ type: 'error', title: '视觉工作台', message: core.missingNodeChinese, buttons: ['打开下载页', '好'], defaultId: 0 }) === 0) await shell.openExternal('https://nodejs.org/zh-cn/download');
    if (SMOKE) showError(core.missingNodeChinese);
    return false;
  }
  log('使用系统 Node', node.version, '启动服务');
  child = spawn(core.nodeCommand(), core.serverArgs(repoDir), { cwd: repoDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  ownChild = true;
  child.stdout.on('data', (d) => log('[服务]', String(d).trimEnd()));
  child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000); log('[服务错误]', String(d).trimEnd()); });
  child.once('error', (error) => { childExited = true; log('服务启动失败：', error.message); });
  child.once('exit', (code) => {
    childExited = true;
    log('服务进程已退出，退出码', code);
    if (!closing && win && !win.isDestroyed()) {
      // 页面里点了「关闭工作台」，或服务意外退出：应用跟着关
      if (code !== 0) showError('工作台服务意外退出了。', stderrTail);
      setTimeout(() => shutdownAndQuit(code === 0 ? 0 : 1), 1500);
    }
  });
  const ready = await core.waitFor(async () => childExited || core.isOurServer(await core.readHealth(fetch), repoDir), { timeoutMs: READY_TIMEOUT_MS, intervalMs: 200 });
  if (!ready || childExited) { showError(childExited ? '工作台服务没能启动。' : '工作台服务启动超时。', stderrTail); return false; }
  return true;
}

async function postShutdown() {
  try {
    const r = await fetch(`${core.ORIGIN}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
    log('POST /api/shutdown →', r.status);
    return r.ok;
  } catch (error) { log('POST /api/shutdown 失败：', error.message); return false; }
}

/** 正常关闭：先保存，再 POST /api/shutdown，等自己启动的服务退出（最多 5 秒），再退出应用。 */
async function shutdownAndQuit(code = 0) {
  if (closing) return;
  closing = true;
  const result = await core.closeWorkbench({
    flushPage: async () => { if (win && !win.isDestroyed()) log('页面保存：', await win.webContents.executeJavaScript(core.FLUSH_SCRIPT)); },
    postShutdown,
    ownChild,
    waitExit: (ms) => core.waitFor(() => childExited, { timeoutMs: ms }),
    kill: () => { try { child.kill(); } catch {} },
  });
  log('关闭流程：', result.steps.join(' → '));
  cleanupSmoke();
  app.exit(code);
}

function cleanupSmoke() {
  if (smokeDataDir) { try { fs.rmSync(smokeDataDir, { recursive: true, force: true }); } catch {} smokeDataDir = null; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    title: '视觉工作台',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f7f5fb',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (process.platform !== 'darwin') win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (core.isExternalOpenable(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (core.isInternalUrl(url)) return;
    e.preventDefault();
    if (core.isExternalOpenable(url)) shell.openExternal(url);
  });
  attachContextMenu(win.webContents);
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => { if (!closing) { e.preventDefault(); shutdownAndQuit(0); } else e.preventDefault(); });
  win.webContents.once('did-finish-load', () => {
    log('页面已加载');
    if (SMOKE) setTimeout(() => shutdownAndQuit(0), 1000);
  });
  win.webContents.on('did-fail-load', (_e, codeNum, desc) => log('页面加载失败：', codeNum, desc));
  win.loadURL(core.ORIGIN);
}

app.on('before-quit', (e) => { if (!closing) { e.preventDefault(); shutdownAndQuit(0); } });
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try { logFile = path.join(app.getPath('userData'), 'desktop.log'); fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch {}
  log('启动', SMOKE ? '（自测模式）' : '', 'Electron', process.versions.electron);
  if (SMOKE) setTimeout(() => { log('自测超时'); try { child?.kill(); } catch {} cleanupSmoke(); app.exit(1); }, SMOKE_TIMEOUT_MS).unref();
  setMenu();
  const repoDir = await findRepo();
  if (!repoDir) { cleanupSmoke(); app.exit(1); return; }
  if (!(await ensureServer(repoDir))) { if (child && !childExited) child.kill(); cleanupSmoke(); app.exit(1); return; }
  createWindow();
});
