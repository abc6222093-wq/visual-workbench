// 版本存档：把项目当前状态（project.json、assets/、fonts/）复制到 versions/<时间>/，并写 meta.json。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROJECT_LAYOUT } from './data-dir.js';

const pad = (n) => String(n).padStart(2, '0');

/** 本地时间 YYYYMMDD-HHMMSS */
function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 递归列出目录下所有文件的相对路径（相对 base，用 / 分隔），按名字排序。 */
function listFiles(dir, base) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base));
    else if (ent.isFile()) out.push(relative(base, abs).split('\\').join('/'));
  }
  return out.sort();
}

/**
 * 存一个版本。
 * @returns {{versionDir: string, meta: object}}
 */
export function saveVersion({ projectDir, note = '', by = 'agent' }) {
  const projectFile = join(projectDir, PROJECT_LAYOUT.file);
  if (!existsSync(projectFile)) throw new Error(`找不到项目文件：${projectFile}`);
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));

  const versionsRoot = join(projectDir, PROJECT_LAYOUT.versions);
  mkdirSync(versionsRoot, { recursive: true });

  // 目录名：时间戳；同秒冲突加 -2、-3……（mkdirSync 不带 recursive，已存在会抛 EEXIST，借此原子占位）
  const base = stamp(new Date());
  let versionDir;
  for (let n = 1; ; n++) {
    const candidate = join(versionsRoot, n === 1 ? base : `${base}-${n}`);
    try {
      mkdirSync(candidate);
      versionDir = candidate;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }

  const files = [];
  cpSync(projectFile, join(versionDir, PROJECT_LAYOUT.file));
  files.push(PROJECT_LAYOUT.file);
  for (const sub of [PROJECT_LAYOUT.assets, PROJECT_LAYOUT.fonts]) {
    const src = join(projectDir, sub);
    if (existsSync(src) && statSync(src).isDirectory()) {
      cpSync(src, join(versionDir, sub), { recursive: true });
      files.push(...listFiles(src, projectDir));
    }
  }

  const meta = {
    savedAt: new Date().toISOString(),
    note,
    by,
    projectId: project.id,
    projectName: project.name,
    files,
  };
  writeFileSync(join(versionDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return { versionDir, meta };
}

/** 列出 versions/ 下的版本目录（绝对路径，按名字排序）。 */
export function listVersions(projectDir) {
  const root = join(projectDir, PROJECT_LAYOUT.versions);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(root, d.name))
    .sort();
}
