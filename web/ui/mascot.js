/*
 * 小兔：工作台的原创几何小动物（扁平 SVG 图标，只有脑袋）。
 * 做法参考 P1：简单几何形拼成的纯白平涂剪影 + 小圆点眼睛，不画渐变、高光、腮红。
 * 造型：圆形脑袋 + 两只胶囊耳朵（醒着时右耳歪一点）。
 *
 * 只用在三处：左上角标志、顶栏 agent 状态、右侧没选中元素时的空状态。
 *
 * mascot({ pose, size, badge, disc, label })
 *   pose:  "awake" 醒着 | "sleep" 睡着（眯眼、耳朵耷拉、冒小圆泡）| "happy" 开心（^ ^）
 *   badge: true 时垫一个浅浅的粉紫蓝圆底（白底界面上用，不然白色剪影看不见）
 *   disc:  true 时是放在「白色圆钮」上的版本（编辑器里用）：小兔浅灰紫、上浅下深，眼睛深一点；
 *          外面的白色圆钮用 CSS 的 .g-disc-badge 包
 * 返回 SVG 字符串。眨眼、呼吸交给 ui/motion.js。
 */
let seq = 0;

const WHITE = "#ffffff";
const EYE_DEFAULT = "#6a55c8";

function eyes(pose, y, l, r, EYE = EYE_DEFAULT) {
  if (pose === "sleep")
    return `<g class="m-eyes" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"><path d="M${l - 2.4} ${y}h4.8M${r - 2.4} ${y}h4.8"/></g>`;
  if (pose === "happy")
    return `<g class="m-eyes" fill="none" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M${l - 2.6} ${y + 1.2}l2.6-2.6 2.6 2.6M${r - 2.6} ${y + 1.2}l2.6-2.6 2.6 2.6"/></g>`;
  return `<g class="m-eyes" fill="${EYE}"><circle cx="${l}" cy="${y}" r="2.4"/><circle cx="${r}" cy="${y}" r="2.4"/></g>`;
}

// 胶囊耳朵：绕耳根转
function ear(cx, baseY, h, tilt) {
  const w = 10;
  return `<rect class="m-ear" x="${cx - w / 2}" y="${baseY - h}" width="${w}" height="${h + 6}" rx="${w / 2}" transform="rotate(${tilt} ${cx} ${baseY + 2})"/>`;
}

export function mascot({ pose = "awake", size = 48, badge = false, disc = false, label = "" } = {}) {
  const id = `mq${++seq}`;
  const sleep = pose === "sleep";
  // 画在 64×64 里
  const hx = 32,
    hy = 37,
    hr = 17,
    earH = 21;
  // 醒着：左耳竖直、右耳歪一点；睡着：两只耳朵往两边耷拉
  const tiltL = sleep ? -42 : -6,
    tiltR = sleep ? 42 : 24;
  const earL = ear(hx - hr * 0.42, hy - hr * 0.55, earH, tiltL),
    earR = ear(hx + hr * 0.42, hy - hr * 0.55, sleep ? earH : earH * 0.86, tiltR);
  const fill = disc ? `url(#${id}-d)` : WHITE;
  const eye = disc ? "#958ea6" : EYE_DEFAULT;
  const fig = `<g class="m-figure" fill="${fill}">${earL}${earR}<circle class="m-head" cx="${hx}" cy="${hy}" r="${hr}"/>${eyes(pose, hy + 1.5, hx - hr * 0.44, hx + hr * 0.44, eye)}</g>`;
  const zz = sleep
    ? `<g class="m-zz" fill="${disc ? "#cdc6d6" : badge ? WHITE : "#b7a2ff"}"><circle cx="${hx + hr + 6}" cy="${hy - hr + 1}" r="2.3"/><circle cx="${hx + hr + 11}" cy="${hy - hr - 5}" r="1.7"/><circle cx="${hx + hr + 14}" cy="${hy - hr - 10}" r="1.2"/></g>`
    : "";
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  if (disc)
    return `<svg class="g-mascot is-${pose} is-disc" width="${size}" height="${size}" viewBox="0 0 64 64" ${a11y}><defs><linearGradient id="${id}-d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ede8f2"/><stop offset="1" stop-color="#d0c8da"/></linearGradient></defs>${fig}${zz}</svg>`;
  if (!badge)
    return `<svg class="g-mascot is-${pose}" width="${size}" height="${size}" viewBox="0 0 64 64" ${a11y}>${fig}${zz}</svg>`;
  // 圆底：浅浅的粉→紫→蓝，小兔缩进圆里
  return `<svg class="g-mascot is-${pose} has-badge" width="${size}" height="${size}" viewBox="0 0 64 64" ${a11y}><defs><linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3c8e4"/><stop offset="0.5" stop-color="#cdbfff"/><stop offset="1" stop-color="#bcd9ff"/></linearGradient><clipPath id="${id}-c"><circle cx="32" cy="32" r="32"/></clipPath></defs><circle cx="32" cy="32" r="32" fill="url(#${id}-b)"/><g clip-path="url(#${id}-c)"><g transform="translate(6.4 10) scale(0.8)">${fig}${zz}</g></g></svg>`;
}
