// 用户数据目录的结构：projects/、library/assets/、library/fonts/；每个项目里有 pages/ assets/ fonts/ versions/（格式 v3）。
// 数据目录在 git 之外，路径由 src/config.js 提供，这里不写死任何位置。
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const LAYOUT = { projects: 'projects', libraryAssets: 'library/assets', libraryFonts: 'library/fonts' };
export const PROJECT_LAYOUT = { file: 'project.json', pages: 'pages', assets: 'assets', fonts: 'fonts', versions: 'versions' };

function ensureDir(abs, created, existed, label) {
  if (existsSync(abs)) {
    existed.push(label);
  } else {
    mkdirSync(abs, { recursive: true });
    created.push(label);
  }
}

/** 创建数据目录骨架；已存在的跳过。返回 { created, existed }（相对数据目录的路径，数据目录本身记为 '.'）。 */
export function initDataDir(dataDir) {
  const created = [];
  const existed = [];
  ensureDir(dataDir, created, existed, '.');
  for (const rel of Object.values(LAYOUT)) ensureDir(join(dataDir, rel), created, existed, rel);
  return { created, existed };
}

export function projectDir(dataDir, projectId) {
  return join(dataDir, LAYOUT.projects, projectId);
}

/** 在项目文件夹里建 pages/ assets/ fonts/ versions/（已存在跳过）。 */
export function initProjectDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const rel of [PROJECT_LAYOUT.pages, PROJECT_LAYOUT.assets, PROJECT_LAYOUT.fonts, PROJECT_LAYOUT.versions]) {
    mkdirSync(join(dir, rel), { recursive: true });
  }
}

/** 参数是已存在的目录就直接用；否则当作项目编号去 <dataDir>/projects/ 下找。最终目录须含 project.json。 */
export function resolveProject(arg, dataDir) {
  if (!arg) throw new Error('缺少项目编号或路径');
  const asPath = resolve(arg);
  let dir;
  if (existsSync(asPath) && statSync(asPath).isDirectory()) dir = asPath;
  else dir = projectDir(dataDir, arg);
  if (!existsSync(join(dir, PROJECT_LAYOUT.file))) {
    throw new Error(`找不到项目：${arg}（已查找 ${dir}，里面没有 ${PROJECT_LAYOUT.file}）`);
  }
  return dir;
}

/** 列出 <dataDir>/projects/ 下含 project.json 的项目编号（按名字排序）。 */
export function listProjects(dataDir) {
  const root = join(dataDir, LAYOUT.projects);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, PROJECT_LAYOUT.file)))
    .map((d) => d.name)
    .sort();
}

/** 工作台自身的状态文件（放在数据目录根下），目前记录哪些项目是系列母版。 */
export const STATE_FILE = 'workbench-state.json';
