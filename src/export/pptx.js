// 导出 PPTX（第 15 轮）：两种做法，都是逐页用 captureProject 截图（动效播完、修改单已叠上的最后一帧）。
// - image（图片版）：每页一张高清 PNG 铺满幻灯片，看起来和原稿一样，不能改字。
// - editable（可改字版）：截图前在页面 iframe 里量出可改文字（[data-vw-id] 且能力含 text、看得见），
//   把这些文字变透明（只藏字，元素自己的底色、边框留着）再截图当背景；每段文字变成 PowerPoint 真正的文本框。
//   旋转 / 倾斜、渐变字（background-clip:text）、描边字、竖排的文字不挖，留在背景图里，warnings 里列出。
// 幻灯片尺寸：页面 px / 96 = 英寸（1920×1080 → 20×11.25 in）。pptxgenjs 一个文件只能有一种幻灯片尺寸：
// 取各页最大宽、最大高；尺寸不同的页按比例缩小放在左上角（warnings 说明）。PowerPoint 上限 56 in，超出整体等比缩小。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { brotliDecompressSync, inflateSync } from 'node:zlib';
import PptxGenJS from 'pptxgenjs';
import { captureProject } from './images.js';
import { pageSize } from '../../web/project-kinds.js';

const PX_PER_IN = 96, PT_PER_PX = 0.75, MAX_IN = 56;
const cancelledError = () => Object.assign(new Error('已取消导出'), { cancelled: true });

// 在页面 iframe 里运行：量文字、藏文字。返回 { items: [...], skipped: [{ id, reason }] }
function collectInFrame() {
  const HIDE = 'data-vw-pptx-hide';
  const rgba = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { hex: p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''), a: p.length > 3 ? p[3] : 1 }; };
  // 第一个具体字体名；serif / sans-serif 这类通用名 PowerPoint 认不出，跳过
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|emoji|math|fangsong|inherit|initial)$/i;
  // 只有通用名时换成两种系统都有的常见字体（中日文 PowerPoint 会自动配同类的黑体 / 明朝体）
  const GENERIC_FACE = { serif: 'Times New Roman', monospace: 'Courier New' };
  const firstFont = f => { const names = String(f || '').split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean); return names.find(x => !GENERIC.test(x)) || GENERIC_FACE[String(names[0]).toLowerCase()] || 'Arial'; };
  const rotated = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if ((s.transform && s.transform !== 'none' && !/^matrix\([^,]+, 0, 0, [^,]+,/.test(s.transform)) || (s.rotate && s.rotate !== 'none' && s.rotate !== '0deg')) return true; } return false; };
  const items = [], skipped = [];
  for (const el of document.querySelectorAll('[data-vw-id]')) {
    const caps = String(el.getAttribute('data-vw') || '').split(/\s+/);
    if (!caps.includes('text')) continue;
    const id = el.getAttribute('data-vw-id');
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    if (op < 0.02) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || !el.textContent.trim()) continue;
    if (el.closest(`[${HIDE}]`)) continue; // 嵌在已挖的文字里
    let why = null;
    if (rotated(el)) why = '旋转或倾斜';
    else if (/vertical/.test(s.writingMode)) why = '竖排';
    else if ([el, ...el.querySelectorAll('*')].some(n => { const c = getComputedStyle(n); return /text/.test(c.backgroundClip || c.webkitBackgroundClip || '') || parseFloat(c.webkitTextStrokeWidth) > 0; })) why = '渐变字或描边字';
    if (why) { skipped.push({ id, reason: why }); continue; }
    // 按行内片段拆 run：文本节点取父元素的样式；<br> 与块级子元素换行
    const runs = [];
    const push = (text, host) => {
      const c = getComputedStyle(host), col = rgba(c.color) || { hex: '000000', a: 1 };
      runs.push({ text, size: parseFloat(c.fontSize), color: col.hex, alpha: col.a, bold: Number(c.fontWeight) >= 600 || c.fontWeight === 'bold', italic: c.fontStyle !== 'normal', underline: /underline/.test(c.textDecorationLine), font: firstFont(c.fontFamily) });
    };
    const br = () => { if (runs.length && !runs[runs.length - 1].br) runs.push({ br: true }); };
    const walk = node => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          // white-space 保留换行（pre / pre-wrap / pre-line / break-spaces）时按 \n 分行
          const keepNl = /^(pre|pre-wrap|pre-line|break-spaces)$/.test(getComputedStyle(n.parentElement).whiteSpace);
          const lines = keepNl ? n.textContent.split('\n') : [n.textContent];
          lines.forEach((line, i) => {
            if (i) runs.push({ br: true });
            const t = line.replace(/[\t\n\r ]+/g, ' ');
            if (t && !(t === ' ' && (!runs.length || runs[runs.length - 1].br))) push(t, n.parentElement);
          });
        }
        else if (n.nodeType === 1) {
          const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') continue;
          if (n.tagName === 'BR') { runs.push({ br: true }); continue; }
          const block = !/^inline/.test(c.display);
          if (block) br(); walk(n); if (block) br();
        }
      }
    };
    walk(el);
    while (runs.length && runs[runs.length - 1].br) runs.pop();
    const lh = parseFloat(s.lineHeight);
    items.push({ id, x: r.left, y: r.top, w: r.width, h: r.height, opacity: op, align: s.textAlign, lineHeight: Number.isFinite(lh) ? lh : null, letterSpacing: parseFloat(s.letterSpacing) || 0, fontSize: parseFloat(s.fontSize), runs });
    el.setAttribute(HIDE, '');
  }
  const st = document.createElement('style');
  st.textContent = `[${HIDE}], [${HIDE}] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }`;
  document.head.appendChild(st);
  return new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok({ items, skipped }))));
}

async function prepareEditable(page) {
  const frame = page.frames().find(f => f.parentFrame() === page.mainFrame());
  if (!frame) return { items: [], skipped: [], error: '找不到页面框架' };
  return frame.evaluate(collectInFrame);
}

// 从字体文件（ttf / otf / woff / woff2）的 name 表读出真正的字体名（nameID 16，没有用 1；优先英文）。
// 项目里常用 @font-face 起别名（如 Display、Sans），PowerPoint 只认系统里装的真名。读不出返回 null。
export function fontRealName(bytes) {
  try {
    const sig = bytes.toString('latin1', 0, 4);
    let name = null;
    if (sig === 'wOF2') {
      const num = bytes.readUInt16BE(12), compLen = bytes.readUInt32BE(20);
      let o = 48, pos = 0;
      const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = bytes[o++]; v = v * 128 + (c & 0x7f); if (!(c & 0x80)) break; } return v; };
      for (let i = 0; i < num; i++) {
        const flags = bytes[o++]; const idx = flags & 0x3f; let tag = null;
        if (idx === 63) { tag = bytes.toString('latin1', o, o + 4); o += 4; }
        const orig = b128(), ver = (flags >> 6) & 3;
        const transformed = (idx === 10 || idx === 11) ? ver === 0 : ver !== 0; // glyf / loca 版本 0 才是变换过的
        const len = transformed ? b128() : orig;
        if (idx === 5 || tag === 'name') name = { pos, len };
        pos += len;
      }
      if (!name || bytes.toString('latin1', 4, 8) === 'ttcf') return null;
      const data = brotliDecompressSync(bytes.subarray(o, o + compLen));
      return readName(data.subarray(name.pos, name.pos + name.len));
    }
    if (sig === 'wOFF') {
      const num = bytes.readUInt16BE(12);
      for (let i = 0; i < num; i++) {
        const e = 44 + i * 20;
        if (bytes.toString('latin1', e, e + 4) !== 'name') continue;
        const off = bytes.readUInt32BE(e + 4), comp = bytes.readUInt32BE(e + 8), orig = bytes.readUInt32BE(e + 12);
        const raw = bytes.subarray(off, off + comp);
        return readName(comp < orig ? inflateSync(raw) : raw);
      }
      return null;
    }
    const num = bytes.readUInt16BE(4);
    for (let i = 0; i < num; i++) {
      const e = 12 + i * 16;
      if (bytes.toString('latin1', e, e + 4) === 'name') return readName(bytes.subarray(bytes.readUInt32BE(e + 8), bytes.readUInt32BE(e + 8) + bytes.readUInt32BE(e + 12)));
    }
  } catch { /* 读不出就算了 */ }
  return null;
}
function readName(t) {
  const count = t.readUInt16BE(2), base = t.readUInt16BE(4);
  const found = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, plat = t.readUInt16BE(r), lang = t.readUInt16BE(r + 4), id = t.readUInt16BE(r + 6), len = t.readUInt16BE(r + 8), off = t.readUInt16BE(r + 10);
    if (id !== 1 && id !== 16) continue;
    const raw = t.subarray(base + off, base + off + len);
    let text;
    if (plat === 3 || plat === 0) { const sw = Buffer.from(raw); sw.swap16(); text = sw.toString('utf16le'); }
    else if (plat === 1) text = raw.toString('latin1');
    else continue;
    found.push({ text: text.trim(), score: (id === 16 ? 2 : 0) + ((plat === 3 && lang === 0x409) || (plat === 1 && lang === 0) ? 1 : 0) });
  }
  found.sort((a, b) => b.score - a.score);
  return found.find(f => f.text)?.text || null;
}

const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' };

/** 导出 PPTX。mode：'image'（每页一张图）或 'editable'（背景图 + 可改的文本框）。返回 { file, bytes, warnings }。 */
export async function exportPptx({ projectDir, outFile, mode = 'image', purpose, onProgress, signal, timeout } = {}) {
  if (!projectDir || !outFile) throw new Error('exportPptx 需要 projectDir 和 outFile');
  if (mode !== 'image' && mode !== 'editable') throw new Error(`不支持的 PPTX 模式：${mode}（只能是 image 或 editable）`);
  if (signal?.aborted) throw cancelledError();
  projectDir = resolve(projectDir); outFile = resolve(outFile);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const warnings = [];
  // 项目自带字体：别名 → 真名
  const aliases = new Map();
  for (const f of project.fonts || []) {
    if (aliases.has(f.family)) continue;
    let real = null; try { real = fontRealName(readFileSync(join(projectDir, f.file))); } catch { /* 文件缺失 */ }
    aliases.set(f.family, real || f.family);
  }
  const usedFonts = new Set();
  // 幻灯片尺寸：各页最大宽 × 最大高（英寸），超过 56 in 整体等比缩小
  const sizes = (project.pages || []).map(p => pageSize(project, p));
  let W = Math.max(...sizes.map(s => s.width), 1) / PX_PER_IN, H = Math.max(...sizes.map(s => s.height), 1) / PX_PER_IN;
  const shrink = Math.min(1, MAX_IN / W, MAX_IN / H);
  if (shrink < 1) { W *= shrink; H *= shrink; warnings.push(`页面太大（PowerPoint 幻灯片最大 56 英寸），整体按 ${Math.round(shrink * 100)}% 缩小`); }
  // 截图倍数：默认 2；长页把最长边限制在约 12000 像素以内，免得图片过大
  const maxPx = Math.max(...sizes.map(s => Math.max(s.width, s.height)), 1);
  // 用途：线上浏览版用 JPEG、1.5 倍（文件小）；印刷版和不指定时用 PNG、2 倍（清晰）
  const web = purpose === 'web';
  const scale = Math.max(0.5, Math.min(web ? 1.5 : 2, 12000 / maxPx));
  const type = web ? 'jpeg' : 'png';
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'VW', width: W, height: H });
  pptx.layout = 'VW';
  if (project.name) pptx.title = project.name;
  const slides = [];
  let textBoxes = 0;
  // 只翻译一个词的别名（导入的旧页面常写 Display / Sans 之类）；本来就是完整字体名的（Source Han Sans SC 等）照用，PowerPoint 认这个名字
  const face = name => { if (!name) return undefined; const real = (!/\s/.test(name) && aliases.get(name)?.replace(/\s+VF$/i, '')) || name; if (aliases.has(name)) usedFonts.add(real === name ? name : `${name}（字体文件里的名字：${real}）`); return real; };
  await captureProject({
    projectDir, type, ...(web ? { quality: 85 } : {}), timeout, signal, scale,
    prepare: mode === 'editable' ? page => prepareEditable(page) : null,
    onProgress: p => { try { onProgress?.({ ...p, total: p.total + 1 }); } catch { /* 忽略 */ } },
    onShot(index, item, buffer, count, { width, height, prepared }) {
      const label = `第 ${index + 1} 页（${item.id}）`;
      // 每页按比例放进幻灯片（同尺寸的页就是 1:1 铺满）
      const k = Math.min(W / (width / PX_PER_IN), H / (height / PX_PER_IN));
      if (Math.abs(width / PX_PER_IN * k - W) > 0.01 || Math.abs(height / PX_PER_IN * k - H) > 0.01) warnings.push(`${label}尺寸和幻灯片不同，已按比例缩放放在左上角`);
      const inch = px => px / PX_PER_IN * k;
      const slide = { image: buffer, w: inch(width), h: inch(height), texts: [] };
      if (prepared) {
        if (prepared.error) warnings.push(`${label}${prepared.error}，只导出了图片`);
        for (const s of prepared.skipped || []) warnings.push(`${label}的「${s.id}」是${s.reason}文字，留在背景图里，不能改字`);
        for (const t of prepared.items || []) {
          const runs = [];
          for (const r of t.runs) {
            // 空行：放一个空 run 撑出行高
            if (r.br) { if (runs.length && !runs[runs.length - 1].options.breakLine) runs[runs.length - 1].options.breakLine = true; else runs.push({ text: '', options: { breakLine: true, fontSize: Math.max(1, Math.round(t.fontSize * PT_PER_PX * k * 2) / 2) } }); continue; }
            const alpha = r.alpha * t.opacity;
            runs.push({ text: r.text, options: { fontSize: Math.max(1, Math.round(r.size * PT_PER_PX * k * 2) / 2), color: r.color, bold: r.bold, italic: r.italic, underline: r.underline ? { style: 'sng' } : undefined, fontFace: face(r.font), transparency: alpha < 1 ? Math.round((1 - alpha) * 100) : undefined } });
          }
          if (!runs.length) continue;
          // 浏览器里没有自动折行的（高度不超过「硬换行数 × 行高」）就不让 PowerPoint 折行：对方电脑换了字体也不会多折出一行压到别的字上
          const lines = t.runs.filter(r => r.br).length + 1, lineH = t.lineHeight || t.fontSize * 1.3;
          const softWrap = t.h > lines * lineH * 1.4;
          // 宽度留 3% 余量：PowerPoint 的字距排法和浏览器略有出入，余量小了会多折一行
          slide.texts.push({ runs, options: {
            x: inch(t.x), y: inch(t.y), w: inch(t.w) * 1.03 + 0.02, h: inch(t.h), margin: 0, valign: 'top', wrap: softWrap, fit: 'none',
            align: ALIGN[t.align] || 'left', autoFit: false,
            lineSpacing: t.lineHeight ? Math.round(t.lineHeight * PT_PER_PX * k * 10) / 10 : undefined,
            charSpacing: t.letterSpacing ? Math.round(t.letterSpacing * PT_PER_PX * k * 10) / 10 : undefined,
            objectName: `vw:${t.id}`,
          } });
          textBoxes++;
        }
      }
      slides[index] = slide;
    },
  });
  if (signal?.aborted) throw cancelledError();
  if (usedFonts.size) warnings.push(`文本框用了项目自带的字体：${[...usedFonts].join('、')}。PowerPoint 不带上字体文件，打开的电脑没装这些字体时会换成别的字体`);
  for (const s of slides) {
    if (!s) continue;
    const slide = pptx.addSlide();
    slide.addImage({ data: `data:image/${type};base64,${s.image.toString('base64')}`, x: 0, y: 0, w: s.w, h: s.h });
    for (const t of s.texts) slide.addText(t.runs, t.options);
  }
  try { onProgress?.({ current: slides.length + 1, total: slides.length + 1, label: '正在写入文件' }); } catch { /* 忽略 */ }
  const data = await pptx.write({ outputType: 'nodebuffer', compression: true });
  if (signal?.aborted) throw cancelledError();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, data);
  return { file: outFile, bytes: data.length, warnings, textBoxes };
}
