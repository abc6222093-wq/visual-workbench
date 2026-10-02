import { loadMotion } from './motion-runtime.js';

export function createPlayback(project, page, { root, onRender, onComplete, onError, assetBase } = {}) {
  let controller = new AbortController();
  let runtime;
  const staticRoot = root?.cloneNode?.(true);
  let nextStep = 0;
  let playing = false;
  let destroyed = false;
  const steps = page.motion?.steps || 0;
  const report = error => { if (!controller.signal.aborted) onError?.(error); };
  const init = async () => {
    const activeController = controller;
    try {
      const loaded = await loadMotion(project, page, root, activeController.signal, assetBase);
      if (activeController.signal.aborted) { loaded.cleanup(); await loaded.handlers.dispose?.(); return; }
      runtime = loaded;
      onRender?.(getState());
    } catch (error) { if (!activeController.signal.aborted) onError?.(error); throw error; }
  };
  let ready = init();
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
