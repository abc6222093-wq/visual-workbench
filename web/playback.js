// 放映控制（第 12 轮）：当前页一个 play 模式的 iframe + 预加载下一页（隐藏）；点击 / 右键 / 方向键推进，上一页用 fast:true 重建（停在最后一步）。
// 换页顺序：新页 loaded（文档加载完、修改单叠完）→ 显示新页、销毁旧页 → start()（预加载的页这时才跑 init）→ 等 ready（init 跑完）→ 等两帧。
// 预加载的下一页用 hold:true（第 13 轮 §4.2）：隐藏时只解析文档、加载资源，不跑 init，用计时器写的入场也是翻过去才开始。
// 第一页和往回翻（fast）不用 hold。
// 不能先等 ready 再显示：init 里 await 的入场动画在 visibility:hidden 的 iframe 里不会走（Chromium 不推进隐藏 iframe 的动画），会一直停在「正在准备放映…」。
// 每页的步数来自 project.json 的 motion.steps。放映页 player.html、导出放映版都可以用它。
//
// createPlayback({ project, container, pageId?, startAtEnd?, assetBase?, loadHtml?, frameOptions?, onChange?, onError?, onEnd?, onExit? })
//   container：放 iframe 的元素（会设成 position:relative，尺寸 = 当前页 frameSize）；缩放由调用方做（onChange 里有 size）。
//   loadHtml(page) → Promise<string>|string：可选，自己提供页面文件文本（导出的单文件用）；不给时按 assetBase 取。
//   frameOptions：原样传给 createPageFrame（例如 runtimeText、assetUrls、baseHref、timeout）。
//   onChange({ index, pageId, nextStep, total, size, count })：换页或走了一步；onError({ pageId, phase, message })；onEnd()：最后一页最后一步后再推进；onExit()：按 Esc。
// 返回 { ready, next(), prev(), goTo(indexOrPageId, { atEnd }), handleKey(key), getState(), destroy() }
import { createPageFrame, frameSize } from './page-frame.js';

const LEAVE_TIMEOUT = 3000;
const within = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
// 等父页面画两帧（最多 200ms）：刚显示的跨源 iframe 要画出一帧之后 Chromium 才会把鼠标事件路由进去，就绪前的点击会被丢掉
const painted = () => within(new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))), 200);

export function createPlayback({ project, container, pageId, startAtEnd = false, assetBase, loadHtml, frameOptions = {}, onChange, onError, onEnd, onExit } = {}) {
  const pages = project.pages || [];
  let index = Math.max(0, pages.findIndex(p => p.id === pageId));
  let current = null;   // { frame, index, nextStep, total }
  let preload = null;   // { frame, index }
  let busy = false, destroyed = false;
  container.style.position = container.style.position || 'relative';

  const hideFrame = iframe => { iframe.style.position = 'absolute'; iframe.style.left = '0'; iframe.style.top = '0'; iframe.style.visibility = 'hidden'; iframe.setAttribute('aria-hidden', 'true'); iframe.tabIndex = -1; };
  const showFrame = iframe => { iframe.style.visibility = ''; iframe.removeAttribute('aria-hidden'); iframe.tabIndex = 0; };

  async function makeFrame(i, { fast = false, hold = false } = {}) {
    const page = pages[i];
    const html = loadHtml ? await loadHtml(page) : undefined;
    let frame;
    frame = createPageFrame({
      ...frameOptions, project, page, mode: 'play', container, html, edits: page.edits || [], fast, assetBase, hold: hold && !fast,
      onMessage: msg => onFrameMessage(frame, msg),
      onError: msg => onError?.({ pageId: page.id, phase: msg.phase, message: msg.message, stack: msg.stack })
    });
    hideFrame(frame.iframe);
    return frame;
  }
  function onFrameMessage(frame, msg) {
    if (!current || frame !== current.frame || destroyed) return;
    if (msg.vw === 'nav') { if (msg.dir < 0) prev(); else next(); }
    else if (msg.vw === 'key') handleKey(msg.key);
  }
  function state() {
    const page = pages[index];
    return { index, pageId: page?.id, nextStep: current?.nextStep ?? 0, total: current?.total ?? (page?.motion?.steps || 0), size: frameSize(project, page), count: pages.length };
  }
  const changed = () => onChange?.(state());
  function sizeContainer() {
    const size = frameSize(project, pages[index]);
    container.style.width = `${size.width}px`;
    container.style.height = `${size.height}px`;
  }

  async function show(i, { atEnd = false } = {}) {
    let frame;
    if (!atEnd && preload && preload.index === i) { frame = preload.frame; preload = null; }
    else frame = await makeFrame(i, { fast: atEnd });
    await frame.loaded;
    if (destroyed) { frame.destroy(); return; }
    const old = current;
    index = i;
    current = null; // ready 之前不接收这一页的 nav / key（guard 里 busy 也拦着）
    sizeContainer();
    showFrame(frame.iframe);
    try { frame.iframe.focus({ preventScroll: true }); } catch { /* 忽略 */ }
    old?.frame.destroy();
    frame.start();
    const ready = await frame.ready;
    if (destroyed) { frame.destroy(); return; }
    await painted();
    if (destroyed) { frame.destroy(); return; }
    current = { frame, index: i, nextStep: ready?.nextStep ?? 0, total: ready?.steps ?? (pages[i].motion?.steps || 0) };
    if (preload && preload.index !== i + 1) { preload.frame.destroy(); preload = null; }
    if (!preload && i + 1 < pages.length) preload = { index: i + 1, frame: await makeFrame(i + 1, { hold: true }) };
    changed();
  }
  async function guard(fn) {
    if (busy || destroyed) return false;
    busy = true;
    try { await fn(); return true; } finally { busy = false; }
  }
  async function leaveTo(i, direction, atEnd) {
    if (current) await within(current.frame.leave(direction), LEAVE_TIMEOUT);
    await show(i, { atEnd });
  }
  function next() {
    return guard(async () => {
      if (current && current.nextStep < current.total) {
        const done = await current.frame.step();
        if (done && current) { current.nextStep = done.nextStep; current.total = done.total; }
        changed();
        return;
      }
      if (index + 1 >= pages.length) { onEnd?.(); return; }
      await leaveTo(index + 1, 1, false);
    });
  }
  function prev() {
    return guard(async () => {
      if (index <= 0) return;
      await leaveTo(index - 1, -1, true);
    });
  }
  function goTo(target, { atEnd = false } = {}) {
    const i = typeof target === 'number' ? target : pages.findIndex(p => p.id === target);
    if (i < 0 || i >= pages.length) return Promise.resolve(false);
    return guard(() => leaveTo(i, i < index ? -1 : 1, atEnd));
  }
  // 方向键 / 空格 / 回车翻页；网页页面的上下键、空格、翻页键留给页面滚动
  function handleKey(key) {
    const web = frameSize(project, pages[index]).kind === 'web';
    if (key === 'Escape') { onExit?.(); return true; }
    if (['ArrowRight', 'Enter'].includes(key) || (!web && [' ', 'ArrowDown', 'PageDown', 'Spacebar'].includes(key))) { next(); return true; }
    if (['ArrowLeft', 'Backspace'].includes(key) || (!web && ['ArrowUp', 'PageUp'].includes(key))) { prev(); return true; }
    if (key === 'Home') { goTo(0); return true; }
    if (key === 'End') { goTo(pages.length - 1, { atEnd: true }); return true; }
    return false;
  }
  function destroy() {
    destroyed = true;
    current?.frame.destroy(); preload?.frame.destroy();
    current = null; preload = null;
  }
  busy = true;
  const ready = show(index, { atEnd: startAtEnd }).finally(() => { busy = false; });
  return { ready, next, prev, goTo, handleKey, getState: state, destroy, isBusy: () => busy, get current() { return current?.frame || null; } };
}
