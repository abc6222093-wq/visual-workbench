import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { temporaryHome } from './helpers/temporary-home.js';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, stripDataDirArg } from '../src/config.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

test('命令行 --data-dir 优先于环境变量和配置文件', t => {
  const home = temporaryHome(t);
  const r = loadConfig({ home, argv: ['--data-dir', '/tmp/vw-cli'], env: { VW_DATA_DIR: '/tmp/vw-env' } });
  assert.equal(r.source, 'cli');
  assert.equal(r.dataDir, resolve('/tmp/vw-cli'));
});

test('命令行也支持 --data-dir=路径 写法', t => {
  const home = temporaryHome(t);
  const r = loadConfig({ home, argv: ['x', '--data-dir=/tmp/vw-cli2'], env: {} });
  assert.equal(r.source, 'cli');
  assert.equal(r.dataDir, resolve('/tmp/vw-cli2'));
});

test('没有命令行参数时，环境变量 VW_DATA_DIR 优先于配置文件', t => {
  const home = temporaryHome(t);
  const r = loadConfig({ home, argv: [], env: { VW_DATA_DIR: '/tmp/vw-env' } });
  assert.equal(r.source, 'env');
  assert.equal(r.dataDir, resolve('/tmp/vw-env'));
});

test('都没有时读仓库根 workbench.config.json 的默认值', t => {
  const home = temporaryHome(t);
  const cfg = JSON.parse(readFileSync(join(ROOT, 'workbench.config.json'), 'utf8'));
  assert.equal(typeof cfg.dataDir, 'string');
  const r = loadConfig({ home, argv: [], env: {} });
  assert.equal(r.source, 'config');
  assert.ok(isAbsolute(r.dataDir));
  const expected = cfg.dataDir.startsWith('~/') ? join(home, cfg.dataDir.slice(2)) : resolve(ROOT, cfg.dataDir);
  assert.equal(r.dataDir, expected);
});

test('~ 开头会展开为用户主目录', t => {
  const home = temporaryHome(t);
  const r = loadConfig({ home, argv: ['--data-dir', '~/some-data'], env: {} });
  assert.equal(r.dataDir, join(home, 'some-data'));
  const r2 = loadConfig({ home, argv: [], env: { VW_DATA_DIR: '~' } });
  assert.equal(r2.dataDir, home);
});

test('--data-dir 缺少值时抛中文错误', t => {
  const home = temporaryHome(t);
  assert.throws(() => loadConfig({ home, argv: ['--data-dir'], env: {} }), /--data-dir/);
});

test('stripDataDirArg 去掉 --data-dir 及其值，保留其余参数', () => {
  assert.deepEqual(stripDataDirArg(['demo', '--data-dir', '/x', '-m', '备注']), ['demo', '-m', '备注']);
  assert.deepEqual(stripDataDirArg(['--data-dir=/x', 'demo']), ['demo']);
  assert.deepEqual(stripDataDirArg(['a', 'b']), ['a', 'b']);
});
