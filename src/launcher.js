import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { openBrowser } from './platform.js';
const exec = promisify(execFile);
export const missingNodeChinese = '未找到 Node.js 22 或更新版本。请先安装：https://nodejs.org/zh-cn/download ，然后重新双击启动。';
export function isCurrentServer(health, repoDir) {
  return health?.app === 'visual-workbench' && health.protocol === 1 && resolve(health.repoDir || '') === resolve(repoDir) && Number.isInteger(health.pid) && health.pid > 0;
}
export async function readHealth(url, fetchImpl = fetch) {
  try { const response = await fetchImpl(`${url}/api/health`, { signal: AbortSignal.timeout(1500) }); return response.ok ? await response.json() : null; } catch { return null; }
}
export async function listenerPids(port, { platform = process.platform, execImpl = exec } = {}) {
  let stdout;
  if (platform === 'win32') {
    ({ stdout } = await execImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`], { encoding: 'utf8' }));
  } else {
    try { ({ stdout } = await execImpl('lsof', ['-nP', `-iTCP:${Number(port)}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })); }
    catch (error) { if (error.code === 1 && !error.stdout && !error.stderr) return []; throw error; }
  }
  return [...new Set(stdout.split(/\s+/).filter(Boolean).map(Number))].filter((pid) => Number.isInteger(pid) && pid > 0);
}
export async function stopListener(port, { find = listenerPids, kill = process.kill.bind(process), selfPid = process.pid } = {}) {
  const first = await find(port);
  const second = await find(port);
  if (first.length !== 1 || second.length !== 1 || first[0] !== second[0] || first[0] === selfPid) throw new Error('无法可靠识别占用工作台端口的进程，未停止任何程序。');
  kill(first[0], 'SIGTERM');
  return first[0];
}
export async function launchWorkbench({ repoDir = fileURLToPath(new URL('..', import.meta.url)), port = 4173, health = readHealth, find = listenerPids, stop = stopListener, open = openBrowser, spawnImpl = spawn, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const url = `http://127.0.0.1:${port}`;
  if (isCurrentServer(await health(url), repoDir)) { await open(url); return { reused: true }; }
  if ((await find(port)).length) {
    await stop(port, { find });
    for (let i = 0; i < 50 && (await find(port)).length; i++) await pause(100);
    if ((await find(port)).length) throw new Error('端口仍被占用，请关闭占用程序后重试。');
  }
  const child = spawnImpl(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['start', '--', '--port', String(port)], { cwd: repoDir, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, VW_OPEN_BROWSER: '0' } });
  let failed = null;
  child.once('error', (error) => { failed = error; });
  child.once('exit', (code) => { failed ||= new Error(`工作台已退出（${code}）。`); });
  for (let i = 0; i < 150; i++) {
    if (failed) throw new Error('工作台启动失败，请检查 Node.js 和依赖是否已安装。');
    if (isCurrentServer(await health(url), repoDir)) { await open(url); return { reused: false, child }; }
    await pause(200);
  }
  throw new Error('工作台启动超时，请查看窗口中的提示。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launchWorkbench().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
