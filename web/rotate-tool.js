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
