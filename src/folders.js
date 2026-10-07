// 文件夹与整理（第 13 轮，docs/format.md §16、docs/round13-contract.md §2 §3）。
// 文件夹列表（含空文件夹）在数据目录 workbench-state.json 的 folders；项目所在文件夹写在 project.json 的 folder。
// 整理前的原状在数据目录 organize-backup.json：{ at, folders, projects: { <id>: { name, folder } } }，「退回整理前」用。
// 状态文件的写法与 src/master.js 一样：原子写（临时文件 + 改名），保留文件里其他字段。
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_FILE, listProjects } from './data-dir.js';

export const BACKUP_FILE = 'organize-backup.json';
export const FOLDER_NAME_MAX = 60;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });

function atomicWrite(file, bytes) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { writeFileSync(tmp, bytes, { flag: 'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
}
function readJson(file) {
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) throw fail(403, `${file} 不能是符号链接`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** 文件夹名规则：去首尾空白、1–60 字、不能含 / \ 和控制字符。返回整理后的名字，不合规则时抛 400。 */
export function cleanFolderName(name) {
  if (typeof name !== 'string') throw fail(400, '请输入文件夹名称');
  const value = name.trim();
  if (!value) throw fail(400, '请输入文件夹名称');
  if ([...value].length > FOLDER_NAME_MAX) throw fail(400, `文件夹名称最多 ${FOLDER_NAME_MAX} 个字`);
  if (/[\\/]/.test(value)) throw fail(400, '文件夹名称不能含有 / 或 \\');
  if (/[\x00-\x1f\x7f]/.test(value)) throw fail(400, '文件夹名称里有不能用的字符');
  return value;
}

function readState(dataDir) {
  const data = readJson(join(dataDir, STATE_FILE));
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}
function writeState(dataDir, patch) {
  mkdirSync(dataDir, { recursive: true });
  const next = { ...readState(dataDir), ...patch };
  atomicWrite(join(dataDir, STATE_FILE), Buffer.from(JSON.stringify(next, null, 2) + '\n'));
}

/** workbench-state.json 里登记的文件夹名（去重，保持顺序）。 */
export function readFolders(dataDir) {
  const list = readState(dataDir).folders;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n) => typeof n === 'string' && n.trim()))];
}
export function writeFolders(dataDir, folders) {
  writeState(dataDir, { folders: [...new Set(folders)] });
  return readFolders(dataDir);
}

// ---------- 项目 ----------
function projectFile(dataDir, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw fail(400, `项目编号不对：${id}`);
  const file = join(dataDir, 'projects', id, 'project.json');
  if (!existsSync(file)) throw fail(404, `找不到项目：${id}`);
  if (lstatSync(join(dataDir, 'projects', id)).isSymbolicLink() || lstatSync(file).isSymbolicLink()) throw fail(403, '项目文件夹不能是符号链接');
  return file;
}
function readProjectFile(dataDir, id) {
  const file = projectFile(dataDir, id);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw fail(400, `项目文件不是合法 JSON：${file}（${e.message}）`); }
}
/** 原子写回 project.json，onWrite(id, bytes) 在写之前调用（服务端记「自己写的」）。 */
function writeProjectFile(dataDir, id, project, onWrite) {
  const file = projectFile(dataDir, id);
  const bytes = Buffer.from(JSON.stringify(project, null, 2) + '\n');
  onWrite?.(id, bytes);
  atomicWrite(file, bytes);
  return project;
}
const folderOf = (project) => (typeof project?.folder === 'string' ? project.folder : '');
function allProjects(dataDir) {
  const out = [];
  for (const id of listProjects(dataDir)) {
    try { out.push({ id, project: JSON.parse(readFileSync(join(dataDir, 'projects', id, 'project.json'), 'utf8')) }); } catch { /* 坏文件跳过 */ }
  }
  return out;
}

// ---------- 总览里卡片的顺序（用户拖动排序，第 17 轮）----------
// workbench-state.json 的 order：{ "": [根上的卡片], "<文件夹名>": [文件夹里的项目] }；卡片键 "p:<项目编号>" / "f:<文件夹名>"。
// 没登记的卡片排在后面（按原来的顺序），登记了但已经不存在的忽略。
const ORDER_KEY = /^(p:[a-z0-9][a-z0-9-]{1,63}|f:[^\\/\x00-\x1f\x7f]{1,60})$/;
export function readOrder(dataDir) {
  const raw = readState(dataDir).order;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [folder, items] of Object.entries(raw)) if (Array.isArray(items)) out[folder] = [...new Set(items.filter((k) => typeof k === 'string' && ORDER_KEY.test(k)))];
  return out;
}
export function writeOrder(dataDir, folder, items) {
  const where = typeof folder === 'string' ? folder : '';
  if (where && where !== cleanFolderName(where)) throw fail(400, '文件夹名称不对');
  if (!Array.isArray(items) || items.length > 5000 || !items.every((k) => typeof k === 'string' && ORDER_KEY.test(k))) throw fail(400, '顺序不对');
  if (where && items.some((k) => k.startsWith('f:'))) throw fail(400, '文件夹里不能再放文件夹');
  writeState(dataDir, { order: { ...readOrder(dataDir), [where]: [...new Set(items)] } });
  return readOrder(dataDir);
}
// 文件夹改名 / 删除时顺序跟着改：根上的 "f:旧名" 换成新名（删除时去掉），这个文件夹自己的顺序换键名（删除时并到根的末尾）
function renameInOrder(dataDir, from, to) {
  const order = readOrder(dataDir);
  const root = (order[''] || []).flatMap((k) => (k === `f:${from}` ? (to ? [`f:${to}`] : []) : [k]));
  const inner = order[from];
  delete order[from];
  if (inner && to) order[to] = inner;
  else if (inner) root.push(...inner.filter((k) => !root.includes(k)));
  writeState(dataDir, { order: { ...order, '': root } });
}

/** 文件夹列表 [{ name, count }]：登记的文件夹（含空的）+ 项目里写了但没登记的。 */
export function listFolders(dataDir) {
  const names = readFolders(dataDir);
  const counts = new Map(names.map((n) => [n, 0]));
  for (const { project } of allProjects(dataDir)) {
    const f = folderOf(project);
    if (!f) continue;
    if (!counts.has(f)) { counts.set(f, 0); names.push(f); }
    counts.set(f, counts.get(f) + 1);
  }
  return names.map((name) => ({ name, count: counts.get(name) }));
}

/** 登记文件夹（已存在不报错）；返回整理后的名字。 */
export function ensureFolder(dataDir, name) {
  const value = cleanFolderName(name);
  const list = readFolders(dataDir);
  if (!list.includes(value)) writeFolders(dataDir, [...list, value]);
  return value;
}
export function createFolder(dataDir, name) {
  const value = cleanFolderName(name);
  if (listFolders(dataDir).some((f) => f.name === value)) throw fail(409, `已经有叫「${value}」的文件夹了`);
  writeFolders(dataDir, [...readFolders(dataDir), value]);
  return listFolders(dataDir);
}
/** 重命名文件夹，里面的项目一起改 folder。 */
export function renameFolder(dataDir, oldName, newName, { onWrite } = {}) {
  const from = typeof oldName === 'string' ? oldName : '';
  if (!listFolders(dataDir).some((f) => f.name === from)) throw fail(404, `找不到文件夹「${from}」`);
  const to = cleanFolderName(newName);
  if (to !== from && listFolders(dataDir).some((f) => f.name === to)) throw fail(409, `已经有叫「${to}」的文件夹了`);
  if (to === from) return listFolders(dataDir);
  const list = readFolders(dataDir);
  writeFolders(dataDir, list.includes(from) ? list.map((n) => (n === from ? to : n)) : [...list, to]);
  renameInOrder(dataDir, from, to);
  const now = new Date().toISOString();
  for (const { id, project } of allProjects(dataDir)) {
    if (folderOf(project) !== from) continue;
    writeProjectFile(dataDir, id, { ...project, folder: to, updatedAt: now }, onWrite);
  }
  return listFolders(dataDir);
}
/** 删文件夹：里面的项目移到根（项目不删）。 */
export function deleteFolder(dataDir, name, { onWrite } = {}) {
  const value = typeof name === 'string' ? name : '';
  if (!listFolders(dataDir).some((f) => f.name === value)) throw fail(404, `找不到文件夹「${value}」`);
  writeFolders(dataDir, readFolders(dataDir).filter((n) => n !== value));
  renameInOrder(dataDir, value, '');
  const now = new Date().toISOString();
  for (const { id, project } of allProjects(dataDir)) {
    if (folderOf(project) !== value) continue;
    const next = { ...project, updatedAt: now };
    delete next.folder;
    writeProjectFile(dataDir, id, next, onWrite);
  }
  return listFolders(dataDir);
}

/** 把项目移进文件夹（"" 或 "/" = 移出）；文件夹不存在自动登记。返回新的项目数据。 */
export function moveProject(dataDir, id, folder, { onWrite } = {}) {
  const project = readProjectFile(dataDir, id);
  const target = folder === '' || folder === '/' ? '' : ensureFolder(dataDir, folder);
  const next = { ...project, updatedAt: new Date().toISOString() };
  if (target) next.folder = target; else delete next.folder;
  return writeProjectFile(dataDir, id, next, onWrite);
}
/** 改项目名称（去首尾空白，1–200 字）。 */
export function renameProject(dataDir, id, name, { onWrite } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw fail(400, '请输入项目名称');
  if ([...name.trim()].length > 200) throw fail(400, '项目名称最多 200 个字');
  const project = readProjectFile(dataDir, id);
  return writeProjectFile(dataDir, id, { ...project, name: name.trim(), updatedAt: new Date().toISOString() }, onWrite);
}

// ---------- 整理备份 ----------
export function readBackup(dataDir) {
  const data = readJson(join(dataDir, BACKUP_FILE));
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.at !== 'string') return null;
  return { at: data.at, folders: Array.isArray(data.folders) ? data.folders.filter((n) => typeof n === 'string') : [], projects: data.projects && typeof data.projects === 'object' ? data.projects : {} };
}
/** 记录原状（覆盖旧备份）：每个项目的名称和所在文件夹 + 文件夹列表。 */
export function beginOrganize(dataDir, { now = new Date() } = {}) {
  const projects = {};
  for (const { id, project } of allProjects(dataDir)) projects[id] = { name: typeof project.name === 'string' ? project.name : id, folder: folderOf(project) };
  const backup = { at: now.toISOString(), folders: readFolders(dataDir), projects };
  mkdirSync(dataDir, { recursive: true });
  atomicWrite(join(dataDir, BACKUP_FILE), Buffer.from(JSON.stringify(backup, null, 2) + '\n'));
  return backup;
}
/** 按备份恢复每个项目的 name、folder 和文件夹列表，然后删掉备份。返回 { restored: 改动的项目数 }。 */
export function restoreOrganize(dataDir, { onWrite } = {}) {
  const backup = readBackup(dataDir);
  if (!backup) throw fail(404, '没有整理前的备份');
  let restored = 0;
  const now = new Date().toISOString();
  for (const [id, saved] of Object.entries(backup.projects)) {
    if (!ID.test(id) || !existsSync(join(dataDir, 'projects', id, 'project.json'))) continue; // 已删除的项目跳过
    const project = readProjectFile(dataDir, id);
    const name = typeof saved?.name === 'string' && saved.name.trim() ? saved.name : project.name;
    const folder = typeof saved?.folder === 'string' ? saved.folder : '';
    if (project.name === name && folderOf(project) === folder) continue;
    const next = { ...project, name, updatedAt: now };
    if (folder) next.folder = folder; else delete next.folder;
    writeProjectFile(dataDir, id, next, onWrite);
    restored += 1;
  }
  writeFolders(dataDir, backup.folders);
  rmSync(join(dataDir, BACKUP_FILE), { force: true });
  return { restored };
}
