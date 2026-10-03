// 数据目录优先级：命令行 > 环境变量 > 本机配置 > 仓库配置。
// 代码里不写死任何个人目录；默认值只存在于 workbench.config.json。
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const CONFIG_PATH = join(REPO_ROOT, 'workbench.config.json');

/** 展开开头的 ~，再转成绝对路径；相对路径按 base 解析。 */
function expandPath(p, base, home = homedir()) {
  let s = String(p).trim();
  if (s === '~') s = home;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = join(home, s.slice(2));
  return isAbsolute(s) ? resolve(s) : resolve(base, s);
}

/** 从命令行参数里找 --data-dir 的值；没有返回 undefined。 */
function findCliDataDir(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) throw new Error('参数 --data-dir 后面需要跟一个目录路径');
      return v;
    }
    if (a.startsWith('--data-dir=')) {
      const v = a.slice('--data-dir='.length);
      if (!v) throw new Error('参数 --data-dir= 后面需要跟一个目录路径');
      return v;
    }
  }
  return undefined;
}

/** 本机配置与仓库分离，多个克隆共享同一个目录选择。 */
export function getLocalConfigPath({ home = homedir() } = {}) {
  return join(home, '.visual-workbench', 'config.json');
}

function readConfig(path) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`配置文件不是合法 JSON：${path}（${e.message}）`);
  }
  if (!cfg || typeof cfg.dataDir !== 'string' || !cfg.dataDir.trim()) {
    throw new Error(`配置文件缺少 dataDir 字段：${path}`);
  }
  return cfg;
}

/**
 * 解析数据目录；configPath 指向仓库配置，cwd 用于命令行和环境变量的相对路径。
 * @returns {{dataDir: string, source: 'cli' | 'env' | 'local' | 'config'}}
 */
export function loadConfig({ argv = process.argv.slice(2), env = process.env,
  home = homedir(), configPath = CONFIG_PATH, cwd = process.cwd() } = {}) {
  const cli = findCliDataDir(argv);
  if (cli !== undefined) return { dataDir: expandPath(cli, cwd, home), source: 'cli' };
  if (env.VW_DATA_DIR) return { dataDir: expandPath(env.VW_DATA_DIR, cwd, home), source: 'env' };

  const localPath = getLocalConfigPath({ home });
  if (existsSync(localPath)) {
    const cfg = readConfig(localPath);
    return { dataDir: expandPath(cfg.dataDir, dirname(localPath), home), source: 'local' };
  }
  if (!existsSync(configPath)) {
    throw new Error(`找不到配置文件：${configPath}。请创建它并写入 dataDir，或使用 --data-dir / 环境变量 VW_DATA_DIR 指定数据目录`);
  }
  const cfg = readConfig(configPath);
  return { dataDir: expandPath(cfg.dataDir, dirname(resolve(configPath)), home), source: 'config' };
}

/** 检查已有数据目录的必要结构；不创建或修改用户数据。 */
export function validateDataDir(dataDir) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('请选择有效的数据目录');
  const resolved = expandPath(dataDir, process.cwd());
  for (const part of ['', 'projects', 'library/assets', 'library/fonts']) {
    const path = join(resolved, part);
    let isDirectory = false;
    try { isDirectory = statSync(path).isDirectory(); } catch {}
    if (!isDirectory) throw new Error(`数据目录无效：缺少文件夹 ${part || resolved}。请选择包含 projects、library/assets 和 library/fonts 的数据目录`);
  }
  return resolved;
}

/** 验证成功后用原子替换保存本机选择；失败不覆盖原配置。 */
export function saveLocalConfig(dataDir, { home = homedir() } = {}) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('请选择有效的数据目录');
  const resolved = validateDataDir(expandPath(dataDir, process.cwd(), home));
  const configPath = getLocalConfigPath({ home });
  mkdirSync(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ dataDir: resolved }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, configPath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { dataDir: resolved, source: 'local' };
}

/** 去掉 --data-dir 及其值（也处理 --data-dir=x），返回剩余参数。 */
export function stripDataDirArg(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir') {
      i++; // 跳过它的值
      continue;
    }
    if (a.startsWith('--data-dir=')) continue;
    out.push(a);
  }
  return out;
}
