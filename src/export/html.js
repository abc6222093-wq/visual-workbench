// 导出「放映版」（第 12 轮）：把整个项目打成一个能离线双击打开的 .html 文件。
// 文件里包含：每页 HTML（资源换成文件内的 data: 地址）、页面运行时 web/page-runtime.js 的全文、
// 放映壳要用的工作台模块（page-frame.js 等，按依赖自动收集）、项目数据（含修改单）、页面用到的 /vendor/ 库（附许可证）。
// 播放器：每页一个 sandbox iframe（srcdoc），点击 / 方向键推进，后退时快进到最后一步。不引用任何网络地址。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import subsetFont from 'subset-font';
import { checkForExport } from './check.js';
import { pageSize } from '../../web/project-kinds.js';
import { createInliner, dataUrl, mimeOf } from './inline-page.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = resolve(HERE, '../../web');
export const SIZE_LIMIT = 15 * 1024 * 1024;
export const PLAYER_FILE = join(HERE, 'player-browser.js');
export const RUNTIME_TEXT_FILE = 'page-runtime.js';

const IMAGE_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };
const BASIC_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

const isSvg = buffer => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, ''));

/**
 * 图片瘦身：第 12 轮页面是自由 HTML，不知道显示尺寸，只把宽度超过 maxWidth（= 2 × 页面宽）的图按比例缩小；
 * 不透明的再试 JPEG，取最小的（原文件更小就用原文件）。SVG、动图原样。
 */
export async function slimImage(buffer, { maxWidth } = {}) {
  if (isSvg(buffer)) return { mime: 'image/svg+xml', data: buffer, note: '原样 svg' };
  let meta;
  try { meta = await sharp(buffer, { animated: true }).metadata(); } catch { return { mime: 'application/octet-stream', data: buffer, note: '原样（无法识别）' }; }
  const format = meta.format;
  const original = { mime: IMAGE_MIME[format] || 'application/octet-stream', data: buffer };
  if (format === 'svg' || (meta.pages || 1) > 1 || !IMAGE_MIME[format]) return { ...original, note: '原样' };
  const rotated = (meta.orientation || 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  const scale = maxWidth && width > maxWidth ? maxWidth / width : 1;
  const resize = scale < 1 ? { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) } : null;
  const base = () => { const image = sharp(buffer).rotate(); return resize ? image.resize(resize.width, resize.height, { fit: 'fill' }) : image; };
  const transparent = meta.hasAlpha && !(await sharp(buffer).stats()).isOpaque;
  const candidates = [{ mime: 'image/png', data: await base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer() }];
  if (!transparent) candidates.push({ mime: 'image/jpeg', data: await base().flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer() });
  if (!rotated && !resize && (format === 'png' || format === 'jpeg' || format === 'webp')) candidates.push(original);
  const best = candidates.reduce((a, b) => (b.data.length < a.data.length ? b : a));
  const size = resize || { width, height };
  const note = best === original ? `${width}×${height}（原文件）` : `${size.width}×${size.height}${resize ? `（原图 ${width}×${height}）` : ''}`;
  return { ...best, note: `${note} ${best.mime.replace('image/', '')}` };
}

/** 找库文件旁边的许可证：web/vendor/LICENSE-<库名>.* */
function findLicense(file) {
  const dir = dirname(file);
  const name = basename(file).toLowerCase().replace(/[^a-z0-9]/g, '');
  const head = basename(file).toLowerCase().split(/[^a-z0-9]/)[0];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return null; }
  for (const entry of entries) {
    const match = /^licen[cs]e[-_.](.+?)(\.(txt|md))?$/i.exec(entry);
    if (!match) continue;
    const key = match[1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (key && (name.startsWith(key) || (head.length >= 3 && key.startsWith(head)))) return join(dir, entry);
  }
  return null;
}

// 放映壳模块：工作台 web/ 里的模块（相对 import 换成占位符，装载器在浏览器里按依赖换成 Blob / data: 地址）
const IMPORT_PATTERN = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])((?:\.{1,2})?\/[^"'\s]*)\2/g;
function linkModule(path, source) {
  const deps = new Set();
  const linked = source.replace(IMPORT_PATTERN, (all, head, quote, spec) => {
    const target = spec.startsWith('/') ? spec : posix.normalize(posix.join(posix.dirname(path), spec));
    deps.add(target);
    return `${head}${quote}vw-module:${target}${quote}`;
  });
  return { source: linked, deps: [...deps] };
}

/** 从播放器出发，按 import 收集 web/ 里的放映模块 */
function collectRuntime(webRoot) {
  const modules = {};
  modules['/player.js'] = linkModule('/player.js', readFileSync(PLAYER_FILE, 'utf8'));
  const queue = [...modules['/player.js'].deps];
  while (queue.length) {
    const path = queue.shift();
    if (modules[path]) continue;
    const file = resolve(webRoot, '.' + path);
    if (!file.startsWith(webRoot + sep) || !existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`放映壳需要的工作台文件 ${path} 不存在（应在 ${join(webRoot, path)}），无法导出放映版`);
    }
    modules[path] = linkModule(path, readFileSync(file, 'utf8'));
    queue.push(...modules[path].deps);
  }
  return modules;
}

// 嵌在 <script> 里的文字：防止提前出现 </script
const scriptSafe = text => text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const jsonInHtml = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => (c === '\u2028' ? '\\u2028' : '\\u2029'));
const commentSafe = text => String(text).replace(/\*\//g, '* /');
const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 运行时装载器：把文件里的模块转成 Blob 地址（按依赖顺序替换占位符），再启动放映器
const LOADER = `(() => {
  const data = JSON.parse(document.getElementById('vw-data').textContent);
  let mode = 'blob';
  let urls = Object.create(null);
  function moduleUrl(path) {
    if (urls[path]) return urls[path];
    const mod = data.modules[path];
    if (!mod) throw new Error('放映文件里没有打包这个模块：' + path);
    urls[path] = 'about:blank';
    let source = mod.source;
    for (const dep of mod.deps) source = source.split('vw-module:' + dep).join(moduleUrl(dep));
    return (urls[path] = mode === 'blob'
      ? URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      : 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source).replace(/'/g, '%27'));
  }
  async function load(path) {
    try { return await import(moduleUrl(path)); }
    catch (error) {
      if (mode !== 'blob' || !(error instanceof TypeError)) throw error;
      mode = 'data';
      urls = Object.create(null);
      return import(moduleUrl(path));
    }
  }
  globalThis.__VW_EXPORT__ = {
    project: data.project,
    pages: data.pages,
    files: data.files,
    runtimeText: data.runtimeText,
    resolveFile(key) { return data.files[key] || null; },
    importModule(path) { return load(path); }
  };
  globalThis.vwReady = load('/player.js').then(module => module.ready).catch(error => {
    console.error(error);
    const toast = document.getElementById('vw-toast');
    toast.textContent = '放映文件打不开：' + (error && error.message || error);
    toast.hidden = false;
    throw error;
  });
  globalThis.vwReady.catch(() => {});
})();`;

const CSS = `html,body{margin:0;height:100%;background:#000;overflow:hidden;overscroll-behavior:none}
#vw-stage{position:fixed;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;cursor:pointer}
#vw-layer{position:absolute;left:0;top:0;transform-origin:0 0}
#vw-shield{position:absolute;inset:0}
#vw-shield[hidden]{display:none}
#vw-counter{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));font:12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:rgba(255,255,255,.6);background:rgba(0,0,0,.4);padding:5px 8px;border-radius:6px;pointer-events:none;font-variant-numeric:tabular-nums}
#vw-toast{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);max-width:calc(100% - 32px);box-sizing:border-box;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff;background:rgba(30,30,30,.88);padding:8px 14px;border-radius:8px;pointer-events:none}
#vw-toast[hidden]{display:none}`;

// 只允许文件内的数据：任何网络请求都会被浏览器拦下（srcdoc 页面继承这条策略）
export const CSP = "default-src 'none'; img-src data: blob:; font-src data: blob:; media-src data: blob:; style-src 'unsafe-inline' data: blob:; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src data: blob:; worker-src data: blob:; frame-src data: blob: about:";

/** 页面文本里用到的字（字体子集用）：去掉标签后的文字 + 脚本原文 + 修改单里的文字 */
function pageChars(html, page) {
  let text = String(html).replace(/<[^>]*>/g, ' ');
  for (const edit of page.edits || []) if (edit.kind === 'text') text += `${edit.after?.text || ''}${edit.before?.text || ''}`;
  return text;
}

/**
 * 导出放映版单文件。
 * @returns {Promise<{file:string, bytes:number, breakdown:object, items:object[], skipped:string[], warnings:string[]}>}
 */
export async function exportHtml({ projectDir, outFile, webRoot = WEB_ROOT, sizeLimit = SIZE_LIMIT }) {
  projectDir = resolve(projectDir);
  webRoot = resolve(webRoot);
  let project;
  try { project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')); }
  catch (error) { throw new Error(`无法读取项目：${error.message}`); }
  const { stale } = checkForExport(project, projectDir);

  const warnings = [];
  if (stale.length) warnings.push(`有 ${stale.length} 条修改单条目对不上（页面里找不到目标或不再允许这种修改），放映时跳过`);
  const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
  const items = [];
  const files = {};
  const sources = {}; // key → { kind, file }
  const maxWidth = 2 * Math.max(project.artboard?.width || 0, ...project.pages.map(page => pageSize(project, page).width));
  const fontFiles = new Set((project.fonts || []).map(font => font.file));
  const embedFile = key => { if (!sources[key]) sources[key] = { kind: 'file' }; return `__VWFILE[${key}]__`; };
  const inliner = createInliner({ projectDir, webRoot, embedFile, warn });

  // 每页 HTML → 自包含文本（资源先记成占位符）
  const pages = {};
  let charText = BASIC_ASCII;
  let pageBytes = 0;
  for (const page of project.pages) {
    const file = join(projectDir, page.file);
    let html;
    try { html = readFileSync(file, 'utf8'); } catch (error) { throw new Error(`读不到页面文件 ${page.file}：${error.message}`); }
    pages[page.id] = inliner.page(page.file, html);
    pageBytes += Buffer.byteLength(pages[page.id]);
    charText += pageChars(html, page);
  }
  // 用户贴进来的图（修改单 addImage）也要带上
  const assetById = new Map((project.assets || []).map(asset => [asset.id, asset]));
  for (const page of project.pages) for (const edit of page.edits || []) {
    if (edit.kind !== 'addImage') continue;
    const asset = assetById.get(edit.after?.asset);
    if (asset && existsSync(join(projectDir, asset.file))) embedFile(asset.file);
    else warn(`页面 ${page.id} 贴进来的图片 ${edit.after?.asset} 找不到素材文件`);
  }

  // 资源：图片瘦身、字体子集、其他原样
  let imageBytes = 0, fontBytes = 0, libraryBytes = 0;
  const licenseNotes = [];
  const chars = [...new Set(charText)].join('');
  for (const key of Object.keys(sources).sort()) {
    if (key.startsWith('vendor:')) {
      const path = key.slice('vendor:'.length);
      const buffer = readFileSync(inliner.vendorFile(path));
      files[key] = dataUrl(mimeOf(path), buffer);
      libraryBytes += files[key].length;
      items.push({ kind: 'library', name: path, bytes: buffer.length });
      continue;
    }
    const buffer = readFileSync(join(projectDir, key));
    const mime = mimeOf(key);
    if (fontFiles.has(key) || /^font\//.test(mime)) {
      let data = buffer, outMime = mime, note = '原样';
      try { data = await subsetFont(buffer, chars, { targetFormat: 'woff2' }); outMime = 'font/woff2'; note = '已子集化'; }
      catch (error) { warn(`字体 ${key} 子集化失败，按原文件打包：${error.message}`); note = '原样（子集化失败）'; }
      files[key] = dataUrl(outMime, data);
      fontBytes += files[key].length;
      items.push({ kind: 'font', name: key, original: buffer.length, bytes: data.length, note });
      continue;
    }
    if (/^image\//.test(mime) || assetById.has(key)) {
      const slim = await slimImage(buffer, { maxWidth });
      files[key] = dataUrl(slim.mime === 'application/octet-stream' ? mime : slim.mime, slim.data);
      imageBytes += files[key].length;
      items.push({ kind: 'image', name: key, original: buffer.length, bytes: slim.data.length, note: slim.note });
      continue;
    }
    files[key] = dataUrl(mime, buffer);
    libraryBytes += files[key].length;
    items.push({ kind: 'file', name: key, original: buffer.length, bytes: buffer.length, note: '原样' });
  }
  // 模块形式内联的项目脚本、库（data: 模块已经写进页面文本，体积算在库里）
  for (const path of inliner.vendorUsed) {
    const file = inliner.vendorFile(path);
    if (!items.some(item => item.kind === 'library' && item.name === path)) items.push({ kind: 'library', name: path, bytes: statSync(file).size });
    const license = findLicense(file);
    if (license) { if (!licenseNotes.some(note => note.name === `库 ${path}`)) licenseNotes.push({ name: `库 ${path}`, text: readFileSync(license, 'utf8') }); }
    else warn(`库 ${path} 旁边没找到许可证文件（LICENSE-*），请确认可以随文件分发`);
  }
  for (const font of project.fonts || []) {
    if (!sources[font.file]) continue;
    if (font.license && existsSync(join(projectDir, font.license))) licenseNotes.push({ name: `字体 ${font.family}（${font.file}）`, text: readFileSync(join(projectDir, font.license), 'utf8') });
  }
  const used = new Set(Object.keys(sources));
  const skipped = (project.assets || []).filter(asset => !used.has(asset.file) && !inliner.projectModules.has(asset.file) && !inliner.inlined.has(asset.file) && !Object.values(pages).some(text => text.includes(asset.file))).map(asset => asset.file);

  // 放映壳与页面运行时
  const runtimeFile = join(webRoot, RUNTIME_TEXT_FILE);
  if (!existsSync(runtimeFile)) throw new Error(`页面运行时 ${runtimeFile} 不存在，无法导出放映版`);
  const runtimeText = readFileSync(runtimeFile, 'utf8');
  const modules = collectRuntime(webRoot);
  let runtimeBytes = Buffer.byteLength(LOADER) + Buffer.byteLength(CSS) + Buffer.byteLength(runtimeText);
  for (const mod of Object.values(modules)) runtimeBytes += Buffer.byteLength(mod.source);
  // 页面文本里内联的 data: 模块属于「库 / 脚本」，从页面体积里拆出来
  let inlineModuleBytes = 0;
  for (const text of Object.values(pages)) for (const m of text.matchAll(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g)) inlineModuleBytes += m[0].length;
  libraryBytes += inlineModuleBytes;

  const projectJson = jsonInHtml(project);
  const pagesJson = jsonInHtml(pages);
  const dataJson = `{"project":${projectJson},"pages":${pagesJson},"files":${jsonInHtml(files)},"runtimeText":${jsonInHtml(runtimeText)},"modules":${jsonInHtml(modules)}}`;
  const licenseComment = licenseNotes.length
    ? `/*\n本文件内嵌的第三方内容及其许可证：\n\n${licenseNotes.map(note => `==== ${note.name} ====\n${commentSafe(note.text).trim()}`).join('\n\n')}\n*/\n`
    : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="generator" content="视觉工作台 · 放映版">
<title>${escapeHtml(project.name)}</title>
<style>${CSS}</style>
</head>
<body>
<div id="vw-stage" role="application" aria-label="放映：点击或按 → / 空格 前进，← 后退"><div id="vw-layer"></div></div>
<script type="text/plain" data-vw-parent-runtime></script>
<div id="vw-counter"></div>
<div id="vw-toast" hidden></div>
<noscript><p style="color:#fff;font:16px sans-serif;padding:24px">这个放映文件需要开启 JavaScript 才能播放。</p></noscript>
<script type="application/json" id="vw-data">${dataJson}</script>
<script>
${scriptSafe(licenseComment)}${LOADER}
</script>
</body>
</html>
`;
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(outFile, html);
  const bytes = Buffer.byteLength(html);
  const breakdown = {
    images: imageBytes,
    fonts: fontBytes,
    runtime: runtimeBytes,
    libraries: libraryBytes,
    pages: Math.max(0, Buffer.byteLength(pagesJson) - inlineModuleBytes),
    project: Buffer.byteLength(projectJson),
    licenses: Buffer.byteLength(licenseComment),
  };
  breakdown.other = Math.max(0, bytes - Object.values(breakdown).reduce((a, b) => a + b, 0));
  if (bytes > sizeLimit) warnings.push(`放映文件瘦身后仍有 ${formatBytes(bytes)}，超过 ${formatBytes(sizeLimit)}。请停下来报告：${describeBreakdown(breakdown)}`);
  return { file: resolve(outFile), bytes, breakdown, items, skipped, warnings };
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const LABELS = { images: '图片', fonts: '字体', runtime: '放映代码', libraries: '库与脚本', pages: '页面', project: '项目数据', licenses: '许可证', other: '其他' };
export function describeBreakdown(breakdown) {
  return Object.entries(breakdown).map(([key, value]) => `${LABELS[key] || key} ${formatBytes(value)}`).join('，');
}

