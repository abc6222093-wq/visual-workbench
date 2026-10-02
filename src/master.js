// 系列母版：把满意的项目标为母版，新建项目时从母版继承画板、背景、字体、配色、动效代码和通用素材，但不带页面内容。
// 母版和新项目之间全部是复制，不互相引用；母版文件夹里的任何文件都不会被修改。
// 项目文件格式本轮不变，所以「是不是母版」记在数据目录的 workbench-state.json，配色与来源记在新项目的 series.json。
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { PROJECT_LAYOUT, STATE_FILE, initProjectDir } from './data-dir.js';
import { formatResult, validateProject, walkElements } from './validate.js';

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 新项目里记录母版来源与配色的文件名（给 agent 读）。 */
export const SERIES_FILE = 'series.json';

// 从母版复制附属文件时跳过的顶层名字（另有：以 . 开头的一律跳过）
const SKIP_TOP = new Set([PROJECT_LAYOUT.file, PROJECT_LAYOUT.assets, PROJECT_LAYOUT.fonts, PROJECT_LAYOUT.versions]);

function isFile(abs) {
  return existsSync(abs) && statSync(abs).isFile();
}

function readState(dataDir) {
  const file = join(dataDir, STATE_FILE);
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** 读出母版项目编号列表；文件不存在或损坏返回 []。 */
export function readMasters(dataDir) {
  const state = readState(dataDir);
  if (!Array.isArray(state.masters)) return [];
  return state.masters.filter((id) => typeof id === 'string');
}

/**
 * 把项目标为母版（on 为真）或取消标记，原子写回状态文件；保留文件里其他字段。
 * @returns {string[]} 新的母版编号列表（去重、排序）
 */
export function setMaster(dataDir, projectId, on) {
  if (typeof projectId !== 'string' || !PROJECT_ID_RE.test(projectId)) {
    throw new Error(`项目编号不合法：“${projectId}”`);
  }
  const state = readState(dataDir);
  const set = new Set(readMasters(dataDir));
  if (on) set.add(projectId);
  else set.delete(projectId);
  const masters = [...set].sort();
  const next = { ...state, masters };

  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, STATE_FILE);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return masters;
}

/** 新项目的空白第 1 页（服务器新建项目、从母版新建都用它）。 */
export function blankPage(background = '#ffffff') {
  return { id: 'page_first', name: '第 1 页', background, elements: [] };
}

/** 把颜色统一成小写 #rrggbb / #rrggbbaa；#rgb / #rgba 展开；不认识的返回 null。 */
function normalizeColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return s;
  if (/^#[0-9a-f]{3,4}$/.test(s)) return '#' + [...s.slice(1)].map((ch) => ch + ch).join('');
  return null;
}

/**
 * 提取项目配色：页面背景、文字颜色、形状填充与描边、渐变各色标。
 * 按出现次数从多到少排序，次数相同按首次出现顺序，最多 limit 个。
 */
export function extractPalette(project, limit = 12) {
  const counts = new Map(); // 颜色 -> 次数（Map 保留首次插入顺序）
  const add = (c) => {
    const n = normalizeColor(c);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  };
  const addFill = (fill) => {
    if (typeof fill === 'string') add(fill);
    else if (fill && typeof fill === 'object' && Array.isArray(fill.stops)) {
      for (const s of fill.stops) if (s && typeof s === 'object') add(s.color);
    }
  };

  for (const page of (project && Array.isArray(project.pages) ? project.pages : [])) {
    if (!page || typeof page !== 'object') continue;
    addFill(page.background);
    walkElements(page.elements, (el) => {
      if (el.type === 'text') add(el.color);
      if (el.type === 'shape') {
        addFill(el.fill);
        if (el.stroke && typeof el.stroke === 'object') add(el.stroke.color);
      }
    });
  }

  const order = [...counts.keys()];
  return order
    .map((color, i) => ({ color, n: counts.get(color), i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.color);
}

/** 递归复制目录（跳过符号链接和以 . 开头的名字），返回复制的文件相对路径（以 / 分隔）。 */
function copyTree(fromDir, toDir, relBase, out) {
  mkdirSync(toDir, { recursive: true });
  for (const ent of readdirSync(fromDir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const from = join(fromDir, ent.name);
    const to = join(toDir, ent.name);
    const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
    const st = lstatSync(from);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) copyTree(from, to, rel, out);
    else if (st.isFile()) {
      copyFileSync(from, to);
      out.push(rel);
    }
  }
  return out;
}

/** 复制母版文件夹里除 project.json、assets/、fonts/、versions/、series.json、隐藏项之外的所有文件和目录。 */
function copyExtras(masterDir, destProjectDir) {
  const out = [];
  for (const ent of readdirSync(masterDir, { withFileTypes: true })) {
    const name = ent.name;
    if (name.startsWith('.') || SKIP_TOP.has(name) || name === SERIES_FILE) continue;
    const from = join(masterDir, name);
    const st = lstatSync(from);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) copyTree(from, join(destProjectDir, name), name, out);
    else if (st.isFile()) {
      copyFileSync(from, join(destProjectDir, name));
      out.push(name);
    }
  }
  return out.sort();
}

/**
 * 从母版新建项目：继承画板、全部字体、素材库来的素材、第 1 页背景和附属文件（如动效代码），不带页面内容。
 * @returns {{destProjectDir: string, project: object, copiedFonts: string[], copiedAssets: string[], copiedExtra: string[], palette: string[]}}
 */
export function createFromMaster({ masterDir, destProjectDir, newId, newName, now = new Date() }) {
  if (typeof masterDir !== 'string' || !masterDir) throw new Error('缺少母版项目文件夹');
  const masterFile = join(masterDir, PROJECT_LAYOUT.file);
  if (!existsSync(masterFile)) throw new Error(`找不到母版项目文件：${masterFile}`);
  let master;
  try {
    master = JSON.parse(readFileSync(masterFile, 'utf8'));
  } catch (e) {
    throw new Error(`母版项目文件不是合法 JSON：${masterFile}（${e.message}）`);
  }

  if (typeof newId !== 'string' || !PROJECT_ID_RE.test(newId)) {
    throw new Error(`新项目编号不合法：“${newId}”（只能用小写字母、数字、连字符，2–64 位，且不能以连字符开头）`);
  }
  if (typeof newName !== 'string' || !newName.trim()) throw new Error('新项目名称不能为空');
  if (typeof destProjectDir !== 'string' || !destProjectDir) throw new Error('缺少新项目文件夹');
  const absMaster = resolve(masterDir);
  const absDest = resolve(destProjectDir);
  if (absDest === absMaster || absDest.startsWith(absMaster + sep)) {
    throw new Error(`新项目文件夹不能放在母版文件夹里：${destProjectDir}`);
  }
  if (existsSync(destProjectDir)) throw new Error(`目标项目已存在，不会覆盖：${destProjectDir}`);

  const masterPages = Array.isArray(master.pages) ? master.pages : [];
  const firstBg = masterPages.length && masterPages[0] && masterPages[0].background !== undefined
    ? structuredClone(masterPages[0].background)
    : '#ffffff';

  const newFonts = (Array.isArray(master.fonts) ? master.fonts : []).map((f) => structuredClone(f));
  const newAssets = (Array.isArray(master.assets) ? master.assets : [])
    .filter((a) => a && a.source && a.source.type === 'library')
    .map((a) => ({ ...structuredClone(a), pendingLayout: false }));

  const iso = now.toISOString();
  const project = {
    format: master.format,
    formatVersion: master.formatVersion,
    id: newId,
    name: newName.trim(),
    createdAt: iso,
    updatedAt: iso,
    artboard: structuredClone(master.artboard),
    assets: newAssets,
    fonts: newFonts,
    pages: [blankPage(firstBg)],
  };
  const palette = extractPalette(master);
  const series = { master: master.id, masterName: master.name, createdFromAt: iso, palette };

  mkdirSync(dirname(destProjectDir), { recursive: true });
  mkdirSync(destProjectDir);
  try {
    initProjectDir(destProjectDir);

    const copiedFonts = [];
    for (const f of newFonts) {
      const from = join(masterDir, f.file);
      if (!isFile(from)) throw new Error(`母版的字体文件不存在：${f.file}`);
      copyFileSync(from, join(destProjectDir, f.file));
      // 许可证若是 fonts/ 下的文件，一并带走
      if (typeof f.license === 'string' && /^fonts\/[^/\\]+$/.test(f.license) && isFile(join(masterDir, f.license))) {
        copyFileSync(join(masterDir, f.license), join(destProjectDir, f.license));
      }
      copiedFonts.push(f.id);
    }

    const copiedAssets = [];
    for (const a of newAssets) {
      const from = join(masterDir, a.file);
      if (!isFile(from)) throw new Error(`母版的素材文件不存在：${a.file}`);
      copyFileSync(from, join(destProjectDir, a.file));
      copiedAssets.push(a.id);
    }

    const copiedExtra = copyExtras(masterDir, destProjectDir);

    writeFileSync(join(destProjectDir, PROJECT_LAYOUT.file), JSON.stringify(project, null, 2) + '\n');
    writeFileSync(join(destProjectDir, SERIES_FILE), JSON.stringify(series, null, 2) + '\n');

    const result = validateProject(destProjectDir);
    if (!result.ok) throw new Error(`新项目校验未通过：\n${formatResult(result)}`);

    return { destProjectDir, project, copiedFonts, copiedAssets, copiedExtra, palette };
  } catch (e) {
    rmSync(destProjectDir, { recursive: true, force: true });
    throw e;
  }
}

