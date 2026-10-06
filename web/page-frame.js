// 父页面侧：把一页显示在隔离的 sandbox iframe 里（第 12 轮，docs/round12-contract.md §1–§2）。
// 编辑画布、放映、缩略图、动效检查、导出都用这里，五处一致。父页面只用 postMessage 和页面说话，绝不碰 contentDocument。
//
// 对外：
//   createPageFrame(options) → 控制对象（见函数注释）
//   buildSrcdoc({ html, mode, project, page, edits, baseHref, runtimeText, fast, assetBase, assetUrls, uiScale, timeout, screen, cropFallback, hold, countSteps, fontLibrary }) → 注入后的 HTML 字符串（纯字符串运算，Node 里也能用）
//   staticDocument({ html, project, page, edits, baseHref, assetBase, assetUrls, fontLibrary }) → 缩略图用的静态 HTML（叠修改单、删脚本），放进 sandbox="" 的 iframe
//   fontLibraryStyle(html, fontLibrary) → 字体库注入的 <style data-vw-fontlib> 文本或 ''（纯函数、不碰 DOM，导出放映版在 Node 里也调；第 13 轮 §4.4）
//   loadRuntimeText() → Promise<string>：/page-runtime.js 全文（缓存；导出的单文件可用 globalThis.__VW_EXPORT__.runtimeText 提供）
//   pageFileUrl(project, page, assetBase?) → /data/projects/<id>/<page.file>
//   frameSize(project, page) → { width, height, contentHeight, kind }：iframe 的尺寸（课件 = 画板；网页 = 设备窗口）
//   assetUrlMap(project, page, { assetBase, baseHref }) → { 素材编号: 地址 }（用户贴的图用）

export const DEVICES = Object.freeze({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } });

const encodePath = file => String(file).split('/').map(encodeURIComponent).join('/');
export function projectBase(project, assetBase) {
  return String(assetBase || `/data/projects/${encodeURIComponent(project.id)}`).replace(/\/+$/, '');
}
export function pageFileUrl(project, page, assetBase) {
  return `${projectBase(project, assetBase)}/${encodePath(page.file || `pages/${page.id}.html`)}`;
}
const absolute = url => (typeof location !== 'undefined' ? new URL(url, location.href).href : url);
function defaultBaseHref(project, page, assetBase) {
  const url = pageFileUrl(project, page, assetBase);
  return absolute(url.slice(0, url.lastIndexOf('/') + 1));
}

export function frameSize(project, page) {
  const kind = project?.kind === 'web' ? 'web' : 'deck';
  if (kind === 'web') {
    const device = DEVICES[page?.device] || DEVICES.desktop;
    const width = Number(page?.size?.width) || device.width;
    return { kind, width, height: device.height, contentHeight: Number(page?.size?.height) || device.height };
  }
  const width = Number(project?.artboard?.width) || 1920, height = Number(project?.artboard?.height) || 1080;
  return { kind, width, height, contentHeight: height };
}

/** 素材编号 → 地址。默认写成相对页面文件的路径（配合 <base>），给了 assetBase 时写绝对路径。 */
export function assetUrlMap(project, page, { assetBase } = {}) {
  const out = {};
  const depth = String(page?.file || 'pages/x.html').split('/').length - 1;
  for (const asset of project?.assets || []) {
    if (!asset?.id || !asset.file) continue;
    out[asset.id] = assetBase ? `${projectBase(project, assetBase)}/${encodePath(asset.file)}` : `${'../'.repeat(depth)}${encodePath(asset.file)}`;
  }
  return out;
}

let runtimeTextPromise = null;
export function loadRuntimeText() {
  const exported = globalThis.__VW_EXPORT__?.runtimeText;
  if (typeof exported === 'string') return Promise.resolve(exported);
  if (!runtimeTextPromise) {
    runtimeTextPromise = fetch('/page-runtime.js', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error(`读不到页面运行时（${response.status}）`);
      return response.text();
    });
    runtimeTextPromise.catch(() => { runtimeTextPromise = null; });
  }
  return runtimeTextPromise;
}

const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const safeScript = text => String(text).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function baseStyle(project, page) {
  const size = frameSize(project, page);
  return size.kind === 'web' ? `html,body{margin:0;width:${size.width}px}` : `html,body{margin:0;width:${size.width}px;height:${size.height}px;overflow:hidden}`;
}

// 把注入内容放进 <head> 最前；没有 <head> 就补；页面末尾加一句「叠修改单」（让页面脚本跑之前尽早叠上）
function inject(html, head, tail = '') {
  let text = String(html ?? '');
  const headMatch = /<head(\s[^>]*)?>/i.exec(text);
  if (headMatch) text = text.slice(0, headMatch.index + headMatch[0].length) + head + text.slice(headMatch.index + headMatch[0].length);
  else {
    const htmlMatch = /<html(\s[^>]*)?>/i.exec(text);
    if (htmlMatch) text = text.slice(0, htmlMatch.index + htmlMatch[0].length) + `<head>${head}</head>` + text.slice(htmlMatch.index + htmlMatch[0].length);
    else {
      const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
      text = doctype ? doctype[0] + `<head>${head}</head>` + text.slice(doctype[0].length) : `<!doctype html><head>${head}</head>` + text;
    }
  }
  if (tail) {
    const end = text.toLowerCase().lastIndexOf('</body>');
    text = end >= 0 ? text.slice(0, end) + tail + text.slice(end) : text + tail;
  }
  return text;
}

// ---------- 字体库（第 13 轮 §4.4） ----------
// fontLibrary：[{ family, aliases: [...], faces: [{ url, weight: 100…900|'variable', style: 'normal'|'italic', format: 'opentype'|'truetype'|'woff2' }] }]
// 扫页面文本里写到的字体名（font-family 声明、font 简写、@font-face 的 font-family；大小写、空格、引号不敏感），
// 命中的每套按页面里实际写的名字生成 @font-face。放在页面自己的样式之前：页面后声明的同名子集 face 优先，
// 子集里没有的字由 Chromium 在同一字族里回退到先声明的完整 face（分段字体回退，见 test/round13-runtime-fontlib.test.js）。
const fontKey = name => String(name || '').replace(/["'\s]/g, '').toLowerCase();
function splitFamilies(value) {
  return String(value).split(',').map(part => part.replace(/\s*!important\s*$/i, '').replace(/["']/g, '').trim()).filter(Boolean);
}
/** 页面文本里写到的字体名（原样，去引号去首尾空白，按规范化名字去重）。 */
export function fontNamesInHtml(html) {
  const text = String(html ?? '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  const out = new Map();
  const add = name => { const key = fontKey(name); if (key && !out.has(key)) out.set(key, name); };
  for (const m of text.matchAll(/font-family\s*:\s*([^;{}<>]+)/gi)) splitFamilies(m[1]).forEach(add);
  // font 简写：族名在字号（可带 /行高）之后
  for (const m of text.matchAll(/(?:^|[\s;{"'])font\s*:\s*([^;{}<>]+)/gi)) {
    const value = m[1];
    const size = /(?<=^|\s)[\d.]+(?:px|pt|em|rem|%|vw|vh|vmin|vmax|ex|ch|cap|lh|q|mm|cm|in|pc)?(?:\s*\/\s*[\w.%-]+)?\s+/gi;
    let last = null; for (const s of value.matchAll(size)) last = s;
    if (!last) continue;
    splitFamilies(value.slice(last.index + last[0].length)).forEach(add);
  }
  return [...out.values()];
}
const cssString = value => `"${String(value).replace(/["\\\n\r]/g, c => (c === '\n' || c === '\r' ? ' ' : `\\${c}`))}"`;
const FONT_FORMATS = { otf: 'opentype', ttf: 'truetype', woff2: 'woff2', woff: 'woff' };
export function fontLibraryStyle(html, fontLibrary) {
  if (!Array.isArray(fontLibrary) || !fontLibrary.length) return '';
  const names = fontNamesInHtml(html);
  if (!names.length) return '';
  const rules = [];
  for (const family of fontLibrary) {
    if (!family || !Array.isArray(family.faces) || !family.faces.length) continue;
    const keys = new Set([family.family, ...(Array.isArray(family.aliases) ? family.aliases : [])].map(fontKey).filter(Boolean));
    for (const name of names) {
      if (!keys.has(fontKey(name))) continue;
      for (const face of family.faces) {
        if (!face || typeof face.url !== 'string' || !face.url) continue;
        const ext = (/\.([a-z0-9]+)(?:[?#].*)?$/i.exec(face.url) || [])[1];
        const format = face.format || FONT_FORMATS[String(ext || '').toLowerCase()];
        const weight = Number.isFinite(Number(face.weight)) && face.weight !== '' && face.weight !== null ? String(Number(face.weight)) : '100 900';
        const style = face.style === 'italic' ? 'italic' : 'normal';
        rules.push(`@font-face{font-family:${cssString(name)};src:url(${cssString(face.url)})${format ? ` format(${cssString(format)})` : ''};font-weight:${weight};font-style:${style};font-display:block}`);
      }
    }
  }
  return rules.length ? `<style data-vw-fontlib>${rules.join('\n').replace(/<\/(style)/gi, '<\\/$1')}</style>` : '';
}

/** 生成 iframe.srcdoc：<base>、基础样式、运行时、启动参数，按约定放在 <head> 最前。 */
// screen：编辑画布的「第 k 屏」（k ≥ 1；1 = init 完成、step(0) 之前）。不给 = 全部显示（不跑 init）。
// cropFallback：true 时裁切一律走兼容方案（背景图），测试和不支持 object-view-box 的浏览器用。
const screenOf = v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : null);
// hold：play 模式里只报 loaded、不跑 init，等父页面发 { vw: 'start' }（放映预加载用，第 13 轮 §4.2）。
// countSteps：play + fast 的探测：逐步快进比对画面，ready 里带 countedSteps / hasStep（第 13 轮 §4.3）。
// fontLibrary：字体库清单，按页面写到的字体名注入 @font-face（第 13 轮 §4.4）。
export function buildSrcdoc({ html, mode = 'edit', project, page, edits, baseHref, runtimeText, fast = false, assetBase, assetUrls, uiScale, timeout, screen, cropFallback, hold, countSteps, fontLibrary } = {}) {
  if (typeof runtimeText !== 'string' || !runtimeText) throw new Error('buildSrcdoc 需要页面运行时全文（loadRuntimeText()）');
  const base = baseHref === null ? '' : (baseHref || defaultBaseHref(project, page, assetBase));
  const boot = {
    mode, pageId: page?.id, size: frameSize(project, page), edits: Array.isArray(edits) ? edits : (page?.edits || []),
    steps: Math.max(0, Number(page?.motion?.steps) || 0), fast: !!fast, assetBase: assetBase || null,
    assets: assetUrls || assetUrlMap(project, page, { assetBase: baseHref === null ? assetBase : undefined }), uiScale: uiScale || 1, timeout: timeout || 5000,
    screen: screenOf(screen), cropFallback: !!cropFallback
  };
  if (hold && mode === 'play' && !countSteps) boot.hold = true;
  if (countSteps) { boot.countSteps = true; boot.mode = 'play'; boot.fast = true; }
  const head = (base ? `<base href="${escapeAttr(base)}">` : '')
    + `<style data-vw-base>${baseStyle(project, page)}</style>`
    + fontLibraryStyle(html, fontLibrary)
    + `<script data-vw-runtime>${safeScript(runtimeText)}</script>`
    + `<script data-vw-boot>vw.__boot(${safeJson(boot)})</script>`;
  return inject(html, head, '<script data-vw-apply>window.vw&&vw.__apply()</script>');
}

/** 缩略图：DOMParser 解析、叠修改单、删掉全部脚本，返回完整 HTML（放进 sandbox="" 的 iframe，再用 CSS 缩放）。需要父页面先加载 /page-runtime.js。 */
export function staticDocument({ html, project, page, edits, baseHref, assetBase, assetUrls, fontLibrary } = {}) {
  const runtime = globalThis.__vwRuntime;
  if (!runtime?.applyEditsToDocument) throw new Error('缩略图需要先在父页面加载 /page-runtime.js（window.__vwRuntime）');
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  runtime.applyEditsToDocument(doc, Array.isArray(edits) ? edits : (page?.edits || []), { assets: assetUrls || assetUrlMap(project, page, {}) });
  for (const node of doc.querySelectorAll('script, noscript')) node.remove();
  for (const node of doc.querySelectorAll('*')) for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
  const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  const style = doc.createElement('style'); style.setAttribute('data-vw-base', ''); style.textContent = baseStyle(project, page);
  head.insertBefore(style, head.firstChild);
  const fontlib = fontLibraryStyle(html, fontLibrary);
  if (fontlib) { const lib = doc.createElement('style'); lib.setAttribute('data-vw-fontlib', ''); lib.textContent = /^<style data-vw-fontlib>([\s\S]*)<\/style>$/.exec(fontlib)[1]; style.after(lib); }
  const base = baseHref === null ? '' : (baseHref || defaultBaseHref(project, page, assetBase));
  if (base) { for (const old of doc.querySelectorAll('base')) old.remove(); const b = doc.createElement('base'); b.setAttribute('href', base); head.insertBefore(b, head.firstChild); }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

// 父页面加载一次运行时（缩略图的 staticDocument 用）
if (typeof document !== 'undefined' && typeof window !== 'undefined' && !window.__vwRuntime && !document.querySelector('script[data-vw-parent-runtime]')) {
  const script = document.createElement('script');
  script.src = '/page-runtime.js';
  script.setAttribute('data-vw-parent-runtime', '');
  (document.head || document.documentElement).appendChild(script);
}

/**
 * 在 container 里放一个页面 iframe。
 * options：{ project, page, mode: 'edit'|'play', container, baseHref?, html?, edits?, fast?, screen?, cropFallback?, assetBase?, assetUrls?, uiScale?, timeout?, runtimeText?,
 *            hold?, countSteps?, fontLibrary?, onMessage(msg), onReady(msg), onError(msg) }
 *   hold：play 模式预加载：文档加载完只报 loaded、不跑 init；调 start() 后才跑（之后照常 ready）。frame.held 为真表示还没 start。
 *   countSteps：数屏探测（自动用 play + fast）：ready 里带 countedSteps、hasStep；用完销毁。
 *   fontLibrary：字体库清单（见 fontLibraryStyle）。
 *   html 不给时按 pageFileUrl(project, page, assetBase) 取；edits 不给时用 page.edits。
 * 返回 { iframe, ready, loaded, held, start, send, setEdits, select（编号或编号数组）, set（目标或目标数组）, addImage, removeImage, step, toEnd, leave, settle, screen, setMode, scrollTo, setUiScale, destroy, reload }
 *   screen(k) → Promise<screen-done 消息>：edit 模式里原地快进到第 k 屏（applied:true）；k 比当前屏小时不能原地回退（applied:false），调用方用 reload({ screen: k }) 另建。
 *   ready：Promise<ready 消息>（reload 后换成新的）；loaded：Promise<loaded 或 ready 消息>（play 模式里文档加载完、修改单叠完，init 可能还在跑；reload 后换成新的）；step()/toEnd() → Promise<step-done 消息>；leave(dir) → Promise<left 消息>；settle(ms) → Promise<settled 消息>
 *   页面 → 父的所有消息都会交给 onMessage（ready、edit、select、editing、paste-image、menu、step-done、left、height、scroll、key、nav、error、settled）。
 */
export function createPageFrame(options = {}) {
  let { project, page, mode = 'edit', container, html, edits, fast = false, screen = null } = options;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', page?.name || page?.id || '页面');
  iframe.dataset.vwPage = page?.id || '';
  const applySize = () => {
    const size = frameSize(project, page);
    iframe.style.cssText = `display:block;border:0;margin:0;padding:0;background:#fff;width:${size.width}px;height:${size.height}px`;
  };
  applySize();
  let destroyed = false, isReady = false, queue = [], generation = 0;
  let held = !!options.hold && mode === 'play' && !options.countSteps;
  let resolveReady, resolveLoaded;
  const waiters = { 'step-done': [], left: [], settled: [], 'screen-done': [], painted: [] };
  const api = {};
  const newReady = () => { isReady = false; api.ready = new Promise(resolve => { resolveReady = resolve; }); api.loaded = new Promise(resolve => { resolveLoaded = resolve; }); };
  newReady();
  const listener = event => {
    if (destroyed || event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.vw !== 'string') return;
    if (msg.vw === 'loaded' || msg.vw === 'ready') resolveLoaded(msg);
    if (msg.vw === 'ready') {
      isReady = true;
      const pending = queue; queue = [];
      for (const item of pending) iframe.contentWindow.postMessage(item, '*');
      resolveReady(msg);
      options.onReady?.(msg);
    }
    if (waiters[msg.vw]) { const w = waiters[msg.vw].shift(); w?.(msg); }
    if (msg.vw === 'error') options.onError?.(msg);
    options.onMessage?.(msg);
  };
  window.addEventListener('message', listener);
  const send = msg => {
    if (destroyed) return;
    if (!isReady || !iframe.contentWindow) { queue.push(msg); return; }
    iframe.contentWindow.postMessage(msg, '*');
  };
  const request = (type, msg) => new Promise(resolve => { if (destroyed) return resolve(null); waiters[type].push(resolve); send(msg); });
  async function load() {
    const mine = ++generation;
    try {
      const [text, runtimeText] = await Promise.all([
        typeof html === 'string' ? html : fetch(pageFileUrl(project, page, options.assetBase), { cache: 'no-cache' }).then(response => {
          if (!response.ok) throw new Error(`读不到页面文件：${page.file}（${response.status}）`);
          return response.text();
        }),
        options.runtimeText || loadRuntimeText()
      ]);
      if (destroyed || mine !== generation) return;
      iframe.srcdoc = buildSrcdoc({ html: text, mode, project, page, edits: edits ?? page.edits ?? [], baseHref: options.baseHref, runtimeText, fast, assetBase: options.assetBase, assetUrls: options.assetUrls, uiScale: options.uiScale, timeout: options.timeout, screen, cropFallback: options.cropFallback, hold: held, countSteps: options.countSteps, fontLibrary: options.fontLibrary });
    } catch (error) {
      if (destroyed || mine !== generation) return;
      options.onError?.({ vw: 'error', phase: 'load', message: error.message, stack: String(error.stack || '') });
      options.onMessage?.({ vw: 'error', phase: 'load', message: error.message });
      const failed = { vw: 'ready', pageId: page?.id, failed: true, error: error.message, steps: 0, nextStep: 0, marks: [], height: 0 };
      resolveLoaded(failed);
      resolveReady(failed);
    }
  }
  Object.assign(api, {
    iframe,
    send,
    // 预加载（hold）的页面翻过去时调：等 loaded 后发 start（只发一次；没 hold 的页面什么也不做）
    start() {
      if (!held || destroyed) return api.loaded;
      held = false;
      const mine = generation;
      return api.loaded.then(msg => {
        if (!destroyed && mine === generation && iframe.contentWindow && !msg?.failed) iframe.contentWindow.postMessage({ vw: 'start' }, '*');
        return msg;
      });
    },
    setEdits(next) { edits = Array.isArray(next) ? next : []; send({ vw: 'edits', edits }); },
    select(id) { send(Array.isArray(id) ? { vw: 'select', ids: id } : { vw: 'select', id: id ?? null }); },
    set(target, kind, after) { send(Array.isArray(target) ? { vw: 'set', targets: target, kind, after } : { vw: 'set', target, kind, after }); },
    addImage(entry, assets) { send({ vw: 'addImage', entry, ...(assets ? { assets } : {}) }); },
    removeImage(id) { send({ vw: 'removeImage', target: id }); },
    step() { return request('step-done', { vw: 'step' }); },
    toEnd() { return request('step-done', { vw: 'toEnd' }); },
    leave(direction = 1) { return request('left', { vw: 'leave', direction }); },
    settle(timeout) { return request('settled', { vw: 'settle', timeout }); },
    // 字体、图片都画出来了（编辑画布换页双缓冲用，不动动画；最多等 timeout）→ Promise<painted 消息>
    painted(timeout) { return request('painted', { vw: 'painted', timeout }); },
    screen(k) { return request('screen-done', { vw: 'screen', screen: k }).then(msg => { if (msg?.applied) screen = msg.screen; return msg; }); },
    setMode(next) { mode = next; send({ vw: 'mode', mode: next }); },
    scrollTo(top) { send({ vw: 'scroll', top }); },
    setUiScale(scale) { send({ vw: 'uiScale', scale }); },
    reload(next = {}) {
      if (destroyed) return api.ready;
      if (next.page) page = next.page;
      if (next.project) project = next.project;
      if ('edits' in next) edits = next.edits;
      html = typeof next.html === 'string' ? next.html : (next.page ? undefined : html);
      if ('fast' in next) fast = !!next.fast;
      if ('screen' in next) screen = next.screen ?? null;
      if (next.mode) mode = next.mode;
      if ('hold' in next) held = !!next.hold && mode === 'play' && !options.countSteps;
      queue = [];
      for (const list of Object.values(waiters)) for (const w of list.splice(0)) w(null);
      newReady();
      applySize();
      load();
      return api.ready;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', listener);
      for (const list of Object.values(waiters)) for (const w of list.splice(0)) w(null);
      iframe.remove();
    }
  });
  // 读当前值的属性（Object.assign 会把 getter 抄成定值，所以单独定义）
  Object.defineProperties(api, {
    held: { get: () => held, enumerable: true },
    mode: { get: () => mode, enumerable: true },
    page: { get: () => page, enumerable: true },
    currentScreen: { get: () => screen, enumerable: true }
  });
  if (container) container.append(iframe);
  load();
  return api;
}
