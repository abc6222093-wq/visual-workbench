// 页面缩略图（左侧页面列表、时间轴、网格、总览卡片）：迷你画板按宿主大小缩放。
// 第 11 轮抽成独立模块：宿主尺寸为 0（面板折叠、视图切换中）时记下来，等看得见再重新量；窗口大小变了也重量。
import { renderPage, patchPage } from './render.js';

export function fitThumb(wrapper, board, project, page) {
  if (!wrapper.clientWidth || !wrapper.clientHeight) return false;
  const size = pageSize(project, page);
  const s = Math.min(wrapper.clientWidth / size.width, wrapper.clientHeight / size.height);
  if (board.style.transform !== `scale(${s})`) board.style.transform = `scale(${s})`;
  board.style.transformOrigin = 'top left';
  return true;
}
// 页面自己的尺寸（网页项目每页高度不同）；没有就用画板
export function pageSize(project, page) {
  const w = page?.size?.width ?? project.artboard.width, h = page?.size?.height ?? project.artboard.height;
  return { width: w, height: h };
}

/**
 * 创建缩略图管理器。getProject() 给当前项目；thumbOptions() 给 renderPage / patchPage 的选项；
 * host 是放缩略图的根（里面找 [data-preview]）；active() 为 false 时不做空闲刷新。
 */
export function createThumbnails({ getProject, thumbOptions, host, active = () => true, idle = globalThis.requestIdleCallback || ((fn) => setTimeout(fn, 60)), cancelIdle = globalThis.cancelIdleCallback || clearTimeout }) {
  let handle = null;
  const pending = new Set(); // 宿主当时量不到大小的缩略图：{ wrapper, board, page }
  function make(project, page) {
    const wrapper = document.createElement('div');
    wrapper.className = 'miniature';
    const board = renderPage(project, page, thumbOptions(project));
    board.removeAttribute('data-page-id');
    wrapper.append(board);
    const entry = { wrapper, board, page };
    requestAnimationFrame(() => { if (!fitThumb(wrapper, board, getProject() || project, page)) pending.add(entry); });
    return wrapper;
  }
  // 所有缩略图重新量一遍（面板展开、视图切换、窗口大小变化后调用）
  function refit() {
    const project = getProject();
    if (!project) return;
    for (const h of host.querySelectorAll('[data-preview]')) {
      const page = project.pages.find((x) => x.id === h.dataset.preview);
      const wrapper = h.querySelector(':scope > .miniature'), board = wrapper?.querySelector(':scope > .vw-artboard');
      if (page && board) fitThumb(wrapper, board, project, page);
    }
    pending.clear();
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
    if (pending.size) for (const entry of [...pending]) if (fitThumb(entry.wrapper, entry.board, project, entry.page)) pending.delete(entry);
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
        fitThumb(wrapper, board, current, p);
      }
    }, { timeout: 400 });
  }
  return { make, refresh, refit, fitThumb };
}
