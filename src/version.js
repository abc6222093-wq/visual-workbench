// 版本存档：把项目当前状态（versions/ 以外的所有普通文件）存到 versions/<时间>/，并写 meta.json。
// 去重：文件内容按 sha256 存进 versions/.objects/<sha256>（只读），版本目录里的文件是指向对象的硬链接；
// 硬链接不可用时退回普通复制。每个版本目录仍是完整可读的目录。
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { PROJECT_LAYOUT } from './data-dir.js';
import { validateProject } from './validate.js';

const pad = (n) => String(n).padStart(2, '0');

/** 对象仓库目录名（在 versions/ 下；以 . 开头，不会被当成版本）。 */
const OBJECTS = '.objects';
/** 版本目录名格式：YYYYMMDD-HHMMSS，同秒冲突时带 -2、-3…… */
const VERSION_ID = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?$/;
/** 版本说明文件，不属于项目内容。 */
const META = 'meta.json';
/** 硬链接失败时退回复制的错误码。 */
const LINK_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'EACCES', 'ENOSYS']);

/** 本地时间 YYYYMMDD-HHMMSS */
function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const tmpName = (prefix) => `.${prefix}-${randomBytes(6).toString('hex')}.tmp`;

/**
 * 递归列出目录下所有普通文件的相对路径（相对 base，用 / 分隔），按路径排序。
 * 跳过名字以 . 开头的文件和目录、符号链接；skipTop 里的名字只在 base 这一层跳过。
 */
function listFiles(dir, base, skipTop = []) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (dir === base && skipTop.includes(ent.name)) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base, skipTop));
    else if (ent.isFile()) out.push(relative(base, abs).split('\\').join('/'));
  }
  return out.sort();
}

/** 项目快照范围：versions/ 以外的所有普通文件（顶层 meta.json 也跳过，免得和版本说明冲突）。 */
function snapshotFiles(projectDir) {
  return listFiles(projectDir, projectDir, [PROJECT_LAYOUT.versions, META]);
}

/** project.json 在最前，其余按路径排序。 */
function orderFiles(files) {
  const rest = files.filter((f) => f !== PROJECT_LAYOUT.file).sort();
  return files.includes(PROJECT_LAYOUT.file) ? [PROJECT_LAYOUT.file, ...rest] : rest;
}

/** 把内容存进对象仓库（已有则跳过），返回对象的绝对路径。先写临时名再 rename，之后设为只读。 */
function putObject(objectsDir, hash, data) {
  const obj = join(objectsDir, hash);
  if (existsSync(obj)) return obj;
  const tmp = join(objectsDir, tmpName('object'));
  try {
    writeFileSync(tmp, data, { flag: 'wx' });
    chmodSync(tmp, 0o444);
    renameSync(tmp, obj);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return obj;
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
  const objectsDir = join(versionsRoot, OBJECTS);
  mkdirSync(objectsDir, { recursive: true });

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

  const files = orderFiles(snapshotFiles(projectDir));
  const objects = {};
  for (const rel of files) {
    // 只读一次：算哈希和写对象用同一份内容，避免中途被改导致对象与哈希不符
    const data = readFileSync(join(projectDir, rel));
    const hash = createHash('sha256').update(data).digest('hex');
    const obj = putObject(objectsDir, hash, data);
    const dest = join(versionDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      linkSync(obj, dest);
    } catch (e) {
      if (!LINK_FALLBACK.has(e.code)) throw e;
      writeFileSync(dest, data);
    }
    objects[rel] = hash;
  }

  const meta = {
    savedAt: new Date().toISOString(),
    note,
    by,
    projectId: project.id,
    projectName: project.name,
    files,
    objects,
  };
  writeFileSync(join(versionDir, META), JSON.stringify(meta, null, 2) + '\n');
  return { versionDir, meta };
}

/** 列出 versions/ 下的版本目录（绝对路径，按名字排序；不含 .objects 等以 . 开头的目录）。 */
export function listVersions(projectDir) {
  const root = join(projectDir, PROJECT_LAYOUT.versions);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => join(root, d.name))
    .sort();
}

/** 递归列出目录下所有普通文件的绝对路径（含以 . 开头的，不跟随符号链接）。 */
function walkAll(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkAll(abs));
    else if (ent.isFile()) out.push(abs);
  }
  return out;
}

/**
 * 版本占用的磁盘空间。
 * apparentBytes：所有版本目录下文件大小之和（按路径算，同一内容在多个版本里重复计）；
 * uniqueBytes：versions/ 下（含 .objects）按 inode 去重后的大小之和，即实际占用。
 * @returns {{versions: number, apparentBytes: number, uniqueBytes: number}}
 */
export function versionDiskUsage(projectDir) {
  const versions = listVersions(projectDir);
  let apparentBytes = 0;
  for (const v of versions) for (const f of walkAll(v)) apparentBytes += lstatSync(f).size;

  let uniqueBytes = 0;
  const root = join(projectDir, PROJECT_LAYOUT.versions);
  if (existsSync(root)) {
    const seen = new Set();
    for (const f of walkAll(root)) {
      const st = lstatSync(f);
      const key = `${st.dev}:${st.ino}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueBytes += st.size;
    }
  }
  return { versions: versions.length, apparentBytes, uniqueBytes };
}

/** 真实复制一份到 dest（先写同目录临时文件再 rename），与源文件互不影响；结果可写。 */
function copyInto(src, dest, prefix) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = join(dirname(dest), tmpName(prefix));
  try {
    copyFileSync(src, tmp);
    chmodSync(tmp, 0o644); // 对象是只读的，复制会带上只读权限，这里改回可写
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * 把项目退回到某个版本。退回前会自动把当前状态存一版。
 * @returns {{backup: {versionDir: string, meta: object}, restoredFrom: string, files: string[]}}
 */
export function restoreVersion({ projectDir, versionId, by = 'user' }) {
  if (typeof versionId !== 'string' || !VERSION_ID.test(versionId)) {
    throw new Error(`版本编号不合法：${versionId}（应为 YYYYMMDD-HHMMSS 或 YYYYMMDD-HHMMSS-N）`);
  }
  const versionDir = join(projectDir, PROJECT_LAYOUT.versions, versionId);
  if (!existsSync(versionDir) || !statSync(versionDir).isDirectory()) {
    throw new Error(`找不到版本：${versionId}（已查找 ${versionDir}）`);
  }
  if (!existsSync(join(versionDir, PROJECT_LAYOUT.file))) {
    throw new Error(`版本 ${versionId} 里没有 ${PROJECT_LAYOUT.file}，无法退回`);
  }

  const check = validateProject(versionDir);
  if (!check.ok) {
    const detail = check.errors.map((e) => `[${e.code}] ${e.path} ${e.message}`).join('；');
    throw new Error(`版本 ${versionId} 校验未通过，未做任何改动：${detail}`);
  }

  const backup = saveVersion({ projectDir, note: `退回前自动存档（退回到 ${versionId}）`, by: 'system' });

  // 版本里的文件：目录里实际存在的普通文件（除 meta.json），旧格式版本也适用
  const files = orderFiles(listFiles(versionDir, versionDir, [META]));
  const keep = new Set(files);

  // 1. 先写其他文件
  for (const rel of files) {
    if (rel === PROJECT_LAYOUT.file) continue;
    copyInto(join(versionDir, rel), join(projectDir, rel), 'restore');
  }
  // 2. 删除快照范围内多出来的文件（空目录保留）
  for (const rel of snapshotFiles(projectDir)) {
    if (!keep.has(rel)) rmSync(join(projectDir, rel), { force: true });
  }
  for (const sub of [PROJECT_LAYOUT.assets, PROJECT_LAYOUT.fonts]) mkdirSync(join(projectDir, sub), { recursive: true });
  // 3. 最后原子替换 project.json
  copyInto(join(versionDir, PROJECT_LAYOUT.file), join(projectDir, PROJECT_LAYOUT.file), 'project');

  return { backup, restoredFrom: versionDir, files };
}
