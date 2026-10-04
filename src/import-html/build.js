// 旧 HTML 导入 · 把分析结果写成项目：素材（位图压到显示尺寸 2 倍以内转 webp，矢量图存 .svg，截图存 .png）、
// 字体（能拿到文件的 @font-face 复制进 fonts/）、页面元素、每页「迁移说明」notes、import/ 里的原文件和 README.md。
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import sharp from 'sharp';
import { WEB_DEVICES, WEB_DEFAULT_ARTBOARD } from '../../web/project-kinds.js';

const hash = b => createHash('sha256').update(b).digest('hex');
const rid = (prefix, n = 12) => `${prefix}${randomUUID().replaceAll('-', '').slice(0, n)}`;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', '-apple-system', 'blinkmacsystemfont', 'math', 'emoji', 'fangsong']);

/** data: 地址、本地服务地址、抓网页时收到的图片 / 字体（resources）→ 字节；其他网络地址返回 null。 */
export function bytesOf(url, { srcDir, origin, resources }) {
  if (typeof url !== 'string') return null;
  if (resources?.has(url)) return resources.get(url);
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
const deviceLabel = d => WEB_DEVICES[d]?.label || d;
/** 跳过的网址 → 一行一条的中文说明。 */
export const skippedLines = skipped => (skipped || []).map(s => `${s.url}（${(s.devices || []).map(deviceLabel).join('、') || '全部'}）：${s.reason}`);

/**
 * 网页：把按 DOM 顺序排好的元素按「由外到内的分组编号」嵌成分组。只有一个子元素的分组去掉外壳，空分组不要；
 * 分组框 = 子元素框的并集，子元素坐标改成相对分组左上角，层级在每一层里从 1 往上排。
 */
export function nestGroups(entries, meta = {}) {
  const root = { children: [] }, nodes = new Map();
  for (const { el, groups = [] } of entries) {
    let parent = root, path = '';
    for (const gid of groups) {
      path += '/' + gid;
      let node = nodes.get(path);
      if (!node) { node = { gid, children: [] }; nodes.set(path, node); parent.children.push(node); }
      parent = node;
    }
    parent.children.push(el);
  }
  const make = node => {
    if (!node.gid) return node; // 元素
    const kids = node.children.map(make).filter(Boolean);
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const x = Math.min(...kids.map(k => k.x)), y = Math.min(...kids.map(k => k.y));
    const r = Math.max(...kids.map(k => k.x + k.width)), b = Math.max(...kids.map(k => k.y + k.height));
    kids.forEach((k, i) => { k.x = round1(k.x - x); k.y = round1(k.y - y); k.zIndex = i + 1; });
    const m = meta[node.gid] || {};
    return { id: rid('el_'), type: 'group', name: m.name || '分组', x: round1(x), y: round1(y), width: Math.max(1, round1(r - x)), height: Math.max(1, round1(b - y)), zIndex: 0, ...(m.origin?.selector ? { origin: m.origin } : {}), children: kids };
  };
  const out = root.children.map(make).filter(Boolean);
  out.forEach((k, i) => { k.zIndex = i + 1; });
  return out;
}
const round1 = v => Math.round(v * 10) / 10;
const countAll = list => list.reduce((n, e) => { const c = e.type === 'group' ? countAll(e.children) : { all: 0, groups: 0 }; return { all: n.all + 1 + c.all, groups: n.groups + (e.type === 'group' ? 1 : 0) + c.groups }; }, { all: 0, groups: 0 });

/** 写项目到 projectDir（临时目录）；返回 { project, summary }。不校验、不改名，交给调用方。 */
export async function buildProject({ analysis, srcDir, projectDir, id, name, preset, width, height, entry, files = [], startedAt = Date.now(), check = () => {} }) {
  const { origin, resources } = analysis, web = analysis.kind === 'web';
  for (const rel of ['assets', 'fonts', 'versions', 'import']) mkdirSync(join(projectDir, rel), { recursive: true });
  const now = new Date().toISOString();
  // ---------- 字体 ----------
  const fonts = [], fontKeys = new Map(), missing = new Set(), remoteFaces = new Set();
  for (const page of analysis.pages) {
    for (const family of page.fonts?.remote || []) missing.add(family);
    for (const face of page.fonts?.faces || []) {
      if (!face.family) continue;
      let bytes = null;
      for (const u of face.urls) { const b = bytesOf(u.url, { srcDir, origin, resources }); if (b && b.length > 12 && fontExt(b)) { bytes = b; break; } }
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
    const bytes = item.svg ? Buffer.from(item.svg, 'utf8') : bytesOf(item.src, { srcDir, origin, resources });
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
  let elementsTotal = 0, shotsTotal = 0, groupsTotal = 0; const shotReasons = new Map();
  const pages = analysis.pages.map((res, index) => {
    let elements = []; const shots = [], used = new Set(), entries = [];
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
      if (item.origin?.selector) el.origin = item.origin;
      if (item.role === 'background') { el.locked = true; bg.push(el); } else if (web) entries.push({ el, groups: item.groups }); else { el.zIndex = z++; elements.push(el); }
    }
    if (web) elements = nestGroups(entries, res.groups);
    bg.forEach((el, i) => { el.zIndex = i - bg.length; });
    const all = [...bg, ...elements];
    const counted = countAll(all);
    elementsTotal += counted.all; groupsTotal += counted.groups; shotsTotal += shots.length;
    const texts = res.items.filter(i => i.kind === 'text');
    const title = texts.filter(t => t.heading).sort((a, b) => a.heading - b.heading)[0] || [...texts].sort((a, b) => b.fontSize - a.fontSize)[0];
    let host = ''; try { host = new URL(res.url).hostname; } catch {}
    const pageName = web ? `${clean(res.title || title?.text || host || entry || '网页').slice(0, 30)} · ${deviceLabel(res.device)}` : clean(analysis.names?.[index] || title?.text || '').slice(0, 20) || `第 ${index + 1} 页`;
    // 迁移说明
    const c = res.clue, lines = web
      ? [`导入说明（网页导入，${now.slice(0, 10)}）`, `- 来源：${res.url ? `网址 ${res.url}${res.finalUrl && res.finalUrl !== res.url ? `（实际打开 ${res.finalUrl}）` : ''}` : `本地文件 import/${res.file || entry}`}`, `- 设备：${deviceLabel(res.device)}，窗口 ${WEB_DEVICES[res.device].width} × ${WEB_DEVICES[res.device].height}；整页高 ${res.height}`, '- 组件（导航栏、区块、卡片、按钮、列表项等）导入成分组；每个元素的 origin.selector 指向原网页里对应的元素']
      : [`迁移说明（旧 HTML 导入，${now.slice(0, 10)}）`, `- 分页方式：${analysis.label}；这是原文件的第 ${index + 1} / ${analysis.pages.length} 页`];
    if (web && res.truncated) lines.push(`- 原网页整页高 ${res.truncated}，超过上限 ${res.height}，下面的部分没有导入`);
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
    if (web && index === 0 && analysis.skipped?.length) lines.push(`- 跳过的网址：${skippedLines(analysis.skipped).join('；')}`);
    if (web) lines.push(res.url ? `- 导入时的网页快照：import/pages/${String(index + 1).padStart(2, '0')}-${res.device}.html；导入那一刻的项目：import/baseline.json` : `- 原文件：import/${entry}；导入那一刻的项目：import/baseline.json`, '- 原网页的动画、交互没有搬过来；需要时请按原网页的意图用新格式写 motion（不要搬旧代码）。');
    else lines.push(`- 原文件：import/${entry}`, '- 请按原 HTML 的动画意图用新格式重写 motion（不要搬旧代码）。');
    const page = { id: `page_i${String(index + 1).padStart(3, '0')}_${randomUUID().replaceAll('-', '').slice(0, 6)}`, name: pageName, notes: lines.join('\n'), background: res.bgGradient || res.background || '#ffffff', elements: all };
    if (web) Object.assign(page, { device: res.device, size: { width: WEB_DEVICES[res.device].width, height: res.height } });
    const capturedAt = res.capturedAt || now;
    page.origin = res.url ? { url: res.url, capturedAt } : { file: web ? (res.file || entry) : entry, capturedAt };
    return page;
  });
  const project = web
    ? { format: 'visual-workbench/project', formatVersion: 2, id, name, kind: 'web', ...(analysis.skipped?.length ? { description: `网页导入时跳过的网址：\n${skippedLines(analysis.skipped).join('\n')}` } : {}), createdAt: now, updatedAt: now, artboard: { ...WEB_DEFAULT_ARTBOARD }, assets, fonts, pages }
    : { format: 'visual-workbench/project', formatVersion: 2, id, name, createdAt: now, updatedAt: now, artboard: { preset, width, height }, assets, fonts, pages };
  const projectText = JSON.stringify(project, null, 2) + '\n';
  writeFileSync(join(projectDir, 'project.json'), projectText);
  // ---------- 原文件 ----------
  // 原文件逐字节复制；和工作台自己写的说明文件重名时，原文件改名（README.md 见下；baseline.json / source.json → 「-原文件」）
  const importDir = join(projectDir, 'import'), RESERVED = { 'baseline.json': 'baseline-原文件.json', 'source.json': 'source-原文件.json' };
  for (const rel of files) { const to = join(importDir, RESERVED[rel] || rel); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(srcDir, rel), to); }
  // 改动清单的「改前」基准：导入那一刻的 project.json
  writeFileSync(join(importDir, 'baseline.json'), projectText);
  if (analysis.source === 'urls') {
    const list = [];
    analysis.pages.forEach((res, i) => {
      const file = `pages/${String(i + 1).padStart(2, '0')}-${res.device}.html`;
      mkdirSync(join(importDir, 'pages'), { recursive: true }); writeFileSync(join(importDir, file), res.snapshot || '');
      list.push({ url: res.url, finalUrl: res.finalUrl, device: res.device, capturedAt: res.capturedAt, file: `import/${file}`, pageId: pages[i].id, height: res.height, ...(res.truncated ? { fullHeight: res.truncated } : {}) });
    });
    writeFileSync(join(importDir, 'source.json'), JSON.stringify({ source: 'urls', importedAt: now, urls: analysis.urls || [], devices: analysis.devices || [], pages: list, skipped: analysis.skipped || [] }, null, 2) + '\n');
  }
  const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
  const message = analysis.kind === 'fallback' ? (pages.length > 1 ? `没有识别出分页结构，按画板高度把整页切成了 ${pages.length} 页（保底办法），分页位置可能切断内容。` : '没有识别出分页结构（不是常见的幻灯片框架，也不是按屏滚动的页面），整份页面作为 1 页导入。') : '';
  const summary = { method: analysis.kind, methodLabel: analysis.label, pages: pages.length, elements: elementsTotal, shots: shotsTotal, shotReasons: Object.fromEntries(shotReasons), images: assets.length, fonts: fonts.length, missingFonts: [...missing], missingImages, seconds, message };
  if (web) Object.assign(summary, { kind: 'web', source: analysis.source, groups: groupsTotal, devices: { desktop: pages.filter(p => p.device === 'desktop').length, mobile: pages.filter(p => p.device === 'mobile').length }, skipped: analysis.skipped || [], truncated: analysis.pages.filter(p => p.truncated).map(p => ({ url: p.url || p.file, device: p.device, height: p.truncated })) });
  const readme = (web ? [
    '# 网页导入', '',
    analysis.source === 'urls' ? `- 网址：${(analysis.urls || []).join('、') || '无'}` : `- 入口文件：${entry}`, `- 导入时间：${now}`, `- 设备：${(analysis.devices || []).map(deviceLabel).join('、')}`, `- 页数：${pages.length}；分组：${groupsTotal}；元素：${elementsTotal}；截图块：${shotsTotal}`,
    ...(summary.skipped.length ? ['- 跳过的网址：', ...skippedLines(summary.skipped).map(l => `  - ${l}`)] : []), '',
    analysis.source === 'urls' ? '这个文件夹里 pages/ 是导入时的网页快照（只读参考），source.json 记录网址、设备、时间和跳过的网址。抓取全程只读：只发 GET 请求，不提交表单、不登录、不点击，原网站不受影响。' : '这个文件夹是导入时复制的原文件（文件名不变），原来的文件没有被修改。',
    'baseline.json 是导入那一刻的 project.json，用来对照之后改了什么。', '',
  ] : [
    '# 旧 HTML 导入', '',
    `- 入口文件：${entry}`, `- 导入时间：${now}`, `- 分页方式：${analysis.label}`, `- 页数：${pages.length}；元素：${elementsTotal}；截图块：${shotsTotal}`,
    ...(summary.missingFonts.length ? [`- 缺失字体：${summary.missingFonts.join('、')}`] : []), ...(message ? [`- 说明：${message}`] : []), '',
    '这个文件夹是导入时复制的原文件（文件名不变），原来的文件没有被修改。项目里每页的 notes 是迁移说明；原来的动画没有搬过来，请按原 HTML 的动画意图用新格式重写 motion，不要搬旧代码。', '',
  ]).join('\n');
  writeFileSync(join(importDir, files.includes('README.md') ? 'README-导入说明.md' : 'README.md'), readme);
  return { project, summary };
}
