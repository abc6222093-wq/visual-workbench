// 编辑器「步骤视图」（第 5 轮）：在编辑器画板上显示「第 k 步之后」的样子，方便エイ 给后出现的元素排版。
// 做法和放映的快进一样（见 playback.js 的 startAtEnd）：初始化动效模块，快进模式下按顺序跑 step(0..k-1)，
// 每步后把动画直接跳到结尾。动效只改画板上的 DOM；项目数据只读快照，一点不改。
import { loadMotion, finishAnimations } from './motion-runtime.js';

/**
 * 在 root（编辑器画板）上快进到第 count 步之后。
 * 返回 { ready, dispose }：ready 在画面就绪后完成（出错时 reject）；dispose() 停止并清理本次动效。
 */
export function applyStepView({ project, page, root, assetBase, count }) {
  const controller = new AbortController();
  let runtime = null;
  const visibility = root.style.visibility;
  root.style.visibility = 'hidden'; // 快进期间先不显示，避免闪一下静止画面
  const ready = (async () => {
    try {
      const loaded = await loadMotion(project, page, root, controller.signal, assetBase, { fast: true });
      if (controller.signal.aborted) { loaded.cleanup(); await loaded.handlers.dispose?.(); return; }
      runtime = loaded;
      finishAnimations(root);
      const steps = Math.min(count, page.motion?.steps || 0);
      for (let index = 0; index < steps; index++) {
        if (controller.signal.aborted) return;
        runtime.setStep(index);
        await runtime.handlers.step(index);
        finishAnimations(root);
      }
      runtime.setFast(false);
    } finally {
      root.style.visibility = visibility;
    }
  })();
  return {
    ready,
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      if (!runtime) return;
      runtime.cleanup();
      try { Promise.resolve(runtime.handlers.dispose?.()).catch(() => {}); } catch {}
    },
  };
}
