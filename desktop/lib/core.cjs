'use strict';
/*
 * 桌面应用壳的纯逻辑（不依赖 electron，便于在 npm test 里用假的 spawn / fetch 测试）。
 * main.cjs 只负责把这些函数和 electron 接起来。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// 文案与 src/launcher.js 的 missingNodeChinese 保持一致
const missingNodeChinese = '未找到 Node.js 22 或更新版本。请先安装：https://nodejs.org/zh-cn/download ，然后重新双击启动。';

/* ---------- 仓库位置 ---------- */

function isRepoDir(dir, existsImpl = fs.existsSync) {
  return typeof dir === 'string' && dir.length > 0 && existsImpl(path.join(dir, 'src', 'server.js'));
}

function readJson(file, readImpl = fs.readFileSync) {
  try { return JSON.parse(String(readImpl(file, 'utf8')).replace(/^﻿/, '')); } catch { return null; }
}

function userDesktopConfigPath(home = os.homedir()) {
  return path.join(home, '.visual-workbench', 'desktop.json');
}

/**
 * 依次尝试：环境变量 VW_REPO_DIR → 用户目录 ~/.visual-workbench/desktop.json →
 * 应用里的 app-config.json（打包时写入）→ 开发态（desktop/ 的上一级）。
 * 第一个含 src/server.js 的目录胜出；都不行返回 { repoDir: null, tried }。
 */
function resolveRepoDir({ appDir, env = process.env, home = os.homedir(), existsImpl = fs.existsSync, readImpl = fs.readFileSync } = {}) {
  const candidates = [];
  if (env.VW_REPO_DIR) candidates.push({ source: '环境变量 VW_REPO_DIR', dir: env.VW_REPO_DIR });
  const user = readJson(userDesktopConfigPath(home), readImpl);
  if (user && user.repoDir) candidates.push({ source: userDesktopConfigPath(home), dir: user.repoDir });
  if (appDir) {
    const packaged = readJson(path.join(appDir, 'app-config.json'), readImpl);
    if (packaged && packaged.repoDir) candidates.push({ source: path.join(appDir, 'app-config.json'), dir: packaged.repoDir });
    candidates.push({ source: '应用所在位置', dir: path.resolve(appDir, '..') });
  }
  for (const c of candidates) if (isRepoDir(c.dir, existsImpl)) return { repoDir: path.resolve(c.dir), source: c.source, tried: candidates };
  return { repoDir: null, source: null, tried: candidates };
}

function missingRepoChinese(tried) {
  const lines = tried.map((c) => `· ${c.dir}（${c.source}）`).join('\n');
  return `找不到视觉工作台的代码文件夹（里面应该有 src/server.js）。\n\n已经找过：\n${lines || '· （没有可用的位置）'}\n\n请点「选择文件夹」，选中视觉工作台的代码文件夹（就是有 README.md、src、web 的那个）。`;
}

/* ---------- 找系统 Node ---------- */

/** Mac 从程序坞打开时 PATH 往往只有 /usr/bin:/bin，补上常见安装位置。 */
function augmentedPath(platform = process.platform, env = process.env, home = os.homedir()) {
  const sep = platform === 'win32' ? ';' : ':';
  const current = (env.PATH || env.Path || '').split(sep).filter(Boolean);
  const extra = platform === 'win32'
    ? [env.ProgramFiles && path.win32.join(env.ProgramFiles, 'nodejs'), env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'nodejs'), env.APPDATA && path.win32.join(env.APPDATA, 'nvm'), env.NVM_SYMLINK]
    : ['/opt/homebrew/bin', '/usr/local/bin', path.posix.join(home, '.volta', 'bin'), path.posix.join(home, '.local', 'bin'), '/usr/bin', '/bin'];
  const out = [...current];
  for (const p of extra) if (p && !out.includes(p)) out.push(p);
  return out.join(sep);
}

function nodeCommand(platform = process.platform) {
  return platform === 'win32' ? 'node.exe' : 'node';
}

function nodeVersionOk(version, min = 22) {
  const major = Number(String(version || '').trim().replace(/^v/, '').split('.')[0]);
  return Number.isInteger(major) && major >= min;
}

/** 用 execFileSync 风格的函数检查 node 是否可用、版本是否够。返回 { ok, version }。 */
function checkNode({ platform = process.platform, env, execImpl }) {
  try {
    const version = String(execImpl(nodeCommand(platform), ['-p', 'process.versions.node'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true })).trim();
    return { ok: nodeVersionOk(version), version };
  } catch {
    return { ok: false, version: null };
  }
}

function serverArgs(repoDir, port = PORT) {
  return [path.join(repoDir, 'src', 'server.js'), '--port', String(port), '--no-open'];
}

/* ---------- 健康检查 ---------- */

/** 与仓库 src/runtime-identity.js 的 codeFingerprint 同一算法（不能 import ESM，这里用 CJS 重写一份）。 */
function codeFingerprint(repoDir) {
  const hash = crypto.createHash('sha256');
  function visit(dir, prefix) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (e.isSymbolicLink()) continue;
      const rel = `${prefix}/${e.name}`;
      if (e.isDirectory()) visit(path.join(dir, e.name), rel);
      else if (/\.(js|html|css|json)$/.test(e.name)) hash.update(rel).update(fs.readFileSync(path.join(dir, e.name)).toString('utf8').replaceAll('\r\n', '\n'));
    }
  }
  for (const dir of ['src', 'web']) visit(path.join(repoDir, dir), dir);
  hash.update(fs.readFileSync(path.join(repoDir, 'package.json')));
  return hash.digest('hex');
}

/** 是不是本仓库的工作台服务（参考 src/launcher.js 的 isCurrentServer）。 */
function isOurServer(health, repoDir) {
  return !!health && health.app === 'visual-workbench' && health.protocol === 1 && path.resolve(health.repoDir || '') === path.resolve(repoDir) && Number.isInteger(health.pid) && health.pid > 0;
}

async function readHealth(fetchImpl, origin = ORIGIN) {
  try {
    const r = await fetchImpl(`${origin}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * 判断 4173 上的情况：
 *  - 'ours'：本仓库、代码没变 → 直接连上
 *  - 'stale'：本仓库但代码已更新（git pull 后旧服务还开着）→ 正常关闭后重启
 *  - 'foreign'：被别的程序占用 → 中文提示
 *  - 'free'：没人用 → 自己启动
 */
function classifyPort({ health, portBusy, repoDir, fingerprint }) {
  if (isOurServer(health, repoDir)) return !fingerprint || !health.fingerprint || health.fingerprint === fingerprint ? 'ours' : 'stale';
  if (health || portBusy) return 'foreign';
  return 'free';
}

/** 端口上有没有程序在监听（能连上就算占用）。 */
function isPortBusy(port = PORT, host = '127.0.0.1', netImpl = require('node:net')) {
  return new Promise((resolve) => {
    const socket = netImpl.connect({ port, host });
    const done = (busy) => { socket.destroy(); resolve(busy); };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** 轮询直到 check() 为真，最多 timeoutMs。 */
async function waitFor(check, { timeoutMs = 5000, intervalMs = 100, pause = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const end = now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (now() >= end) return false;
    await pause(intervalMs);
  }
}

const portBusyChinese = `端口 ${PORT} 已被别的程序占用，视觉工作台没法启动。\n\n请先关掉占用它的程序（例如另一个仓库的工作台、或别的开发服务），再重新打开。`;

/* ---------- 关闭流程（状态机） ---------- */

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * 正常关闭工作台：
 *  1. flushPage：让页面把没保存的修改存掉（最多 flushMs）
 *  2. postShutdown：POST /api/shutdown（服务清除「正在使用」标记后自己退出）
 *  3. 服务是自己启动的（ownChild）：等进程退出，最多 waitMs；超时才 kill
 *     连上的别人的服务：不等也不杀
 * 返回各步骤记录，供日志与测试使用。
 */
async function closeWorkbench({ flushPage = async () => {}, postShutdown, ownChild = false, waitExit = async () => true, kill = () => {}, flushMs = 3000, waitMs = 5000 } = {}) {
  const steps = [];
  const flushed = await withTimeout(flushPage().then(() => true), flushMs, false);
  steps.push(flushed ? 'flushed' : 'flush-skipped');
  const shutdown = await withTimeout(postShutdown().then((ok) => ok !== false), 4000, false);
  steps.push(shutdown ? 'shutdown-sent' : 'shutdown-failed');
  if (!ownChild) { steps.push('left-running-external'); return { steps, killed: false }; }
  const exited = await waitExit(shutdown ? waitMs : 0);
  if (exited) { steps.push('exited'); return { steps, killed: false }; }
  kill();
  steps.push('killed');
  return { steps, killed: true };
}

/** 页面里执行的保存脚本：页面若提供了 window.vwFlushBeforeClose 就调用，否则等自动保存（600ms 节流）落盘。 */
const FLUSH_SCRIPT = "(async()=>{try{if(typeof window.vwFlushBeforeClose==='function'){await window.vwFlushBeforeClose();return 'hook';}}catch(e){}await new Promise(r=>setTimeout(r,900));return 'waited';})()";

/** 外链判断：同源（工作台自己的页面）留在窗口里，其它用系统浏览器打开。 */
function isInternalUrl(url, origin = ORIGIN) {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    return u.protocol === o.protocol && u.port === o.port && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch { return false; }
}

function isExternalOpenable(url) {
  try { return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol); } catch { return false; }
}

module.exports = {
  PORT, ORIGIN, missingNodeChinese, portBusyChinese, FLUSH_SCRIPT,
  isRepoDir, resolveRepoDir, missingRepoChinese, userDesktopConfigPath,
  augmentedPath, nodeCommand, nodeVersionOk, checkNode, serverArgs,
  codeFingerprint, isOurServer, readHealth, classifyPort, isPortBusy, waitFor,
  closeWorkbench, withTimeout, isInternalUrl, isExternalOpenable,
};
