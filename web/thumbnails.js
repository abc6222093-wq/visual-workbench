// 页面缩略图（左侧页面列表、时间轴、网格、总览卡片），第 12 轮：
// 页面文件文本 → page-frame.js 的 staticDocument（叠好修改单、去掉所有脚本）→ 放进 sandbox="" 的 iframe（不跑脚本），
// 按宿主大小 CSS 缩放（contain、居中）。只给看得见（含视口外一小段）的缩略图建 iframe，远离视口的卸掉，
// 所以几十页的项目页面栏也流畅；同一时刻的 iframe 数有上限。
import { pageViewport } from './project-kinds.js';

let frameModule = null;
/** 父页面侧的页面显示模块（web/page-frame.js，子智能体 A 写）。加载失败时下次再试。 */
export function loadFrameModule() {
  frameModule ||= import('./page-frame.js').catch(error => { frameModule = null; throw error; });
  return frameModule;
}

/** 页面文件地址；stamp 是 agent 换过文件后的时间戳（让浏览器重新取）。 */
export function pageFileURL(project, page, stamp = '') {
  const file = page.file || `pages/${page.id}.html`;
  return `/data/projects/${encodeURIComponent(project.id)}/${String(file).split('/').map(encodeURIComponent).join('/')}${stamp ? `?v=${stamp}` : ''}`;
}
const texts = new Map(); // 地址 → Promise<文本>（只留最近的一些）
/** 打开项目时忘掉这个项目的页面文本：打开时服务端可能刚改过页面文件（旧格式转换、按新规则补标记），总览缩略图取的是改之前的 */
export function forgetPageTexts(projectId) {
  const prefix = `/data/projects/${encodeURIComponent(projectId)}/`;
  for (const url of [...texts.keys()]) if (url.startsWith(prefix)) texts.delete(url);
}
export function fetchPageText(url) {
  if (!texts.has(url)) {
    const p = fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : '')).catch(() => '');
    texts.set(url, p);
    p.then(text => { if (!text) texts.delete(url); });
    if (texts.size > 200) texts.delete(texts.keys().next().value);
  }
  return texts.get(url);
}

// 缩略图显示的范围：课件页是整个画板；网页页是设备窗口那一屏（像浏览器截图）
export function thumbSize(project, page) { return pageViewport(project, page); }

function fit(wrapper, frame, size) {
  const W = wrapper.clientWidth, H = wrapper.clientHeight;
  if (!W || !H || !size.width || !size.height) return false;
  const s = Math.min(W / size.width, H / size.height);
  const x = Math.round(((W - size.width * s) / 2) * 100) / 100, y = Math.round(((H - size.height * s) / 2) * 100) / 100;
  const t = `translate(${x}px, ${y}px) scale(${s})`;
  if (frame.style.transform !== t) frame.style.transform = t;
  return true;
}

/**
 * 创建缩略图管理器。getProject() 给当前项目（总览用 null：每张缩略图带自己的项目）；host 里找 [data-preview]；
 * stamp(file) 给页面文件的时间戳；active() 为 false 时不做刷新。max 是同时存在的 iframe 上限。
 */
export function createThumbnails({ getProject = () => null, host, stamp = () => '', active = () => true, rootMargin = '300px 300px', max = 40 } = {}) {
  const entries = new Map(); // wrapper → { project, pageId, visible, frame, sig, token }
  let io = null, ro = null;
  const observers = () => {
    if (!io && typeof IntersectionObserver === 'function') io = new IntersectionObserver(records => {
      for (const r of records) { const e = entries.get(r.target); if (!e) continue; e.visible = r.isIntersecting; if (e.visible) mount(r.target); else unmount(r.target); }
      trim();
    }, { root: null, rootMargin });
    if (!ro && typeof ResizeObserver === 'function') ro = new ResizeObserver(records => { for (const r of records) refit(r.target); });
  };
  const projectOf = e => { const p = getProject(); return p && p.id === e.project.id ? p : e.project; };
  const pageOf = e => projectOf(e).pages.find(p => p.id === e.pageId);
  const signature = (project, page) => JSON.stringify([page.file, page.edits || [], stamp(page.file || ''), page.device, page.size, project.artboard]);
  function refit(wrapper) {
    const e = entries.get(wrapper);
    if (!e?.frame) return;
    const project = projectOf(e), page = pageOf(e);
    if (page) fit(wrapper, e.frame, thumbSize(project, page));
  }
  async function mount(wrapper) {
    const e = entries.get(wrapper);
    if (!e || !e.visible || !wrapper.isConnected) return;
    const project = projectOf(e), page = pageOf(e);
    if (!page) return;
    const sig = signature(project, page);
    if (e.frame && e.sig === sig) return;
    const token = ++e.token;
    const size = thumbSize(project, page);
    let doc = '';
    try {
      const [mod, html] = await Promise.all([loadFrameModule(), fetchPageText(pageFileURL(project, page, stamp(page.file || '')))]);
      doc = html ? mod.staticDocument({ html, project, page, edits: page.edits || [] }) : '';
    } catch { doc = ''; }
    if (token !== e.token || !e.visible || !wrapper.isConnected) return;
    const frame = document.createElement('iframe');
    frame.className = 'vw-thumb-frame';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('tabindex', '-1');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('loading', 'eager');
    frame.style.width = `${size.width}px`;
    frame.style.height = `${size.height}px`;
    frame.srcdoc = doc;
    const old = e.frame;
    e.frame = frame;
    e.sig = sig;
    wrapper.dataset.thumbPage = page.id;
    fit(wrapper, frame, size);
    if (old) { // 新内容画好再换，不闪
      frame.style.visibility = 'hidden';
      wrapper.append(frame);
      frame.addEventListener('load', () => { frame.style.visibility = ''; old.remove(); }, { once: true });
      setTimeout(() => { if (old.isConnected) { frame.style.visibility = ''; old.remove(); } }, 1500);
    } else wrapper.append(frame);
  }
  function unmount(wrapper) {
    const e = entries.get(wrapper);
    if (!e) return;
    e.token++;
    wrapper.querySelectorAll(':scope > iframe').forEach(n => n.remove());
    e.frame = null;
    e.sig = null;
  }
  // 超过上限：卸掉看不见的（IntersectionObserver 回调前偶尔会多出来）
  function trim() {
    const mounted = [...entries].filter(([, e]) => e.frame);
    if (mounted.length <= max) return;
    for (const [w, e] of mounted) { if (mounted.length <= max) break; if (!e.visible || !w.isConnected) { unmount(w); mounted.splice(mounted.findIndex(([x]) => x === w), 1); } }
  }
  function forget(wrapper) { unmount(wrapper); io?.unobserve(wrapper); ro?.unobserve(wrapper); entries.delete(wrapper); }
  /** 一张缩略图（总览卡片直接用；编辑器的页面视图由 refresh 自动填）。 */
  function make(project, page) {
    observers();
    const wrapper = document.createElement('div');
    wrapper.className = 'miniature';
    entries.set(wrapper, { project, pageId: page.id, visible: false, frame: null, sig: null, token: 0 });
    io ? io.observe(wrapper) : requestAnimationFrame(() => { const e = entries.get(wrapper); if (e) { e.visible = true; mount(wrapper); } });
    ro?.observe(wrapper);
    return wrapper;
  }
  function refresh() {
    const project = getProject();
    for (const w of [...entries.keys()]) if (!w.isConnected) forget(w);
    if (!project || !active()) return;
    for (const h of host.querySelectorAll('[data-preview]')) {
      const page = project.pages.find(x => x.id === h.dataset.preview);
      if (!page) continue;
      let wrapper = h.querySelector(':scope > .miniature');
      if (!wrapper) { wrapper = make(project, page); h.replaceChildren(wrapper); continue; }
      const e = entries.get(wrapper);
      if (e && e.visible && e.sig !== signature(project, page)) mount(wrapper);
    }
  }
  function refitAll() { for (const w of entries.keys()) refit(w); }
  const count = () => [...entries.values()].filter(e => e.frame).length;
  return { make, refresh, refit: refitAll, count };
}
