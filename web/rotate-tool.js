// 画布旋转把手的计算（第 9 轮）：只做数学，不碰 DOM 和项目状态。
// 角度：0° 朝上，顺时针为正，和元素的 rotation 一致。
export function pointerAngle(center, point) {
  return Math.atan2(point.x - center.x, center.y - point.y) * 180 / Math.PI;
}
// 规范到 (-180, 180]
export function normalizeAngle(angle) {
  let a = ((angle % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Object.is(a, -0) ? 0 : a;
}
// 拖动旋转：起始角度 + 指针转过的角度；接近 45° 的倍数（默认 4° 以内）吸附，Alt 关闭吸附。
export function rotateFromPointer({ start, center, from, to, snap = 4, disabled = false }) {
  const raw = normalizeAngle(start + pointerAngle(center, to) - pointerAngle(center, from));
  if (disabled) return { rotation: Math.round(raw * 10) / 10, snapped: false };
  const nearest = Math.round(raw / 45) * 45;
  if (Math.abs(raw - nearest) <= snap) return { rotation: normalizeAngle(nearest), snapped: true };
  return { rotation: Math.round(raw), snapped: false };
}
// 旋转把手放哪：优先元素下方；下方放不下放上方；上下都贴边放右侧 / 左侧；四面都放不下放元素内部底边中央，始终能点到。
// box / board 都是屏幕矩形；need 是把手外缘到元素边的距离（屏幕像素）。返回元素自身坐标系里的 CSS 位置。
export function rotateHandlePlacement({ box, board, need, size, gap }) {
  const fits = {
    bottom: !board || box.bottom + need <= board.bottom,
    top: !board || box.top - need >= board.top,
    right: !board || box.right + need <= board.right,
    left: !board || box.left - need >= board.left,
  };
  const side = fits.bottom ? 'bottom' : fits.top ? 'top' : fits.right ? 'right' : fits.left ? 'left' : 'inside';
  const auto = 'auto', mid = `calc(50% - ${size / 2}px)`, out = `calc(100% + ${gap}px)`;
  const style = {
    bottom: { left: '50%', top: out, bottom: auto, right: auto, transform: 'translateX(-50%)' },
    top: { left: '50%', top: auto, bottom: out, right: auto, transform: 'translateX(-50%)' },
    right: { left: out, top: mid, bottom: auto, right: auto, transform: 'none' },
    left: { left: auto, right: out, top: mid, bottom: auto, transform: 'none' },
    inside: { left: '50%', top: auto, bottom: `${gap / 3}px`, right: auto, transform: 'translateX(-50%)' },
  }[side];
  return { side, style };
}
