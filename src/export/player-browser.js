// 单文件放映版里的放映器（在浏览器里运行，导出时整段内嵌进 .html）。
// 页面渲染、点击推进、换页、动效检查都直接用工作台的 render.js / playback.js / motion-check.js，
// 这里只负责：画板按窗口缩放（第 11 轮：每页按自己的尺寸；网页页面按窗口宽度缩放、上下滚动看整页）、点击 / 按键 / 滑动推进、页码显示。
// 换页流程与工作台 web/motion-stage.js 一致：先渲染下一页（隐藏），由当前页的 transition 负责过渡，再销毁当前页。
// 后退到上一页时，那一页直接停在最后一步完成后的画面。
import { renderPage } from './render.js';
import { createPlayback } from './playback.js';
import { checkMotion } from './motion-check.js';
import { isWebProject, pageSize, pageViewport } from './project-kinds.js';

const exported = globalThis.__VW_EXPORT__;
const project = exported.project;
const web = isWebProject(project);
// 当前页的尺寸（整页）与窗口尺寸；课件页两者都等于画板
let W = project.artboard.width;
let H = project.artboard.height;
let VW = W, VH = H;
const stage = document.getElementById('vw-stage');
const counter = document.getElementById('vw-counter');
const toast = document.getElementById('vw-toast');

const layer = document.createElement('div');
layer.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`;
stage.append(layer);
// 网页页面比窗口长：用一个撑高的占位块让放映区可以上下滚动
const sizer = document.createElement('div');
sizer.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:0;pointer-events:none';
stage.append(sizer);
if (web) { stage.style.overflowY = 'auto'; stage.style.touchAction = 'pan-y'; }

// 画板等比缩放到窗口内居中，四周留黑。
// 网页页面：按「该页窗口」（电脑端 1440×900 / 手机端 390×844）缩放到浏览器窗口内，水平居中、从顶部开始，整页上下滚动。
function fit() {
  const width = stage.clientWidth || innerWidth;
  const height = stage.clientHeight || innerHeight;
  if (web) {
    const scale = Math.min(width / VW, height / VH);
    layer.style.transform = `translate(${(width - W * scale) / 2}px, 0px) scale(${scale})`;
    sizer.style.height = `${Math.ceil(H * scale)}px`;
    return;
  }
  const scale = Math.min(width / W, height / H);
  layer.style.transform = `translate(${(width - W * scale) / 2}px, ${(height - H * scale) / 2}px) scale(${scale})`;
}
// 换页时按新页的尺寸重设放映层
function sizeFor(page) {
  ({ width: W, height: H } = pageSize(project, page));
  ({ width: VW, height: VH } = pageViewport(project, page));
  layer.style.width = `${W}px`;
  layer.style.height = `${H}px`;
  fit();
}
fit();
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 200));
globalThis.visualViewport?.addEventListener('resize', fit);

let toastTimer;
function say(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}
function report(error) {
  console.error(error);
  say(`动效出错：${error?.message || error}`);
}

const state = { index: -1, board: null, playback: null, busy: false, broken: false };
function showCounter() { counter.textContent = `${state.index + 1} / ${project.pages.length}`; }

// 后退时新页先在隐藏状态下快进到最后一步（像 PowerPoint 那样显示上一页的结束画面），再由当前页 transition 过渡；前进从第 0 步开始
async function show(index, direction = 1) {
  state.busy = true;
  const previous = state.playback;
  const oldRoot = state.board;
  const page = project.pages[index];
  const board = renderPage(project, page, {});
  board.style.position = 'absolute';
  board.style.inset = '0';
  board.style.visibility = oldRoot ? 'hidden' : 'visible';
  layer.append(board);
  let broken = false;
  // 动效初始化或某一步出错时，不让放映卡住：再点一下直接去下一页
  const onError = error => { broken = true; if (state.playback === playback) state.broken = true; report(error); };
  let playback = null;
  try {
    if (direction < 0 && oldRoot) {
      playback = createPlayback(project, page, { root: board, onError, startAtEnd: true });
      await playback.ready.catch(() => { broken = true; });
    }
    if (previous && oldRoot) {
      try {
        await previous.ready;
        board.style.visibility = 'visible';
        await previous.transition(board, direction);
      } catch (error) { report(error); }
      await previous.destroy();
      oldRoot.remove();
    }
    board.style.visibility = 'visible';
    sizeFor(page);
    if (web && index !== state.index) stage.scrollTop = 0;
    state.index = index;
    state.board = board;
    state.broken = broken;
    showCounter();
    if (!playback) {
      playback = createPlayback(project, page, { root: board, onError });
      state.playback = playback;
      await playback.ready.catch(() => { state.broken = true; });
    } else state.playback = playback;
  } finally { state.busy = false; }
}

function advance() {
  if (state.busy || !state.playback || state.playback.isPlaying()) return;
  const steps = project.pages[state.index].motion?.steps || 0;
  if (!state.broken && state.playback.getState().nextStep < steps) state.playback.next();
  else if (state.index < project.pages.length - 1) show(state.index + 1, 1);
  else say('已经是最后一页');
}
function back() {
  if (state.busy || !state.playback || state.playback.isPlaying()) return;
  if (state.index > 0) show(state.index - 1, -1);
  else say('已经是第一页');
}

// 点击 / 轻点推进；手指横向滑动：向左滑前进、向右滑后退
let down = null;
stage.addEventListener('pointerdown', event => {
  if (event.button > 0) return;
  down = { x: event.clientX, y: event.clientY };
});
stage.addEventListener('pointercancel', () => { down = null; });
stage.addEventListener('pointerup', event => {
  if (!down) return;
  const dx = event.clientX - down.x;
  const dy = event.clientY - down.y;
  down = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) advance(); else back(); }
  else if (Math.hypot(dx, dy) < 24) advance();
});
addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if ([' ', 'Spacebar', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(event.key)) { event.preventDefault(); advance(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); back(); }
  else if (event.key === 'f' || event.key === 'F') {
    const root = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    else (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root);
  }
});

// 自检：与工作台「动效检查」同一套逻辑，逐页跑完所有步骤和换页（原项目 + 移动与尺寸变体）
globalThis.vwCheckMotion = async (options = {}) => {
  const mount = document.createElement('div');
  // 检查用的页面放在看不见但仍在渲染的位置（隐藏元素在 Safari 里动画可能被节流）；大小取所有页里最大的
  const sizes = project.pages.map(page => pageSize(project, page));
  const mw = Math.max(project.artboard.width, ...sizes.map(size => size.width));
  const mh = Math.max(project.artboard.height, ...sizes.map(size => size.height));
  mount.style.cssText = `position:fixed;left:0;top:0;width:${mw}px;height:${mh}px;opacity:0;pointer-events:none;z-index:-1;overflow:hidden`;
  document.body.append(mount);
  try { return await checkMotion(project, { assetBase: '', timeout: options.timeout ?? 5000, mount, pageId: options.pageId }); }
  finally { mount.remove(); }
};
globalThis.vwPlayer = { advance, back, get page() { return state.index + 1; }, get busy() { return state.busy || !!state.playback?.isPlaying(); } };

// 打开时带 #vw-check 只做检查，不开始放映（命令行检查用，避免放映动效干扰检查结果）
export const ready = location.hash === '#vw-check' ? Promise.resolve() : show(0);
