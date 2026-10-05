// 旧 HTML / 网页导入（第 12 轮）· 资源：把页面引用的图片、样式表、脚本、字体复制进项目的 assets/、fonts/ 并登记。
// 地址都是绝对地址（后台浏览器里换算好的）。来源：data: 地址、本地临时服务（上传的文件）、网址抓取时收到的响应或再发一次 GET。
// 页面在 pages/、样式表在 assets/，两处都用 ../assets/…、../fonts/… 引用，所以改写结果一样。拿不到的网络地址保留原样，记进迁移说明。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import sharp from 'sharp';

const hash = b => createHash('sha256').update(b).digest('hex');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.bmp', '.ico']);
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/x-icon': '.ico', 'text/css': '.css', 'text/javascript': '.js', 'application/javascript': '.js', 'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/font-woff': '.woff', 'application/x-font-ttf': '.ttf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3' };
const MAX_BYTES = 40_000_000;

export function fontExt(b) {
  if (!b || b.length < 4) return null;
  const sig = b.subarray(0, 4).toString('latin1');
  if (sig === 'wOF2') return '.woff2'; if (sig === 'wOFF') return '.woff'; if (sig === 'OTTO') return '.otf';
  if (sig === 'true' || b.readUInt32BE(0) === 0x00010000) return '.ttf';
  return null;
}
function sniff(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return '.png';
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return '.gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  const head = b.subarray(0, 300).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return '.svg';
  return fontExt(b);
}
export function fontWeight(w) {
  const parts = String(w || '400').trim().split(/\s+/);
  if (parts.length > 1) return 'variable';
  const n = parts[0] === 'bold' ? 700 : parts[0] === 'normal' ? 400 : Number(parts[0]);
  return Number.isFinite(n) ? Math.max(100, Math.min(900, Math.round(n / 100) * 100)) : 400;
}
const extOf = url => { try { const p = decodeURIComponent(new URL(url).pathname); const m = /(\.[a-z0-9]{1,6})$/i.exec(p); return m ? m[1].toLowerCase() : ''; } catch { return ''; } };
const baseName = url => {
  if (url.startsWith('data:')) return '';
  try { const p = decodeURIComponent(new URL(url).pathname).split('/').pop() || ''; return p.replace(/\.[a-z0-9]{1,6}$/i, ''); } catch { return ''; }
};
const safe = s => String(s).normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const isRemote = url => /^https?:\/\//i.test(url);
const unquote = s => String(s || '').trim().replace(/^['"]|['"]$/g, '').trim();

/** CSS 里的 url() 与 @import（不碰 data: 和 #片段）；返回 [{ start, end, url, kind }]，kind: url / import。 */
function cssRefs(text) {
  const out = [];
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi)) out.push({ start: m.index, end: m.index + m[0].length, url: m[2], kind: 'import', raw: m[0] });
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*))\s*\)/gi)) {
    if (out.some(o => m.index >= o.start && m.index < o.end)) continue;
    const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!url || /^#/.test(url)) continue;
    out.push({ start: m.index, end: m.index + m[0].length, url, kind: 'url' });
  }
  return out.sort((a, b) => a.start - b.start);
}
/** @font-face 块的范围与描述（family、weight、style）。 */
function fontFaces(text) {
  const out = [];
  for (const m of text.matchAll(/@font-face\s*\{([^{}]*)\}/gi)) {
    const body = m[1], get = name => (new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`, 'i').exec(body) || [])[1];
    out.push({ start: m.index, end: m.index + m[0].length, family: unquote(get('font-family')), weight: get('font-weight') || '400', style: /italic|oblique/i.test(get('font-style') || '') ? 'italic' : 'normal' });
  }
  return out;
}

/**
 * 项目资源仓库。projectDir：临时项目文件夹；srcDir + origin：上传文件的本地临时服务；remote(url)：网址来源时取网络资源（只发 GET），没有就不下载。
 * 每页一个 log（{ remote:Set, missing:Set, css:Set, scripts:Set, fonts:Set, missingFonts:Set }），写迁移说明用。
 */
export function createStore({ projectDir, srcDir = null, origin = null, remote = null }) {
  const assets = [], fonts = [], byHash = new Map(), byUrl = new Map(), names = new Set();
  mkdirSync(join(projectDir, 'assets'), { recursive: true }); mkdirSync(join(projectDir, 'fonts'), { recursive: true });
  const local = url => origin && url.startsWith(origin + '/');

  async function bytes(url) {
    if (url.startsWith('data:')) {
      const m = /^data:([^,]*?),(.*)$/s.exec(url); if (!m) return null;
      try { return { data: /;base64$/i.test(m[1]) ? Buffer.from(m[2].replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf8'), mime: m[1].split(';')[0].toLowerCase() }; } catch { return null; }
    }
    if (local(url)) {
      let path; try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
      const root = resolve(srcDir), file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
      return { data: readFileSync(file), mime: '' };
    }
    if (isRemote(url) && remote) { try { const got = await remote(url); return got && got.data?.length && got.data.length < MAX_BYTES ? got : null; } catch { return null; } }
    return null;
  }
  const unique = (stem, ext) => { let name = `${stem || 'file'}${ext}`, n = 2; while (names.has(name.toLowerCase())) name = `${stem || 'file'}-${n++}${ext}`; names.add(name.toLowerCase()); return name; };

  async function put(url, data, { mime, as, face, log }) {
    const key = `${as}:${hash(data)}`;
    if (byHash.has(key)) return byHash.get(key);
    let ext = as === 'css' ? '.css' : as === 'font' ? (fontExt(data) || extOf(url) || '.woff2') : (extOf(url) || MIME_EXT[mime] || sniff(data) || '');
    if (as === 'asset' && !IMAGE_EXT.has(ext) && sniff(data) && IMAGE_EXT.has(sniff(data))) ext = sniff(data);
    if (as === 'script' && !ext) ext = '.js';
    const stem = safe(baseName(url)) || (as === 'font' ? safe(face?.family || 'font') : url.startsWith('data:') ? 'inline' : 'file');
    const dir = as === 'font' ? 'fonts' : 'assets', name = unique(stem, ext), file = `${dir}/${name}`;
    let out = data;
    if (as === 'css') out = Buffer.from(await rewriteCss(data.toString('utf8'), url, log), 'utf8');
    writeFileSync(join(projectDir, file), out);
    const id = `${as === 'font' ? 'font' : 'asset'}_${hash(as + hash(data)).slice(0, 12)}`;
    if (as === 'font') {
      fonts.push({ id, family: face?.family || stem, file, weight: fontWeight(face?.weight), style: face?.style || 'normal' });
      log?.fonts.add(face?.family || stem);
    } else {
      const image = IMAGE_EXT.has(ext);
      const entry = { id, kind: image ? 'image' : 'file', file, name: (baseName(url) || name).slice(0, 80), addedAt: new Date().toISOString() };
      if (image) { try { const meta = await sharp(data, { limitInputPixels: false }).metadata(); if (meta.width && meta.height) Object.assign(entry, { width: meta.width, height: meta.height }); } catch {} }
      assets.push(entry);
      if (as === 'css') log?.css.add(file); if (as === 'script') log?.scripts.add(file);
    }
    const rel = `../${file}`;
    byHash.set(key, rel);
    return rel;
  }

  /** 绝对地址 → 新地址（../assets/… 或 ../fonts/…）；拿不到时返回 null（网络地址保留原样，本地缺失的文件记下来）。 */
  async function resolveUrl(url, { as = 'asset', face, log } = {}) {
    const key = `${as}|${url}`;
    if (byUrl.has(key)) { const r = byUrl.get(key); if (r === null) note(url, log); return r; }
    const promise = (async () => {
      const got = await bytes(url);
      if (!got) return null;
      return put(url, got.data, { mime: got.mime, as, face, log });
    })();
    byUrl.set(key, promise);
    const result = await promise; byUrl.set(key, result);
    if (result === null) note(url, log);
    return result;
  }
  const note = (url, log) => { if (!log) return; if (isRemote(url) && !local(url)) log.remote.add(url); else if (!url.startsWith('data:')) log.missing.add(local(url) ? decodeURIComponent(new URL(url).pathname.slice(1)) : url); };

  /** 改写一段 CSS：url() / @import 按 base 换算后复制；@font-face 里的进 fonts/ 并登记。拿不到的网络地址保留绝对地址，本地缺失的写成空图。 */
  async function rewriteCss(text, base, log) {
    const faces = fontFaces(text), refs = cssRefs(text);
    let out = '', at = 0;
    for (const ref of refs) {
      let abs; try { abs = new URL(ref.url, base).href; } catch { continue; }
      const face = faces.find(f => ref.start >= f.start && ref.end <= f.end);
      out += text.slice(at, ref.start); at = ref.end;
      if (ref.kind === 'import') {
        const to = await resolveUrl(abs, { as: 'css', log });
        if (!to && /fonts\.googleapis\.com|fonts\.loli\.net|fonts\.bunny\.net/.test(abs)) googleFamilies(abs).forEach(f => log?.missingFonts.add(f));
        out += `@import url("${to || abs}")`;
        continue;
      }
      if (abs.startsWith('data:') && !face && !/^data:image\//i.test(abs)) { out += text.slice(ref.start, ref.end); continue; } // 不是图片的内嵌数据保留原样
      const to = await resolveUrl(abs, { as: face ? 'font' : 'asset', face, log });
      if (!to && face) log?.missingFonts.add(face.family);
      out += `url("${to || (isRemote(abs) && !local(abs) ? abs : 'data:,')}")`;
    }
    return out + text.slice(at);
  }

  return { assets, fonts, resolveUrl, rewriteCss, isLocal: local };
}

export function googleFamilies(href) {
  try { return new URL(href).searchParams.getAll('family').flatMap(f => f.split('|')).map(f => f.split(':')[0].replace(/\+/g, ' ')).filter(Boolean); } catch { return []; }
}
export const newLog = () => ({ remote: new Set(), missing: new Set(), css: new Set(), scripts: new Set(), fonts: new Set(), missingFonts: new Set() });

/** 一页的引用表：prepare 返回的 refs（[绝对地址, 角色]）→ { 绝对地址: 新地址 }；拿不到的网络地址不进表（保留原样），本地缺失的换成空。 */
export async function mapRefs(store, refs, log) {
  const map = {};
  for (const [url, role] of refs) {
    if (url.startsWith('data:') && role === 'asset' && url.length < 2048 && !/^data:image\//i.test(url)) continue;
    const to = await store.resolveUrl(url, { as: role === 'css' ? 'css' : role === 'script' ? 'script' : 'asset', log });
    if (to) map[url] = to;
    else {
      if (role === 'css' && /fonts\.googleapis\.com|fonts\.loli\.net|fonts\.bunny\.net/.test(url)) googleFamilies(url).forEach(f => log.missingFonts.add(f));
      if (!isRemote(url) || store.isLocal(url)) map[url] = url.startsWith('data:') ? url : '';
    }
  }
  return map;
}
