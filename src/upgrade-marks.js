// 旧项目标记自动升级（第 13 轮）：按第 2 版规则只补 data-vw 标记，不动设计。
// 第 2 版规则：文字 text move resize color（原有的其他能力保留）；图片 <img> move resize crop；纯色色块 move resize background；
// 整页背景（html、body、或盒子 ≥ 页面宽高 95% 的块）只 background。project.json 的 marksRule 记规则版本，≥ 2 不再升级。
// 做法：先自动存版；后台浏览器（不跑页面脚本，视口 = 画板）量盒子和计算样式，Node 只在源码文本上改 / 插属性，
// 不重新序列化文档（设计、格式、空白原样）。找不到浏览器时只做不用量尺寸的部分（文字 / 图片 / move 补能力）。
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveVersion } from './version.js';

export const MARKS_RULE = 2;
const NOTE = '按新规则补标记前自动存版';
const ORDER = ['text', 'move', 'resize', 'color', 'background', 'crop'];
const RAW = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const DEVICES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

// ---------- 源码扫描：所有开始标签（跳过注释、原始文本元素的内容） ----------
export function scanTags(src) {
  const tags = []; const n = src.length; let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i); if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(src.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const name = m[1].toLowerCase(); let p = lt + m[0].length; const attrs = [];
    // 属性：name[=value]
    for (;;) {
      while (p < n && /[\s/]/.test(src[p])) { if (src[p] === '/' && src[p + 1] === '>') break; p++; }
      if (p >= n || src[p] === '>' || (src[p] === '/' && src[p + 1] === '>')) break;
      const an = /^[^\s/>=][^\s/>=]*/.exec(src.slice(p, p + 256)); if (!an) { p++; continue; }
      const a = { name: an[0].toLowerCase(), start: p, value: null }; p += an[0].length;
      let q = p; while (q < n && /\s/.test(src[q])) q++;
      if (src[q] === '=') {
        q++; while (q < n && /\s/.test(src[q])) q++;
        if (src[q] === '"' || src[q] === "'") { const e = src.indexOf(src[q], q + 1); const end = e < 0 ? n : e; a.vs = q + 1; a.ve = end; a.quote = src[q]; p = Math.min(n, end + 1); }
        else { const vm = /^[^\s>]*/.exec(src.slice(q)); a.vs = q; a.ve = q + vm[0].length; a.quote = ''; p = a.ve; }
        a.value = src.slice(a.vs, a.ve);
      }
      a.end = p; attrs.push(a);
    }
    tags.push({ name, start: lt, insertAt: p, attrs }); // 插入点：'>' 或 '/>' 之前
    i = (src.indexOf('>', p) + 1) || n;
    if (RAW.has(name)) { const re = new RegExp(`</${name}[\\s>/]`, 'ig'); re.lastIndex = i; const e = re.exec(src); i = e ? e.index : n; }
  }
  return tags;
}
const attrOf = (tag, name) => tag.attrs.find(a => a.name === name);

/** 已有标记的升级：返回新的能力字符串，不用改返回 null。info：浏览器量的 { big }（没量到为 undefined）。 */
export function upgradeCaps(value, tagName, info) {
  const caps = String(value || '').split(/\s+/).filter(Boolean); const set = new Set(caps);
  if (set.has('text')) { set.add('move'); set.add('resize'); }
  else if (tagName === 'img') { if (!set.size) return null; set.add('move'); set.add('resize'); set.add('crop'); }
  else if (set.has('move') && !set.has('resize')) set.add('resize');
  else if (set.has('background') && !set.has('move') && !set.has('resize') && tagName !== 'html' && tagName !== 'body' && info && info.big === false) { set.add('move'); set.add('resize'); }
  const out = [...ORDER.filter(c => set.has(c)), ...[...set].filter(c => !ORDER.includes(c))].join(' ');
  return sameSet(caps, set) ? null : out;
}
const sameSet = (caps, set) => caps.length === set.size && caps.every(c => set.has(c));

/** 在源码上改一页：measure 是浏览器量的结果（可没有）。返回 { html, changed, stats }。 */
export function upgradeSource(src, measure, usedIds = new Set()) {
  const tags = scanTags(src); const patches = []; const stats = { upgraded: 0, added: 0 };
  const big = new Map((measure?.marks || []).map(m => [m.id, m.big]));
  for (const t of tags) {
    const idA = attrOf(t, 'data-vw-id'), capA = attrOf(t, 'data-vw');
    if (!idA || !capA || capA.value === null) continue;
    usedIds.add(idA.value);
    const next = upgradeCaps(capA.value, t.name, big.has(idA.value) ? { big: big.get(idA.value) } : undefined);
    if (next === null) continue;
    patches.push({ at: capA.start, end: capA.end, text: `data-vw="${next}"` }); stats.upgraded++;
  }
  for (const t of tags) { const a = attrOf(t, 'data-vw-id'); if (a?.value) usedIds.add(a.value); }
  if (measure?.blocks?.length) {
    const byName = new Map(); for (const t of tags) { if (!byName.has(t.name)) byName.set(t.name, []); byName.get(t.name).push(t); }
    let k = 0; const nextId = () => { let id; do id = `b${++k}`; while (usedIds.has(id)); usedIds.add(id); return id; };
    for (const b of measure.blocks) {
      const t = byName.get(b.tag)?.[b.ord]; if (!t) continue;
      const v = name => { const a = attrOf(t, name); return a ? (a.value ?? '') : null; };
      if (v('id') !== b.id || v('class') !== b.cls || attrOf(t, 'data-vw-id') || attrOf(t, 'data-vw')) continue; // 对不上就跳过
      patches.push({ at: t.insertAt, end: t.insertAt, text: ` data-vw-id="${nextId()}" data-vw="move resize background"` }); stats.added++;
    }
  }
  if (!patches.length) return { html: src, changed: false, stats };
  patches.sort((a, b) => b.at - a.at);
  let html = src; for (const p of patches) html = html.slice(0, p.at) + p.text + html.slice(p.end);
  return { html, changed: true, stats };
}

// ---------- 浏览器里量（不跑页面脚本；evaluate 由 Playwright 执行） ----------
function measureInPage({ width, height, web }) {
  const st = document.createElement('style'); st.textContent = web ? `html,body{margin:0;width:${width}px}` : `html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}`;
  document.head.prepend(st);
  const pageW = width, pageH = web ? Math.max(height, document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : height;
  const ords = new Map(), counter = new Map();
  for (const el of document.querySelectorAll('*')) { if (el === st) continue; const n = el.localName.toLowerCase(); const c = counter.get(n) || 0; ords.set(el, c); counter.set(n, c + 1); }
  const isBig = el => { const r = el.getBoundingClientRect(); return r.width >= pageW * 0.95 && r.height >= pageH * 0.95; };
  const marks = [...document.querySelectorAll('[data-vw-id]')].map(el => ({ id: el.getAttribute('data-vw-id'), big: isBig(el) }));
  const NEVER = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'OBJECT', 'CANVAS', 'VIDEO', 'AUDIO', 'HEAD']);
  const NOT_BLOCK = new Set(['IMG', 'PICTURE', 'EMBED', 'INPUT', 'LINK', 'META', 'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM', 'AREA', 'MAP', 'BASE', 'TITLE', 'TBODY', 'COLGROUP']);
  const clearColor = c => !c || c === 'transparent' || /,\s*0(\.0+)?\s*\)$/.test(c) || /\/\s*0(\.0+)?%?\s*\)$/.test(c);
  const colorBg = s => { const img = s.backgroundImage || 'none'; if (/url\(/i.test(img)) return false; return !clearColor(s.backgroundColor) || /gradient\(/i.test(img); };
  const directText = el => [...el.childNodes].some(n => n.nodeType === 3 && /\S/.test(n.nodeValue));
  const blocks = [];
  if (!document.querySelector('template') && document.body) {
    const walk = el => { for (const c of [...el.children]) {
      const tag = c.tagName.toUpperCase(); if (NEVER.has(tag) || NOT_BLOCK.has(tag) || c.hasAttribute('data-vw-id')) continue;
      const s = getComputedStyle(c), r = c.getBoundingClientRect();
      if (colorBg(s) && s.display !== 'none' && s.visibility !== 'hidden' && !directText(c) && r.width >= 2 && r.height >= 2 && !isBig(c))
        blocks.push({ tag: c.localName.toLowerCase(), ord: ords.get(c), id: c.getAttribute('id'), cls: c.getAttribute('class') });
      walk(c);
    } };
    walk(document.body);
  }
  st.remove();
  return { marks, blocks };
}

// 可能有色块：<body> 里有元素、源码里出现底色
function mayHaveBlocks(src) {
  if (!/background|bgcolor/i.test(src)) return false;
  const tags = scanTags(src); const body = tags.findIndex(t => t.name === 'body');
  return tags.slice(body + 1).some(t => !['script', 'style', 'link', 'meta', 'template', 'noscript', 'br'].includes(t.name));
}
function writeAtomic(file, data) { const tmp = join(dirname(file), `.upgrade-${randomUUID()}.tmp`); try { writeFileSync(tmp, data, { flag: 'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); } }
const needsUpgrade = p => p && p.formatVersion !== 2 && !(Number.isInteger(p.marksRule) && p.marksRule >= MARKS_RULE);

/**
 * 升级一个项目的标记。marksRule ≥ 2 或旧格式（v2）→ { upgraded:false }。
 * 成功 → { upgraded:true, pages:[改过的页面文件], stats, measured }；measured=false 表示没找到浏览器，只补了不用量尺寸的部分。
 * launch：测试可注入（默认 src/browser.js 的 launchBrowser）。
 */
export async function upgradeProjectMarks({ projectDir, launch } = {}) {
  const projectFile = join(projectDir, 'project.json');
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  if (!needsUpgrade(project)) return { upgraded: false };
  // 先不开浏览器看一遍：没有要补的能力、也没有可能是色块的元素（如工作台新建的空白页）→ 什么都不写，打开项目不产生改动
  const pages = [];
  for (const page of (project.pages || []).filter(p => !p.draft && typeof p.file === 'string')) {
    let src; try { src = readFileSync(join(projectDir, page.file), 'utf8'); } catch { continue; }
    pages.push({ page, src, measure: mayHaveBlocks(src), caps: upgradeSource(src, null).changed });
  }
  if (!pages.some(p => p.measure || p.caps)) return { upgraded: false };
  saveVersion({ projectDir, note: NOTE, by: 'agent', auto: 'marks-v2' });
  const out = { upgraded: true, pages: [], stats: { upgraded: 0, added: 0 }, measured: false };
  let browser = null, context = null, server = null, origin = '';
  try {
    if (pages.some(p => p.measure)) {
      try {
        if (!launch) ({ launchBrowser: launch } = await import('./browser.js'));
        browser = await launch();
        const { startStatic } = await import('./import-html/analyze.js');
        ({ server, origin } = await startStatic(projectDir));
        context = await browser.newContext({ javaScriptEnabled: false, deviceScaleFactor: 1 });
        await context.route('**/*', route => { const r = route.request(); return r.method() === 'GET' && r.url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient'); });
        out.measured = true;
      } catch (e) { browser?.close().catch(() => {}); browser = null; context = null; console.warn(`[upgrade-marks] 没有可用的浏览器，只补文字 / 图片 / 移动的能力：${e.message || e}`); }
    }
    for (const { page, src, measure: needMeasure } of pages) {
      const file = join(projectDir, page.file);
      let measure = null;
      if (context && needMeasure) {
        const web = project.kind === 'web';
        const size = web ? (DEVICES[page.device] || DEVICES.desktop) : { width: Number(project.artboard?.width) || 1920, height: Number(project.artboard?.height) || 1080 };
        const tab = await context.newPage();
        try {
          await tab.setViewportSize(size);
          await tab.goto(origin + '/' + page.file.split('/').map(encodeURIComponent).join('/'), { waitUntil: 'load', timeout: 30000 }).catch(() => {});
          await tab.evaluate(() => document.fonts?.ready && Promise.race([document.fonts.ready, new Promise(ok => setTimeout(ok, 3000))])).catch(() => {});
          measure = await tab.evaluate(measureInPage, { ...size, web });
        } catch (e) { console.warn(`[upgrade-marks] ${page.file} 量不了，只补不用量尺寸的部分：${e.message || e}`); }
        finally { await tab.close().catch(() => {}); }
      }
      const used = new Set((page.edits || []).map(e => e?.target).filter(Boolean));
      const res = upgradeSource(src, measure, used);
      out.stats.upgraded += res.stats.upgraded; out.stats.added += res.stats.added;
      if (res.changed) { writeAtomic(file, res.html); out.pages.push(page.file); }
    }
  } finally {
    await browser?.close().catch(() => {});
    if (server) await new Promise(ok => server.close(ok));
  }
  // project.json：重新读（期间可能被改过），只加 marksRule，其他字段原样
  const fresh = JSON.parse(readFileSync(projectFile, 'utf8'));
  writeAtomic(projectFile, `${JSON.stringify({ ...fresh, marksRule: MARKS_RULE }, null, 2)}\n`);
  return out;
}
