/*
 * 动起来的部分统一放这里，全部用 anime.js（web/vendor/anime.esm.min.js，MIT），不手写逐帧动画。
 * 系统开了「减少动态效果」时，循环动画一律不跑，只保留瞬间的状态切换。
 */
import { animate } from "../vendor/anime.esm.min.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// 每次重画编辑器后，旧节点上的循环动画要停掉，避免越积越多
const running = new Set();
function track(animation) {
  running.add(animation);
  return animation;
}
export function stopLoops() {
  for (const a of running) a.cancel();
  running.clear();
}

/* 小兔：呼吸、眨眼、睡觉冒泡 */
export function liven(root = document) {
  if (reduced()) return;
  root.querySelectorAll(".g-mascot").forEach((svg) => {
    if (svg.dataset.alive) return;
    svg.dataset.alive = "1";
    const figure = svg.querySelector(".m-figure");
    const sleeping = svg.classList.contains("is-sleep");
    track(
      animate(figure, {
        scale: [1, sleeping ? 1.035 : 1.02],
        duration: sleeping ? 2400 : 1800,
        ease: "inOutSine",
        loop: true,
        alternate: true,
      }),
    );
    if (svg.classList.contains("is-awake")) {
      track(
        animate(svg.querySelector(".m-eyes"), {
          scaleY: [1, 0.12, 1],
          duration: 240,
          ease: "inOutQuad",
          loop: true,
          loopDelay: 3600 + Math.random() * 1800,
        }),
      );
    }
    const zz = svg.querySelectorAll(".m-zz circle");
    if (zz.length) {
      track(
        animate(zz, {
          translateY: [0, -3],
          opacity: [0.2, 0.8],
          duration: 1400,
          delay: (_, i) => i * 260,
          ease: "inOutSine",
          loop: true,
          alternate: true,
        }),
      );
    }
  });
}

/* 跳一下（保存成功的小对勾） */
export function hop(el, height = 7) {
  if (!el || reduced()) return;
  animate(el, {
    translateY: [0, -height, 0],
    scale: [1, 1.06, 1],
    duration: 560,
    ease: "outQuad",
  });
}

/* 出现 / 消失 */
export function popIn(el) {
  if (!el) return;
  if (reduced()) {
    el.style.opacity = "1";
    return;
  }
  return animate(el, {
    opacity: [0, 1],
    translateY: [6, 0],
    scale: [0.85, 1],
    duration: 320,
    ease: "outBack(1.6)",
  });
}
export function fadeOut(el, done) {
  if (!el) return done?.();
  if (reduced()) {
    done?.();
    return;
  }
  animate(el, { opacity: [1, 0], translateY: [0, -6], duration: 260, ease: "inQuad", onComplete: () => done?.() });
}

/* 放映前的加载画面：光圈慢慢转 */
export function loaderLoop(root) {
  if (reduced()) return [];
  return [
    animate(root.querySelector(".g-loader__halo"), {
      rotate: [0, 360],
      duration: 2400,
      ease: "linear",
      loop: true,
    }),
  ];
}
