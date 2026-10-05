// 单文件放映版里的放映器（第 12 轮；在浏览器里运行，导出时整段内嵌进 .html）。
// 页面显示、点击推进、换页、快进、动效检查都直接用工作台的 page-frame.js / playback.js / motion-check.js
// （每页一个 sandbox iframe，srcdoc 注入同一套 page-runtime.js），这里只负责：
// 页面文本里的占位符换成文件内的 data: 地址、按窗口缩放、点击 / 按键 / 滑动、页码、自检入口。
import { createPlayback } from './playback.js';
import { checkMotion } from './motion-check.js';
import { frameSize } from './page-frame.js';

const exported = globalThis.__VW_EXPORT__;
const project = exported.project;
const stage = document.getElementById('vw-stage');
const layer = document.getElementById('vw-layer');
const counter = document.getElementById('vw-counter');
const toast = document.getElementById('vw-toast');
layer.style.position = 'absolute';

/** 页面文本里的占位符 → 文件内的 data: 地址 */
export function pageHtml(page) {
  const text = exported.pages[page.id];
  if (typeof text !== 'string') throw new Error(`放映文件里没有这一页：${page.id}`);
  return text.replace(/__VWFILE\[([^\]]+)\]__/g, (all, key) => exported.files[key] || all);
}
// 用户贴进来的图（修改单 addImage）：素材编号 → 文件内的 data: 地址
const assetUrls = {};
for (const asset of project.assets || []) if (exported.files[asset.file]) assetUrls[asset.id] = exported.files[asset.file];
const frameOptions = { runtimeText: exported.runtimeText, assetUrls, baseHref: null };

let toastTimer;
function say(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

let size = frameSize(project, project.pages[0]);
// 页面（课件 = 画板；网页 = 设备窗口，页面在 iframe 里自己滚动）等比缩放到浏览器窗口内居中
function fit() {
  const width = stage.clientWidth || innerWidth;
  const height = stage.clientHeight || innerHeight;
  const scale = Math.min(width / size.width, height / size.height);
  layer.style.transform = `translate(${(width - size.width * scale) / 2}px, ${(height - size.height * scale) / 2}px) scale(${scale})`;
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 200));
globalThis.visualViewport?.addEventListener('resize', fit);

let playback = null;
let page = 0;
function startPlayback() {
  playback = createPlayback({
    project, container: layer, loadHtml: pageHtml, frameOptions,
    onChange(state) {
      page = state.index + 1;
      size = state.size;
      counter.textContent = `${state.index + 1} / ${state.count}`;
      // 点击一律先到页面里（页面自己的点击动画能收到；页面没处理的点击由运行时回 nav 推进）。
      // 只在能触摸的设备上给课件页盖透明挡板，接住手指滑动翻页（iframe 里的触摸事件到不了外层）。
      shield.hidden = size.kind === 'web' || !touchDevice();
      fit();
    },
    onError(error) { console.error(error.message); say(`动效出错：${error.message}`); },
    onEnd() { say('已经是最后一页'); },
  });
  return playback.ready;
}
const advance = () => playback?.next();
const back = () => { if (playback && playback.getState().index === 0) say('已经是第一页'); else playback?.prev(); };

const shield = document.createElement('div');
shield.id = 'vw-shield';
shield.hidden = true;
stage.append(shield);
function touchDevice() {
  try { return (navigator.maxTouchPoints || 0) > 0 || !!globalThis.matchMedia?.('(any-pointer: coarse)').matches; } catch { return false; }
}
// 挡板和页面四周的留白（点不到 iframe 的地方）：点击 / 轻点推进；手指横向滑动：向左滑前进、向右滑后退。
// 点在 iframe 里的事件到不了这里，由页面运行时处理。
let down = null;
stage.addEventListener('pointerdown', event => { if (event.button > 0) return; down = { x: event.clientX, y: event.clientY }; });
stage.addEventListener('pointercancel', () => { down = null; });
stage.addEventListener('pointerup', event => {
  if (!down) return;
  const dx = event.clientX - down.x;
  const dy = event.clientY - down.y;
  down = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) advance(); else back(); }
  else if (Math.hypot(dx, dy) < 24) advance();
});
stage.addEventListener('contextmenu', event => { event.preventDefault(); advance(); });
addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || !playback) return;
  if (event.key === 'f' || event.key === 'F') {
    const root = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    else (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root);
    return;
  }
  if (event.key === 'Escape') return;
  if (playback.handleKey(event.key)) event.preventDefault();
});

// 自检：与工作台「动效检查」同一套逻辑（web/motion-check.js），逐页在看不见的 iframe 里跑
globalThis.vwCheckMotion = async (options = {}) => {
  const mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none';
  document.body.append(mount);
  try {
    const result = await checkMotion(project, { timeout: options.timeout ?? 5000, mount, pageId: options.pageId, loadHtml: pageHtml, frameOptions });
    // phase 是 motion-check 的叫法；variant 给旧的命令行输出用
    for (const row of result.results) row.variant ??= row.phase;
    if (options.pageId && !result.results.length) result.results.push({ ok: false, page: options.pageId, phase: '放映', variant: '放映', error: '放映文件里没有这一页' });
    result.ok = result.results.every(row => row.ok);
    return result;
  } finally { mount.remove(); }
};
globalThis.vwPlayer = {
  advance, back,
  get page() { return page; },
  get busy() { return !playback || playback.isBusy(); },
  get step() { return playback?.getState().nextStep ?? 0; },
  get frame() { return playback?.current?.iframe || null; },
};

// 打开时带 #vw-check 只做检查，不开始放映（命令行检查用）
export const ready = location.hash === '#vw-check' ? Promise.resolve() : startPlayback();
