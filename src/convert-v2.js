// 旧项目转换（第 12 轮）：格式 v2（元素列表 + motion.source）→ 格式 v3（每页一个 HTML 文件 + 修改单）。
// 画法照第 11 轮 web/render.js（c9da515）逐项搬：位置、旋转、透明度、层级、混合 / 滤镜 / 遮罩 / 裁切路径、
// 文字字体与描边投影、图片 fit / crop / tint、形状（rect / ellipse 用 CSS，line / polygon 用 SVG）、渐变、翻转、分组。
// 标记：文字 text move color（用户可以改字、挪动、改色，和 v2 里一样能拖）；图片 move resize crop；有填充的矩形 / 椭圆和分组 move resize background（色块）；页面底色在 body 上，只标 background。
// 动效：v2 的 motion.source 原样内嵌，包一层兼容层登记到 vw.motion（ctx.element(id) 仍可用）；transition 搬不了，写进 notes。
// 流程：读 → 不是 v2 返回 { converted:false } → 自动存版 → 在内存里生成全部页面 → 写 pages/ → 最后写 project.json。
// 任何一步失败都把已写的页面文件删掉、不写 project.json，抛中文错误。
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveVersion } from './version.js';

const px = value => `${Number(value) || 0}px`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

export const CONVERT_NOTE = '转换为 v3 前自动存版';
const MIGRATION = '迁移说明（v2 → v3 自动转换）';

// ---------- HTML 小工具 ----------
const escapeText = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = s => escapeText(s).replace(/"/g, '&quot;');
// 内嵌进 <script> 的 JSON：把 < 换成 \u003c，免得源码里的 </script> 提前结束脚本
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const fileRef = file => `../${String(file).split('/').map(encodeURIComponent).join('/')}`;
const cssUrl = file => `url("${fileRef(file)}")`;
function styleAttr(decls) {
  const text = decls.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}:${v}`).join(';');
  return escapeAttr(text);
}

// ---------- 与 render.js 相同的颜色 / 效果换算 ----------
export function paint(value) {
  if (typeof value === 'string') return value;
  if (!value || !Array.isArray(value.stops)) return 'transparent';
  const stops = value.stops.map(stop => `${stop.color} ${stop.offset * 100}%`).join(', ');
  return value.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${value.angle ?? 0}deg, ${stops})`;
}
function maskImage(mask) {
  if (!mask || !Array.isArray(mask.stops)) return '';
  const stops = mask.stops.map(stop => `rgba(0,0,0,${clamp(stop.opacity, 0, 1)}) ${stop.offset * 100}%`).join(', ');
  return mask.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${mask.angle ?? 0}deg, ${stops})`;
}
function clipPath(clip) {
  return clip?.type === 'polygon' && Array.isArray(clip.points) ? `polygon(${clip.points.map(([x, y]) => `${x}% ${y}%`).join(', ')})` : '';
}
function filterString(filters = {}) {
  return Object.entries(filters || {}).map(([name, value]) => `${name}(${value}${name === 'blur' ? 'px' : ''})`).join(' ');
}
function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const n = key => Number(crop[key]);
  if (![n('x'), n('y'), n('width'), n('height')].every(Number.isFinite) || !(n('width') > 0) || !(n('height') > 0)) return null;
  return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
}
function cropGeometry(element, crop) {
  const w = num(element.width), h = num(element.height);
  const W = w / crop.width, H = h / crop.height, left = -crop.x * W, top = -crop.y * H;
  return { left, top, width: W, height: H, inset: [-top, W - w + left, H - h + top, -left] };
}
const pct = v => `${Math.round(v * 1e6) / 1e4}%`;
const MASK_SIZE = { cover: 'cover', contain: 'contain', fill: '100% 100%' };

function fail(message) { throw new Error(message); }

// ---------- 元素 → HTML ----------
// 外层节点的样式（render.js updateElementNode）：动效代码读 node.style.transform / filter / opacity，所以写成内联样式、写法一致。
function outerDecls(element) {
  const effects = element.effects || {};
  const mask = maskImage(effects.mask);
  return [
    ['position', 'absolute'],
    ['left', px(element.x)], ['top', px(element.y)],
    ['width', px(element.width)], ['height', px(element.height)],
    ['transform-origin', 'center center'],
    ['transform', `rotate(${num(element.rotation)}deg) scale(1)`],
    ['opacity', String(element.opacity ?? 1)],
    ['z-index', String(element.zIndex || 0)],
    ...(effects.blend && effects.blend !== 'normal' ? [['mix-blend-mode', effects.blend]] : []),
    ['filter', filterString(effects.filters)],
    ['mask-image', mask], ['-webkit-mask-image', mask],
    ['clip-path', clipPath(effects.clip)],
    ...(element.visible === false ? [['visibility', 'hidden']] : []),
  ];
}

function marks(element, caps) {
  const out = [`data-vw-id="${escapeAttr(element.id)}"`];
  if (!element.locked && caps.length) out.push(`data-vw="${caps.join(' ')}"`);
  if (element.origin?.selector) out.push(`data-vw-origin="${escapeAttr(element.origin.selector)}"`);
  return out.join(' ');
}

const flipped = element => !!(element.flipX || element.flipY);
const flipDecls = element => [['position', 'absolute'], ['inset', '0'], ['width', '100%'], ['height', '100%'], ['transform-origin', 'center center'], ['transform', `scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})`]];
const lockedDecls = element => (element.locked ? [['pointer-events', 'none']] : []);

function textDecls(element, ctx) {
  const stroke = element.stroke && Number(element.stroke.width) > 0 ? `${px(element.stroke.width)} ${element.stroke.color}` : '';
  const shadow = element.shadow ? `${px(element.shadow.x)} ${px(element.shadow.y)} ${px(Math.max(0, Number(element.shadow.blur) || 0))} ${element.shadow.color}` : '';
  const family = element.font && ctx.fontNames.has(element.font) ? JSON.stringify(ctx.fontNames.get(element.font)) : 'sans-serif';
  if (element.font && !ctx.fontNames.has(element.font)) fail(`第 ${ctx.pageNo} 页的文字「${element.id}」引用了不存在的字体：${element.font}`);
  return [
    ['white-space', 'pre-wrap'], ['overflow-wrap', 'break-word'],
    ['font-family', family], ['font-size', px(element.fontSize || 16)], ['font-weight', String(element.fontWeight || 400)],
    ['line-height', String(element.lineHeight || 1.4)], ['letter-spacing', px(element.letterSpacing || 0)],
    ['text-align', element.align || 'left'], ['color', element.color || '#000000'],
    ...(stroke ? [['-webkit-text-stroke', stroke], ['paint-order', 'stroke fill']] : []),
    ...(shadow ? [['text-shadow', shadow]] : []),
  ];
}

function renderText(element, ctx, indent) {
  const style = styleAttr([...outerDecls(element), ...textDecls(element, ctx), ...lockedDecls(element)]);
  const body = escapeText(element.text ?? '');
  const inner = flipped(element) ? `<div style="${styleAttr(flipDecls(element))}">${body}</div>` : body;
  return `${indent}<div ${marks(element, ['text', 'move', 'color'])} style="${style}">${inner}</div>`;
}

function renderImage(element, ctx, indent) {
  const asset = ctx.assets.get(element.asset);
  if (!asset) fail(`第 ${ctx.pageNo} 页的图片「${element.id}」引用了不存在的素材：${element.asset ?? '（空）'}`);
  if (typeof asset.file !== 'string' || !asset.file) fail(`素材「${asset.id}」没有文件路径`);
  const fit = element.fit || 'cover';
  const crop = normalizeCrop(element.crop);
  const tint = typeof element.tint === 'string' && element.tint ? element.tint : null;
  const alt = escapeAttr(element.name || '');
  // 最常见的情况：图片自己就是外层节点，裁切用 object-view-box（与工作台的裁切写法一致）
  if (!tint && !flipped(element)) {
    const decls = [...outerDecls(element), ['display', 'block'], ['max-width', 'none'], ['max-height', 'none']];
    if (crop) decls.push(['object-fit', 'cover'], ['object-view-box', `inset(${pct(crop.y)} ${pct(1 - crop.x - crop.width)} ${pct(1 - crop.y - crop.height)} ${pct(crop.x)})`]);
    else decls.push(['object-fit', fit]);
    decls.push(...lockedDecls(element));
    return `${indent}<img ${marks(element, ['move', 'resize', 'crop'])} src="${escapeAttr(fileRef(asset.file))}" alt="${alt}" draggable="false" style="${styleAttr(decls)}">`;
  }
  // 重新着色或翻转：照 render.js 包一层（外层节点 → 翻转层 → 图片 / 着色块），不能再用裁切能力
  const geometry = crop ? cropGeometry(element, crop) : null;
  const placed = geometry
    ? [['position', 'absolute'], ['left', px(geometry.left)], ['top', px(geometry.top)], ['width', px(geometry.width)], ['height', px(geometry.height)], ['max-width', 'none'], ['max-height', 'none'], ['display', 'block'], ['clip-path', `inset(${geometry.inset.map(v => px(Math.max(0, v))).join(' ')})`]]
    : [['width', '100%'], ['height', '100%'], ['display', 'block']];
  let content;
  if (tint) {
    const url = cssUrl(asset.file);
    const maskDecls = [];
    for (const prefix of ['-webkit-', '']) maskDecls.push([`${prefix}mask-image`, url], [`${prefix}mask-size`, geometry ? '100% 100%' : MASK_SIZE[fit] || 'cover'], [`${prefix}mask-position`, 'center'], [`${prefix}mask-repeat`, 'no-repeat']);
    content = `<div role="img" aria-label="${alt}" style="${styleAttr([...placed, ['background-color', tint], ...maskDecls])}"></div>`;
  } else {
    content = `<img src="${escapeAttr(fileRef(asset.file))}" alt="${alt}" draggable="false" style="${styleAttr(geometry ? placed : [...placed, ['object-fit', fit]])}">`;
  }
  if (flipped(element)) content = `<div style="${styleAttr(flipDecls(element))}">${content}</div>`;
  return `${indent}<div ${marks(element, ['move', 'resize'])} style="${styleAttr([...outerDecls(element), ...lockedDecls(element)])}">${content}</div>`;
}

function svgGradient(value, id) {
  if (!value || typeof value === 'string') return '';
  const tag = value.type === 'radial' ? 'radialGradient' : 'linearGradient';
  let attrs = `id="vw-gradient-${escapeAttr(id)}"`;
  if (value.type === 'linear') {
    const angle = (value.angle || 0) * Math.PI / 180;
    attrs += ` x1="${50 - 50 * Math.sin(angle)}%" y1="${50 + 50 * Math.cos(angle)}%" x2="${50 + 50 * Math.sin(angle)}%" y2="${50 - 50 * Math.cos(angle)}%"`;
  }
  const stops = (value.stops || []).map(s => `<stop offset="${s.offset * 100}%" stop-color="${escapeAttr(s.color)}"></stop>`).join('');
  return `<defs><${tag} ${attrs}>${stops}</${tag}></defs>`;
}

function renderShape(element, ctx, indent) {
  const svg = element.shape === 'line' || element.shape === 'polygon';
  const stroke = element.stroke;
  const caps = ['move', 'resize'];
  if (!svg && element.fill) caps.push('background');
  if (svg) {
    if (element.shape === 'polygon' && !Array.isArray(element.points)) fail(`第 ${ctx.pageNo} 页的多边形「${element.id}」缺少顶点 points`);
    const fill = element.shape === 'line' ? 'none' : !element.fill ? 'none' : typeof element.fill === 'string' ? element.fill : `url(#vw-gradient-${element.id})`;
    const defs = element.shape === 'polygon' ? svgGradient(element.fill, element.id) : '';
    const common = `fill="${escapeAttr(fill)}" stroke="${escapeAttr(stroke?.color || 'none')}" stroke-width="${num(stroke?.width)}" vector-effect="non-scaling-stroke"`;
    const figure = element.shape === 'line'
      ? `<line x1="0" y1="0" x2="100" y2="100" ${common}></line>`
      : `<polygon points="${escapeAttr(element.points.map(p => p.join(',')).join(' '))}" ${common}></polygon>`;
    let content = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible;display:block">${defs}${figure}</svg>`;
    if (flipped(element)) content = `<div style="${styleAttr(flipDecls(element))}">${content}</div>`;
    return `${indent}<div ${marks(element, caps)} style="${styleAttr([...outerDecls(element), ...lockedDecls(element)])}">${content}</div>`;
  }
  const look = [
    ['background', paint(element.fill)],
    ['border', stroke ? `${stroke.width}px solid ${stroke.color}` : 'none'],
    ['box-sizing', 'border-box'],
    ['border-radius', element.shape === 'ellipse' ? '50%' : px(element.cornerRadius || 0)],
  ];
  if (flipped(element)) {
    return `${indent}<div ${marks(element, caps)} style="${styleAttr([...outerDecls(element), ...lockedDecls(element)])}"><div style="${styleAttr([...flipDecls(element), ...look])}"></div></div>`;
  }
  return `${indent}<div ${marks(element, caps)} style="${styleAttr([...outerDecls(element), ...look, ...lockedDecls(element)])}"></div>`;
}

const byZ = list => [...(list || [])].map((e, i) => [e, i]).sort((a, b) => (a[0].zIndex || 0) - (b[0].zIndex || 0) || a[1] - b[1]).map(([e]) => e);

function renderGroup(element, ctx, indent) {
  if (!Array.isArray(element.children)) fail(`第 ${ctx.pageNo} 页的分组「${element.id}」缺少 children`);
  const children = byZ(element.children).map(child => renderElement(child, ctx, `${indent}    `)).join('\n');
  const open = `${indent}<div ${marks(element, ['move', 'resize', 'background'])} style="${styleAttr([...outerDecls(element), ...lockedDecls(element)])}">`;
  if (flipped(element)) return `${open}\n${indent}  <div style="${styleAttr(flipDecls(element))}">\n${children}\n${indent}  </div>\n${indent}</div>`;
  return `${open}\n${children}\n${indent}</div>`;
}

function renderElement(element, ctx, indent = '  ') {
  if (!element || typeof element !== 'object') fail(`第 ${ctx.pageNo} 页有一个元素不是对象`);
  if (typeof element.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(element.id)) fail(`第 ${ctx.pageNo} 页有元素编号不合法：${element.id}`);
  if (ctx.ids.has(element.id)) fail(`第 ${ctx.pageNo} 页的元素编号重复：${element.id}`);
  ctx.ids.add(element.id);
  switch (element.type) {
    case 'text': return renderText(element, ctx, indent);
    case 'image': return renderImage(element, ctx, indent);
    case 'shape': return renderShape(element, ctx, indent);
    case 'group': return renderGroup(element, ctx, indent);
    default: return fail(`第 ${ctx.pageNo} 页的元素「${element.id}」类型无法识别：${element.type}`);
  }
}

// ---------- 兼容层：把 v2 的 motion.source 登记到 vw.motion ----------
// v2 模块的默认导出在 init 时调用（它的函数体就是旧的初始化），返回的 step / dispose 照旧用；transition 不再调用。
const COMPAT = String.raw`
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };
const findElement = (list, id) => { for (const el of list || []) { if (el.id === id) return el; const child = findElement(el.children, id); if (child) return child; } return null; };
const esc = id => (globalThis.CSS?.escape ? CSS.escape(id) : String(id).replace(/["\\]/g, '\\$&'));
let handlers = null;
function v2Context(ctx) {
  const project = freeze(structuredClone(V2_PROJECT));
  const page = project.pages[0];
  const files = new Set([...(project.assets || []), ...(project.fonts || [])].map(item => item.file));
  return {
    project, page, root: ctx.root, signal: ctx.signal,
    get step() { return ctx.step; },
    element(id) {
      const base = findElement(page.elements, id);
      if (!base) throw new Error('动效引用了不存在的元素：' + id);
      const node = document.querySelector('[data-vw-id="' + esc(id) + '"]');
      if (!node) throw new Error('页面缺少元素节点：' + id);
      return { node, base };
    },
    animate: (node, keyframes, options) => ctx.animate(node, keyframes, options),
    timer: ms => ctx.timer(ms),
    importModule: path => ctx.importModule(path),
    assetUrl(file) {
      if (typeof file !== 'string' || !files.has(file)) throw new Error('未登记的项目资源：' + file);
      return '../' + file.split('/').map(encodeURIComponent).join('/');
    }
  };
}
window.vw?.motion({
  async init(ctx) {
    const url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(V2_SOURCE);
    const mod = await import(url);
    if (typeof mod.default !== 'function') throw new Error('动效模块必须 default export 一个函数');
    handlers = (await mod.default(v2Context(ctx))) || {};
  },
  async step(index) { if (typeof handlers?.step === 'function') await handlers.step(index); },
  dispose() { const h = handlers; handlers = null; if (typeof h?.dispose === 'function') h.dispose(); }
});`;

function motionScript(project, page) {
  const snapshot = { ...project, pages: [page] };
  return `<script type="module">
// 由 v2 项目自动转换：下面是原来的 motion.source（原样），外面一层把它接到 vw.motion。
// agent 重写动效时可以直接换成普通的 vw.motion({ init, step, leave }) 写法。
const V2_SOURCE = ${scriptJson(page.motion.source)};
const V2_PROJECT = ${scriptJson(snapshot)};
${COMPAT.trim()}
</script>`;
}

function fontFaces(project, fontNames) {
  return (project.fonts || []).map(font => `@font-face { font-family: ${JSON.stringify(fontNames.get(font.id))}; src: ${cssUrl(font.file)}; font-weight: ${font.weight === 'variable' ? '100 900' : font.weight || 400}; font-style: ${font.style || 'normal'}; }`);
}

// 字体名：family 在项目里唯一就用它（agent 读起来自然）；同名的多个字体文件用 vw-<编号> 区分，免得字重互相顶替
function fontNameMap(fonts) {
  const count = new Map();
  for (const font of fonts) count.set(font.family, (count.get(font.family) || 0) + 1);
  return new Map(fonts.map(font => [font.id, font.family && count.get(font.family) === 1 ? font.family : `vw-${font.id}`]));
}

function pageSize(project, page) {
  if (project.kind === 'web' && page.size) return { width: num(page.size.width), height: num(page.size.height) };
  return { width: num(project.artboard?.width), height: num(project.artboard?.height) };
}

export function renderPageHtml(project, page, pageNo, shared) {
  if (!page || typeof page !== 'object') fail(`第 ${pageNo} 页不是对象`);
  if (typeof page.id !== 'string' || !/^page_[A-Za-z0-9_-]+$/.test(page.id)) fail(`第 ${pageNo} 页的编号不合法：${page.id}`);
  if (!Array.isArray(page.elements)) fail(`第 ${pageNo} 页（${page.id}）缺少 elements`);
  if (page.motion !== undefined) {
    if (!page.motion || typeof page.motion !== 'object') fail(`第 ${pageNo} 页（${page.id}）的 motion 不是对象`);
    if (!Number.isInteger(page.motion.steps) || page.motion.steps < 0) fail(`第 ${pageNo} 页（${page.id}）的 motion.steps 必须是非负整数`);
    if (typeof page.motion.source !== 'string' || !page.motion.source.trim()) fail(`第 ${pageNo} 页（${page.id}）的 motion.source 不是动效代码文本，无法搬过去`);
  }
  const ctx = { pageNo, assets: shared.assets, fontNames: shared.fontNames, ids: new Set() };
  const { width, height } = pageSize(project, page);
  const body = byZ(page.elements).map(el => renderElement(el, ctx)).join('\n');
  // 页面底色写在 body 上：标成整页背景，只能改颜色（编号避开页面里已有的元素编号）
  let bgId = 'page_bg';
  for (let n = 2; ctx.ids.has(bgId); n++) bgId = `page_bg${n}`;
  const css = [
    ...fontFaces(project, shared.fontNames),
    `html, body { margin: 0; width: ${width}px; height: ${height}px; }`,
    `body { position: relative; overflow: hidden; isolation: isolate; background: ${paint(page.background)}; }`,
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeText(page.name || page.id)}</title>
<style>
${css.join('\n')}
</style>
</head>
<body data-vw-id="${bgId}" data-vw="background">
${body}
${page.motion ? motionScript(project, page) : ''}
</body>
</html>
`;
}

function migrationNotes(page) {
  const lines = [];
  if (page.motion) {
    lines.push('原动效（motion.source）已原样搬进页面，外面包了一层兼容层（ctx.element(id) 等仍可用）；以后重写动效可直接换成 vw.motion 写法。');
    if (/\btransition\s*[(:]/.test(page.motion.source)) lines.push('原换页效果（transition）未搬，需 agent 用 leave 重写。');
  }
  if (!lines.length) return page.notes || '';
  const block = `${MIGRATION}：\n${lines.map(l => `- ${l}`).join('\n')}`;
  return page.notes ? `${page.notes}\n\n${block}` : block;
}

function convertAsset(asset) {
  const out = { id: asset.id, kind: 'image', file: asset.file };
  for (const key of ['name', 'width', 'height', 'addedAt']) if (asset[key] !== undefined) out[key] = asset[key];
  return out;
}

/** 只在内存里转换：返回 { project, pages: [{ file, html }] }，失败抛中文错误。 */
export function convertV2Data(project, { now = new Date() } = {}) {
  if (!project || typeof project !== 'object') fail('项目文件不是对象');
  if (!Array.isArray(project.pages) || !project.pages.length) fail('项目没有页面');
  const assets = new Map((project.assets || []).map(a => [a.id, a]));
  const fonts = project.fonts || [];
  for (const font of fonts) if (typeof font.file !== 'string' || !font.file) fail(`字体「${font.id}」没有文件路径`);
  const shared = { assets, fontNames: fontNameMap(fonts) };
  const seen = new Set();
  const outPages = [];
  const pages = project.pages.map((page, i) => {
    const html = renderPageHtml(project, page, i + 1, shared);
    if (seen.has(page.id)) fail(`页面编号重复：${page.id}`);
    seen.add(page.id);
    const file = `pages/${page.id}.html`;
    outPages.push({ file, html });
    const next = { id: page.id, name: page.name || page.id, file };
    const notes = migrationNotes(page);
    if (notes) next.notes = notes;
    if (page.motion) next.motion = { steps: page.motion.steps };
    next.edits = [];
    if (project.kind === 'web') {
      if (page.device) next.device = page.device;
      if (page.size) next.size = { width: page.size.width, height: page.size.height };
      if (page.origin) next.origin = page.origin;
    }
    return next;
  });
  const out = { format: 'visual-workbench/project', formatVersion: 3, id: project.id, name: project.name };
  if (project.description !== undefined) out.description = project.description;
  out.kind = project.kind === 'web' ? 'web' : 'deck';
  for (const key of ['folder', 'designCard']) if (project[key] !== undefined) out[key] = project[key];
  out.createdAt = project.createdAt || now.toISOString();
  out.updatedAt = now.toISOString();
  out.artboard = project.artboard;
  out.assets = (project.assets || []).map(convertAsset);
  out.fonts = fonts.map(font => ({ ...font }));
  out.pages = pages;
  return { project: out, pages: outPages };
}

/**
 * 把项目文件夹里的 v2 项目转成 v3。不是 v2 → { converted:false, formatVersion }。
 * 成功 → { converted:true, versionDir, pages: [文件] }。失败抛中文错误，project.json 保持原样、不留下页面文件。
 */
export async function convertV2Project({ projectDir, now = new Date() }) {
  const projectFile = join(projectDir, 'project.json');
  let project;
  try { project = JSON.parse(readFileSync(projectFile, 'utf8')); }
  catch (e) { throw new Error(`读不了项目文件 ${projectFile}：${e.message}`); }
  if (project?.formatVersion !== 2) return { converted: false, formatVersion: project?.formatVersion ?? null };
  const { versionDir } = saveVersion({ projectDir, note: CONVERT_NOTE, by: 'agent', auto: 'convert-v3' });
  let result;
  try { result = convertV2Data(project, { now }); }
  catch (e) { throw new Error(`项目「${project.id}」转换为 v3 失败：${e.message}。项目保持原样（已自动存版）。`); }
  const pagesDir = join(projectDir, 'pages');
  const createdDir = !existsSync(pagesDir);
  const written = [];
  try {
    mkdirSync(pagesDir, { recursive: true });
    for (const page of result.pages) {
      const target = join(projectDir, page.file);
      if (existsSync(target)) fail(`页面文件已经存在，不覆盖：${page.file}`);
      writeFileSync(target, page.html);
      written.push(target);
    }
    writeFileSync(projectFile, `${JSON.stringify(result.project, null, 2)}\n`);
  } catch (e) {
    for (const file of written) rmSync(file, { force: true });
    if (createdDir && existsSync(pagesDir) && !readdirSync(pagesDir).length) rmdirSync(pagesDir);
    throw new Error(`项目「${project.id}」转换为 v3 时写文件失败：${e.message}。项目保持原样（已自动存版）。`);
  }
  return { converted: true, versionDir, pages: result.pages.map(p => p.file) };
}
