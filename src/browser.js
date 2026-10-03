// 找一个能用的浏览器给「动效检查」和「导出图片 / PDF」用。
// 顺序：Mac 上装的 Chrome → Edge → Playwright 自带的 Chromium → Playwright 自带的 WebKit（Safari 内核）。
// 都没有时抛出一句中文说明和解决办法，不让エイ看到英文报错。
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { chromium, webkit } from 'playwright';

const MAC_APPS = [
  ['Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'],
  ['Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
];
const LINUX_BINS = [
  ['Google Chrome', '/usr/bin/google-chrome'],
  ['Google Chrome', '/usr/bin/google-chrome-stable'],
];

export function noBrowserMessage(platform = process.platform) { return [
  '找不到可用的浏览器，动效检查和导出图片 / PDF 需要一个浏览器在后台打开页面。',
  '解决办法（任选一个）：',
  '  1. 安装 Google Chrome：https://www.google.com/chrome/ ，装好后重新运行；',
  '  2. 或在终端里进入工作台文件夹运行：npx playwright install chromium',
].join('\n'); }
export const NO_BROWSER_MESSAGE = noBrowserMessage();

/** 列出本机能用的浏览器候选（按优先级）。env 可传 VW_BROWSER=chrome|chromium|webkit 只用指定的一种。 */
export function browserCandidates({ platform = process.platform, home = homedir(), exists = existsSync, env = process.env, only = env.VW_BROWSER } = {}) {
  const list = [];
  const system = platform === 'darwin'
    ? MAC_APPS.flatMap(([name, rel]) => ['/Applications', join(home, 'Applications')].map((dir) => [name, join(dir, rel)]))
    : platform === 'win32' ? ['Google Chrome', 'Microsoft Edge'].flatMap((name) => {
      const rel = name === 'Google Chrome' ? 'Google/Chrome/Application/chrome.exe' : 'Microsoft/Edge/Application/msedge.exe';
      return [env.PROGRAMFILES || env.ProgramFiles, env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'], env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local')]
        .filter(Boolean).map((dir) => [name, win32.join(dir, rel)]);
    }) : platform === 'linux' ? LINUX_BINS : [];
  for (const [name, path] of system) if (exists(path) && !list.some((c) => c.name === name)) list.push({ id: 'chrome', name, type: chromium, executablePath: path });
  const safePath = (type) => { try { return type.executablePath(); } catch { return null; } };
  const pwChromium = safePath(chromium);
  if (pwChromium && exists(pwChromium)) list.push({ id: 'chromium', name: 'Playwright Chromium', type: chromium });
  const pwWebkit = safePath(webkit);
  if (pwWebkit && exists(pwWebkit)) list.push({ id: 'webkit', name: 'WebKit（Safari 内核）', type: webkit });
  return only ? list.filter((c) => c.id === only) : list;
}

function launchOptions(candidate, extra) {
  return { headless: true, ...(candidate.executablePath ? { executablePath: candidate.executablePath } : {}), ...extra };
}

async function tryEach(fn) {
  const candidates = browserCandidates();
  const failures = [];
  for (const candidate of candidates) {
    try { return await fn(candidate); }
    catch (error) { failures.push(`${candidate.name}：${String(error.message || error).split('\n')[0]}`); }
  }
  const error = new Error(failures.length ? `${NO_BROWSER_MESSAGE}\n（试过：${failures.join('；')}）` : NO_BROWSER_MESSAGE);
  error.code = 'NO_BROWSER';
  throw error;
}

/** 启动浏览器，返回 Playwright Browser；browser.vwName 是用的哪个浏览器。 */
export function launchBrowser(extra = {}) {
  return tryEach(async (candidate) => {
    const browser = await candidate.type.launch(launchOptions(candidate, extra));
    browser.vwName = candidate.name;
    browser.vwEngine = candidate.id === 'webkit' ? 'webkit' : 'chromium';
    return browser;
  });
}

/** 启动可单独杀掉的浏览器进程（动效检查用：卡死的页面可以强制结束）。返回 { server, browser }。 */
export function launchBrowserServer(extra = {}) {
  return tryEach(async (candidate) => {
    const server = await candidate.type.launchServer(launchOptions(candidate, extra));
    try {
      const browser = await candidate.type.connect(server.wsEndpoint());
      browser.vwName = candidate.name;
      browser.vwEngine = candidate.id === 'webkit' ? 'webkit' : 'chromium';
      return { server, browser };
    } catch (error) { await server.close().catch(() => {}); throw error; }
  });
}
