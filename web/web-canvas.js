// 网页项目的画布窗口（第 11 轮）：固定比例的「浏览器窗口」里放整页画板，用鼠标滚轮上下浏览。
// 不用原生滚动条：滚动量 S.scrollY 由 app.js 维护，画板用 translateY 平移，这样屏幕坐标、命中测试、把手、吸附线都照常。
// 这里只放纯计算与自动滚动循环，不碰 app.js 的状态。

/** 把滚动位置夹在 [0, 整页高 − 窗口高]。 */
export function clampScroll(y, pageHeight, viewHeight) {
  const max = Math.max(0, pageHeight - viewHeight);
  return Math.min(max, Math.max(0, Number.isNaN(Number(y)) ? 0 : Number(y)));
}

/** 滚轮事件换算成整页像素（行 / 页模式按常见浏览器的做法放大）；只取竖直分量。 */
export function wheelDelta(event, viewHeight) {
  const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? viewHeight : 1;
  return (event.deltaY || 0) * unit;
}

/** 指针靠近窗口上下边缘（edge 屏幕像素以内或已出界）时的滚动速度（整页像素 / 帧，负数向上）；越靠近 / 越出界越快。 */
export function edgeSpeed(clientY, rect, edge = 20, max = 28) {
  if (!rect || rect.height <= edge * 2) return 0;
  const top = clientY - rect.top, bottom = rect.bottom - clientY;
  if (top < edge) return -Math.min(max, 4 + ((edge - top) / edge) * (max - 4));
  if (bottom < edge) return Math.min(max, 4 + ((edge - bottom) / edge) * (max - 4));
  return 0;
}

/**
 * 拖动时贴近窗口上下边缘自动滚动。
 * getRect()：窗口在屏幕上的矩形；scrollBy(dy)：滚动整页像素，返回实际滚了多少；onScroll()：滚动后重新按最后的指针位置算拖动。
 * 返回 { update(event), stop() }：拖动中每次 pointermove 调 update，松手调 stop。
 */
export function createAutoScroll({ getRect, scrollBy, onScroll, edge = 20 }) {
  let raf = 0, last = null;
  const tick = () => {
    raf = 0;
    if (!last) return;
    const speed = edgeSpeed(last.clientY, getRect(), edge);
    if (!speed) return;
    const moved = scrollBy(speed);
    if (moved) onScroll(last);
    raf = requestAnimationFrame(tick);
  };
  return {
    update(event) {
      last = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
      if (!raf && edgeSpeed(last.clientY, getRect(), edge)) raf = requestAnimationFrame(tick);
    },
    stop() { last = null; if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}
