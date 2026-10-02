// 编辑器里「预览动效」：不进全屏、不进放映，只在画板上面盖一层临时画面，把本页动效从头到尾播一遍。
// 播的是项目的一份拷贝，画在临时层里；播完（或按 Esc / 再点一次按钮）就把临时层整个拿掉，
// 编辑器里的画板、元素和项目数据一律不碰。页面自己的「换页过渡」不在这里播。
import { renderPage } from './render.js';
import { createPlayback } from './playback.js';

const STEP_GAP_MS = 450; // 两步之间停一下，看得清每一步
const END_HOLD_MS = 700; // 最后一步播完停一下再收起

/**
 * 开始预览。返回 { stop(), done }：stop() 提前结束；done 在预览结束、临时层已拿掉后完成
 * （结果 'finished' | 'stopped' | 'error'）。
 * holder：画板外面那层（#artboard-holder），artboard：编辑器里的画板（#artboard），scale：当前缩放。
 */
export function startMotionPreview({ project, page, holder, artboard, scale, assetBase, onError, onStep }) {
  const projectCopy = structuredClone(project);
  const pageCopy = projectCopy.pages.find(p => p.id === page.id);
  const steps = pageCopy.motion?.steps || 0;
  let stopped = false;
  let reported = false;
  let wake = null; // 正在等的那一步：提前结束时叫醒它
  const report = error => {
    if (stopped || reported) return;
    reported = true;
    onError?.(error);
    wake?.(error);
  };

  // 临时层：盖在画板上面、同样大小同样缩放，挡住所有鼠标操作
  const holderPosition = holder.style.position;
  const artboardVisibility = artboard?.style.visibility ?? '';
  if (getComputedStyle(holder).position === 'static') holder.style.position = 'relative';
  const layer = document.createElement('div');
  layer.className = 'motion-preview-layer';
  layer.dataset.motionPreview = '';
  layer.setAttribute('aria-label', '正在预览动效');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:20;overflow:hidden;cursor:default';
  for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'dragstart', 'contextmenu']) layer.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); });
  const board = renderPage(projectCopy, pageCopy, { assetBase });
  board.style.position = 'absolute';
  board.style.left = '0';
  board.style.top = '0';
  board.style.transform = `scale(${scale})`;
  board.style.transformOrigin = 'top left';
  layer.append(board);
  holder.append(layer);
  if (artboard) artboard.style.visibility = 'hidden';

  let playback;
  let pending = null; // 正在播的那一步 { index, done }
  const sleep = ms => new Promise(done => { const t = setTimeout(done, ms); wake = () => { clearTimeout(t); done(); }; });
  // 播一步，等它真的播完（playback 播完一步会调用 onRender）
  const runStep = index => new Promise((done, failed) => {
    wake = error => (error ? failed(error) : done());
    pending = { index, done };
    if (!playback.next()) failed(new Error('动效没能开始播放'));
  });

  const cleanup = async () => {
    const p = playback;
    playback = null;
    try { await p?.destroy(); } catch {}
    layer.remove();
    holder.style.position = holderPosition;
    if (artboard) artboard.style.visibility = artboardVisibility;
  };

  const done = (async () => {
    let result = 'finished';
    try {
      playback = createPlayback(projectCopy, pageCopy, {
        root: board,
        assetBase,
        onError: report,
        onRender: state => { if (pending && state.nextStep > pending.index) { const p = pending; pending = null; p.done(); } },
      });
      await Promise.race([playback.ready, new Promise((_, failed) => { wake = failed; })]);
      for (let i = 0; i < steps && !stopped; i++) {
        await sleep(i === 0 ? STEP_GAP_MS / 2 : STEP_GAP_MS);
        if (stopped) break;
        onStep?.(i, steps);
        await runStep(i);
      }
      if (!stopped) await sleep(END_HOLD_MS);
      if (stopped) result = 'stopped';
    } catch (error) {
      if (stopped) result = 'stopped';
      else { result = 'error'; report(error); }
    } finally {
      await cleanup();
    }
    return result;
  })();

  return {
    done,
    stop() {
      if (stopped) return done;
      stopped = true;
      wake?.();
      return done;
    },
  };
}
