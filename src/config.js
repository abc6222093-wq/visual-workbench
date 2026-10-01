// 读取数据目录配置。优先级：命令行 --data-dir > 环境变量 VW_DATA_DIR > 仓库根 workbench.config.json 的 dataDir。
// 代码里不写死任何个人目录；默认值只存在于 workbench.config.json。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');
export const CONFIG_PATH = join(REPO_ROOT, 'workbench.config.json');

/** 展开开头的 ~，再转成绝对路径；相对路径按 base 解析。 */
function expandPath(p, base) {
  let s = String(p).trim();
  if (s === '~') s = homedir();
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = join(homedir(), s.slice(2));
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

/**
 * 解析数据目录。
 * @returns {{dataDir: string, source: 'cli' | 'env' | 'config'}}
 */
export function loadConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
  const cli = findCliDataDir(argv);
  if (cli !== undefined) return { dataDir: expandPath(cli, process.cwd()), source: 'cli' };

  if (env.VW_DATA_DIR) return { dataDir: expandPath(env.VW_DATA_DIR, process.cwd()), source: 'env' };

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`找不到配置文件：${CONFIG_PATH}。请创建它并写入 dataDir，或使用 --data-dir / 环境变量 VW_DATA_DIR 指定数据目录`);
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`配置文件不是合法 JSON：${CONFIG_PATH}（${e.message}）`);
  }
  if (!cfg || typeof cfg.dataDir !== 'string' || !cfg.dataDir.trim()) {
    throw new Error(`配置文件缺少 dataDir 字段：${CONFIG_PATH}`);
  }
  return { dataDir: expandPath(cfg.dataDir, REPO_ROOT), source: 'config' };
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
