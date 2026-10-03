import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isCurrentServer, launchWorkbench, stopListener, listenerPids, missingNodeChinese } from '../src/launcher.js';
const current = { app: 'visual-workbench', protocol: 1, repoDir: '/tmp/日本 项目', pid: 123 };
test('健康检查要求当前仓库和协议；已有正确服务只打开浏览器', async () => {
  assert.ok(isCurrentServer(current, current.repoDir));
  assert.equal(isCurrentServer({...current,fingerprint:'old'},current.repoDir,'new'),false);
  assert.equal(isCurrentServer({ ...current, protocol: 0 }, current.repoDir), false);
  assert.equal(isCurrentServer(current, '/tmp/other'), false);
  const opened = [];
  assert.deepEqual(await launchWorkbench({ repoDir: current.repoDir, fingerprint:null, health: async () => current, open: async (url) => opened.push(url), find: () => { throw new Error('不应调用'); } }), { reused: true });
  assert.equal(opened.length, 1);
  assert.match(missingNodeChinese, /https:\/\/nodejs.org/);
});
test('只停止两次都确认的唯一 PID，身份变化时安全退出', async () => {
  const kills = [];
  await stopListener(4173, { find: async () => [123], selfPid: 999, kill: (...args) => kills.push(args) });
  assert.deepEqual(kills, [[123, 'SIGTERM']]);
  let calls = 0;
  await assert.rejects(stopListener(4173, { find: async () => [++calls], kill: () => assert.fail('不能停止') }));
  await assert.rejects(stopListener(4173, { find: async () => [1, 2], kill: () => assert.fail('不能停止') }));
});
test('错误仓库旧服务与其他端口占用者关闭后重新启动，健康后才打开', async () => {
  for (const previous of [{ ...current, repoDir: '/tmp/other' }, { ...current, protocol: 0 }, null]) {
    const events = []; let spawned = false; let occupied = true;
    const result = await launchWorkbench({ repoDir: current.repoDir, fingerprint:null, health: async () => spawned ? current : previous, find: async () => occupied ? [123] : [], stop: async () => { events.push('stop'); occupied = false; }, spawnImpl: (_, args, options) => { events.push('spawn'); assert.deepEqual(args, ['start', '--', '--port', '4173']); assert.equal(options.env.VW_OPEN_BROWSER, '0'); spawned = true; return new EventEmitter(); }, open: async () => events.push('open'), pause: async () => {} });
    assert.equal(result.reused, false);
    assert.deepEqual(events, ['stop', 'spawn', 'open']);
  }
});
test('Windows 监听者用 PowerShell 查询并去重', async () => {
  const pids = await listenerPids(4173, { platform: 'win32', execImpl: async (command, args) => { assert.equal(command, 'powershell.exe'); assert.match(args.at(-1), /LocalPort -eq 4173/); return { stdout: '123\r\n123\r\n' }; } });
  assert.deepEqual(pids, [123]);
});

test('Windows 启动包装器不用系统代码页解码中文，PowerShell 带 BOM',async()=>{
 const {readFileSync}=await import('node:fs');const cmd=readFileSync(new URL('../launchers/启动视觉工作台.cmd',import.meta.url));const ps=readFileSync(new URL('../launchers/start-workbench.ps1',import.meta.url));
 assert.ok([...cmd].every(b=>b<128));assert.ok(cmd.toString().includes('\r\n'));assert.deepEqual([...ps.subarray(0,3)],[239,187,191]);assert.match(ps.toString('utf8'),/OutputEncoding/);assert.match(ps.toString('utf8'),/未找到 Node.js/);
});

test('Windows 实机查询占用和空端口，并验证无 Node 时的中文提示',async()=>{
 if(process.platform!=='win32')return;
 const {createServer}=await import('node:net');const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{assert.ok((await listenerPids(port)).includes(process.pid));}finally{await new Promise(r=>server.close(r));}
 assert.deepEqual(await listenerPids(port),[]);
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');const script=fileURLToPath(new URL('../launchers/start-workbench.ps1',import.meta.url));
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',`$env:Path=''; & '${script.replaceAll("'","''")}'`],{encoding:'utf8',timeout:15000});
 assert.match(result.stdout,/未找到 Node.js/);assert.match(result.stdout,/https:\/\/nodejs.org/);
});
