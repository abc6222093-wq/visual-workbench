import { renderPage } from './render.js';
import { createPlayback } from './playback.js';

// Scaling belongs to the stage, leaving both page roots free for agent transitions.
export async function showMotionPage(state, id, { stage, label, assetBase, onError }) {
  if (state.motionChanging) return;
  state.motionChanging = true;
  const previous = state.playback;
  const oldId = state.pageId;
  const oldRoot = stage.querySelector('[data-page-id]');
  const page = state.project.pages.find(p => p.id === id);
  const board = renderPage(state.project, page, { assetBase });
  const scale = Math.min(innerWidth / state.project.artboard.width, (innerHeight - 90) / state.project.artboard.height);
  let layer = stage.firstElementChild;
  if (!layer || !oldRoot) {
    stage.replaceChildren();
    layer = document.createElement('div');
    layer.style.cssText = `position:relative;width:${state.project.artboard.width}px;height:${state.project.artboard.height}px;transform:scale(${scale});transform-origin:top left`;
    stage.append(layer);
  }
  layer.style.transform = `scale(${scale})`;
  stage.style.width = `${state.project.artboard.width * scale}px`;
  stage.style.height = `${state.project.artboard.height * scale}px`;
  board.style.position = 'absolute';
  board.style.inset = '0';
  board.style.visibility = oldRoot ? 'hidden' : 'visible';
  layer.append(board);
  try {
    if (previous && oldRoot && oldId !== id) {
      await previous.ready;
      board.style.visibility = 'visible';
      await previous.transition(board, state.project.pages.findIndex(p => p.id === id) > state.project.pages.findIndex(p => p.id === oldId) ? 1 : -1);
    }
    // Escape or a view change during an asynchronous transition must not restart playback.
    if (state.view !== 'play') { board.remove(); return; }
    await previous?.destroy();
    oldRoot?.remove();
    board.style.visibility = 'visible';
    state.pageId = id;
    label.textContent = `${state.project.pages.indexOf(page) + 1} / ${state.project.pages.length}`;
    state.playback = createPlayback(state.project, page, { root: board, assetBase, onError });
    await state.playback.ready;
  } catch (error) {
    onError(error);
    board.remove();
  } finally { state.motionChanging = false; }
}
