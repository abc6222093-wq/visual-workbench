// 第 12 轮：把一页 HTML 改写成「不依赖任何文件」的文本，给放映版单文件用。
// - 相对引用（../assets/…、../fonts/…）换成占位符 __VWFILE[<项目内路径>]__，放映器拼 srcdoc 时再换成 data: 地址
//   （同一张图被多页用到只存一份）；
// - <link rel=stylesheet> 内联成 <style>（CSS 里的 url() 按 CSS 文件位置换算）；
// - <script src> 内联；模块脚本里的相对 import 与 /vendor/… 库换成 data: 模块（依赖在 Node 端递归展开，data: 模块里不再有相对路径）；
// - ctx.importModule('字面路径') 同样换成 data: 模块。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, resolve, sep, join, extname } from 'node:path';
import { resolvePageRef } from '../../web/page-marks.js';

export const TOKEN = /__VWFILE\[([^\]]+)\]__/g;
export const token = key => `__VWFILE[${key}]__`;

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const MODULE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])((?:\.{1,2}\/|\/)[^"'\s]*)\2/g;
const IMPORT_MODULE_CALL = /(\bimportModule\s*\(\s*)(["'`])([^"'`$]+)\2/g;
const cleanRef = ref => String(ref).trim().split(/[?#]/)[0];
const decodeEntities = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const scriptSafe = text => String(text).replace(/<\/(script)/gi, '<\\/$1');
const styleSafe = text => String(text).replace(/<\/(style)/gi, '<\\/$1');

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain',
};
export const mimeOf = file => MIME[extname(file).toLowerCase()] || 'application/octet-stream';
export const dataUrl = (mime, buffer) => `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;

const ATTR_RE = name => new RegExp(`(\\s${name}\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s"'<>\`]+))`, 'i');
function getAttr(raw, name) { const m = ATTR_RE(name).exec(raw); return m ? decodeEntities(m[3] ?? m[4] ?? m[5] ?? '') : null; }
function dropAttr(raw, name) { return raw.replace(ATTR_RE(name), ''); }

/**
 * 打包上下文：同一次导出的所有页面共用（文件只读一次、模块只展开一次）。
 * embedFile(projectRel) → 占位符；由调用方提供（图片瘦身、字体子集在 html.js 里做）。
 */
export function createInliner({ projectDir, webRoot, embedFile, warn }) {
  const moduleCache = new Map();
  const vendorUsed = new Set();
  const projectModules = new Set();
  const inlined = new Set(); // 内联进页面的样式表、经典脚本（项目内路径）

  const projectFile = rel => {
    const file = resolve(projectDir, rel);
    if (!file.startsWith(resolve(projectDir) + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
    return file;
  };
  const vendorFile = path => {
    const file = resolve(webRoot, '.' + path);
    if (!file.startsWith(resolve(webRoot) + sep) || !existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`页面导入的库 ${path} 在工作台里找不到（应在 ${join(webRoot, path)}），无法打包进放映版`);
    }
    return file;
  };

  /** 模块（项目内路径或 /vendor/…）→ 完整的 data: 地址（依赖已递归展开） */
  function moduleDataUrl(spec, stack = []) {
    if (moduleCache.has(spec)) return moduleCache.get(spec);
    if (stack.includes(spec)) throw new Error(`模块循环导入，无法打包：${[...stack, spec].join(' → ')}`);
    const isVendor = spec.startsWith('/');
    const file = isVendor ? vendorFile(spec) : projectFile(spec);
    if (!file) throw new Error(`页面引用的模块 ${spec} 不存在，无法打包`);
    (isVendor ? vendorUsed : projectModules).add(spec);
    const source = readFileSync(file, 'utf8').replace(MODULE_IMPORT, (all, head, quote, ref) => {
      const target = resolveFrom(spec, cleanRef(ref));
      if (!target) { warn?.(`${spec} 里的导入 ${ref} 越出了项目，无法打包`); return all; }
      return `${head}${quote}${moduleDataUrl(target, [...stack, spec])}${quote}`;
    });
    const url = dataUrl('text/javascript', Buffer.from(source));
    moduleCache.set(spec, url);
    return url;
  }

  /** from 是项目内路径或 /vendor/…；ref 是 ./x、../x 或 /vendor/x */
  function resolveFrom(from, ref) {
    if (ref.startsWith('/')) return posix.normalize(ref);
    if (from.startsWith('/')) return posix.normalize(posix.join(posix.dirname(from), ref));
    return resolvePageRef(from, ref);
  }

  // 页面 / CSS 里的一个资源引用 → 占位符；不是项目内相对路径的原样返回
  function ref(from, raw) {
    const value = decodeEntities(raw).trim();
    if (!value || SKIP.test(value)) return raw;
    const clean = cleanRef(value);
    if (value.startsWith('/')) {
      if (value.startsWith('/vendor/')) { vendorFile(clean); vendorUsed.add(clean); return embedFile(`vendor:${clean}`); }
      warn?.(`${from} 引用了根路径 ${value}，放映版里打不开`);
      return raw;
    }
    const rel = resolveFrom(from, clean);
    if (!rel || !projectFile(rel)) { warn?.(`${from} 引用的 ${value} 不存在`); return raw; }
    return embedFile(rel);
  }

  function css(from, text) {
    return String(text)
      .replace(/(@import\s+)(?:url\(\s*)?(["'])([^"']+)\2\s*\)?\s*([^;]*);/g, (all, head, q, href) => {
        const value = cleanRef(href);
        if (SKIP.test(value) || value.startsWith('/')) return all;
        const rel = resolveFrom(from, value);
        if (!rel || !projectFile(rel)) { warn?.(`${from} 导入的样式 ${href} 不存在`); return all; }
        inlined.add(rel);
        return css(rel, readFileSync(projectFile(rel), 'utf8'));
      })
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g, (all, a, b, c) => {
        const value = a ?? b ?? c ?? '';
        const out = ref(from, value);
        return out === value ? all : `url("${out}")`;
      });
  }

  function moduleSource(from, text) {
    return String(text)
      .replace(MODULE_IMPORT, (all, head, quote, spec) => {
        const target = resolveFrom(from, cleanRef(spec));
        if (!target) return all;
        if (target.startsWith('/') && !target.startsWith('/vendor/')) return all;
        return `${head}${quote}${moduleDataUrl(target)}${quote}`;
      })
      .replace(IMPORT_MODULE_CALL, (all, head, quote, spec) => {
        const value = cleanRef(spec);
        if (SKIP.test(value)) return all;
        const target = resolveFrom(from, value);
        if (!target || (target.startsWith('/') && !target.startsWith('/vendor/'))) return all;
        return `${head}${quote}${moduleDataUrl(target)}${quote}`;
      });
  }

  function attributes(from, tag, raw) {
    let out = raw;
    for (const name of ['src', 'href', 'poster', 'data-src']) {
      if (tag === 'a' && name === 'href') continue;
      out = out.replace(ATTR_RE(name), (all, head, quoted, d, s, bare) => {
        const value = d ?? s ?? bare ?? '';
        const next = ref(from, value);
        return next === decodeEntities(value).trim() || next === value ? all : `${head}"${next}"`;
      });
    }
    out = out.replace(ATTR_RE('srcset'), (all, head, quoted, d, s, bare) => {
      const value = decodeEntities(d ?? s ?? bare ?? '');
      const next = value.split(',').map(part => { const bits = part.trim().split(/\s+/); if (bits[0]) bits[0] = ref(from, bits[0]); return bits.join(' '); }).join(', ');
      return `${head}"${next}"`;
    });
    out = out.replace(ATTR_RE('style'), (all, head, quoted, d, s, bare) => {
      const value = decodeEntities(d ?? s ?? bare ?? '');
      const next = css(from, value);
      return next === value ? all : `${head}"${next.replace(/"/g, '&quot;')}"`;
    });
    return out;
  }

  /** 一页 HTML → 自包含文本（含占位符） */
  function page(pageFile, html) {
    const parts = [];
    const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<!--[\s\S]*?-->|<([a-zA-Z][\w:-]*)\b([^>]*)>/gi;
    let last = 0;
    for (const m of html.matchAll(re)) {
      parts.push(html.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[0].startsWith('<!--')) { parts.push(m[0]); continue; }
      if (m[1]) {
        const kind = m[1].toLowerCase();
        const attrs = m[2];
        const body = m[3];
        if (kind === 'style') { parts.push(`<style${attrs}>${styleSafe(css(pageFile, body))}</style>`); continue; }
        const type = (getAttr(attrs, 'type') || '').trim().toLowerCase();
        const isModule = type === 'module';
        const isJs = !type || isModule || /javascript|ecmascript/.test(type);
        const src = getAttr(attrs, 'src');
        if (src && !SKIP.test(src.trim())) {
          const spec = resolveFrom(pageFile, cleanRef(src));
          const isVendor = spec?.startsWith('/vendor/');
          const file = !spec ? null : isVendor ? vendorFile(spec) : spec.startsWith('/') ? null : projectFile(spec);
          if (!file) { warn?.(`${pageFile} 的脚本 ${src} 找不到`); parts.push(m[0]); continue; }
          if (isVendor) vendorUsed.add(spec);
          const rest = dropAttr(attrs, 'src');
          if (isModule) parts.push(`<script${rest}>import ${JSON.stringify(moduleDataUrl(spec))};</script>`);
          else { if (!isVendor) inlined.add(spec); parts.push(`<script${rest}>${scriptSafe(readFileSync(file, 'utf8'))}</script>`); }
          continue;
        }
        if (!isJs) { parts.push(m[0]); continue; }
        parts.push(`<script${attrs}>${scriptSafe(isModule ? moduleSource(pageFile, body) : body.replace(IMPORT_MODULE_CALL, (all, head, quote, spec) => {
          const target = resolveFrom(pageFile, cleanRef(spec));
          if (!target || SKIP.test(spec) || (target.startsWith('/') && !target.startsWith('/vendor/'))) return all;
          return `${head}${quote}${moduleDataUrl(target)}${quote}`;
        }))}</script>`);
        continue;
      }
      const tag = m[4].toLowerCase();
      const raw = m[5];
      if (tag === 'link') {
        const rel = (getAttr(raw, 'rel') || '').toLowerCase().split(/\s+/);
        const href = getAttr(raw, 'href');
        if (rel.includes('stylesheet') && href && !SKIP.test(href.trim()) && !href.trim().startsWith('/')) {
          const target = resolveFrom(pageFile, cleanRef(href));
          const file = target && projectFile(target);
          if (file) { inlined.add(target); const media = getAttr(raw, 'media'); parts.push(`<style${media ? ` media="${media}"` : ''}>${styleSafe(css(target, readFileSync(file, 'utf8')))}</style>`); continue; }
          warn?.(`${pageFile} 的样式表 ${href} 找不到`);
        }
        // 图标、预加载等对放映没用的 link：去掉，避免任何外部请求
        if (!rel.includes('stylesheet')) { parts.push(''); continue; }
      }
      parts.push(`<${m[4]}${attributes(pageFile, tag, raw)}>`);
    }
    parts.push(html.slice(last));
    return parts.join('');
  }

  return {
    page,
    moduleDataUrl,
    vendorUsed,
    projectModules,
    inlined,
    vendorDataUrl: path => moduleDataUrl(path),
    vendorFile,
  };
}
