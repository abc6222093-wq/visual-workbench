import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getLocalConfigPath, saveLocalConfig, validateDataDir } from '../src/config.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vw-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cwd = join(root, 'cwd');
  const configPath = join(root, 'clone', 'workbench.config.json');
  mkdirSync(home); mkdirSync(cwd); mkdirSync(join(root, 'clone'));
  writeFileSync(configPath, JSON.stringify({ dataDir: './repo-data' }));
  return { root, home, cwd, configPath, argv: [], env: {} };
}
function dataTree(root) {
  for (const part of ['projects', 'library/assets', 'library/fonts']) mkdirSync(join(root, part), { recursive: true });
  return root;
}

test('本机配置优先级：命令行 > 环境变量 > 本机 > 仓库', t => {
  const f = fixture(t);
  assert.deepEqual(loadConfig(f), { source: 'config', dataDir: join(f.root, 'clone', 'repo-data') });
  const localPath = getLocalConfigPath(f);
  mkdirSync(join(f.home, '.visual-workbench'));
  writeFileSync(localPath, JSON.stringify({ dataDir: '~/local-data' }));
  assert.deepEqual(loadConfig(f), { source: 'local', dataDir: join(f.home, 'local-data') });
  assert.deepEqual(loadConfig({ ...f, env: { VW_DATA_DIR: 'env-data' } }), { source: 'env', dataDir: join(f.cwd, 'env-data') });
  assert.deepEqual(loadConfig({ ...f, argv: ['--data-dir=cli-data'], env: { VW_DATA_DIR: 'env-data' } }), { source: 'cli', dataDir: join(f.cwd, 'cli-data') });
});

test('本机配置在不同克隆间共享，保存绝对路径并可替换', t => {
  const f = fixture(t);
  const data = dataTree(join(f.root, 'data'));
  assert.equal(validateDataDir(data), data);
  assert.deepEqual(saveLocalConfig(data, f), { dataDir: data, source: 'local' });
  const path = getLocalConfigPath(f);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { dataDir: data });
  assert.deepEqual(loadConfig({ ...f, configPath: join(f.root, 'another-clone', 'workbench.config.json') }), { dataDir: data, source: 'local' });
  const next = dataTree(join(f.home, 'next'));
  saveLocalConfig('~/next', f);
  assert.equal(loadConfig(f).dataDir, next);
  assert.deepEqual(readdirSync(join(f.home, '.visual-workbench')), ['config.json']);
});

test('无效目录使用中文错误，且不保存或覆盖配置', t => {
  const f = fixture(t);
  const invalid = join(f.root, 'incomplete');
  mkdirSync(invalid); mkdirSync(join(invalid, 'projects'));
  assert.throws(() => saveLocalConfig(invalid, f), /数据目录无效.*library\/assets/);
  assert.equal(existsSync(getLocalConfigPath(f)), false);
  saveLocalConfig(dataTree(join(f.root, 'valid')), f);
  const previous = readFileSync(getLocalConfigPath(f), 'utf8');
  for (const value of [invalid, '', null, join(f.root, 'missing')]) assert.throws(() => saveLocalConfig(value, f), /目录/);
  assert.equal(readFileSync(getLocalConfigPath(f), 'utf8'), previous);
  const fileRoot = dataTree(join(f.root, 'file-root'));
  rmSync(join(fileRoot, 'library/fonts'), { recursive: true });
  writeFileSync(join(fileRoot, 'library/fonts'), 'file');
  assert.throws(() => validateDataDir(fileRoot), /library\/fonts/);
});

test('损坏本机配置抛中文错误；明确覆盖参数仍可启动', t => {
  const f = fixture(t);
  mkdirSync(join(f.home, '.visual-workbench'));
  const path = getLocalConfigPath(f);
  writeFileSync(path, '{');
  assert.throws(() => loadConfig(f), /配置文件不是合法 JSON/);
  assert.equal(loadConfig({ ...f, argv: ['--data-dir', '/tmp/override'] }).source, 'cli');
  writeFileSync(path, '{}');
  assert.throws(() => loadConfig(f), /缺少 dataDir/);
});
