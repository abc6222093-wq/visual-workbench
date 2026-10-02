// 导出图片 / PDF 的页面端：渲染指定页面，按顺序播完全部动效步骤，等画面静止后告诉 Node 端可以截图。
// Node 端（src/export/images.js）调用 window.vwExportPage(project, pageId, options)。
import { renderPage } from './render.js';
import { createPlayback } from './playback.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

// Safari 的 error.stack 只有调用位置、不含错误信息，所以先写信息再接 stack
function describe(error) {
  if (!error || typeof error !== 'object') return String(error);
  const head = `${error.name || 'Error'}: ${error.message}`;
  const stack = String(error.stack || '');
  return stack.includes(error.message) ? stack : stack ? `${head}\n${stack}` : head;
}

function bounded(promise, label, timeout) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超过 ${timeout} ms 仍未完成`)), timeout); })
  ]).finally(() => clearTimeout(timer));
}

// 等页面上还在跑的有限时长动画全部结束；无限循环的动画暂停在当前帧，保证截图稳定
async function settleAnimations(timeout) {
  const deadline = Date.now() + timeout;
  for (let round = 0; round < 20; round++) {
    const all = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
    const running = [];
    for (const animation of all) {
      if (animation.playState !== 'running' && animation.playState !== 'pending') continue;
      const end = animation.effect?.getComputedTiming?.().endTime;
      if (!Number.isFinite(end)) { animation.pause(); continue; }
      running.push(animation.finished.catch(() => {}));
    }
    if (!running.length) return;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`动画超过 ${timeout} ms 仍未停下`);
    await bounded(Promise.all(running), '等待动画结束', left);
    await frame();
  }
}

async function settleMedia(root) {
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all([...root.querySelectorAll('img')].map(image => (image.complete ? Promise.resolve() : new Promise(resolve => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); }))
    .then(() => image.decode?.().catch(() => {}))));
}

/** 渲染并播完一页。成功返回 { ok: true }；出错返回 { ok: false, error }（不抛出，方便 Node 端拼中文提示）。 */
window.vwExportPage = async function vwExportPage(project, pageId, { assetBase = '/project', timeout = 5000 } = {}) {
  const page = project.pages.find(item => item.id === pageId);
  if (!page) return { ok: false, error: `找不到页面：${pageId}` };
  const stage = document.getElementById('stage');
  stage.replaceChildren();
  const errors = [];
  addEventListener('error', event => errors.push(event.error || new Error(event.message)));
  addEventListener('unhandledrejection', event => { errors.push(event.reason || new Error('未处理的 Promise 拒绝')); event.preventDefault(); });
  try {
    const root = renderPage(project, page, { assetBase });
    stage.append(root);
    const steps = page.motion?.steps || 0;
    const playback = createPlayback(project, page, { root, assetBase, onError: error => errors.push(error) });
    await bounded(playback.ready, '动效初始化', timeout);
    for (let index = 0; index < steps; index++) {
      if (!playback.next()) throw new Error(`第 ${index + 1} 步没能开始`);
      await bounded((async () => { while (playback.isPlaying()) { if (errors.length) throw errors[0]; await pause(10); } })(), `第 ${index + 1} 步`, timeout);
      await pause(0);
      if (errors.length) throw errors[0];
      if (playback.getState().nextStep !== index + 1) throw new Error(`第 ${index + 1} 步没有完成`);
    }
    await settleAnimations(timeout);
    await bounded(settleMedia(root), '等待图片与字体加载', timeout);
    await frame(); await frame();
    if (errors.length) throw errors[0];
    // 不调用 destroy：destroy 会取消 fill: 'forwards' 的动画，画面会跳回初始状态
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
};
window.vwExportReady = true;
