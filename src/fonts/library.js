// 本地常用字体库（第 13 轮，docs/round13-contract.md §9、docs/format.md §19）。
// 数据目录 library/fonts/<key>/ 放完整字体文件，library/fonts/fonts.json 是清单（npm run fonts -- install 写）。
//   readFontLibrary(dataDir) → { dir, families: [{ key, family, aliases, license, licenseFile, faces: [{ file, weight, style, format, bytes }] }] }
//   matchFamily(name) → 字族 key 或 null（按目录别名，去空格、引号、大小写）
//   familiesInHtml(html, families?) → [{ key, usedName }]（页面里写到的、认得出的字族）
//   fontLibraryFor(dataDir, project, pagesHtml) → createPageFrame 的 fontLibrary 数组（只给页面用到的字族）
//   fontsApi(dataDir) → GET /api/fonts 的响应体
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FONT_CATALOG, catalogEntry, fontFaces } from './catalog.js';

export const MANIFEST = 'fonts.json';
export const URL_BASE = '/data/library/fonts';
export const libraryDir = dataDir => join(dataDir, 'library', 'fonts');

export const normalizeName = name => String(name ?? '').replace(/["'\s]/g, '').toLowerCase();
const safeName = name => typeof name === 'string' && name && !/[\\/]/.test(name) && name !== '.' && name !== '..';
const safeKey = key => typeof key === 'string' && /^[a-z0-9][a-z0-9_-]*$/i.test(key);

/** 读 fonts.json 原文；没有或坏了返回 null */
export function readManifest(dataDir) {
  try {
    const data = JSON.parse(readFileSync(join(libraryDir(dataDir), MANIFEST), 'utf8'));
    return data && Array.isArray(data.families) ? data : null;
  } catch { return null; }
}

const fileSize = path => { try { const s = statSync(path); return s.isFile() ? s.size : -1; } catch { return -1; } };

export function readFontLibrary(dataDir) {
  const dir = libraryDir(dataDir);
  const manifest = readManifest(dataDir);
  const families = [];
  for (const entry of manifest?.families || []) {
    if (!entry || !safeKey(entry.key)) continue;
    const catalog = catalogEntry(entry.key);
    const faces = [];
    let licenseFile = null;
    for (const file of Array.isArray(entry.files) ? entry.files : []) {
      if (!file || !safeName(file.file)) continue;
      const size = fileSize(join(dir, entry.key, file.file));
      if (size <= 0) continue;
      if (file.kind === 'license') { licenseFile = file.file; continue; }
      faces.push({ file: file.file, weight: file.weight ?? 'variable', style: file.style === 'italic' ? 'italic' : 'normal', format: file.format || formatOf(file.file), bytes: size });
    }
    if (!faces.length) continue;
    const aliases = [...new Set([...(catalog?.aliases || []), ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter(a => typeof a === 'string' && a.trim()))];
    families.push({ key: entry.key, family: entry.family || catalog?.family || entry.key, aliases, license: entry.license || catalog?.license || null, licenseFile, faces });
  }
  return { dir, families };
}

const FORMATS = { otf: 'opentype', ttf: 'truetype', woff2: 'woff2', woff: 'woff' };
export const formatOf = file => FORMATS[(/\.([a-z0-9]+)$/i.exec(String(file)) || [])[1]?.toLowerCase()] || 'opentype';

/** 按名字认字族；families 默认用固定清单（也可传 readFontLibrary 的 families） */
export function matchFamily(name, families = FONT_CATALOG) {
  const key = normalizeName(name);
  if (!key) return null;
  for (const entry of families) {
    if (normalizeName(entry.family) === key || normalizeName(entry.key) === key) return entry.key;
    if ((entry.aliases || []).some(alias => normalizeName(alias) === key)) return entry.key;
  }
  return null;
}

const decode = text => String(text ?? '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const splitFamilies = value => String(value).split(',').map(part => part.replace(/\s*!important\s*$/i, '').replace(/["']/g, '').trim()).filter(Boolean);

/** 页面文本里写到的字体名（font-family 声明、@font-face 的 font-family、font 简写），原样、按规范化名去重 */
export function fontNamesIn(html) {
  const text = decode(html);
  const out = new Map();
  const add = name => { const key = normalizeName(name); if (key && !out.has(key)) out.set(key, name); };
  for (const m of text.matchAll(/font-family\s*:\s*([^;{}<>]+)/gi)) splitFamilies(m[1]).forEach(add);
  for (const m of text.matchAll(/(?:^|[\s;{"'])font\s*:\s*([^;{}<>]+)/gi)) {
    const value = m[1];
    let last = null;
    for (const s of value.matchAll(/(?<=^|\s)[\d.]+(?:px|pt|em|rem|%|vw|vh|vmin|vmax|ex|ch|q|mm|cm|in|pc)?(?:\s*\/\s*[\w.%-]+)?\s+/gi)) last = s;
    if (last) splitFamilies(value.slice(last.index + last[0].length)).forEach(add);
  }
  return [...out.values()];
}

/** 页面里写到的、认得出的字族：[{ key, usedName }]（同一套被写成几个名字时各算一条） */
export function familiesInHtml(html, families = FONT_CATALOG) {
  const hits = [];
  for (const name of fontNamesIn(html)) {
    const key = matchFamily(name, families);
    if (key) hits.push({ key, usedName: name });
  }
  return hits;
}

/**
 * createPageFrame 的 fontLibrary：只给页面用到的、已安装的字族。
 * pagesHtml：一页 HTML 文本，或多页的数组 / { pageId: html } 对象。project 暂不使用（保留给以后按项目过滤）。
 * urlFor(key, file)：face 的地址，默认 /data/library/fonts/<key>/<file>（导出放映版换成占位符）。
 */
export function fontLibraryFor(dataDir, project, pagesHtml, { urlFor = (key, file) => `${URL_BASE}/${encodeURIComponent(key)}/${encodeURIComponent(file)}`, library } = {}) {
  if (!dataDir && !library) return [];
  const { families } = library || readFontLibrary(dataDir);
  if (!families.length) return [];
  const texts = typeof pagesHtml === 'string' ? [pagesHtml] : Array.isArray(pagesHtml) ? pagesHtml : Object.values(pagesHtml || {});
  const used = new Set();
  for (const text of texts) for (const hit of familiesInHtml(text, families)) used.add(hit.key);
  return families.filter(family => used.has(family.key)).map(family => ({
    key: family.key,
    family: family.family,
    aliases: family.aliases,
    faces: family.faces.map(face => ({ url: urlFor(family.key, face.file), file: face.file, weight: face.weight, style: face.style, format: face.format })),
  }));
}

/** GET /api/fonts 的响应体：每套装没装、哪些文件缺 */
export function fontsApi(dataDir) {
  const dir = libraryDir(dataDir);
  const manifest = readManifest(dataDir);
  const families = FONT_CATALOG.map(entry => {
    const listed = manifest?.families?.find(item => item?.key === entry.key);
    const wanted = listed && Array.isArray(listed.files) && listed.files.length ? listed.files : entry.files;
    const files = [], missing = [];
    for (const file of wanted) {
      if (!file || !safeName(file.file)) continue;
      const size = fileSize(join(dir, entry.key, file.file));
      if (size > 0 && (!listed || !file.bytes || file.bytes === size)) files.push({ file: file.file, bytes: size, kind: file.kind === 'license' ? 'license' : 'font' });
      else missing.push(file.file);
    }
    const installed = !!listed && !missing.length && fontFaces({ files: wanted }).length > 0;
    return { key: entry.key, family: entry.family, installed, files, missing };
  });
  const fontLibrary = (() => { try { return allFontLibrary(dataDir); } catch { return []; } })();
  return { dir, exists: existsSync(dir), families, fontLibrary };
}

/** 装好的全部字族（不按页面过滤），给浏览器侧的 createPageFrame 用；页面没用到的由 fontLibraryStyle 过滤 */
export function allFontLibrary(dataDir, { urlFor = (key, file) => `${URL_BASE}/${encodeURIComponent(key)}/${encodeURIComponent(file)}` } = {}) {
  return readFontLibrary(dataDir).families.map(family => ({
    key: family.key, family: family.family, aliases: family.aliases,
    faces: family.faces.map(face => ({ url: urlFor(family.key, face.file), file: face.file, weight: face.weight, style: face.style, format: face.format })),
  }));
}
