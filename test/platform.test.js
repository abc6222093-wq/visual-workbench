import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { platformCommand, openBrowser, revealFile } from '../src/platform.js';
test('系统打开命令保留中文日文和空格，不经过 shell', async () => {
  assert.deepEqual(platformCommand('reveal', 'C:\\项目 日本\\图.png', 'win32'), ['explorer.exe', ['/select,C:\\项目 日本\\图.png']]);
  assert.deepEqual(platformCommand('browser', 'http://127.0.0.1:4173', 'win32'), ['rundll32.exe', ['url.dll,FileProtocolHandler', 'http://127.0.0.1:4173/']]);
  const calls = [];
  const spawnImpl = (...args) => { calls.push(args); const child = new EventEmitter(); queueMicrotask(() => child.emit('close', 0)); return child; };
  await openBrowser('http://localhost:4173', { platform: 'darwin', spawnImpl });
  await revealFile('/tmp/中文 日本.png', { platform: 'darwin', spawnImpl });
  assert.equal(calls[0][2].shell, false);
  assert.deepEqual(calls[1][1], ['-R', '/tmp/中文 日本.png']);
  assert.deepEqual(platformCommand('reveal', '/tmp/中文 日本.png', 'linux'), ['xdg-open', ['/tmp']]);
  assert.throws(() => platformCommand('browser', 'file:///tmp/a'));
});
