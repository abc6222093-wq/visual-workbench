// 父页面侧：把一页显示在隔离的 sandbox iframe 里（第 12 轮，docs/round12-contract.md §1–§2）。
// 编辑画布、放映、缩略图、动效检查、导出都用这里，五处一致。父页面只用 postMessage 和页面说话，绝不碰 contentDocument。
//
// 对外：
//   createPageFrame(options) → 控制对象（见函数注释）
//   buildSrcdoc({ html, mode, project, page, edits, baseHref, runtimeText, fast, assetBase, assetUrls, uiScale, timeout, screen, cropFallback }) → 注入后的 HTML 字符串（纯字符串运算，Node 里也能用）
//   staticDocument({ html, project, page, edits, baseHref, assetBase, assetUrls }) → 缩略图用的静态 HTML（叠修改单、删脚本），放进 sandbox="" 的 iframe
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

/** 生成 iframe.srcdoc：<base>、基础样式、运行时、启动参数，按约定放在 <head> 最前。 */
// screen：编辑画布的「第 k 屏」（k ≥ 1；1 = init 完成、step(0) 之前）。不给 = 全部显示（不跑 init）。
// cropFallback：true 时裁切一律走兼容方案（背景图），测试和不支持 object-view-box 的浏览器用。
const screenOf = v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? Number(v) : null);
export function buildSrcdoc({ html, mode = 'edit', project, page, edits, baseHref, runtimeText, fast = false, assetBase, assetUrls, uiScale, timeout, screen, cropFallback } = {}) {
  if (typeof runtimeText !== 'string' || !runtimeText) throw new Error('buildSrcdoc 需要页面运行时全文（loadRuntimeText()）');
  const base = baseHref === null ? '' : (baseHref || defaultBaseHref(project, page, assetBase));
  const boot = {
    mode, pageId: page?.id, size: frameSize(project, page), edits: Array.isArray(edits) ? edits : (page?.edits || []),
    steps: Math.max(0, Number(page?.motion?.steps) || 0), fast: !!fast, assetBase: assetBase || null,
    assets: assetUrls || assetUrlMap(project, page, { assetBase: baseHref === null ? assetBase : undefined }), uiScale: uiScale || 1, timeout: timeout || 5000,
    screen: screenOf(screen), cropFallback: !!cropFallback
  };
  const head = (base ? `<base href="${escapeAttr(base)}">` : '')
    + `<style data-vw-base>${baseStyle(project, page)}</style>`
    + `<script data-vw-runtime>${safeScript(runtimeText)}</script>`
    + `<script data-vw-boot>vw.__boot(${safeJson(boot)})</script>`;
  return inject(html, head, '<script data-vw-apply>window.vw&&vw.__apply()</script>');
}

/** 缩略图：DOMParser 解析、叠修改单、删掉全部脚本，返回完整 HTML（放进 sandbox="" 的 iframe，再用 CSS 缩放）。需要父页面先加载 /page-runtime.js。 */
export function staticDocument({ html, project, page, edits, baseHref, assetBase, assetUrls } = {}) {
  const runtime = globalThis.__vwRuntime;
  if (!runtime?.applyEditsToDocument) throw new Error('缩略图需要先在父页面加载 /page-runtime.js（window.__vwRuntime）');
  const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  runtime.applyEditsToDocument(doc, Array.isArray(edits) ? edits : (page?.edits || []), { assets: assetUrls || assetUrlMap(project, page, {}) });
  for (const node of doc.querySelectorAll('script, noscript')) node.remove();
  for (const node of doc.querySelectorAll('*')) for (const attr of [...node.attributes]) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
  const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  const style = doc.createElement('style'); style.setAttribute('data-vw-base', ''); style.textContent = baseStyle(project, page);
  head.insertBefore(style, head.firstChild);
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
 *            onMessage(msg), onReady(msg), onError(msg) }
 *   html 不给时按 pageFileUrl(project, page, assetBase) 取；edits 不给时用 page.edits。
 * 返回 { iframe, ready, send, setEdits, select, set, addImage, removeImage, step, toEnd, leave, settle, screen, setMode, scrollTo, setUiScale, destroy, reload }
 *   screen(k) → Promise<screen-done 消息>：edit 模式里原地快进到第 k 屏（applied:true）；k 比当前屏小时不能原地回退（applied:false），调用方用 reload({ screen: k }) 另建。
 *   ready：Promise<ready 消息>（reload 后换成新的）；step()/toEnd() → Promise<step-done 消息>；leave(dir) → Promise<left 消息>；settle(ms) → Promise<settled 消息>
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
  let resolveReady;
  const waiters = { 'step-done': [], left: [], settled: [], 'screen-done': [] };
  const api = {};
  const newReady = () => { isReady = false; api.ready = new Promise(resolve => { resolveReady = resolve; }); };
  newReady();
  const listener = event => {
    if (destroyed || event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || typeof msg.vw !== 'string') return;
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
      iframe.srcdoc = buildSrcdoc({ html: text, mode, project, page, edits: edits ?? page.edits ?? [], baseHref: options.baseHref, runtimeText, fast, assetBase: options.assetBase, assetUrls: options.assetUrls, uiScale: options.uiScale, timeout: options.timeout, screen, cropFallback: options.cropFallback });
    } catch (error) {
      if (destroyed || mine !== generation) return;
      options.onError?.({ vw: 'error', phase: 'load', message: error.message, stack: String(error.stack || '') });
      options.onMessage?.({ vw: 'error', phase: 'load', message: error.message });
      resolveReady({ vw: 'ready', pageId: page?.id, failed: true, error: error.message, steps: 0, nextStep: 0, marks: [], height: 0 });
    }
  }
  Object.assign(api, {
    iframe,
    send,
    setEdits(next) { edits = Array.isArray(next) ? next : []; send({ vw: 'edits', edits }); },
    select(id) { send({ vw: 'select', id: id ?? null }); },
    set(target, kind, after) { send({ vw: 'set', target, kind, after }); },
    addImage(entry, assets) { send({ vw: 'addImage', entry, ...(assets ? { assets } : {}) }); },
    removeImage(id) { send({ vw: 'removeImage', target: id }); },
    step() { return request('step-done', { vw: 'step' }); },
    toEnd() { return request('step-done', { vw: 'toEnd' }); },
    leave(direction = 1) { return request('left', { vw: 'leave', direction }); },
    settle(timeout) { return request('settled', { vw: 'settle', timeout }); },
    screen(k) { return request('screen-done', { vw: 'screen', screen: k }).then(msg => { if (msg?.applied) screen = msg.screen; return msg; }); },
    setMode(next) { mode = next; send({ vw: 'mode', mode: next }); },
    scrollTo(top) { send({ vw: 'scroll', top }); },
    setUiScale(scale) { send({ vw: 'uiScale', scale }); },
    get mode() { return mode; },
    get page() { return page; },
    get currentScreen() { return screen; },
    reload(next = {}) {
      if (destroyed) return api.ready;
      if (next.page) page = next.page;
      if (next.project) project = next.project;
      if ('edits' in next) edits = next.edits;
      html = typeof next.html === 'string' ? next.html : (next.page ? undefined : html);
      if ('fast' in next) fast = !!next.fast;
      if ('screen' in next) screen = next.screen ?? null;
      if (next.mode) mode = next.mode;
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
  if (container) container.append(iframe);
  load();
  return api;
}
