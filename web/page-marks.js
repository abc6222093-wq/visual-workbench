// 页面文件的扫描（第 12 轮）：不依赖 DOM，浏览器和 Node 共用。
// 1) 标记：data-vw-id / data-vw（docs/format.md §4.2）；2) 相对资源引用（§5）。正则扫描，够校验和复制页面用。
import { MARK_ID, CAPS } from './edits-model.js';

// 属性值里可以有 >（例如 data-vw-origin="main > h1"），所以引号内的内容整段吞掉
const TAG = /<([a-zA-Z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
function attrsOf(raw) {
  const out = {};
  for (const m of raw.matchAll(ATTR)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}
const decode = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * 扫出所有 data-vw-id。返回 { marks: Map(id → caps[]), items: [{ id, caps, tag, origin }], duplicates: [id], invalidIds: [id], invalidCaps: [{ id, cap }] }
 */
export function scanMarks(html) {
  const marks = new Map(), items = [], duplicates = [], invalidIds = [], invalidCaps = [];
  const text = stripComments(String(html || ''));
  for (const m of text.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    const attrs = attrsOf(m[2]);
    if (!('data-vw-id' in attrs)) continue;
    const id = decode(attrs['data-vw-id']).trim();
    const caps = decode(attrs['data-vw'] || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!MARK_ID.test(id)) { invalidIds.push(id); continue; }
    for (const cap of caps) if (!CAPS.includes(cap)) invalidCaps.push({ id, cap });
    const valid = caps.filter(c => CAPS.includes(c));
    if (marks.has(id)) { duplicates.push(id); continue; }
    marks.set(id, valid);
    items.push({ id, caps: valid, tag, origin: attrs['data-vw-origin'] ? decode(attrs['data-vw-origin']) : null });
  }
  return { marks, items, duplicates, invalidIds, invalidCaps };
}

function stripComments(html) { return html.replace(/<!--[\s\S]*?-->/g, ''); }

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i; // 协议、协议相对、锚点、根路径（/vendor/…）都不是项目内相对路径
const isRelative = ref => !!ref && !SKIP.test(ref);
const clean = ref => decode(ref).trim().split(/[?#]/)[0];

/** 扫出页面引用的相对路径（按书写原样，相对页面文件）：src / href / poster / srcset、style 与 <style> 里的 url()、模块脚本的 import。 */
export function scanResources(html) {
  const refs = new Set();
  const text = stripComments(String(html || ''));
  for (const m of text.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attrs = attrsOf(m[2]);
    for (const name of ['src', 'href', 'poster', 'data-src']) {
      if (!(name in attrs)) continue;
      if (tag === 'a' && name === 'href') continue;
      const ref = clean(attrs[name]);
      if (isRelative(ref)) refs.add(ref);
    }
    if (attrs.srcset) for (const part of decode(attrs.srcset).split(',')) { const ref = clean(part.trim().split(/\s+/)[0]); if (isRelative(ref)) refs.add(ref); }
    if (attrs.style) for (const ref of cssUrls(decode(attrs.style))) refs.add(ref);
  }
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) for (const ref of cssUrls(m[1])) refs.add(ref);
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type\s*=\s*["']?module/i.test(m[1])) continue;
    for (const ref of moduleImports(m[2])) refs.add(ref);
  }
  return [...refs];
}

export function cssUrls(css) {
  const out = [];
  for (const m of String(css).matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) { const ref = clean(m[1] ?? m[2] ?? m[3] ?? ''); if (isRelative(ref)) out.push(ref); }
  for (const m of String(css).matchAll(/@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)')/g)) { const ref = clean(m[1] ?? m[2] ?? ''); if (isRelative(ref)) out.push(ref); }
  return out;
}

export const IMPORT_PATTERN = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])((?:\.{1,2})\/[^"'\s]*)\2/g;
export function moduleImports(source) {
  const out = [];
  for (const m of String(source).matchAll(IMPORT_PATTERN)) { const ref = clean(m[3]); if (isRelative(ref)) out.push(ref); }
  return out;
}

/** 把页面里的相对引用换算成相对项目根的 posix 路径；越出项目根返回 null。 */
export function resolvePageRef(pageFile, ref) {
  const dir = String(pageFile).split('/').slice(0, -1);
  const parts = [...dir];
  for (const seg of String(ref).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** 页面文件相对项目根 → 从页面指向项目根下某文件的相对路径（复制页面、导入写页面时用）。 */
export function refFromPage(pageFile, projectRelative) {
  const depth = String(pageFile).split('/').length - 1;
  return `${'../'.repeat(depth)}${projectRelative}`;
}
