// 页面缩略图（左侧页面列表、时间轴、网格、总览卡片）：迷你画板按宿主大小缩放，整页完整显示（contain、居中）。
// 第 11 轮抽成独立模块。宿主尺寸为 0（面板折叠、视图切换中、还没挂进文档）时量不到，以前就停在 scale(1)
// 的原始尺寸，只露出画板左上角一块。现在每张缩略图都挂 ResizeObserver：宿主一有大小（展开、切回列表、窗口变化）
// 就自动重算，不依赖调用方记得 refit()。
import { renderPage, patchPage } from './render.js';
import { pageSize as kindPageSize } from './project-kinds.js';

// 页面自己的尺寸（网页项目每页高度不同）；没有就用画板
export function pageSize(project, page) { return kindPageSize(project, page); }

// 迷你画板的尺寸跟页面走（renderPage 按画板尺寸画；网页项目的竖长页要改成页自己的高度）
function sizeBoard(board, size) {
  const w = `${size.width}px`, h = `${size.height}px`;
  if (board.style.width !== w) board.style.width = w;
  if (board.style.height !== h) board.style.height = h;
}

export function fitThumb(wrapper, board, project, page) {
  const size = pageSize(project, page);
  sizeBoard(board, size);
  const W = wrapper.clientWidth, H = wrapper.clientHeight;
  if (!W || !H || !size.width || !size.height) return false;
  const s = Math.min(W / size.width, H / size.height);
  const x = Math.round(((W - size.width * s) / 2) * 100) / 100, y = Math.round(((H - size.height * s) / 2) * 100) / 100;
  const transform = `translate(${x}px, ${y}px) scale(${s})`;
  if (board.style.transform !== transform) board.style.transform = transform;
  if (board.style.transformOrigin !== 'left top') board.style.transformOrigin = 'left top';
  return true;
}

// 所有缩略图共用一个 ResizeObserver：wrapper → { board, pageId, page, getProject }
const watched = new WeakMap();
let observer = null;
function fitEntry(wrapper) {
  const entry = watched.get(wrapper);
  if (!entry) return false;
  const project = entry.getProject();
  const page = project?.pages?.find((p) => p.id === entry.pageId) || entry.page;
  return fitThumb(wrapper, entry.board, project || entry.project, page);
}
function watch(wrapper, entry) {
  watched.set(wrapper, entry);
  if (!observer && typeof ResizeObserver === 'function') observer = new ResizeObserver((records) => { for (const r of records) fitEntry(r.target); });
  observer?.observe(wrapper);
}

/**
 * 创建缩略图管理器。getProject() 给当前项目；thumbOptions() 给 renderPage / patchPage 的选项；
 * host 是放缩略图的根（里面找 [data-preview]）；active() 为 false 时不做空闲刷新。
 */
export function createThumbnails({ getProject, thumbOptions, host, active = () => true, idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 60)), cancelIdle = globalThis.cancelIdleCallback || clearTimeout }) {
  let handle = null;
  function make(project, page) {
    const wrapper = document.createElement('div');
    wrapper.className = 'miniature';
    const board = renderPage(project, page, thumbOptions(project));
    board.removeAttribute('data-page-id');
    wrapper.append(board);
    sizeBoard(board, pageSize(project, page));
    watch(wrapper, { board, pageId: page.id, page, project, getProject: () => getProject() || project });
    // 没有 ResizeObserver 的环境兜底：下一帧量一次
    if (!observer) requestAnimationFrame(() => fitEntry(wrapper));
    return wrapper;
  }
  // 所有缩略图重新量一遍（ResizeObserver 已经自动做；留给调用方强制重算）
  function refit() {
    for (const h of host.querySelectorAll('[data-preview]')) {
      const wrapper = h.querySelector(':scope > .miniature');
      if (wrapper) fitEntry(wrapper);
    }
  }
  // 空的宿主立刻填上；内容变了的页（按页 JSON 签名比较）空闲时在原来的迷你画板上原地更新，图片复用、不闪
  function refresh(extraSignature = '') {
    const project = getProject();
    if (!project) return;
    const signatures = new Map();
    const signature = (p) => {
      if (!signatures.has(p.id)) signatures.set(p.id, JSON.stringify([p, project.artboard, project.fonts, project.assets, extraSignature]));
      return signatures.get(p.id);
    };
    let dirty = false;
    for (const h of host.querySelectorAll('[data-preview]')) {
      const p = project.pages.find((x) => x.id === h.dataset.preview);
      if (!p) continue;
      if (!h.querySelector(':scope > .miniature')) { h.replaceChildren(make(project, p)); h._thumbSig = signature(p); }
      else if (h._thumbSig !== signature(p)) dirty = true;
    }
    if (!dirty) return;
    cancelIdle(handle);
    handle = idle(() => {
      const current = getProject();
      if (!active() || !current) return;
      signatures.clear();
      for (const h of host.querySelectorAll('[data-preview]')) {
        const p = current.pages.find((x) => x.id === h.dataset.preview);
        const wrapper = h.querySelector(':scope > .miniature'), board = wrapper?.querySelector(':scope > .vw-artboard');
        if (!p || !board || h._thumbSig === signature(p)) continue;
        h._thumbSig = signature(p);
        patchPage(board, current, p, thumbOptions(current));
        // patchPage 会按画板尺寸重写宽高，这里按页自己的尺寸再量一次（尺寸变了也会重算缩放）
        fitThumb(wrapper, board, current, p);
      }
    }, { timeout: 400 });
  }
  return { make, refresh, refit, fitThumb };
}
