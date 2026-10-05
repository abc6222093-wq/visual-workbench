// 系列母版：把满意的项目标为母版，新建项目时从母版继承画板、字体、配色和通用素材，起始页是母版第 1 页的副本。
// 母版和新项目之间全部是复制，不互相引用；母版文件夹里的任何文件都不会被修改。
// 「是不是母版」记在数据目录的 workbench-state.json；配色、来源与母版各页（HTML 参考放在 series/pages/）记在新项目的 series.json。
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
import { formatResult, validateProject, readPageHtml, isLegacyProject, FORMAT_VERSION } from './validate.js';
import { copyPagesInto } from './copy-pages.js';

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 新项目里记录母版来源与配色的文件名（给 agent 读）。 */
export const SERIES_FILE = 'series.json';

// 从母版复制附属文件时跳过的顶层名字（另有：以 . 开头的一律跳过）
const SKIP_TOP = new Set([PROJECT_LAYOUT.file, PROJECT_LAYOUT.pages, PROJECT_LAYOUT.assets, PROJECT_LAYOUT.fonts, PROJECT_LAYOUT.versions, 'import', 'series']);

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

/** 新项目的空白第 1 页条目（服务器新建课件项目用）；页面文件内容见 blankPageHtml。 */
export function blankPage() {
  return { id: 'page_first', name: '第 1 页', file: 'pages/page_first.html', edits: [] };
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
 * 提取项目配色：设计卡片的颜色 + 各页 HTML / CSS 里写的十六进制颜色。
 * 按出现次数从多到少排序，次数相同按首次出现顺序，最多 limit 个。projectDir 不给时只看设计卡片。
 */
export function extractPalette(project, limit = 12, projectDir = null) {
  const counts = new Map();
  const add = (c) => { const n = normalizeColor(c); if (n) counts.set(n, (counts.get(n) || 0) + 1); };
  for (const c of (project?.designCard?.colors || [])) add(c);
  for (const page of (Array.isArray(project?.pages) ? project.pages : [])) {
    const html = projectDir ? readPageHtml(projectDir, page) : null;
    if (!html) continue;
    for (const m of html.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) add(m[0]);
  }
  return [...counts.keys()]
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

/** 复制母版文件夹里除 project.json、pages/、assets/、fonts/、versions/、import/、series/、series.json、隐藏项之外的所有文件和目录。 */
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

/** 新项目里放母版各页 HTML 参考的文件夹（不进 pages 列表）。 */
export const SERIES_PAGES_DIR = 'series/pages';

/**
 * 从母版新建项目（格式 v3）：继承画板、全部字体、素材库来的素材、附属文件；起始页 = 母版第 1 页的副本（文件 + 资源 + 修改单）；
 * 母版各页 HTML 复制到 series/pages/ 做参考，series.json 记 master、palette、pages。
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
  if (isLegacyProject(master)) throw new Error('母版还是旧格式：先在工作台里打开一次母版（会自动转换），再从它新建');
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
  if (!masterPages.length) throw new Error('母版没有页面');

  const newFonts = (Array.isArray(master.fonts) ? master.fonts : []).map((f) => structuredClone(f));
  const newAssets = (Array.isArray(master.assets) ? master.assets : [])
    .filter((a) => a && a.source && a.source.type === 'library')
    .map((a) => { const c = structuredClone(a); delete c.pendingLayout; return c; });

  const iso = now.toISOString();
  const base = {
    format: master.format,
    formatVersion: FORMAT_VERSION,
    id: newId,
    name: newName.trim(),
    ...(master.kind ? { kind: master.kind } : {}),
    ...(master.designCard ? { designCard: structuredClone(master.designCard) } : {}),
    createdAt: iso,
    updatedAt: iso,
    artboard: structuredClone(master.artboard),
    assets: newAssets,
    fonts: newFonts,
    pages: [],
  };
  const palette = extractPalette(master, 12, masterDir);
  const seriesPages = masterPages.map((page) => ({ pageId: page.id, name: page.name, file: `${SERIES_PAGES_DIR}/${page.id}.html` }));
  const series = { master: master.id, masterName: master.name, createdFromAt: iso, palette, pages: seriesPages };

  mkdirSync(dirname(destProjectDir), { recursive: true });
  mkdirSync(destProjectDir);
  try {
    initProjectDir(destProjectDir);

    const copiedFonts = [];
    for (const f of newFonts) {
      const from = join(masterDir, f.file);
      if (!isFile(from)) throw new Error(`母版的字体文件不存在：${f.file}`);
      mkdirSync(dirname(join(destProjectDir, f.file)), { recursive: true });
      copyFileSync(from, join(destProjectDir, f.file));
      if (typeof f.license === 'string' && /^fonts\/[^/\\]+$/.test(f.license) && isFile(join(masterDir, f.license))) {
        copyFileSync(join(masterDir, f.license), join(destProjectDir, f.license));
      }
      copiedFonts.push(f.id);
    }
    const copiedAssets = [];
    for (const a of newAssets) {
      const from = join(masterDir, a.file);
      if (!isFile(from)) throw new Error(`母版的素材文件不存在：${a.file}`);
      mkdirSync(dirname(join(destProjectDir, a.file)), { recursive: true });
      copyFileSync(from, join(destProjectDir, a.file));
      copiedAssets.push(a.id);
    }
    const copiedExtra = copyExtras(masterDir, destProjectDir);

    // 起始页 = 母版第 1 页的副本（页面文件 + 引用的资源 + 修改单）
    const first = copyPagesInto({ srcDir: masterDir, src: master, pageIds: [masterPages[0].id], destDir: destProjectDir, dest: base, keepIds: true });
    const project = first.project;
    for (const id of first.copiedAssets) if (!copiedAssets.includes(id)) copiedAssets.push(id);
    for (const id of first.copiedFonts) if (!copiedFonts.includes(id)) copiedFonts.push(id);

    // 母版各页 HTML 做参考
    for (const [i, page] of masterPages.entries()) {
      const from = join(masterDir, page.file);
      if (!isFile(from)) continue;
      const to = join(destProjectDir, seriesPages[i].file);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }

    writeFileSync(join(destProjectDir, PROJECT_LAYOUT.file), JSON.stringify(project, null, 2) + '\n');
    writeFileSync(join(destProjectDir, SERIES_FILE), JSON.stringify(series, null, 2) + '\n');

    const result = validateProject(destProjectDir, { structural: true });
    if (!result.ok) throw new Error(`新项目校验未通过：\n${formatResult(result)}`);

    return { destProjectDir, project, copiedFonts, copiedAssets, copiedExtra, palette };
  } catch (e) {
    rmSync(destProjectDir, { recursive: true, force: true });
    throw e;
  }
}
