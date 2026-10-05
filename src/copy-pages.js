// 复制页面（格式 v3）：页面文件 + 它引用的资源（图片、字体、脚本、样式，样式和模块脚本里再引用的也带上）+ 修改单。
// 三处共用：命令行 copy-pages（复制成新项目）、服务器的「从别的项目复制页面」和「复制页面」、从母版新建。
// 源项目只读；资源复制进目标项目并登记，文件名冲突时改名并改写引用。
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join, posix, extname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PROJECT_LAYOUT, initProjectDir } from './data-dir.js';
import { formatResult, validateProject, FORMAT_VERSION, isLegacyProject } from './validate.js';
import { scanResources, cssUrls, moduleImports, resolvePageRef } from '../web/page-marks.js';
import { newEditId } from '../web/edits-model.js';
import { WEB_DEVICES, projectKind, webPageDefaults } from '../web/project-kinds.js';

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
const hex = (n = 8) => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 把 "1,3" 或 "1-2,3" 解析成页码数组（1 开始，保持写的顺序）。 */
export function parsePageList(str) {
  if (typeof str !== 'string' || !str.trim()) throw new Error('页码不能为空，例如 1,3 或 1-2,3');
  const out = [];
  for (const raw of str.split(',')) {
    const part = raw.trim();
    let m;
    if ((m = /^(\d+)$/.exec(part))) out.push(Number(m[1]));
    else if ((m = /^(\d+)-(\d+)$/.exec(part))) {
      const a = Number(m[1]), b = Number(m[2]);
      if (a > b) throw new Error(`页码范围写反了：${part}`);
      for (let i = a; i <= b; i++) out.push(i);
    } else throw new Error(`无法识别的页码：“${part}”，请写成 1,3 或 1-2,3`);
  }
  return out;
}

const isFile = abs => { try { return statSync(abs).isFile(); } catch { return false; } };
const sameBytes = (a, b) => isFile(a) && isFile(b) && readFileSync(a).equals(readFileSync(b));
const decodeRel = rel => { try { return decodeURIComponent(rel); } catch { return rel; } };

/** 新的页面编号（不和 taken 里的重复）。 */
export function newPageId(taken = new Set()) {
  for (;;) { const id = `page_${hex(8)}`; if (!taken.has(id)) return id; }
}

/** 最小空白页面文件：课件页一个空 body；网页页同样（宽度由工作台按设备注入）。 */
export function blankPageHtml({ title = '', background = null } = {}) {
  const style = background ? `\n  <style>body { background: ${background}; }</style>` : '';
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <title>${esc(title)}</title>${style}\n</head>\n<body>\n</body>\n</html>\n`;
}

/** 新页面的 project.json 条目。 */
export function blankPageEntry({ id, name, project, device }) {
  const page = { id, name, file: `pages/${id}.html`, edits: [] };
  if (projectKind(project) === 'web') {
    const d = WEB_DEVICES[device] ? device : 'desktop';
    Object.assign(page, webPageDefaults(d, WEB_DEVICES[d].height));
  }
  return page;
}

/** 一个文件（相对项目根）里引用的其他文件（相对项目根）：HTML 用 scanResources，CSS 用 url()/@import，JS 用相对 import。 */
function refsOf(rel, text) {
  const ext = extname(rel).toLowerCase();
  let refs;
  if (ext === '.html' || ext === '.htm') refs = scanResources(text);
  else if (ext === '.css') refs = cssUrls(text);
  else if (ext === '.js' || ext === '.mjs') refs = moduleImports(text);
  else return [];
  return refs.map(ref => ({ ref, rel: resolvePageRef(rel, ref) })).filter(r => r.rel !== null);
}

/** 在 text 里把引用 ref 换成 next（只换处在引号、括号、空白、逗号之间的完整写法）。 */
function replaceRef(text, ref, next) {
  const pattern = new RegExp(`(["'(\\s,=])${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[?#"')\\s,])`, 'g');
  return text.replace(pattern, (_, pre) => `${pre}${next}`);
}

/** 目标里可用的文件名：不存在，或内容与源相同（可复用）。 */
function pickDestRel(srcAbs, destDir, rel, reserved) {
  const ext = extname(rel), stem = rel.slice(0, rel.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? rel : `${stem}-${n}${ext}`;
    const abs = join(destDir, candidate);
    if (reserved.has(candidate)) { if (reserved.get(candidate) === srcAbs) return { rel: candidate, reuse: true }; continue; }
    if (!existsSync(abs)) return { rel: candidate, reuse: false };
    if (sameBytes(srcAbs, abs)) return { rel: candidate, reuse: true };
  }
}

/**
 * 把源项目的若干页复制进目标项目（写文件，返回新的目标项目对象；不写 project.json）。
 * @param {object} o
 * @param {string} o.srcDir 源项目文件夹（只读）
 * @param {object} o.src 源项目数据
 * @param {string[]} o.pageIds 要复制的源页面编号（按这个顺序）
 * @param {string} o.destDir 目标项目文件夹
 * @param {object} o.dest 目标项目数据（不改入参）
 * @param {string|null} [o.after] 插在目标的哪一页后面；不给放最后
 * @param {boolean} [o.keepIds] 页面编号尽量不变（复制成新项目时）；否则总是新编号
 * @param {(rel: string, bytes: Buffer|null) => void} [o.onWrite] 写文件前回调（服务器记「自己写的」）
 * @param {(page: object) => string} [o.rename] 新页名
 * @returns {{project: object, written: string[], pageIds: string[], copiedAssets: string[], copiedFonts: string[]}}
 */
export function copyPagesInto({ srcDir, src, pageIds, destDir, dest, after = null, keepIds = false, onWrite, rename }) {
  if (!Array.isArray(pageIds) || !pageIds.length) throw new Error('至少要选一页');
  if (new Set(pageIds).size !== pageIds.length) throw new Error('页面重复');
  const srcPages = pageIds.map(id => {
    const page = (src.pages || []).find(p => p.id === id);
    if (!page) throw new Error(`源项目里没有这一页：${id}`);
    return page;
  });
  const project = structuredClone(dest);
  project.assets = project.assets || [];
  project.fonts = project.fonts || [];
  project.pages = project.pages || [];
  const destKind = projectKind(project);
  const written = [];
  const reserved = new Map(); // 本次已决定的目标路径 → 源绝对路径
  const fileMap = new Map(); // 源相对路径 → 目标相对路径
  const assetIdMap = new Map();
  const copiedAssets = [], copiedFonts = [];
  const takenPages = new Set(project.pages.map(p => p.id));
  const takenEdits = new Set(project.pages.flatMap(p => (p.edits || []).map(e => e.id)));
  const takenAssets = new Set(project.assets.map(a => a.id));
  const takenFonts = new Set(project.fonts.map(f => f.id));

  const write = (rel, bytes) => {
    const abs = join(destDir, rel);
    onWrite?.(rel, bytes);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes, { flag: 'wx' });
    written.push(rel);
  };

  const registerAsset = (srcRel, destRel) => {
    let entry = project.assets.find(a => a.file === destRel);
    if (entry) return entry;
    const from = (src.assets || []).find(a => a.file === srcRel);
    entry = from ? { ...structuredClone(from), file: destRel, source: { type: 'copied-from-project', from: `${src.id}/${from.id}` } }
      : { id: '', kind: IMAGE_EXT.has(extname(destRel).toLowerCase()) ? 'image' : 'file', file: destRel, name: basename(destRel), source: { type: 'copied-from-project', from: `${src.id}/${srcRel}` } };
    delete entry.pendingLayout;
    if (!entry.id || takenAssets.has(entry.id)) { do entry.id = `asset_${hex(12)}`; while (takenAssets.has(entry.id)); }
    takenAssets.add(entry.id);
    project.assets.push(entry);
    copiedAssets.push(entry.id);
    if (from) assetIdMap.set(from.id, entry.id);
    return entry;
  };
  const registerFont = (srcRel, destRel) => {
    let entry = project.fonts.find(f => f.file === destRel);
    if (entry) return entry;
    const from = (src.fonts || []).find(f => f.file === srcRel);
    if (!from && project.fonts.some(f => f.license === destRel)) return null; // 许可证文件
    if (!from && (src.fonts || []).some(f => f.license === srcRel)) return null;
    entry = from ? structuredClone(from) : { id: '', family: basename(destRel, extname(destRel)), file: destRel };
    entry.file = destRel;
    if (!entry.id || takenFonts.has(entry.id)) { do entry.id = `font_${hex(12)}`; while (takenFonts.has(entry.id)); }
    takenFonts.add(entry.id);
    // 许可证若是 fonts/ 下的文件，一并带走
    if (from && typeof from.license === 'string' && /^fonts\//.test(from.license) && isFile(join(srcDir, from.license))) {
      entry.license = copyResource(from.license);
    }
    project.fonts.push(entry);
    copiedFonts.push(entry.id);
    return entry;
  };

  // 复制一个资源（相对源项目根），返回目标相对路径；递归带上它引用的文件
  function copyResource(srcRelRaw) {
    const srcRel = isFile(join(srcDir, srcRelRaw)) ? srcRelRaw : decodeRel(srcRelRaw);
    if (fileMap.has(srcRel)) return fileMap.get(srcRel);
    const top = srcRel.split('/')[0];
    if (srcRel === PROJECT_LAYOUT.file || top === PROJECT_LAYOUT.versions || top === PROJECT_LAYOUT.pages || top.startsWith('.')) { fileMap.set(srcRel, srcRel); return srcRel; }
    const srcAbs = join(srcDir, srcRel);
    if (!isFile(srcAbs) || lstatSync(srcAbs).isSymbolicLink()) throw new Error(`源项目里找不到页面引用的文件：${srcRel}`);
    const pick = pickDestRel(srcAbs, destDir, srcRel, reserved);
    fileMap.set(srcRel, pick.rel);
    reserved.set(pick.rel, srcAbs);
    let bytes = readFileSync(srcAbs);
    const nested = refsOf(srcRel, bytes.toString('utf8'));
    if (nested.length) {
      let text = bytes.toString('utf8'), changed = false;
      for (const { ref, rel } of nested) {
        const destRel = copyResource(rel);
        if (destRel === rel && pick.rel === srcRel) continue;
        const next = posix.relative(posix.dirname(pick.rel), destRel) || posix.basename(destRel);
        if (next !== ref) { text = replaceRef(text, ref, next); changed = true; }
      }
      if (changed) bytes = Buffer.from(text, 'utf8');
    }
    if (!pick.reuse) write(pick.rel, bytes);
    if (pick.rel.startsWith(`${PROJECT_LAYOUT.assets}/`)) registerAsset(srcRel, pick.rel);
    else if (pick.rel.startsWith(`${PROJECT_LAYOUT.fonts}/`)) registerFont(srcRel, pick.rel);
    return pick.rel;
  }

  try {
    const newPages = [];
    for (const srcPage of srcPages) {
      const id = keepIds && !takenPages.has(srcPage.id) ? srcPage.id : newPageId(takenPages);
      takenPages.add(id);
      const file = `${PROJECT_LAYOUT.pages}/${id}.html`;
      const pageAbs = join(srcDir, srcPage.file);
      if (!isFile(pageAbs)) throw new Error(`源项目的页面文件不存在：${srcPage.file}`);
      let html = readFileSync(pageAbs, 'utf8');
      for (const { ref, rel } of refsOf(srcPage.file, html)) {
        const destRel = copyResource(rel);
        const next = posix.relative(posix.dirname(file), destRel);
        if (destRel !== rel && next !== ref) html = replaceRef(html, ref, next);
      }
      const page = structuredClone(srcPage);
      page.id = id;
      page.file = file;
      if (rename) page.name = rename(srcPage);
      page.edits = (srcPage.edits || []).map(e => {
        const copy = structuredClone(e);
        if (takenEdits.has(copy.id)) copy.id = newEditId();
        while (takenEdits.has(copy.id)) copy.id = newEditId();
        takenEdits.add(copy.id);
        if (copy.kind === 'addImage' && copy.after?.asset) {
          const asset = (src.assets || []).find(a => a.id === copy.after.asset);
          if (asset) { copyResource(asset.file); copy.after.asset = assetIdMap.get(asset.id) || project.assets.find(a => a.file === fileMap.get(asset.file))?.id || copy.after.asset; }
        }
        return copy;
      });
      if (destKind === 'web' && !WEB_DEVICES[page.device]) Object.assign(page, webPageDefaults('desktop', project.artboard?.height || WEB_DEVICES.desktop.height));
      if (destKind !== 'web') { delete page.device; delete page.size; }
      write(file, Buffer.from(html, 'utf8'));
      newPages.push(page);
    }
    const index = after ? project.pages.findIndex(p => p.id === after) : -1;
    if (after && index < 0) throw new Error(`目标项目里没有这一页：${after}`);
    project.pages.splice(index < 0 ? project.pages.length : index + 1, 0, ...newPages);
    return { project, written, pageIds: newPages.map(p => p.id), copiedAssets, copiedFonts };
  } catch (e) {
    for (const rel of written.reverse()) { onWrite?.(rel, null); rmSync(join(destDir, rel), { force: true }); }
    throw e;
  }
}

/** 撤掉 copyPagesInto 写的文件（保存 project.json 失败时用）。 */
export function rollbackWritten(destDir, written, onWrite) {
  for (const rel of [...written].reverse()) { onWrite?.(rel, null); rmSync(join(destDir, rel), { force: true }); }
}

/**
 * 复制若干页成一个新项目（命令行 copy-pages）。pages 是页码（1 开始）或页面编号。
 * @returns {{destProjectDir: string, project: object, copiedAssets: string[], copiedFonts: string[]}}
 */
export function copyPages({ srcProjectDir, pages, destProjectDir, newId, newName, now = new Date() }) {
  const srcFile = join(srcProjectDir, PROJECT_LAYOUT.file);
  if (!existsSync(srcFile)) throw new Error(`找不到源项目文件：${srcFile}`);
  const src = JSON.parse(readFileSync(srcFile, 'utf8'));
  if (isLegacyProject(src)) throw new Error('源项目是旧格式，请先运行 npm run convert 转换');
  if (typeof newId !== 'string' || !PROJECT_ID_RE.test(newId)) {
    throw new Error(`新项目编号不合法：“${newId}”（只能用小写字母、数字、连字符，2–64 位，且不能以连字符开头）`);
  }
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('至少要选一页');
  const pageIds = pages.map(p => {
    if (typeof p === 'string') { if (!src.pages.some(x => x.id === p)) throw new Error(`源项目里没有这一页：${p}`); return p; }
    if (!Number.isInteger(p) || p < 1 || p > src.pages.length) throw new Error(`页码越界：${p}（源项目共 ${src.pages.length} 页，页码从 1 开始）`);
    return src.pages[p - 1].id;
  });
  if (new Set(pageIds).size !== pageIds.length) throw new Error(`页码重复：${pages.join(',')}`);
  if (existsSync(destProjectDir)) throw new Error(`目标项目已存在，不会覆盖：${destProjectDir}`);

  const iso = now.toISOString();
  const empty = {
    format: src.format, formatVersion: FORMAT_VERSION, id: newId, name: newName ?? `${src.name}（副本）`,
    ...(src.description !== undefined ? { description: src.description } : {}),
    ...(src.kind ? { kind: src.kind } : {}),
    createdAt: iso, updatedAt: iso, artboard: structuredClone(src.artboard), assets: [], fonts: [], pages: [],
  };
  mkdirSync(dirname(destProjectDir), { recursive: true });
  mkdirSync(destProjectDir);
  try {
    initProjectDir(destProjectDir);
    const out = copyPagesInto({ srcDir: srcProjectDir, src, pageIds, destDir: destProjectDir, dest: empty, keepIds: true });
    writeFileSync(join(destProjectDir, PROJECT_LAYOUT.file), JSON.stringify(out.project, null, 2) + '\n');
    const result = validateProject(destProjectDir, { structural: true });
    if (!result.ok) throw new Error(`新项目校验未通过：\n${formatResult(result)}`);
    return { destProjectDir, project: out.project, copiedAssets: out.copiedAssets, copiedFonts: out.copiedFonts };
  } catch (e) {
    rmSync(destProjectDir, { recursive: true, force: true });
    throw e;
  }
}
