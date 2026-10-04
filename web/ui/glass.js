/*
 * 玻璃层：编辑器背后那一层「背景图 + 薄玻璃」。
 *
 * 做法和样张（docs/design/glass-specimen.html）完全一样：
 *   - 背景图铺满画面
 *   - 每块玻璃都是 LiquidGlass（web/vendor/liquidglass.esm.js，MIT）用 WebGL 画的，
 *     真的把后面的背景折射、弯曲，边缘一圈细白亮边
 *   - 每块玻璃下方一片单色投影，往右下稍微错开，玻璃正下方的投影大部分挖掉
 *
 * 界面本身（文字、按钮、输入框）是另一层，叠在玻璃层上面，背景透明。
 * 界面上写了 data-glass="名字" 的元素，玻璃层就在它正下方垫一块同样大小、同样圆角的玻璃：
 *   data-glass-layer="panel"   直接放在背景上的玻璃（侧栏、操作条、工具条、导航条）
 *   data-glass-layer="control" 放在别的玻璃上面的玻璃
 *   data-glass-frost           磨砂玻璃（中间画布那一块、左右两侧面板）：糊一点、白一点
 * 玻璃的圆角跟着界面元素自己的 border-radius 走：方形面板、胶囊、圆形都可以。
 *
 * 参数全部在下面的 GLASS 里，数值和样张一致，统一在这里微调。
 */
import { LiquidGlass } from "../vendor/liquidglass.esm.js";

export const GLASS = {
  // —— 背景 ——
  // 背景上蒙一层白：让整体偏白底（0 = 原图，越大越白）
  backgroundVeil: 0.22,

  // —— 两侧和顶部的透明玻璃（和样张 window.GLASS 相同，只多加了一点白） ——
  // 通透：0 = 完全透明不加白
  whiteness: 0.04,
  // 变亮：默认背景本来就很亮，超过 0.02 玻璃里就会一片死白
  brightness: 0.0,
  // 饱和度：玻璃里的颜色稍微浓一点
  saturation: 0.15,
  // 磨砂：0 = 不糊
  blur: 0.0,
  // 折射强度：边缘处背景被弯曲的程度
  refraction: 0.7,
  // 玻璃厚度：越小越薄越平
  thickness: 12,
  // 边缘色散：亮边处轻微的分色
  chromAberration: 0.05,
  // 库自带的边缘提亮（太大整块玻璃会发白）
  edgeHighlight: 0.12,
  // 细白亮边：玻璃外沿那一圈 1px 白线的亮度
  rimLine: 0.95,
  // 掠射反光：越靠边越亮
  fresnel: 0.6,
  // 表面高光
  specular: 0.04,

  // —— 投影（和样张相同） ——
  // 贴边的细投影（库自带）
  contactShadow: 0.18,
  // 投影往右、往下错开多少（按玻璃短边的比例）
  shadowShiftX: 0.06,
  shadowShiftY: 0.14,
  // 错开距离的上限（像素）
  shadowShiftMax: 16,
  // 投影颜色（单一颜色）
  shadowColor: "60, 52, 92",
  // 投影深浅（小控件）
  shadowOpacity: 0.34,
  // 大玻璃（侧栏、弹窗）的投影深浅
  shadowOpacityLarge: 0.2,
  // 投影边缘的柔和程度（像素）
  shadowBlur: 8,
  // 大玻璃（面板）的投影：更软、更淡，不出现生硬的边
  largeShadowBlur: 26,
  largeShadowShift: 10,
  // 玻璃正下方的投影透出来多少（太大玻璃会发灰）
  shadowUnderGlass: 0.2,

  // —— 磨砂玻璃（中间画布那一块，和左右两侧面板） ——
  // 磨砂程度：0 = 不糊，1 = 最糊
  frostBlur: 0.8,
  // 磨砂玻璃加多少白
  frostWhiteness: 0.2,
  // 磨砂玻璃里的颜色淡一点（-1 = 黑白）
  frostSaturation: -0.35,

  // —— 带色按钮（「放映」）的颜色浓度 ——
  tint: 0.62,
};

export const DEFAULT_BACKGROUND = "/assets/backgrounds/default.jpg";

/* ------------------------------------------------------------------ */
/* 玻璃层本体                                                          */
/* ------------------------------------------------------------------ */

let layer = null;
let bgImg = null;
let floor = null; // 背景上的投影
let upper = null; // 玻璃上的投影（按钮落在侧栏、顶栏上）
let instance = null;
let initKeys = "";
let initializing = null;
const plates = new Map(); // 名字 -> 玻璃片
let lastScope = null;
let lastRects = "";
const lastPlateRect = new Map(); // 名字 -> 上次的位置，用来只重画动过的玻璃

function libConfig(radius, frost = false) {
  return {
    refraction: GLASS.refraction,
    zRadius: Math.min(GLASS.thickness, radius),
    chromAberration: GLASS.chromAberration,
    edgeHighlight: GLASS.edgeHighlight,
    fresnel: GLASS.fresnel,
    specular: GLASS.specular,
    blurAmount: frost ? GLASS.frostBlur : GLASS.blur,
    brightness: GLASS.brightness + (frost ? GLASS.frostWhiteness : GLASS.whiteness),
    saturation: frost ? GLASS.frostSaturation : GLASS.saturation,
    opacity: 1,
    shadowOpacity: GLASS.contactShadow,
    shadowSpread: 5,
    shadowOffsetY: 2,
    bevelMode: 0,
    cornerRadius: radius,
  };
}

function makeLayer(className) {
  const el = document.createElement("div");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  const img = document.createElement("img");
  img.className = "gl-bg";
  img.alt = "";
  img.decoding = "async";
  const f = document.createElement("canvas");
  f.className = "gl-shadow gl-shadow--floor";
  const u = document.createElement("canvas");
  u.className = "gl-shadow gl-shadow--upper";
  el.append(img, f, u);
  return { el, img, floor: f, upper: u };
}

function ensureLayer() {
  if (layer) return;
  const made = makeLayer("gl-layer");
  layer = made.el;
  bgImg = made.img;
  floor = made.floor;
  upper = made.upper;
  document.body.prepend(layer);
  document.documentElement.style.setProperty("--gl-rim", GLASS.rimLine);
  document.documentElement.style.setProperty("--gl-tint", GLASS.tint);
  loadBackground();
  // 窗口大小变了：重新对齐
  let t;
  const again = () => {
    clearTimeout(t);
    t = setTimeout(() => lastScope && syncGlass(lastScope), 60);
  };
  addEventListener("resize", again);
  new ResizeObserver(again).observe(document.documentElement);
  // 字体、图片晚加载时界面会挪一点：每隔一会儿核对一次位置（只量几块玻璃的位置，几乎不费力），
  // 挪了就重画投影，免得投影和玻璃对不齐、露出生硬的边
  let pointerHeld = false;
  addEventListener("pointerdown", () => (pointerHeld = true), true);
  addEventListener("pointerup", () => (pointerHeld = false), true);
  addEventListener("pointercancel", () => (pointerHeld = false), true);
  setInterval(() => {
    if (pointerHeld || !lastScope || layer.hidden || document.visibilityState !== "visible") return;
    syncGlass(lastScope);
  }, 400);
  document.fonts?.ready.then(again);
}

/*
 * 画一个模糊的形状。Safari 不支持画布的 filter: blur()，
 * 所以用画布自带的「影子」来做模糊：形状本身画在画布外面，只让它的影子落在要的位置。
 * 影子的偏移和模糊不受缩放影响，要手动乘上屏幕倍数（dpr）。
 */
function blurredShape(ctx, dpr, x, y, w, h, radius, blur, color) {
  const FAR = 100000;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * 2 * dpr;
  ctx.shadowOffsetX = FAR * dpr;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#000";
  shape(ctx, x - FAR, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

/* 投影：玻璃形状往右下稍微错开，单一颜色；玻璃正下方的大部分挖掉 */
function shape(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(radius, Math.min(w, h) / 2));
}
function paintShadows(canvas, rects, veil = 0) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 背景上的白纱（画在最底下的投影画布上，玻璃能直接读到，不额外费力）
  if (veil > 0) {
    ctx.fillStyle = `rgba(255,255,255,${veil})`;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }
  for (const { rect: r, radius } of rects) {
    const short = Math.min(r.width, r.height);
    const large = short > 120;
    const dx = large
        ? GLASS.largeShadowShift * 0.4
        : Math.min(short * GLASS.shadowShiftX, GLASS.shadowShiftMax * 0.45),
      dy = large
        ? GLASS.largeShadowShift
        : Math.min(short * GLASS.shadowShiftY, GLASS.shadowShiftMax);
    const blur = large ? GLASS.largeShadowBlur : GLASS.shadowBlur;
    const pad = blur * 4 + Math.max(dx, dy) + 10;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.round((r.width + pad * 2) * dpr));
    off.height = Math.max(1, Math.round((r.height + pad * 2) * dpr));
    const o = off.getContext("2d");
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    blurredShape(
      o,
      dpr,
      pad + dx,
      pad + dy,
      r.width,
      r.height,
      radius,
      blur,
      `rgba(${GLASS.shadowColor},${large ? GLASS.shadowOpacityLarge : GLASS.shadowOpacity})`,
    );
    o.globalCompositeOperation = "destination-out";
    blurredShape(
      o,
      dpr,
      pad + 1,
      pad + 1,
      r.width - 2,
      r.height - 2,
      Math.max(0, radius - 1),
      Math.max(2, blur * 0.25),
      `rgba(0,0,0,${1 - GLASS.shadowUnderGlass})`,
    );
    ctx.drawImage(off, r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2);
  }
}

/* 玻璃的圆角 = 界面元素自己的圆角（最多到短边的一半，也就是胶囊 / 圆） */
function radiusOf(el, r) {
  const v = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  return Math.min(v, Math.min(r.width, r.height) / 2);
}

/*
 * 让玻璃层对齐界面：scope 里所有 data-glass 元素下面各垫一块玻璃。
 * 界面每次重画后调用；位置没变就什么都不做（不会卡）。
 */
export function syncGlass(scope = document) {
  ensureLayer();
  lastScope = scope;
  if (layer.hidden) layer.hidden = false;
  const targets = [...scope.querySelectorAll("[data-glass]")].filter(
    (t) => !t.closest(".modal-backdrop"),
  );
  const seen = new Set();
  const floorRects = [],
    upperRects = [];
  const moved = [];
  let sig = "";
  for (const t of targets) {
    const key = t.dataset.glass;
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    seen.add(key);
    const isControl = t.dataset.glassLayer === "control";
    let plate = plates.get(key);
    if (!plate) {
      plate = document.createElement("div");
      plate.dataset.key = key;
      layer.append(plate);
      plates.set(key, plate);
    }
    const cls = `gl-plate ${isControl ? "gl-plate--control" : "gl-plate--panel"}`;
    if (plate.className !== cls) plate.className = cls;
    const radius = radiusOf(t, r);
    const style = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${radius}px`;
    if (plate.getAttribute("style") !== style) plate.setAttribute("style", style);
    const cfg = JSON.stringify(libConfig(radius, "glassFrost" in t.dataset));
    if (plate.dataset.config !== cfg) plate.dataset.config = cfg;
    (isControl ? upperRects : floorRects).push({ rect: r, radius });
    const one = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${Math.round(radius)}`;
    if (lastPlateRect.get(key) !== one) moved.push(plate);
    lastPlateRect.set(key, one);
    sig += `${key}:${one};`;
  }
  for (const [key, plate] of plates) {
    if (!seen.has(key)) {
      plate.remove();
      plates.delete(key);
      lastPlateRect.delete(key);
    }
  }
  sig += `|${innerWidth}x${innerHeight}@${window.devicePixelRatio}`;
  if (sig !== lastRects) {
    const sizeChanged = !lastRects.endsWith(sig.slice(sig.lastIndexOf("|")));
    lastRects = sig;
    paintShadows(floor, floorRects, GLASS.backgroundVeil);
    paintShadows(upper, upperRects);
    // 只让动过的玻璃重画；窗口大小变了才全部重画
    if (sizeChanged) instance?.markChanged();
    else for (const plate of moved) instance?.markChanged(plate);
  }
  const keys = [...plates.keys()].sort().join(",");
  if (keys !== initKeys) start(keys);
}

async function start(keys) {
  initKeys = keys;
  if (initializing) await initializing.catch(() => {});
  if (initKeys !== keys) return;
  instance?.destroy();
  instance = null;
  // 这一页没有玻璃（比如放映的加载画面）：只留背景图
  if (!keys) return;
  initializing = (async () => {
    await bgImg.decode().catch(() => {});
    // 玻璃按「先面板、后按钮」排好：按钮折射的是面板
    const ordered = [...plates.values()].sort(
      (a, b) =>
        a.classList.contains("gl-plate--control") - b.classList.contains("gl-plate--control"),
    );
    instance = await LiquidGlass.init({ root: layer, glassElements: ordered });
  })();
  try {
    await initializing;
  } catch (err) {
    console.error("玻璃效果没能启动", err);
  } finally {
    initializing = null;
  }
}

/* 当前背景图的地址（放映时铺在作品四周用：全屏时玻璃层在全屏画面外面，看不到） */
export function backgroundURL() {
  return bgImg?.currentSrc || bgImg?.src || DEFAULT_BACKGROUND;
}

/* 放映时藏起来（全屏画面里用不到） */
export function hideGlass() {
  if (layer) layer.hidden = true;
  lastScope = null;
}

/* ------------------------------------------------------------------ */
/* 弹窗：单独一层玻璃，垫在弹窗下面                                    */
/* ------------------------------------------------------------------ */

let modalLayer = null;
let modalInstance = null;
let modalToken = 0;

export async function openModalGlass(sheet) {
  closeModalGlass();
  if (!sheet) return;
  const token = ++modalToken;
  const made = makeLayer("gl-layer gl-layer--modal");
  modalLayer = made.el;
  made.img.src = bgImg?.currentSrc || bgImg?.src || DEFAULT_BACKGROUND;
  document.body.append(modalLayer);
  const r = sheet.getBoundingClientRect();
  const radius = radiusOf(sheet, r);
  const plate = document.createElement("div");
  plate.className = "gl-plate gl-plate--panel";
  plate.setAttribute(
    "style",
    `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${radius}px`,
  );
  plate.dataset.config = JSON.stringify(libConfig(radius));
  modalLayer.append(plate);
  paintShadows(made.floor, [{ rect: r, radius }], GLASS.backgroundVeil);
  await made.img.decode().catch(() => {});
  if (token !== modalToken) return;
  try {
    const inst = await LiquidGlass.init({ root: modalLayer, glassElements: [plate] });
    if (token !== modalToken) inst.destroy();
    else modalInstance = inst;
  } catch (err) {
    console.error("弹窗玻璃没能启动", err);
  }
}

export function closeModalGlass() {
  modalToken++;
  modalInstance?.destroy();
  modalInstance = null;
  modalLayer?.remove();
  modalLayer = null;
}

/* ------------------------------------------------------------------ */
/* 背景图：默认图，或用户自己选的图片（记在浏览器里，下次打开还是它）   */
/* ------------------------------------------------------------------ */

const DB = "visual-workbench-ui",
  STORE = "prefs",
  KEY = "background";
let objectURL = null;

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDo(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBackground() {
  ensureLayer();
  let blob = null;
  try {
    blob = await dbDo("readonly", (s) => s.get(KEY));
  } catch {}
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = blob ? URL.createObjectURL(blob) : null;
  bgImg.src = objectURL || DEFAULT_BACKGROUND;
  await bgImg.decode().catch(() => {});
  instance?.markChanged();
  return !!blob;
}

/* 换成自己的图片：太大的图先缩到最长边 3840 像素，免得浏览器吃力 */
export async function setBackgroundFile(file) {
  const bitmap = await createImageBitmap(file);
  let blob = file;
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest > 3840 || file.size > 8_000_000) {
    const f = Math.min(1, 3840 / longest);
    const c = document.createElement("canvas");
    c.width = Math.round(bitmap.width * f);
    c.height = Math.round(bitmap.height * f);
    c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
    blob = await new Promise((done) => c.toBlob(done, "image/jpeg", 0.9));
  }
  bitmap.close();
  await dbDo("readwrite", (s) => s.put(blob, KEY));
  return loadBackground();
}

export async function resetBackground() {
  try {
    await dbDo("readwrite", (s) => s.delete(KEY));
  } catch {}
  return loadBackground();
}
