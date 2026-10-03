import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export function platformCommand(action, value, platform = process.platform) {
  if (action === 'browser') {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只能打开 HTTP 或 HTTPS 地址。');
    if (platform === 'darwin') return ['open', [url.href]];
    if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url.href]];
    return ['xdg-open', [url.href]];
  }
  if (action !== 'reveal') throw new Error('未知的系统操作。');
  if (platform === 'darwin') return ['open', ['-R', resolve(value)]];
  if (platform === 'win32') return ['explorer.exe', [`/select,${value}`]];
  return ['xdg-open', [dirname(resolve(value))]];
}
function run(action, value, { platform = process.platform, spawnImpl = spawn } = {}) {
  const [command, args] = platformCommand(action, value, platform);
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(command, args, { shell: false, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error(action === 'browser' ? '无法打开浏览器，请手动打开工作台地址。' : '无法打开文件所在文件夹。')));
    child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error('系统无法完成打开操作。')));
  });
}
export function openBrowser(url, options) { return run('browser', url, options); }
export function revealFile(path, options) { return run('reveal', path, options); }
