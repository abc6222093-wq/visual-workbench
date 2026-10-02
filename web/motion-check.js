import { renderPage } from './render.js';
import { createPlayback } from './playback.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function variant(project) {
  const changed = structuredClone(project);
  function shift(elements) {
    for (const element of elements || []) {
      element.x = Math.max(0, (element.x || 0) + 37);
      element.y = Math.max(0, (element.y || 0) + 23);
      element.width = Math.max(1, (element.width || 1) + 13);
      element.height = Math.max(1, (element.height || 1) + 7);
      element.zIndex = (element.zIndex || 0) + 1;
      if (typeof element.opacity === 'number') element.opacity = Math.max(0.1, element.opacity - 0.1);
      if (element.type === 'text') { element.fontSize = (element.fontSize || 16) + 2; element.color = '#37a4c5'; }
      if (element.type === 'shape' && typeof element.fill === 'string') element.fill = '#37a4c5';
      shift(element.children);
    }
  }
  for (const page of changed.pages) shift(page.elements);
  return changed;
}
function bounded(promise, label, timeout) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeout} ms`)), timeout); })]).finally(() => clearTimeout(timer));
}
async function runPage(project, page, { assetBase, timeout, mount }) {
  const root = renderPage(project, page, { assetBase });
  mount.append(root);
  const errors = [];
  const onWindowError = event => errors.push(event.error || new Error(event.message));
  const onRejection = event => { errors.push(event.reason || new Error('未处理的 Promise 拒绝')); event.preventDefault(); };
  const oldConsoleError = console.error;
  console.error = (...args) => { errors.push(new Error(args.map(String).join(' '))); oldConsoleError.apply(console, args); };
  addEventListener('error', onWindowError);
  addEventListener('unhandledrejection', onRejection);
  const playback = createPlayback(project, page, { root, assetBase, onError: error => errors.push(error) });
  const limit = (promise, label) => bounded(promise, label, timeout);
  try {
    await limit(playback.ready, '初始化');
    for (let index = 0; index < (page.motion?.steps || 0); index++) {
      if (!playback.next()) throw new Error(`第 ${index + 1} 步未开始`);
      await limit((async () => { while (playback.isPlaying()) { if (errors.length) throw errors[0]; await pause(10); } })(), `第 ${index + 1} 步`);
      await pause(0);
      if (errors.length) throw errors[0];
      if (playback.getState().nextStep !== index + 1) throw new Error(`第 ${index + 1} 步没有完成`);
    }
    const index = project.pages.indexOf(page);
    for (const direction of [1, -1]) {
      const toPage = project.pages[index + direction] || page;
      const to = renderPage(project, toPage, { assetBase });
      mount.append(to);
      try { await limit(playback.transition(to, direction), `换页 ${direction > 0 ? '向后' : '向前'}`);
      await pause(0);
      if (errors.length) throw errors[0]; } finally { to.remove(); }
    }
  } finally {
    try { await limit(playback.destroy(), '清理'); } finally {
      removeEventListener('error', onWindowError);
      removeEventListener('unhandledrejection', onRejection);
      console.error = oldConsoleError;
      root.remove();
    }
    if (errors.length) throw errors[0];
  }
}
export async function checkMotion(project, { assetBase = `/data/projects/${encodeURIComponent(project.id)}`, timeout = 5000, mount = document.body, pageId } = {}) {
  const results = [];
  for (const [label, candidate] of [['原项目', project], ['移动与尺寸变体', variant(project)]]) {
    for (const page of candidate.pages) {
      if (pageId && page.id !== pageId) continue;
      try { await runPage(candidate, page, { assetBase, timeout, mount }); results.push({ page: page.id, variant: label, ok: true }); }
      catch (error) { results.push({ page: page.id, variant: label, ok: false, error: String(error?.stack || error) }); }
    }
  }
  return { ok: results.every(result => result.ok), results };
}
