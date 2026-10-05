import { renderPage } from './render.js';
import { createPlayback } from './playback.js';
import { pageSize, pageViewport } from './project-kinds.js';

// Scaling belongs to the stage, leaving both page roots free for agent transitions.
// 后退（新页序号小于旧页）时，新页先在隐藏状态下快进到最后一步，再由旧页的 transition 过渡；前进仍从第 0 步开始。
export async function showMotionPage(state, id, { stage, label, assetBase, onError }) {
  if (state.motionChanging) return;
  state.motionChanging = true;
  const previous = state.playback;
  const oldId = state.pageId;
  const oldRoot = stage.querySelector('[data-page-id]');
  const page = state.project.pages.find(p => p.id === id);
  const board = renderPage(state.project, page, { assetBase });
  // 第 11 轮：按页自己的尺寸放映；网页页面按设备窗口缩放，整页在舞台里上下滚动
  const { width: PW, height: PH } = pageSize(state.project, page), view = pageViewport(state.project, page);
  const scale = Math.min(innerWidth / view.width, (innerHeight - 90) / view.height);
  let layer = stage.firstElementChild;
  if (!layer || !oldRoot) {
    stage.replaceChildren();
    layer = document.createElement('div');
    layer.style.cssText = `position:relative;transform:scale(${scale});transform-origin:top left`;
    stage.append(layer);
  }
  layer.style.transform = `scale(${scale})`;
  layer.style.width = `${PW}px`;
  layer.style.height = `${PH}px`;
  stage.style.width = `${PW * scale}px`;
  stage.style.height = `${Math.min(PH, view.height) * scale}px`;
  stage.style.overflowY = PH > view.height ? 'auto' : '';
  if (PH > view.height) stage.scrollTop = 0;
  board.style.position = 'absolute';
  board.style.inset = '0';
  board.style.visibility = oldRoot ? 'hidden' : 'visible';
  layer.append(board);
  const oldIndex = state.project.pages.findIndex(p => p.id === oldId);
  const newIndex = state.project.pages.indexOf(page);
  const direction = newIndex > oldIndex ? 1 : -1;
  const backward = previous && oldRoot && oldId !== id && newIndex < oldIndex;
  let playback = null;
  try {
    if (backward) {
      // 快进出错已由 playback 通过 onError 报告；页面照常显示
      playback = createPlayback(state.project, page, { root: board, assetBase, onError, startAtEnd: true });
      await playback.ready.catch(() => {});
    }
    if (previous && oldRoot && oldId !== id) {
      // Initialization errors were already reported; users must still be able to leave.
      const initialized = await previous.ready.then(() => true, () => false);
      board.style.visibility = 'visible';
      if (initialized) await previous.transition(board, direction);
    }
    // Escape or a view change during an asynchronous transition must not restart playback.
    if (state.view !== 'play') { await playback?.destroy(); board.remove(); return; }
    await previous?.destroy();
    oldRoot?.remove();
    board.style.visibility = 'visible';
    state.pageId = id;
    label.textContent = `${newIndex + 1} / ${state.project.pages.length}`;
    state.playback = playback || createPlayback(state.project, page, { root: board, assetBase, onError });
    playback = null;
    // Playback reports initialization failures. Keep its page visible and navigable.
    await state.playback.ready.catch(() => {});
  } catch (error) {
    onError(error);
    await playback?.destroy();
    board.remove();
  } finally { state.motionChanging = false; }
}
