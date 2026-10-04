import { loadMotion, finishAnimations } from './motion-runtime.js';

// startAtEnd：初始化后立刻无动画地跑完全部步骤，直接停在本页最后一步的画面（后退到上一页时用，像 PowerPoint）。
// 快进期间页面保持 visibility:hidden，避免闪一下初始画面；之后的下一次点击直接去下一页。
export function createPlayback(project, page, { root, onRender, onComplete, onError, assetBase, startAtEnd = false } = {}) {
  let controller = new AbortController();
  let runtime;
  const staticRoot = root?.cloneNode?.(true);
  let nextStep = 0;
  let playing = false;
  let destroyed = false;
  const steps = page.motion?.steps || 0;
  const report = error => { if (!controller.signal.aborted) onError?.(error); };
  const init = async (toEnd = false) => {
    const activeController = controller;
    const hide = toEnd && root?.style;
    const visibility = hide ? root.style.visibility : '';
    if (hide) root.style.visibility = 'hidden';
    try {
      const loaded = await loadMotion(project, page, root, activeController.signal, assetBase, { fast: toEnd });
      if (activeController.signal.aborted) { loaded.cleanup(); await loaded.handlers.dispose?.(); return; }
      runtime = loaded;
      if (toEnd) await fastForward(activeController.signal);
      if (activeController.signal.aborted) return;
      onRender?.(getState());
    } catch (error) { if (!activeController.signal.aborted) onError?.(error); throw error; }
    finally { if (hide) root.style.visibility = visibility; }
  };
  // 快进：按顺序跑完 step(0..steps-1)，每步后把 root 里的有限动画（Web Animations 和 anime.js 的）直接跳到结尾。
  // 某一步出错只报告，不让 ready 失败：页面照常显示，下一次点击去下一页。
  async function fastForward(signal) {
    const finishAll = () => { finishAnimations(root); runtime.finish?.(); };
    finishAll();
    try {
      for (let index = 0; index < steps; index++) {
        if (signal.aborted) return;
        runtime.setStep(index);
        await runtime.handlers.step(index);
        finishAll();
      }
    } catch (error) {
      if (!signal.aborted) onError?.(error);
    } finally {
      runtime.setFast(false);
    }
    if (signal.aborted) return;
    nextStep = steps;
    if (steps > 0) onComplete?.();
  }
  let ready = init(startAtEnd);
  ready.catch(() => {});
  function getState() { return { nextStep, totalSteps: steps }; }
  function next() {
    if (destroyed || playing || nextStep >= steps) return false;
    playing = true;
    const index = nextStep;
    const signal = controller.signal;
    ready.then(async () => {
      if (signal.aborted) return;
      runtime.setStep(index);
      await runtime.handlers.step(index);
      if (signal.aborted) return;
      nextStep++;
      onRender?.(getState());
      if (nextStep === steps) onComplete?.();
    }).catch(report).finally(() => { if (!signal.aborted) playing = false; });
    return true;
  }
  async function transition(to, direction = 1) {
    await ready;
    if (controller.signal.aborted) return;
    if (typeof runtime.handlers.transition === 'function') await runtime.handlers.transition({ from: root, to, direction });
  }
  function destroy() {
    if (destroyed) return Promise.resolve();
    destroyed = true;
    controller.abort();
    let disposal = Promise.resolve();
    if (runtime) {
      runtime.cleanup();
      try { disposal = Promise.resolve(runtime.handlers.dispose?.()); }
      catch (error) { disposal = Promise.reject(error); }
    }
    playing = false;
    return disposal.catch(error => { onError?.(error); });
  }
  async function reset() {
    await destroy();
    await ready.catch(() => {});
    if (root && staticRoot) {
      for (const attr of [...root.attributes]) root.removeAttribute(attr.name);
      for (const attr of staticRoot.attributes) root.setAttribute(attr.name, attr.value);
      root.replaceChildren(...[...staticRoot.childNodes].map(node => node.cloneNode(true)));
    }
    controller = new AbortController();
    runtime = undefined;
    nextStep = 0;
    playing = false;
    destroyed = false;
    ready = init();
    ready.catch(() => {});
    return ready;
  }
  return { get ready() { return ready; }, start() { return false; }, next, transition, reset, destroy, getState, isPlaying() { return playing; } };
}
