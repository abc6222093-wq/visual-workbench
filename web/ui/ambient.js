/*
 * 背景层：白底上很淡的粉、蓝、紫光，加两组装饰用的薄玻璃片。
 * 玻璃片重叠的地方叠出更浓的粉蓝紫流光（P4 的做法）。
 * 挂在 <body> 最底下，固定不随页面滚动；只在玻璃界面（html.glass-mode）里显示。
 */
import { drift } from "./motion.js";

export function mountAmbient() {
  if (document.querySelector(".g-ambient")) return;
  const layer = document.createElement("div");
  layer.className = "g-ambient";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = `
    <i class="g-light g-light--pink" data-drift="60,40"></i>
    <i class="g-light g-light--blue" data-drift="-50,60"></i>
    <i class="g-light g-light--violet" data-drift="70,-50"></i>
    <i class="g-light g-light--mix" data-drift="-40,-40"></i>
    <div class="g-lenses g-lenses--a" data-drift="10,8,2">
      <span class="g-lens g-lens--circle"></span>
      <span class="g-lens g-lens--capsule"></span>
      <span class="g-caustic"></span>
    </div>
    <div class="g-lenses g-lenses--b" data-drift="-8,-10,-2">
      <span class="g-lens g-lens--circle"></span>
      <span class="g-lens g-lens--dot"></span>
      <span class="g-caustic"></span>
    </div>`;
  document.body.prepend(layer);
  drift(layer);
}
