// 第 11 轮 · 桌面应用壳的纯逻辑（不需要安装 electron）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { missingNodeChinese } from '../src/launcher.js';
import { codeFingerprint as repoFingerprint } from '../src/runtime-identity.js';

const require = createRequire(import.meta.url);
const core = require('../desktop/lib/core.cjs');
const repoDir = fileURLToPath(new URL('..', import.meta.url));
const desktopDir = join(repoDir, 'desktop');

test('仓库位置：环境变量 > 用户 desktop.json > 应用 app-config.json > 开发态上一级，只认含 src/server.js 的目录', () => {
  const appDir = resolve('/apps/vw/desktop');
  const home = resolve('/home/u');
  const valid = new Set([resolve('/env/repo'), resolve('/user/repo'), resolve('/packed/repo'), resolve('/apps/vw')].map((d) => join(d, 'src', 'server.js')));
  const files = {
    [join(home, '.visual-workbench', 'desktop.json')]: JSON.stringify({ repoDir: resolve('/user/repo') }),
    [join(appDir, 'app-config.json')]: '\uFEFF' + JSON.stringify({ repoDir: resolve('/packed/repo') }),
  };
  const existsImpl = (p) => valid.has(resolve(p));
  const readImpl = (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; };
  const base = { appDir, home, existsImpl, readImpl };
  assert.equal(core.resolveRepoDir({ ...base, env: { VW_REPO_DIR: resolve('/env/repo') } }).repoDir, resolve('/env/repo'));
  assert.equal(core.resolveRepoDir({ ...base, env: {} }).repoDir, resolve('/user/repo'));
  delete files[join(home, '.visual-workbench', 'desktop.json')];
  const packed = core.resolveRepoDir({ ...base, env: {} });
  assert.equal(packed.repoDir, resolve('/packed/repo'));
  assert.match(packed.source, /app-config\.json$/);
  delete files[join(appDir, 'app-config.json')];
  assert.equal(core.resolveRepoDir({ ...base, env: {} }).repoDir, resolve('/apps/vw'));
  // 都不存在 → null，中文说明列出找过的位置
  const none = core.resolveRepoDir({ ...base, env: { VW_REPO_DIR: resolve('/nope') }, existsImpl: () => false });
  assert.equal(none.repoDir, null);
  const text = core.missingRepoChinese(none.tried);
  assert.match(text, /src\/server\.js/);
  assert.ok(text.includes(resolve('/nope')));
  assert.match(text, /选择文件夹/);
});

test('开发态：本仓库的 desktop/ 能找到本仓库', () => {
  assert.equal(core.resolveRepoDir({ appDir: desktopDir, env: {}, home: join(repoDir, 'test', 'fixtures', '__no_home__') }).repoDir, resolve(repoDir));
});

test('找 Node：命令名、补 PATH、版本门槛与中文提示', () => {
  assert.equal(core.nodeCommand('win32'), 'node.exe');
  assert.equal(core.nodeCommand('darwin'), 'node');
  const mac = core.augmentedPath('darwin', { PATH: '/usr/bin:/bin' }, '/Users/u').split(':');
  assert.ok(mac.includes('/opt/homebrew/bin') && mac.includes('/usr/local/bin'));
  assert.equal(mac.filter((p) => p === '/usr/bin').length, 1, '不重复添加');
  assert.deepEqual(mac.slice(0, 2), ['/usr/bin', '/bin'], '原有 PATH 在前');
  const win = core.augmentedPath('win32', { PATH: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }).split(';');
  assert.ok(win.includes('C:\\Program Files\\nodejs'));
  assert.ok(core.nodeVersionOk('v22.0.0') && core.nodeVersionOk('24.19.0'));
  assert.ok(!core.nodeVersionOk('20.11.1') && !core.nodeVersionOk('') && !core.nodeVersionOk(null));
  const calls = [];
  assert.deepEqual(core.checkNode({ platform: 'win32', env: {}, execImpl: (cmd, args) => { calls.push([cmd, ...args]); return '24.19.0\n'; } }), { ok: true, version: '24.19.0' });
  assert.deepEqual(calls[0], ['node.exe', '-p', 'process.versions.node']);
  assert.equal(core.checkNode({ platform: 'darwin', env: {}, execImpl: () => '18.0.0' }).ok, false);
  assert.deepEqual(core.checkNode({ platform: 'darwin', env: {}, execImpl: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } }), { ok: false, version: null });
  assert.equal(core.missingNodeChinese, missingNodeChinese, '与 src/launcher.js 文案一致');
  const args = core.serverArgs(resolve('/r'));
  assert.deepEqual(args, [join(resolve('/r'), 'src', 'server.js'), '--port', '4173', '--no-open']);
});

test('健康检查：本仓库 / 代码已更新 / 别的程序 / 空闲', async () => {
  const health = { app: 'visual-workbench', protocol: 1, repoDir: '/tmp/日本 项目', pid: 12, fingerprint: 'new' };
  assert.ok(core.isOurServer(health, '/tmp/日本 项目'));
  assert.ok(!core.isOurServer({ ...health, protocol: 2 }, '/tmp/日本 项目'));
  assert.ok(!core.isOurServer({ ...health, pid: 0 }, '/tmp/日本 项目'));
  assert.equal(core.classifyPort({ health, portBusy: true, repoDir: '/tmp/日本 项目', fingerprint: 'new' }), 'ours');
  assert.equal(core.classifyPort({ health, portBusy: true, repoDir: '/tmp/日本 项目', fingerprint: null }), 'ours');
  assert.equal(core.classifyPort({ health, portBusy: true, repoDir: '/tmp/日本 项目', fingerprint: 'old' }), 'stale');
  assert.equal(core.classifyPort({ health, portBusy: true, repoDir: '/tmp/other', fingerprint: 'new' }), 'foreign');
  assert.equal(core.classifyPort({ health: null, portBusy: true, repoDir: '/r' }), 'foreign');
  assert.equal(core.classifyPort({ health: null, portBusy: false, repoDir: '/r' }), 'free');
  const urls = [];
  assert.deepEqual(await core.readHealth(async (url) => { urls.push(url); return { ok: true, json: async () => health }; }), health);
  assert.equal(urls[0], 'http://127.0.0.1:4173/api/health');
  assert.equal(await core.readHealth(async () => ({ ok: false })), null);
  assert.equal(await core.readHealth(async () => { throw new Error('ECONNREFUSED'); }), null);
  assert.match(core.portBusyChinese, /4173/);
});

test('代码指纹与仓库 src/runtime-identity.js 算法一致', () => {
  assert.equal(core.codeFingerprint(repoDir), repoFingerprint(repoDir));
});

test('关闭流程：自己启动的服务 → 先保存、再 POST shutdown、等退出', async () => {
  const events = [];
  const result = await core.closeWorkbench({
    flushPage: async () => events.push('flush'),
    postShutdown: async () => { events.push('shutdown'); return true; },
    ownChild: true,
    waitExit: async (ms) => { events.push(`wait:${ms}`); return true; },
    kill: () => events.push('kill'),
  });
  assert.deepEqual(events, ['flush', 'shutdown', 'wait:5000']);
  assert.deepEqual(result, { steps: ['flushed', 'shutdown-sent', 'exited'], killed: false });
});

test('关闭流程：5 秒内没退出才杀；shutdown 失败不等直接杀；页面卡住不拖住关闭', async () => {
  const kills = [];
  const slow = await core.closeWorkbench({ postShutdown: async () => true, ownChild: true, waitExit: async () => false, kill: () => kills.push('k') });
  assert.deepEqual(slow.steps, ['flushed', 'shutdown-sent', 'killed']);
  assert.equal(kills.length, 1);
  const waits = [];
  const failed = await core.closeWorkbench({ postShutdown: async () => { throw new Error('ECONNREFUSED'); }, ownChild: true, waitExit: async (ms) => { waits.push(ms); return false; }, kill: () => kills.push('k') });
  assert.deepEqual(waits, [0]);
  assert.deepEqual(failed.steps, ['flushed', 'shutdown-failed', 'killed']);
  const hung = await core.closeWorkbench({ flushPage: () => new Promise(() => {}), flushMs: 30, postShutdown: async () => true, ownChild: true, waitExit: async () => true });
  assert.deepEqual(hung.steps, ['flush-skipped', 'shutdown-sent', 'exited']);
});

test('关闭流程：连上的别人的服务只发 shutdown，不等不杀', async () => {
  const result = await core.closeWorkbench({ postShutdown: async () => true, ownChild: false, waitExit: async () => assert.fail('不应等待'), kill: () => assert.fail('不应杀进程') });
  assert.deepEqual(result, { steps: ['flushed', 'shutdown-sent', 'left-running-external'], killed: false });
});

test('页面保存脚本优先调用页面提供的钩子，否则等自动保存', () => {
  assert.match(core.FLUSH_SCRIPT, /vwFlushBeforeClose/);
  assert.match(core.FLUSH_SCRIPT, /setTimeout/);
});

test('链接：工作台自己的页面留在窗口，其它交给系统浏览器', () => {
  assert.ok(core.isInternalUrl('http://127.0.0.1:4173/#/p/a'));
  assert.ok(core.isInternalUrl('http://localhost:4173/api/health'));
  assert.ok(!core.isInternalUrl('http://127.0.0.1:5000/'));
  assert.ok(!core.isInternalUrl('https://nodejs.org/'));
  assert.ok(!core.isInternalUrl('not a url'));
  assert.ok(core.isExternalOpenable('https://nodejs.org/zh-cn/download'));
  assert.ok(core.isExternalOpenable('mailto:a@b.c'));
  assert.ok(!core.isExternalOpenable('file:///C:/Windows/system32/cmd.exe'));
  assert.ok(!core.isExternalOpenable('javascript:alert(1)'));
});

test('端口占用检测与等待', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { assert.equal(await core.isPortBusy(port), true); } finally { await new Promise((r) => server.close(r)); }
  assert.equal(await core.isPortBusy(port), false);
  let n = 0;
  assert.equal(await core.waitFor(async () => ++n >= 3, { intervalMs: 1 }), true);
  let t = 0;
  assert.equal(await core.waitFor(async () => false, { timeoutMs: 50, intervalMs: 10, pause: async () => {}, now: () => (t += 10) }), false);
});

test('应用壳接线与打包配置：单实例、外链、自测参数；工作台代码不进包', () => {
  const main = readFileSync(join(desktopDir, 'main.cjs'), 'utf8');
  for (const s of ['requestSingleInstanceLock', "'second-instance'", 'win.show()', 'win.focus()', 'setWindowOpenHandler', "'--smoke'", 'width: 1440', 'height: 900', "title: '视觉工作台'", 'executeJavaScript(core.FLUSH_SCRIPT)', 'spawn(core.nodeCommand()', 'cwd: repoDir']) assert.ok(main.includes(s), `main.cjs 应包含 ${s}`);
  assert.ok(!/process\.execPath/.test(main), '不能用 Electron 自带的 Node 跑服务');
  const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
  assert.equal(pkg.productName, '视觉工作台');
  assert.equal(pkg.main, 'main.cjs');
  assert.ok(pkg.devDependencies.electron && pkg.devDependencies['@electron/packager']);
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, '应用壳没有运行时依赖');
  const pack = readFileSync(join(desktopDir, 'scripts', 'pack.mjs'), 'utf8');
  assert.match(pack, /dir: desktopDir/);
  assert.ok(!/osxSign|osxNotarize\s*:/.test(pack.replace(/\/\/.*$/gm, '')), '不配置签名');
  assert.match(pack, /app-config\.json/);
  const ignore = readFileSync(join(desktopDir, '.gitignore'), 'utf8').split(/\r?\n/);
  for (const line of ['node_modules/', 'dist/', 'out/']) assert.ok(ignore.includes(line));
});

test('Windows 安装脚本：带 BOM、无需管理员、桌面和开始菜单两个快捷方式、不覆盖原来的快捷方式', () => {
  const buf = readFileSync(join(desktopDir, 'install-windows.ps1'));
  assert.deepEqual([...buf.subarray(0, 3)], [239, 187, 191]);
  const ps = buf.toString('utf8');
  assert.match(ps, /WScript\.Shell/);
  assert.match(ps, /GetFolderPath\('Desktop'\)/);
  assert.match(ps, /GetFolderPath\('Programs'\)/);
  assert.match(ps, /（应用）\.lnk/);
  assert.match(ps, /app-config\.json/);
  assert.ok(!/RunAs|Administrator/i.test(ps));
});
