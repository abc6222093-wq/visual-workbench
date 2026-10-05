// 导出「放映版」：把整个项目打成一个能离线双击打开的 .html 文件。
// 文件里包含：全部页面数据、每页动效代码、动效用到的本地库（附许可证）、工作台的放映运行代码，
// 以及瘦身后的图片（缩到最大显示尺寸再压缩）和字体（只保留用到的字）。不引用任何网络地址。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import subsetFont from 'subset-font';
import { validateProjectData } from '../validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = resolve(HERE, '../../web');
export const SIZE_LIMIT = 15 * 1024 * 1024;

// 放映要用到的工作台代码（原样内嵌，保证和工作台行为一致）
const RUNTIME = [
  ['/project-kinds.js', join(WEB_ROOT, 'project-kinds.js')], // 第 11 轮：render.js 按页尺寸取宽高要用
  ['/render.js', join(WEB_ROOT, 'render.js')],
  ['/motion-runtime.js', join(WEB_ROOT, 'motion-runtime.js')],
  ['/playback.js', join(WEB_ROOT, 'playback.js')],
  ['/motion-check.js', join(WEB_ROOT, 'motion-check.js')],
  ['/player.js', join(HERE, 'player-browser.js')],
];

const FONT_MIME = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const IMAGE_MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif' };
const BASIC_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

const dataUrl = (mime, buffer) => `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;

/** 遍历所有页面的元素（含分组子元素） */
function* walk(elements) {
  for (const element of elements || []) {
    yield element;
    yield* walk(element.children);
  }
}
function allElements(project) { return project.pages.flatMap(page => [...walk(page.elements)]); }

/** 所有页面动效代码拼在一起：用来判断代码里提到的素材，以及给字体子集兜底 */
function motionText(project) { return project.pages.map(page => page.motion?.source || '').join('\n'); }

/** 图片在画板上需要的最大缩放比例（相对原图像素）；fill 按两个方向里更大的算，保持比例。
 *  裁切过的（crop）：源图被放大到 元素尺寸 / crop 比例，按两个方向里更大的算，放大后不糊 */
export function neededScale(element, width, height) {
  if (!width || !height) return 1;
  const crop = element.crop;
  if (crop && crop.width > 0 && crop.height > 0) return Math.max((element.width || 0) / (crop.width * width), (element.height || 0) / (crop.height * height));
  const sx = (element.width || 0) / width;
  const sy = (element.height || 0) / height;
  return element.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
}

const isSvg = buffer => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, ''));

async function slimImage(buffer, elements, { keepAlpha = false } = {}) {
  // SVG 原样放进去（data:image/svg+xml），重新着色（tint）用它当遮罩，矢量边缘保持清晰
  if (isSvg(buffer)) return { mime: 'image/svg+xml', data: buffer, note: '原样 svg' };
  const meta = await sharp(buffer, { animated: true }).metadata();
  const format = meta.format;
  const original = { mime: IMAGE_MIME[format] || 'application/octet-stream', data: buffer };
  // 矢量图、动图原样放进去
  if (format === 'svg' || (meta.pages || 1) > 1 || !IMAGE_MIME[format]) return { ...original, note: '原样' };
  const rotated = (meta.orientation || 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  const scale = elements.length ? Math.max(...elements.map(element => neededScale(element, width, height))) : 1;
  const resize = scale < 1 ? { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) } : null;
  const base = () => { const image = sharp(buffer).rotate(); return resize ? image.resize(resize.width, resize.height, { fit: 'fill' }) : image; };
  const transparent = meta.hasAlpha && !(await sharp(buffer).stats()).isOpaque;
  const candidates = [{ mime: 'image/png', data: await base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer() }];
  // 重新着色的图片靠透明度取形状，不能变成 JPEG
  if (!transparent && !keepAlpha) candidates.push({ mime: 'image/jpeg', data: await base().flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer() });
  // 没有方向问题时，原文件反而更小（比如小图标缩小后边缘更复杂）就用原文件
  if (!rotated && (format === 'png' || format === 'jpeg' || format === 'webp')) candidates.push(original);
  const best = candidates.reduce((a, b) => (b.data.length < a.data.length ? b : a));
  const size = best === original || !resize ? { width, height } : resize;
  const note = best === original ? (resize ? `${width}×${height}（原文件更小，未缩）` : `${width}×${height}（原文件）`) : `${size.width}×${size.height}${resize ? `（原图 ${width}×${height}）` : ''}`;
  return { ...best, note: `${note} ${best.mime.replace('image/', '')}` };
}

/** 收集用到某字体的全部文字，加上动效代码里出现的字符和基本 ASCII */
function fontText(project, fontId) {
  let text = BASIC_ASCII + motionText(project);
  for (const element of allElements(project)) if (element.type === 'text' && element.font === fontId) text += element.text || '';
  return [...new Set(text)].join('');
}

/** 在动效代码里找 ctx.importModule('/…') 这样写死的本地路径 */
export function findImportedModules(project) {
  const paths = new Set();
  const dynamic = [];
  for (const page of project.pages) {
    const source = page.motion?.source || '';
    for (const match of source.matchAll(/importModule\s*\(\s*(?:(['"`])([^'"`]*)\1\s*\)|([^)]*)\))/g)) {
      if (match[2] !== undefined && match[2].startsWith('/') && !match[2].includes('${')) paths.add(match[2]);
      else dynamic.push({ page: page.id, code: match[0] });
    }
  }
  return { paths: [...paths], dynamic };
}

// 模块里静态 / 动态导入的相对或根路径，换成占位符，运行时再替换成文件内模块的地址
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

/** 把本地库（以及它们相对导入的文件）从 web/ 读进来 */
function collectLibraries(paths, webRoot) {
  const modules = {};
  const licenses = [];
  const queue = [...paths];
  while (queue.length) {
    const path = queue.shift();
    if (modules[path]) continue;
    const file = resolve(webRoot, '.' + path);
    if (!file.startsWith(webRoot + sep) || !existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`动效代码导入的库 ${path} 在工作台里找不到（应在 ${join(webRoot, path)}），无法打包进放映版`);
    }
    const linked = linkModule(path, readFileSync(file, 'utf8'));
    modules[path] = linked;
    queue.push(...linked.deps);
    const license = findLicense(file);
    licenses.push({ name: path, text: license ? readFileSync(license, 'utf8') : null });
  }
  return { modules, licenses };
}

// 嵌在 <script> 里的文字：防止提前出现 </script
const scriptSafe = text => text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const jsonInHtml = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => (c === '\u2028' ? '\\u2028' : '\\u2029'));
const commentSafe = text => String(text).replace(/\*\//g, '* /');
const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 运行时装载器：把文件里的模块转成 Blob 地址（按依赖顺序替换占位符），再启动放映器
const LOADER = `(() => {
  const data = JSON.parse(document.getElementById('vw-data').textContent);
  const blank = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // 先用 Blob 地址；万一某个浏览器在 file:// 下不让导入 Blob 模块，就整体改用 data: 地址再试一次
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
    resolveAsset(file) {
      if (data.files[file]) return data.files[file];
      console.warn('放映文件里没有打包这个文件：' + file);
      return blank;
    },
    importModule(path) {
      if (!data.modules[path]) return Promise.reject(new Error('放映文件里没有打包这个库：' + path + '（动效代码要用字面路径调用 ctx.importModule 才会被打包）'));
      return load(path);
    }
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
#vw-counter{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(10px,env(safe-area-inset-bottom));font:12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:rgba(255,255,255,.6);background:rgba(0,0,0,.4);padding:5px 8px;border-radius:6px;pointer-events:none;font-variant-numeric:tabular-nums}
#vw-toast{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));transform:translateX(-50%);max-width:calc(100% - 32px);box-sizing:border-box;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff;background:rgba(30,30,30,.88);padding:8px 14px;border-radius:8px;pointer-events:none}
#vw-toast[hidden]{display:none}`;

// 只允许文件内的数据：任何网络请求都会被浏览器拦下
const CSP = "default-src 'none'; img-src data: blob:; font-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:";

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
  const validation = validateProjectData(project, { projectDir });
  if (!validation.ok) throw new Error(`项目没通过校验，先修好再导出：\n${validation.errors.map(error => `  ${error.path}: ${error.message}`).join('\n')}`);

  const warnings = [];
  const items = [];
  const skipped = [];
  const files = {};
  const motion = motionText(project);
  const elements = allElements(project);

  // 图片：只打包页面用到的、或动效代码里提到的素材
  let imageBytes = 0;
  for (const asset of project.assets || []) {
    const users = elements.filter(element => element.type === 'image' && element.asset === asset.id);
    const mentioned = motion.includes(asset.file) || motion.includes(asset.id);
    if (!users.length && !mentioned) { skipped.push(asset.file); continue; }
    const buffer = readFileSync(join(projectDir, asset.file));
    // 代码里提到的素材可能被放大使用，保持原尺寸
    const slim = await slimImage(buffer, mentioned ? [] : users, { keepAlpha: users.some(element => typeof element.tint === 'string') });
    files[asset.file] = dataUrl(slim.mime, slim.data);
    imageBytes += files[asset.file].length;
    items.push({ kind: 'image', name: asset.file, original: buffer.length, bytes: slim.data.length, note: slim.note });
  }

  // 字体：子集化成 woff2，只保留用到的字
  let fontBytes = 0;
  const licenseNotes = [];
  for (const font of project.fonts || []) {
    const buffer = readFileSync(join(projectDir, font.file));
    let data, mime, note;
    try {
      data = await subsetFont(buffer, fontText(project, font.id), { targetFormat: 'woff2' });
      mime = 'font/woff2';
      note = '已子集化';
    } catch (error) {
      data = buffer;
      mime = FONT_MIME[extname(font.file).toLowerCase()] || 'application/octet-stream';
      note = '原样（子集化失败）';
      warnings.push(`字体 ${font.file} 子集化失败，按原文件打包：${error.message}`);
    }
    files[font.file] = dataUrl(mime, data);
    fontBytes += files[font.file].length;
    items.push({ kind: 'font', name: font.file, original: buffer.length, bytes: data.length, note });
    if (font.license && existsSync(join(projectDir, font.license))) licenseNotes.push({ name: `字体 ${font.family}（${font.file}）`, text: readFileSync(join(projectDir, font.license), 'utf8') });
  }

  // 动效用到的本地库
  const { paths, dynamic } = findImportedModules(project);
  for (const item of dynamic) warnings.push(`页面 ${item.page} 的 ${item.code} 不是字面路径，无法自动打包；放映版里调用会失败`);
  const libraries = collectLibraries(paths, webRoot);
  for (const lib of libraries.licenses) {
    if (lib.text) licenseNotes.push({ name: `库 ${lib.name}`, text: lib.text });
    else warnings.push(`库 ${lib.name} 旁边没找到许可证文件（LICENSE-*），请确认可以随文件分发`);
  }
  let libraryBytes = 0;
  for (const [path, mod] of Object.entries(libraries.modules)) {
    libraryBytes += Buffer.byteLength(mod.source);
    items.push({ kind: 'library', name: path, bytes: Buffer.byteLength(mod.source) });
  }

  // 工作台放映代码
  const modules = { ...libraries.modules };
  let runtimeBytes = Buffer.byteLength(LOADER) + Buffer.byteLength(CSS);
  for (const [path, file] of RUNTIME) {
    modules[path] = linkModule(path, readFileSync(file, 'utf8'));
    runtimeBytes += Buffer.byteLength(modules[path].source);
  }

  const projectJson = jsonInHtml(project);
  const dataJson = `{"project":${projectJson},"files":${jsonInHtml(files)},"modules":${jsonInHtml(modules)}}`;
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
<div id="vw-stage" role="application" aria-label="放映：点击或按 → / 空格 前进，← 后退"></div>
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

const LABELS = { images: '图片', fonts: '字体', runtime: '放映代码', libraries: '动效库', project: '项目数据', licenses: '许可证', other: '其他' };
export function describeBreakdown(breakdown) {
  return Object.entries(breakdown).map(([key, value]) => `${LABELS[key] || key} ${formatBytes(value)}`).join('，');
}
