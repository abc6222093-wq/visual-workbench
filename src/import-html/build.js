// 旧 HTML 导入 · 把分析结果写成项目：素材（位图压到显示尺寸 2 倍以内转 webp，矢量图存 .svg，截图存 .png）、
// 字体（能拿到文件的 @font-face 复制进 fonts/）、页面元素、每页「迁移说明」notes、import/ 里的原文件和 README.md。
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import sharp from 'sharp';

const hash = b => createHash('sha256').update(b).digest('hex');
const rid = (prefix, n = 12) => `${prefix}${randomUUID().replaceAll('-', '').slice(0, n)}`;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'math', 'emoji', 'fangsong']);

/** data: 地址、本地服务地址 → 字节；网络地址返回 null。 */
export function bytesOf(url, { srcDir, origin }) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('data:')) {
    const m = /^data:([^,]*?),(.*)$/s.exec(url); if (!m) return null;
    try { return /;base64$/i.test(m[1]) ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf8'); } catch { return null; }
  }
  if (origin && url.startsWith(origin + '/')) {
    let path; try { path = decodeURIComponent(new URL(url).pathname); } catch { return null; }
    const root = resolve(srcDir), file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
    return readFileSync(file);
  }
  return null;
}
const isRemote = (url, origin) => /^https?:\/\//i.test(url) && !(origin && url.startsWith(origin + '/'));
function fontExt(b) {
  const sig = b.subarray(0, 4).toString('latin1');
  if (sig === 'wOF2') return '.woff2'; if (sig === 'wOFF') return '.woff'; if (sig === 'OTTO') return '.otf';
  if (sig === 'true' || b.readUInt32BE(0) === 0x00010000) return '.ttf';
  return null;
}
function fontWeight(w) {
  const parts = String(w || '400').trim().split(/\s+/);
  if (parts.length > 1) return 'variable';
  const n = parts[0] === 'bold' ? 700 : parts[0] === 'normal' ? 400 : Number(parts[0]);
  return Number.isFinite(n) ? Math.max(100, Math.min(900, Math.round(n / 100) * 100)) : 400;
}
// SVG 只收纯图形；带脚本、事件、外链等的改成位图
function safeSvg(text) { return /<svg[\s>]/i.test(text) && !/<script|<foreignObject|[\s"'/]on[a-z]+\s*=|javascript\s*:|<!ENTITY/i.test(text) && !/href\s*=\s*["']?\s*(?:https?:)?\/\//i.test(text); }
function svgSize(text) {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] || ''; const attr = n => new RegExp(`\\s${n}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i').exec(root)?.[1];
  const w = Math.round(Number(attr('width'))), h = Math.round(Number(attr('height')));
  return w >= 1 && h >= 1 ? { width: w, height: h } : {};
}
const pngSize = b => (b.length > 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : {});
const clean = s => String(s).replace(/\s+/g, ' ').trim();
const fileSafe = s => String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'font';
const describe = list => list.map(({ name, count }) => `${name} ×${count}`).join('、');

/** 写项目到 projectDir（临时目录）；返回 { project, summary }。不校验、不改名，交给调用方。 */
export async function buildProject({ analysis, srcDir, projectDir, id, name, preset, width, height, entry, files, startedAt = Date.now(), check = () => {} }) {
  const { origin } = analysis;
  for (const rel of ['assets', 'fonts', 'versions', 'import']) mkdirSync(join(projectDir, rel), { recursive: true });
  const now = new Date().toISOString();
  // ---------- 字体 ----------
  const fonts = [], fontKeys = new Map(), missing = new Set(), remoteFaces = new Set();
  for (const page of analysis.pages) {
    for (const family of page.fonts?.remote || []) missing.add(family);
    for (const face of page.fonts?.faces || []) {
      if (!face.family) continue;
      let bytes = null;
      for (const u of face.urls) { const b = bytesOf(u.url, { srcDir, origin }); if (b && b.length > 12 && fontExt(b)) { bytes = b; break; } }
      if (!bytes) { if (face.urls.some(u => isRemote(u.url, origin))) { missing.add(face.family); remoteFaces.add(face.family); } continue; }
      const weight = fontWeight(face.weight), style = /italic|oblique/.test(face.style) ? 'italic' : 'normal';
      const key = `${face.family.toLowerCase()}|${weight}|${style}|${hash(bytes)}`;
      const partial = !!face.range && !/^U\+0+-10FFFF$/i.test(face.range.trim());
      if (fontKeys.has(key)) { (page.fontIds ||= []).push({ id: fontKeys.get(key), partial }); continue; }
      const fid = rid('font_', 10), file = `fonts/${fileSafe(face.family)}-${weight}${style === 'italic' ? '-italic' : ''}-${fid.slice(5, 11)}${fontExt(bytes)}`;
      writeFileSync(join(projectDir, file), bytes);
      fontKeys.set(key, fid); fonts.push({ id: fid, family: face.family, file, weight, style }); (page.fontIds ||= []).push({ id: fid, partial });
    }
  }
  for (const f of fonts) missing.delete(f.family);
  // 同名字体有多份（各页各自的子集）时，优先用这一页 @font-face 里登记的、不带 unicode-range 的那份
  const fontFor = (family, weight, page) => {
    const all = fonts.filter(f => f.family.toLowerCase() === String(family || '').toLowerCase()); if (!all.length) return null;
    const mine = page?.fontIds || [], pick = ids => all.filter(f => ids.some(x => x.id === f.id));
    const full = pick(mine.filter(x => !x.partial)), list = full.length ? full : pick(mine).length ? pick(mine) : all;
    return (list.find(f => f.weight === 'variable') || list.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a))).id;
  };
  // ---------- 图片 ----------
  const sources = new Map(); let missingImages = 0;
  for (const page of analysis.pages) for (const item of page.items) {
    if (item.kind !== 'image') continue;
    const bytes = item.svg ? Buffer.from(item.svg, 'utf8') : bytesOf(item.src, { srcDir, origin });
    if (!bytes?.length) { item.skip = true; missingImages++; page.missing = [...(page.missing || []), String(item.src || '').slice(0, 160)]; continue; }
    const key = hash(bytes); item.key = key;
    const s = sources.get(key) || { bytes, w: 1, h: 1, name: item.name }; s.w = Math.max(s.w, item.width); s.h = Math.max(s.h, item.height); sources.set(key, s);
  }
  const assets = [], assetOf = new Map();
  for (const [key, s] of sources) {
    check();
    const text = s.bytes.subarray(0, 4096).toString('utf8');
    let data, ext, size = {};
    try {
      if (/<svg[\s>]/i.test(text) && safeSvg(s.bytes.toString('utf8'))) { data = s.bytes; ext = '.svg'; size = svgSize(s.bytes.toString('utf8')); if (!size.width) size = { width: Math.max(1, Math.round(s.w)), height: Math.max(1, Math.round(s.h)) }; }
      else {
        const out = await sharp(s.bytes, { animated: false, limitInputPixels: 268402689 }).rotate().resize({ width: Math.max(1, Math.ceil(s.w * 2)), height: Math.max(1, Math.ceil(s.h * 2)), fit: 'outside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer({ resolveWithObject: true });
        data = out.data; ext = '.webp'; size = { width: out.info.width, height: out.info.height };
      }
    } catch { missingImages++; continue; }
    const aid = rid('asset_'), file = `assets/${aid.slice(6)}${ext}`;
    writeFileSync(join(projectDir, file), data);
    assets.push({ id: aid, kind: 'image', file, name: clean(s.name || '图片').slice(0, 60) || '图片', ...size, pendingLayout: false, addedAt: now, source: { type: 'upload' } });
    assetOf.set(key, aid);
  }
  // ---------- 页面 ----------
  let elementsTotal = 0, shotsTotal = 0; const shotReasons = new Map();
  const pages = analysis.pages.map((res, index) => {
    const elements = [], shots = [], used = new Set();
    let z = 1; const bg = [];
    for (const item of res.items) {
      const geo = { x: item.x, y: item.y, width: Math.max(1, item.width), height: Math.max(1, item.height), ...(item.rotation ? { rotation: item.rotation } : {}) };
      const op = item.opacity !== undefined && item.opacity < 0.999 ? { opacity: Math.max(0, Math.round(item.opacity * 1000) / 1000) } : {};
      let el = null;
      if (item.kind === 'text') {
        used.add(item.family);
        el = { id: rid('el_'), type: 'text', name: clean(item.text).slice(0, 12) || '文字', ...geo, ...op, text: item.text, font: fontFor(item.family, item.fontWeight, res), fontSize: Math.max(1, item.fontSize), fontWeight: item.fontWeight, lineHeight: item.lineHeight, letterSpacing: item.letterSpacing, align: item.align, color: item.color, stroke: item.stroke, shadow: item.shadow };
      } else if (item.kind === 'image') {
        if (item.skip || !assetOf.has(item.key)) continue;
        el = { id: rid('el_'), type: 'image', name: clean(item.name || '图片').slice(0, 30), ...geo, ...op, asset: assetOf.get(item.key), fit: item.fit || 'cover' };
      } else if (item.kind === 'shape') {
        el = { id: rid('el_'), type: 'shape', name: item.name || '色块', ...geo, ...op, shape: 'rect', fill: item.fill, stroke: item.stroke, ...(item.radius > 0 ? { cornerRadius: item.radius } : {}) };
      } else if (item.kind === 'shot') {
        if (!item.png) continue;
        const aid = rid('asset_'), file = `assets/${aid.slice(6)}.png`;
        writeFileSync(join(projectDir, file), item.png);
        const label = item.role === 'background' ? '背景' : item.reason;
        assets.push({ id: aid, kind: 'image', file, name: `[截图] 第 ${index + 1} 页 ${label}`, ...pngSize(item.png), pendingLayout: false, addedAt: now, source: { type: 'upload' } });
        el = { id: rid('el_'), type: 'image', name: item.role === 'background' ? '[截图] 背景' : (item.name?.startsWith('[截图]') ? item.name : `[截图] ${item.reason}`), ...geo, asset: aid, fit: 'fill' };
        if (item.role !== 'background') { shots.push(item.reason); shotReasons.set(item.reason, (shotReasons.get(item.reason) || 0) + 1); }
      }
      if (!el) continue;
      if (item.effects && Object.keys(item.effects).length) el.effects = item.effects;
      if (item.tint && el.type === 'image') el.tint = item.tint;
      if (item.locked && el.type !== 'text') el.locked = true;
      if (item.role === 'background') { el.locked = true; bg.push(el); } else { el.zIndex = z++; elements.push(el); }
    }
    bg.forEach((el, i) => { el.zIndex = i - bg.length; });
    const all = [...bg, ...elements];
    elementsTotal += all.length; shotsTotal += shots.length;
    const texts = res.items.filter(i => i.kind === 'text');
    const title = texts.filter(t => t.heading).sort((a, b) => a.heading - b.heading)[0] || [...texts].sort((a, b) => b.fontSize - a.fontSize)[0];
    const pageName = clean(analysis.names?.[index] || title?.text || '').slice(0, 20) || `第 ${index + 1} 页`;
    // 迁移说明
    const c = res.clue, lines = [`迁移说明（旧 HTML 导入，${now.slice(0, 10)}）`, `- 分页方式：${analysis.label}；这是原文件的第 ${index + 1} / ${analysis.pages.length} 页`];
    if (c) {
      lines.push(`- 原动画（播完后取的最后画面）：${c.running.length ? describe(c.running) : '没有观察到正在运行的 CSS 动画或过渡'}`);
      if (c.keyframes.length) lines.push(`- 样式表里定义的关键帧：${c.keyframes.slice(0, 20).join('、')}`);
      if (c.libs.length || c.scripts.length) lines.push(`- 动画库 / 脚本：${[...c.libs, ...c.scripts.filter(s => !c.libs.some(l => s.toLowerCase().includes(l.toLowerCase())))].slice(0, 15).join('、')}`);
      if (c.attrs.length || c.fragments) lines.push(`- 分步线索：${[...(c.fragments ? [`.fragment ×${c.fragments}`] : []), ...c.attrs.map(a => `${a.name} ×${a.count}`)].join('、')}`);
    }
    if (shots.length) lines.push(`- 截成图片的块（名字带「[截图]」）：${describe([...shots.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map())].map(([name, count]) => ({ name, count })))}`);
    const pageMissing = [...used].filter(f => missing.has(f));
    if (pageMissing.length) lines.push(`- 缺失字体（网络字体，没有下载，文字暂用系统默认字体）：${pageMissing.join('、')}`);
    const unregistered = [...used].filter(f => f && !missing.has(f) && !GENERIC.has(f.toLowerCase()) && !fonts.some(x => x.family.toLowerCase() === f.toLowerCase()));
    if (unregistered.length) lines.push(`- 用到但没有内嵌文件的字体（暂用系统默认字体）：${unregistered.join('、')}`);
    if (res.missing?.length) lines.push(`- 没有取到的图片（网络地址或文件不存在，没有导入）：${[...new Set(res.missing)].slice(0, 10).join('、')}`);
    if (res.limited) lines.push(`- 元素超过每页 300 个的上限，剩下的 ${res.limited} 个块合成一张截图`);
    if (res.error) lines.push(`- 这一页分析失败（${res.error}），整页截成了一张图`);
    lines.push(`- 原文件：import/${entry}`, '- 请按原 HTML 的动画意图用新格式重写 motion（不要搬旧代码）。');
    const page = { id: `page_i${String(index + 1).padStart(3, '0')}_${randomUUID().replaceAll('-', '').slice(0, 6)}`, name: pageName, notes: lines.join('\n'), background: res.bgGradient || res.background || '#ffffff', elements: all };
    return page;
  });
  const project = { format: 'visual-workbench/project', formatVersion: 2, id, name, createdAt: now, updatedAt: now, artboard: { preset, width, height }, assets, fonts, pages };
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  // ---------- 原文件 ----------
  const importDir = join(projectDir, 'import');
  for (const rel of files) { const to = join(importDir, rel); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(srcDir, rel), to); }
  const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
  const message = analysis.kind === 'fallback' ? (pages.length > 1 ? `没有识别出分页结构，按画板高度把整页切成了 ${pages.length} 页（保底办法），分页位置可能切断内容。` : '没有识别出分页结构（不是常见的幻灯片框架，也不是按屏滚动的页面），整份页面作为 1 页导入。') : '';
  const summary = { method: analysis.kind, methodLabel: analysis.label, pages: pages.length, elements: elementsTotal, shots: shotsTotal, shotReasons: Object.fromEntries(shotReasons), images: assets.length, fonts: fonts.length, missingFonts: [...missing], missingImages, seconds, message };
  const readme = [
    '# 旧 HTML 导入', '',
    `- 入口文件：${entry}`, `- 导入时间：${now}`, `- 分页方式：${analysis.label}`, `- 页数：${pages.length}；元素：${elementsTotal}；截图块：${shotsTotal}`,
    ...(summary.missingFonts.length ? [`- 缺失字体：${summary.missingFonts.join('、')}`] : []), ...(message ? [`- 说明：${message}`] : []), '',
    '这个文件夹是导入时复制的原文件（文件名不变），原来的文件没有被修改。项目里每页的 notes 是迁移说明；原来的动画没有搬过来，请按原 HTML 的动画意图用新格式重写 motion，不要搬旧代码。', '',
  ].join('\n');
  writeFileSync(join(importDir, files.includes('README.md') ? 'README-导入说明.md' : 'README.md'), readme);
  return { project, summary };
}
