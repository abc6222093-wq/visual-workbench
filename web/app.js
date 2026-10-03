import { renderPage, updateElementNode } from "./render.js";
import { showMotionPage } from "./motion-stage.js";
import { mountMotionStatus } from "./motion-status.js";
// 编辑器里预览本页动效（第 4 轮）：临时层里播一遍，播完拿掉，不改项目
import { startMotionPreview } from "./motion-preview.js";
// 步骤视图（第 5 轮）：画板显示「第 k 步之后」的样子，方便给后出现的元素排版；只改画板 DOM，不改项目
import { applyStepView } from "./step-view.js";
import {
  clone,
  uid,
  findElement,
  allElements,
  editable,
  mutateElements,
  duplicateElements,
  deleteElements,
  reorderPages,
  createHistory,
  rootSelection,
  resizeGroup,
  referenceText,
} from "./editor.js";
// 实时连接（第 3 轮）：合并エイ 和 agent 的修改
import { createSyncController, mergeProjects, summarizeConflicts } from "./sync.js";
// 玻璃界面组件（第 2 轮视觉）
import { icon } from "./ui/icons.js";
import { mascot } from "./ui/mascot.js";
import { liven, hop, stopLoops, fadeOut, loaderLoop } from "./ui/motion.js";
import {
  syncGlass,
  openModalGlass,
  closeModalGlass,
  hideGlass,
  backgroundURL,
  setBackgroundFile,
  resetBackground,
} from "./ui/glass.js";
const $ = (s) => document.querySelector(s),
  app = $("#app"),
  toast = $("#toast");
const S = {
  view: "home",
  project: null,
  revision: null,
  pageId: null,
  selected: [],
  checked: new Set(),
  history: null,
  dirty: 0,
  saved: 0,
  saving: false,
  conflict: false,
  tab: "layers",
  playback: null,
  scale: 1,
  base: null, // 上次和磁盘一致时的项目（合并 agent 修改时当作共同起点）
  dragging: false,
  events: null,
  sync: null,
  lastConflict: null,
  stale: new Map(), // 被 agent 换过内容的素材文件 → 时间戳（让图片重新加载）
  preview: null, // 正在预览动效时：{ stop, done }
  exportKind: "pdf", // 导出弹窗上次选的类型
  stepView: 0, // 步骤视图：0 = 静止；k = 第 k 步之后
  stepPage: null, // 步骤视图对应的页面（换页就回到静止）
  stepRun: null, // 正在画板上生效的步骤视图 { ready, dispose }
  focus: false, // 专注模式：藏起顶栏和左右面板，画板放大（刷新后不记得）
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
async function api(path, method = "GET", body) {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || data.message || `请求失败 ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}
const path = () => `/api/projects/${encodeURIComponent(S.project.id)}`,
  base = () => `/data/projects/${encodeURIComponent(S.project.id)}`,
  page = () => S.project.pages.find((p) => p.id === S.pageId) || S.project.pages[0];
function notice(m) {
  toast.textContent = m;
  toast.classList.add("visible");
  clearTimeout(notice.t);
  notice.t = setTimeout(() => toast.classList.remove("visible"), 3200);
}
// glass：在这个按钮下面垫一块真玻璃（见 ui/glass.js）。"panel" = 直接放在背景上，"control" = 放在别的玻璃上
function glassAttr(glass) {
  if (!glass) return "";
  const [key, layer = "control"] = glass.split(":");
  return `data-glass="${key}" data-glass-layer="${layer}"`;
}
function gbtn(a, label, { icon: name, cls = "", extra = "", glass = "" } = {}) {
  return `<button class="g-btn ${glass ? "g-on-glass" : ""} ${cls}" data-action="${a}" ${glassAttr(glass)} ${extra}>${name ? icon(name, 17) : ""}${label}</button>`;
}
function round(a, name, title, cls = "", extra = "", glass = "") {
  return `<button class="g-round ${glass ? "g-on-glass" : ""} ${cls}" data-action="${a}" title="${title}" aria-label="${title}" ${glassAttr(glass)} ${extra}>${icon(name, 18)}</button>`;
}
// 不垫玻璃的普通按钮：只有图标 / 只有文字，放在玻璃上或背景上
function ibtn(a, name, title, extra = "") {
  return `<button class="ed-ibtn" data-action="${a}" title="${title}" aria-label="${title}" ${extra}>${icon(name, 18)}</button>`;
}
function tbtn(a, label, name, cls = "", extra = "") {
  return `<button class="ed-tbtn ${cls}" data-action="${a}" title="${label}" ${extra}>${name ? icon(name, 16) : ""}<span>${label}</span></button>`;
}
const TYPE_ICON = { text: "type", image: "image", shape: "shapes", group: "group" };
function shell(active, body) {
  document.documentElement.classList.add("glass-mode");
  stopPreview(); // 换画面时，正在播的动效预览一起结束
  stopLoops();
  closeModalGlass();
  // 左侧导航：当前所在的页面那一格浮起来
  const nav = (a, name, title) =>
    `<button class="ed-ibtn ${active === a ? "is-on" : ""}" data-action="${a}" title="${title}" aria-label="${title}" ${active === a ? 'aria-current="page"' : ""}>${icon(name, 18)}</button>`;
  disposeStepView();
  const focus = active === "editor" && S.focus ? " is-focus" : "";
  app.innerHTML = `<div class="ed-shell${focus}"><aside class="ed-rail"><div class="ed-logo g-disc-badge" title="视觉工作台">${mascot({ size: 38, disc: true, label: "视觉工作台" })}</div><nav class="ed-dock">${nav("home", "grid", "项目总览")}${nav("library", "library", "公共素材库")}${ibtn("background", "image", "更换背景")}</nav><div class="ed-rail__spacer"></div><div class="ed-avatar" title="エイ">E</div></aside><main class="ed-main">${body}</main></div><div id="modal-root"></div>`;
}
// 总览页、素材库的顶部：左边页面名直接放在背景上，右边一个白色圆钮
function head(name, count, action) {
  return `<header class="ed-top"><div class="ed-titlebox"><h1 class="ed-title">${esc(name)}</h1>${count ? `<span class="ed-count ed-count--bg">${count}</span>` : ""}</div><div class="ed-spacer"></div>${action}</header>`;
}
function modal(html) {
  $("#modal-root").innerHTML = document.documentElement.classList.contains("glass-mode")
    ? `<div class="modal-backdrop g-backdrop"><div class="g-sheet" role="dialog" aria-modal="true">${html}</div></div>`
    : `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $(".modal-backdrop").onpointerdown = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };
  // 编辑器里的弹窗：下面垫一层玻璃
  if (document.documentElement.classList.contains("glass-mode")) openModalGlass($(".g-sheet"));
}
function closeModal() {
  closeModalGlass();
  $("#modal-root")?.replaceChildren();
}
function thumb(project, p) {
  const wrapper = document.createElement("div");
  wrapper.className = "miniature";
  const board = renderPage(project, p, {
    assetBase: `/data/projects/${encodeURIComponent(project.id)}`,
  });
  wrapper.append(board);
  requestAnimationFrame(() => {
    const s = Math.min(
      wrapper.clientWidth / project.artboard.width,
      wrapper.clientHeight / project.artboard.height,
    );
    board.style.transform = `scale(${s})`;
    board.style.transformOrigin = "top left";
  });
  return wrapper;
}
async function home() {
  await flush();
  S.view = "home";
  S.project = null;
  S.focus = false;
  disconnectEvents();
  const list = await api("/api/projects");
  S.masters = list.filter((x) => x.master).map((x) => ({ id: x.id, name: x.name }));
  // 缩略图框是 16:10，作品按自己的比例居中放进去（竖版海报不会被裁）
  const fit = ({ width, height }) => {
    const r = width / height / 1.6;
    return r >= 1 ? `width:100%;height:${100 / r}%` : `width:${100 * r}%;height:100%`;
  };
  const card = (item, i) =>
    `<div class="hm-cell"><button class="hm-card" data-action="open" data-id="${esc(item.id)}"><div class="hm-card__thumb"><div class="hm-card__art" style="${fit(item.project.artboard)}" data-thumb="${i}"></div></div><div class="hm-card__info"><strong>${esc(item.name)}</strong><small>${item.project.pages.length} 页 · ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></div><span class="hm-card__tag">${item.master ? "系列母版" : esc(item.project.artboard.preset)}</span></button><button class="ed-add hm-master ${item.master ? "is-on" : ""}" data-action="master" data-id="${esc(item.id)}" data-on="${item.master ? 1 : 0}" title="${item.master ? "取消系列母版" : "设为系列母版"}" aria-label="${item.master ? "取消系列母版" : "设为系列母版"}" aria-pressed="${item.master ? "true" : "false"}">${icon("bookmark", 15)}</button></div>`;
  shell(
    "home",
    `${head("项目总览", `${list.length} 个项目`, `<button class="ed-play" data-action="new">${icon("plus", 15)}<span>新建项目</span></button>`)}<section class="hm-panel" ${glassAttr("home:panel")} data-glass-frost><div class="hm-scroll ed-scroll"><div class="hm-grid">${list.map(card).join("")}<button class="hm-card hm-card--add" data-action="new"><span class="ed-add" aria-hidden="true">${icon("plus", 18)}</span><span>新建项目</span></button></div></div></section>`,
  );
  list.forEach((x, i) => $(`[data-thumb="${i}"]`).append(thumb(x.project, x.project.pages[0])));
  liven(app);
  syncGlass(app);
}
const presets = [
  ["slide-16x9", "演示文稿", 1920, 1080],
  ["web-desktop", "桌面网页", 1440, 900],
  ["web-mobile", "手机网页", 390, 844],
  ["poster-a4", "A4 海报", 2480, 3508],
  ["poster-a3", "A3 海报", 3508, 4961],
  ["custom", "自定义", 1200, 800],
];
function newDialog() {
  modal(
    `<h2>新建项目</h2><form id="new-form"><label class="g-field g-field--stack"><span>项目名称</span><input name="name" required maxlength="200" placeholder="例如：秋季课程提案" autofocus></label>${(S.masters || []).length ? `<label class="g-field g-field--stack"><span>从母版开始</span><select name="master"><option value="">不用母版</option>${S.masters.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label>` : ""}<label class="g-field g-field--stack"><span>画板类型</span><select name="preset">${presets.map((p) => `<option value="${p[0]}">${p[1]} · ${p[2]} × ${p[3]}</option>`).join("")}</select></label><div class="g-sheet__pair"><label class="g-field g-field--stack"><span>宽度</span><input name="width" type="number" min="1" value="1920" required></label><label class="g-field g-field--stack"><span>高度</span><input name="height" type="number" min="1" value="1080" required></label></div><div class="g-sheet__actions">${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("plus", 17)}创建项目</button></div></form>`,
  );
  const f = $("#new-form");
  f.preset.onchange = () => {
    const p = presets.find((p) => p[0] === f.preset.value);
    f.width.value = p[2];
    f.height.value = p[3];
  };
  // 选了母版：画板尺寸跟母版走，下面三项不用填
  if (f.master)
    f.master.onchange = () => {
      for (const field of [f.preset, f.width, f.height]) field.disabled = !!f.master.value;
    };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await api(
        "/api/projects",
        "POST",
        f.master?.value
          ? { name: f.name.value.trim(), fromMaster: f.master.value }
          : {
              name: f.name.value.trim(),
              preset: f.preset.value,
              width: +f.width.value,
              height: +f.height.value,
            },
      );
      closeModal();
      open(result.project.id, result);
    } catch (err) {
      notice(err.message);
    }
  };
}
async function open(id, data) {
  await flush();
  data ||= await api(`/api/projects/${encodeURIComponent(id)}`);
  S.project = data.project;
  S.revision = data.revision;
  S.pageId = S.project.pages[0].id;
  S.selected = [];
  S.checked.clear();
  S.history = createHistory(S.project);
  S.dirty = S.saved = 0;
  S.conflict = false;
  S.base = clone(S.project);
  S.lastConflict = null;
  S.stale.clear();
  S.stepView = 0;
  S.focus = false;
  S.view = "editor";
  renderEditor();
  connectEvents(S.project.id);
}
function pageItem(p, i) {
  return `<div class="ed-page ${p.id === S.pageId ? "active" : ""}" data-page-index="${i}" draggable="true"><input class="g-check ed-page__check" type="checkbox" data-check="${p.id}" ${S.checked.has(p.id) ? "checked" : ""} aria-label="选择第 ${i + 1} 页"><button class="ed-page__open" data-action="switch" data-id="${p.id}"><span class="ed-page__thumb" data-preview="${p.id}"></span><span class="ed-page__label"><b>${String(i + 1).padStart(2, "0")}</b><i>${esc(p.name)}</i></span></button></div>`;
}
function layers(items, depth = 0) {
  return [...items]
    .sort((a, b) => b.zIndex - a.zIndex)
    .map(
      (e) =>
        `<button class="g-row ${S.selected.includes(e.id) ? "selected" : ""}" data-action="select" data-id="${e.id}" style="padding-left:${6 + depth * 18}px"><span class="g-row__icon">${icon(TYPE_ICON[e.type], 15)}</span><span class="g-row__text">${esc(e.name || e.text || e.type)}</span>${e.locked ? `<span class="g-row__meta">${icon("lock", 13)}锁定</span>` : ""}</button>${e.children ? layers(e.children, depth + 1) : ""}`,
    )
    .join("");
}
function property() {
  if (!S.selected.length)
    return `<div class="ed-empty"><span class="g-disc-badge g-disc-badge--lg">${mascot({ size: 46, disc: true })}</span><span>未选择元素</span></div>`;
  const e = findElement(page(), S.selected[0])?.element;
  if (!e) return "";
  const field = (k, label, v = e[k], type = "number") =>
    `<label class="g-field"><span>${label}</span><input data-prop="${k}" type="${type}" value="${esc(v ?? "")}"></label>`;
  return `<div class="ed-selected"><span class="ed-selected__icon">${icon(TYPE_ICON[e.type], 16)}</span><div><strong>${S.selected.length > 1 ? `${S.selected.length} 个元素` : esc(e.name || e.type)}</strong><small>${esc(e.type)} · ${esc(e.id)}</small></div></div><section class="ed-section"><h3 class="ed-heading">位置与大小</h3><div class="ed-pair">${field("x", "X")}${field("y", "Y")}${field("width", "宽度")}${field("height", "高度")}${field("rotation", "旋转")}</div></section>${e.type === "text" ? `<section class="ed-section"><h3 class="ed-heading">文字</h3><label class="g-area">内容<textarea data-prop="text" rows="3">${esc(e.text)}</textarea></label><div class="ed-pair">${field("fontSize", "字号")}${field("fontWeight", "字重")}${field("color", "颜色", e.color, "color")}<label class="g-field"><span>字体</span><select data-prop="font"><option value="">系统默认</option>${S.project.fonts.map((f) => `<option value="${f.id}" ${e.font === f.id ? "selected" : ""}>${esc(f.family)}</option>`).join("")}</select></label></div></section>${textStyleFields(e, field)}` : ""}${e.type === "image" ? `<section class="ed-section"><h3 class="ed-heading">图片</h3><div class="ed-pair">${field("tint", "颜色", hex6(e.tint, "#000000"), "color")}${tbtn("clear-style", "原色", "undo", "", `data-clear="tint" ${e.tint ? "" : "disabled"}`)}</div></section>` : ""}${e.type === "shape" ? `<section class="ed-section"><h3 class="ed-heading">形状</h3><div class="ed-pair">${field("fill", "填充", typeof e.fill === "string" ? e.fill : "#d9d3ef", "color")}</div></section>` : ""}<section class="ed-section"><h3 class="ed-heading">排列</h3><div class="ed-pair">${field("zIndex", "层级")}</div><div class="ed-actions">${tbtn("duplicate", "复制", "copy")}${tbtn("delete", "删除", "trash", "ed-tbtn--danger")}</div></section>`;
}
// 文字的描边、投影（没有时框里显示默认值，改了才写进项目）
function textStyleFields(e, field) {
  const stroke = e.stroke || null,
    shadow = e.shadow || null,
    clear = (root, on) => tbtn("clear-style", "无", "x", "", `data-clear="${root}" ${on ? "" : "disabled"}`);
  return `<section class="ed-section"><h3 class="ed-heading">描边</h3><div class="ed-pair">${field("stroke.color", "颜色", hex6(stroke?.color, "#000000"), "color")}${field("stroke.width", "粗细", stroke?.width ?? 0)}</div><div class="ed-actions">${clear("stroke", stroke)}</div></section><section class="ed-section"><h3 class="ed-heading">投影</h3><div class="ed-pair">${field("shadow.color", "颜色", hex6(shadow?.color, "#000000"), "color")}${field("shadow.blur", "模糊", shadow?.blur ?? STYLE_DEFAULT.shadow.blur)}${field("shadow.x", "X", shadow?.x ?? STYLE_DEFAULT.shadow.x)}${field("shadow.y", "Y", shadow?.y ?? STYLE_DEFAULT.shadow.y)}</div><div class="ed-actions">${clear("shadow", shadow)}</div></section>`;
}
// agent 状态：服务器发现项目文件被工作台以外的程序改动时推送「working」，一段时间没有新改动后推送「idle」
const agentUI = { state: "idle" };
function agentChip() {
  const awake = agentUI.state === "working";
  return `<span class="g-chip ed-agent ${awake ? "is-awake" : ""}" id="agent-chip"><span class="g-disc-badge g-disc-badge--sm">${mascot({ pose: awake ? "awake" : "sleep", size: 17, disc: true })}</span><span>${awake ? "agent 正在改" : "agent 空闲"}</span></span>`;
}
function refreshAgentChip() {
  const chip = $("#agent-chip");
  if (!chip) return;
  chip.outerHTML = agentChip();
  liven($("#agent-chip"));
}
function setAgent(state) {
  const next = state === "working" ? "working" : "idle";
  if (agentUI.state === next) return;
  agentUI.state = next;
  refreshAgentChip();
}
// ---------- 实时连接 ----------
// エイ 正忙（拖动、输入框里有没提交的字、弹窗开着、正在保存、在放映）时不打断她，等她忙完再合并
function isBusy() {
  if (S.view !== "editor" || !S.project) return true;
  if (S.dragging || S.saving || S.assetPromise || S.preview) return true;
  if ($("#modal-root")?.childElementCount) return true;
  const field = document.activeElement;
  if (field?.matches?.("input[data-prop],textarea[data-prop]") && field.value !== field.defaultValue)
    return true;
  return false;
}
function keepSelection() {
  if (!S.project.pages.some((p) => p.id === S.pageId)) S.pageId = S.project.pages[0].id;
  S.selected = S.selected.filter((id) => findElement(page(), id));
  for (const id of [...S.checked]) if (!S.project.pages.some((p) => p.id === id)) S.checked.delete(id);
}
// 合并结果落到界面：agent 的修改进撤销记录（撤销一步就回到她原来的样子）；两边改了同一处时保留エイ 的并提示
function applySync({ project, base, revision, remoteChanged, needsSave, conflicts }) {
  const before = { base: S.base, local: clone(S.project), remote: clone(base) };
  S.base = clone(base);
  S.revision = revision;
  S.conflict = false;
  if (remoteChanged) {
    S.project = clone(project);
    S.history.commit(S.project);
    keepSelection();
  }
  if (needsSave) {
    S.dirty++;
    schedule();
  } else S.saved = S.dirty;
  if (remoteChanged || conflicts.length) renderEditor();
  if (conflicts.length) {
    S.lastConflict = { ...before, labels: summarizeConflicts(conflicts) };
    conflictDialog();
  } else if (remoteChanged) notice("已载入 agent 的最新修改（可以撤销）");
}
function makeSync() {
  return createSyncController({
    isBusy,
    getLocal: () => ({ project: S.project, base: S.base, revision: S.revision }),
    fetchRemote: () => api(path()),
    apply: applySync,
  });
}
// agent 只换了素材 / 动效代码文件内容（项目文件没变）：等エイ 不忙时重画，图片地址带上时间戳重新加载
function refreshFiles(files) {
  const stamp = Date.now();
  for (const file of files) if (file !== "project.json") S.stale.set(file, stamp);
  clearTimeout(refreshFiles.t);
  const attempt = () => {
    if (S.view === "editor" && S.project && !isBusy()) return renderEditor();
    if (S.project) refreshFiles.t = setTimeout(attempt, 300);
  };
  attempt();
}
function bustStale(root) {
  if (!S.stale.size || !S.project) return;
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    for (const [file, stamp] of S.stale)
      if (src.startsWith(base() + "/") && decodeURIComponent(src.split("?")[0]).endsWith("/" + file))
        img.src = `${src.split("?")[0]}?v=${stamp}`;
  });
  // 设了「颜色」的图片画成遮罩色块：遮罩地址同样带上时间戳
  root.querySelectorAll("[data-vw-tint]").forEach((div) => {
    const src = /url\("?([^")]*)"?\)/.exec(div.style.getPropertyValue("mask-image") || div.style.getPropertyValue("-webkit-mask-image"))?.[1] || "";
    for (const [file, stamp] of S.stale)
      if (src.startsWith(base() + "/") && decodeURIComponent(src.split("?")[0]).endsWith("/" + file)) {
        const url = `url(${JSON.stringify(`${src.split("?")[0]}?v=${stamp}`)})`;
        div.style.setProperty("mask-image", url);
        div.style.setProperty("-webkit-mask-image", url);
      }
  });
}
function connectEvents(id) {
  disconnectEvents();
  S.sync = makeSync();
  const events = new EventSource(`/api/projects/${encodeURIComponent(id)}/events`);
  S.events = events;
  const mine = () => S.events === events && S.project?.id === id;
  const data = (e) => {
    try {
      return JSON.parse(e.data);
    } catch {
      return {};
    }
  };
  // hello 在每次连上（包括断线重连）时都会收到：顺便对一下版本，补上断线期间错过的修改
  events.addEventListener("hello", (e) => {
    if (!mine()) return;
    const d = data(e);
    setAgent(d.agent);
    if (d.revision && d.revision !== S.revision) S.sync.notify();
  });
  events.addEventListener("changed", (e) => {
    if (!mine()) return;
    const d = data(e);
    if (d.revision && d.revision !== S.revision) S.sync.notify();
    if (d.external && (d.files || []).some((f) => f !== "project.json")) refreshFiles(d.files);
  });
  events.addEventListener("agent", (e) => {
    if (mine()) setAgent(data(e).state);
  });
}
function disconnectEvents() {
  S.events?.close();
  S.events = null;
  S.sync?.dispose();
  S.sync = null;
  clearTimeout(refreshFiles.t);
  agentUI.state = "idle";
}
function inspectorBody(p) {
  if (S.tab === "library") {
    const list = S.libraryChoices || [];
    return `<div class="ed-assets">${list.length ? list.map((a, i) => `<button class="g-row g-row--tall" data-action="library-copy" data-index="${i}" draggable="true" data-library-file="${esc(a.file)}"><img class="g-row__thumb" src="${esc(a.url)}" alt=""><span class="g-row__text">${esc(a.name)}</span></button>`).join("") : `<p class="ed-note">公共素材库里还没有素材</p>`}</div>`;
  }
  if (S.tab === "assets")
    return `${tbtn("browse-library", "公共素材库", "library", "ed-tbtn--block")}<div class="ed-assets">${S.project.assets.map((a) => `<button class="g-row g-row--tall" data-action="place" data-id="${a.id}" draggable="true" data-asset="${a.id}"><img class="g-row__thumb" src="${base()}/${a.file}" alt=""><span class="g-row__text">${esc(a.name || a.file)}</span>${a.pendingLayout ? `<span class="g-chip g-chip--quiet g-chip--pink">待排版</span>` : ""}</button>`).join("")}</div>`;
  return `<div class="ed-layers ed-scroll">${layers(p.elements)}</div><h3 class="ed-heading ed-heading--main">基础编辑</h3><div class="ed-props">${property()}</div>`;
}
function renderEditor() {
  if (!S.project) return;
  stopPreview();
  clampStepView();
  const p = page();
  const saveState = S.conflict ? "warn" : S.dirty !== S.saved ? "busy" : "ok";
  shell(
    "editor",
    `<header class="ed-top"><div class="ed-titlebox"><h1 class="ed-title">${esc(S.project.name)}</h1>${agentChip()}</div><div class="ed-spacer"></div><div class="ed-bar" ${glassAttr("actions:panel")}>${ibtn("undo", "undo", "撤销", S.history.canUndo ? "" : "disabled")}${ibtn("redo", "redo", "重做", S.history.canRedo ? "" : "disabled")}<span class="ed-save" id="save-chip"><i class="g-dot ${saveState === "ok" ? "" : `g-dot--${saveState}`}"></i><span id="save-status">${{ warn: "保存冲突", busy: "正在保存…", ok: "已保存" }[saveState]}</span></span><span class="ed-sep"></span>${tbtn("brief", "复制给 agent", "copy")}${tbtn("version", "存一版", "bookmark")}${tbtn("versions", "版本列表", "history")}${tbtn("export", "导出", "upload")}<button class="ed-play" data-action="play">${icon("play", 15)}<span>放映</span></button></div></header><div class="ed-grid"><aside class="ed-col ed-pages" ${glassAttr("pages:panel")} data-glass-frost><div class="ed-col-head"><h2>页面</h2><span class="ed-count">${S.project.pages.length}</span><div class="ed-spacer"></div><button class="ed-add" data-action="add-page" title="添加页面" aria-label="添加页面">${icon("plus", 16)}</button></div><div class="page-list ed-scroll">${S.project.pages.map(pageItem).join("")}</div><div class="ed-pages__foot">${tbtn("copy", "复制到新项目", "copyPlus")}${tbtn("reference", "复制引用", "link")}</div></aside><section class="ed-work" ${glassAttr("work:panel")} data-glass-frost><div class="ed-toolbar"><span class="ed-crumb">${esc(p.name)}</span><div class="ed-tools">${tbtn("add-text", "文字", "type")}${tbtn("add-shape", "形状", "shapes")}${tbtn("import", "素材导入", "imagePlus")}${stepSwitcher(p)}${tbtn("preview-motion", "预览动效", "play", "", 'aria-pressed="false"')}<span class="ed-sep"></span><span class="ed-zoom" id="zoom-label"></span>${focusButton()}</div></div><div class="ed-well" id="canvas-well"><div id="artboard-holder"></div></div><div class="ed-foot">${S.project.artboard.width} × ${S.project.artboard.height} px <span>·</span> ${esc(S.project.artboard.preset)}</div></section><aside class="ed-col inspector ed-inspector" ${glassAttr("inspector:panel")} data-glass-frost><div class="g-seg"><button data-action="tab-layers" class="${S.tab === "layers" ? "active" : ""}">图层</button><button data-action="tab-assets" class="${S.tab === "assets" || S.tab === "library" ? "active" : ""}">素材</button><button data-action="versions">版本</button></div><div class="ed-inspector__body ed-scroll">${inspectorBody(p)}</div></aside></div>${S.focus ? `<div class="ed-bar ed-focus-exit" ${glassAttr("focus-exit:panel")}>${ibtn("focus", "minimize", "退出专注模式", 'aria-pressed="true"')}</div>` : ""}`,
  );
  renderBoard();
  mountMotionStatus(S.project, base(), $(".ed-toolbar"));
  S.project.pages.forEach((p) => $(`[data-preview="${p.id}"]`)?.append(thumb(S.project, p)));
  bindDrag();
  decorateEditor();
  bustStale(app);
  syncGlass(app);
}
// 画面上的小反馈：小兔眨眼呼吸、保存状态的小圆点跟着文字变
function decorateEditor() {
  liven(app);
  const status = $("#save-status");
  if (status) new MutationObserver(() => onSaveText(status)).observe(status, { childList: true });
}
function onSaveText(status) {
  const chip = $("#save-chip");
  if (!chip || !chip.contains(status)) return;
  const text = status.textContent;
  const state = text === "已保存" ? "ok" : text === "正在保存…" ? "busy" : "warn";
  const mark = chip.firstElementChild;
  if (state !== "ok") {
    mark.outerHTML = `<i class="g-dot g-dot--${state}"></i>`;
    return;
  }
  // 保存成功：小圆点换成小对勾，轻轻跳一下，再变回小圆点
  mark.outerHTML = `<span class="ed-save__ok">${icon("check", 11)}</span>`;
  const ok = chip.firstElementChild;
  hop(ok, 4);
  clearTimeout(onSaveText.t);
  onSaveText.t = setTimeout(() => {
    if (ok.isConnected) ok.outerHTML = `<i class="g-dot"></i>`;
  }, 1400);
}
function renderBoard() {
  stopPreview();
  disposeStepView();
  clampStepView();
  const holder = $("#artboard-holder");
  if (!holder) return;
  holder.replaceChildren();
  const board = renderPage(S.project, page(), {
    assetBase: base(),
    interactive: true,
    selectedIds: S.selected,
    onSelect: selectCanvas,
  });
  board.id = "artboard";
  holder.append(board);
  const well = $("#canvas-well");
  S.scale = Math.max(
    0.07,
    Math.min(
      (well.clientWidth - 100) / S.project.artboard.width,
      (well.clientHeight - 100) / S.project.artboard.height,
      1,
    ),
  );
  board.style.transform = `scale(${S.scale})`;
  board.style.transformOrigin = "top left";
  holder.style.width = `${S.project.artboard.width * S.scale}px`;
  holder.style.height = `${S.project.artboard.height * S.scale}px`;
  $("#zoom-label").textContent = `${Math.round(S.scale * 100)}%`;
  bustStale(holder);
  // 按下时自己挑要操作的元素（捕获阶段，先于各元素自己的处理）：
  // 锁定的元素（例如盖满整页的纸纹）点不中、也不挡住下面的元素；已选中的元素优先，被别的元素盖住也能接着拖、拉把手。
  board.addEventListener(
    "pointerdown",
    (e) => {
      const { id, resize } = pickElement(board, e);
      e.stopPropagation();
      if (id) return selectCanvas(id, e, resize);
      if (S.selected.length) {
        S.selected = [];
        renderEditor();
      }
    },
    true,
  );
  board.querySelectorAll("[data-element-id]").forEach((n) => {
    if (S.selected.includes(n.dataset.elementId)) {
      const h = document.createElement("span");
      h.className = "resize-handle";
      h.dataset.resize = n.dataset.elementId;
      n.append(h);
    }
  });
  if (S.stepView) startStepView(board);
}
// ---------- 步骤视图 ----------
// 下拉选「第 k 步后」：画板按本页动效快进到第 k 步之后的样子（还没出现的元素藏着、移动过的在移动后的位置）。
// 拖动、缩放照样改元素自己的 x / y / 宽 / 高；松手保存后重画画板，动效从新的位置重新快进。
function stepSwitcher(p) {
  const steps = p.motion?.steps || 0;
  if (!steps) return "";
  const options = [`<option value="0" ${S.stepView ? "" : "selected"}>静止</option>`];
  for (let k = 1; k <= steps; k++)
    options.push(`<option value="${k}" ${S.stepView === k ? "selected" : ""}>第 ${k} 步后</option>`);
  return `<label class="g-field ed-stepview" title="按动效步骤查看这一页（只是看，不改动效）"><span>步骤</span><select data-step-view aria-label="步骤视图">${options.join("")}</select></label>`;
}
function clampStepView() {
  if (!S.project) return;
  const steps = page().motion?.steps || 0;
  if (S.stepPage !== S.pageId || !Number.isInteger(S.stepView) || S.stepView < 0 || S.stepView > steps)
    S.stepView = 0;
  S.stepPage = S.pageId;
}
function syncStepSelect() {
  const select = $("[data-step-view]");
  if (select) select.value = String(S.stepView);
}
function disposeStepView() {
  const run = S.stepRun;
  S.stepRun = null;
  run?.dispose();
}
function startStepView(board) {
  const count = S.stepView;
  const run = applyStepView({ project: S.project, page: page(), root: board, assetBase: base(), count });
  S.stepRun = run;
  run.ready.then(
    () => {
      if (S.stepRun !== run) return;
      board.dataset.stepShown = String(count);
      markSelection(); // 动效改了节点内容时，选中框和缩放把手补回来
    },
    (error) => {
      if (S.stepRun !== run) return;
      notice(`动效错误：${error.message}`);
      S.stepView = 0; // 回到静止
      syncStepSelect();
      renderBoard();
    },
  );
}
function resetStepView() {
  if (!S.stepView) return false;
  S.stepView = 0;
  disposeStepView();
  syncStepSelect();
  return true;
}
// 步骤视图里拖动：只用 CSS translate 跟手（和动效写的 transform 叠加，不冲掉动效的样式）；缩放时直接改宽高
function paintStepDragged(target, old, resizing) {
  const node = $(`#artboard [data-element-id="${CSS.escape(target.id)}"]`);
  if (!node) return;
  if (!resizing) {
    node.style.translate = `${target.x - old.x}px ${target.y - old.y}px`;
    return;
  }
  node.style.width = `${target.width}px`;
  node.style.height = `${target.height}px`;
  if (target.type === "text") node.style.fontSize = `${target.fontSize}px`;
  for (const child of target.children || []) paintDragged(child);
}
// ---------- 专注模式 ----------
function focusButton() {
  return ibtn(
    "focus",
    S.focus ? "minimize" : "maximize",
    S.focus ? "退出专注模式" : "专注模式",
    `aria-pressed="${S.focus ? "true" : "false"}"`,
  );
}
function setFocus(on) {
  if (S.focus === on) return;
  S.focus = on;
  renderEditor();
}
// 点下去的位置上从上到下有哪些元素；跳过锁定的（含锁定分组里的），选中的元素排在最前面
function pickElement(board, e) {
  const p = page(),
    hits = [];
  let handle = null;
  for (const node of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (!board.contains(node)) continue;
    if (node.dataset.resize && S.selected.includes(node.dataset.resize)) handle ??= node.dataset.resize;
    const owner = node.closest("[data-element-id]"),
      id = owner?.dataset.elementId;
    // 步骤视图里还没出现（透明）的元素点不中，除非已经选中它
    if (S.stepView && id && !S.selected.includes(id) && getComputedStyle(owner).opacity === "0") continue;
    if (id && !hits.includes(id) && editable(p, id)) hits.push(id);
  }
  // 缩放把手在指针下面就是要缩放它（即使把手被别的元素盖住）
  if (handle && !e.shiftKey) return { id: handle, resize: true };
  if (!e.shiftKey) {
    const chosen = hits.find((id) => S.selected.includes(id));
    if (chosen) return { id: chosen, resize: false };
  }
  return { id: hits[0] || null, resize: false };
}
// 拖动中只改画面上对应节点的样式，不重画整块画板（重画会让图片重新加载，画面一闪一闪）
function paintDragged(target) {
  const node = $(`#artboard [data-element-id="${CSS.escape(target.id)}"]`);
  if (!node) return;
  updateElementNode(node, target);
  if (target.type === "text") node.style.fontSize = `${target.fontSize}px`;
  for (const child of target.children || []) paintDragged(child);
}
function selectCanvas(id, event, resize) {
  if (!editable(page(), id)) {
    notice("这个元素或所在分组已锁定");
    return;
  }
  S.selected = event.shiftKey
    ? S.selected.includes(id)
      ? S.selected.filter((x) => x !== id)
      : [...S.selected, id]
    : [id];
  const ids = rootSelection(page(), S.selected);
  const resizing = resize ?? !!event.target.closest("[data-resize]");
  const start = {
    x: event.clientX,
    y: event.clientY,
    values: ids.map((id) => ({ id, element: clone(findElement(page(), id).element) })),
  };
  event.preventDefault();
  S.dragging = true;
  const move = (e) => {
    const dx = (e.clientX - start.x) / S.scale,
      dy = (e.clientY - start.y) / S.scale;
    for (const { id, element: old } of start.values) {
      const found = findElement(page(), id),
        target = found?.element;
      if (!target) continue;
      const angle =
          ((found.ancestors.reduce((sum, a) => sum + (a.rotation || 0), 0) +
            (resizing ? target.rotation || 0 : 0)) *
            Math.PI) /
          180,
        localX = dx * Math.cos(angle) + dy * Math.sin(angle),
        localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (resizing) {
        if (target.type === "group")
          resizeGroup(
            target,
            old,
            Math.max(0, old.width + localX),
            Math.max(0, old.height + localY),
          );
        else {
          target.width = Math.max(0, Math.round(old.width + localX));
          target.height = Math.max(0, Math.round(old.height + localY));
        }
      } else {
        target.x = Math.round(old.x + localX);
        target.y = Math.round(old.y + localY);
      }
      if (S.stepView) paintStepDragged(target, old, resizing);
      else paintDragged(target);
    }
  };
  const up = (e) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    S.dragging = false;
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 2) changed();
    else renderEditor();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  markSelection();
}
// 按下时只在原节点上换选中框和缩放把手，不重画画板
function markSelection() {
  document.querySelectorAll("#artboard [data-element-id]").forEach((n) => {
    const on = S.selected.includes(n.dataset.elementId);
    n.style.outline = on ? "2px solid #38bdf8" : "";
    const handle = n.querySelector(":scope > [data-resize]");
    if (on && !handle) {
      const h = document.createElement("span");
      h.className = "resize-handle";
      h.dataset.resize = n.dataset.elementId;
      n.append(h);
    } else if (!on && handle) handle.remove();
  });
}
function changed() {
  S.history.commit(S.project);
  S.dirty++;
  schedule();
  renderEditor();
}
function schedule() {
  clearTimeout(S.timer);
  if ($("#save-status")) $("#save-status").textContent = "正在保存…";
  S.timer = setTimeout(() => flush().catch(() => {}), 600);
}
async function flush() {
  clearTimeout(S.timer);
  if (!S.project) return;
  if (S.assetPromise) await S.assetPromise;
  if (S.saving) {
    await S.savePromise;
    if (S.saved < S.dirty) return flush();
    return;
  }
  if (S.conflict) throw new Error("请先处理保存冲突");
  if (S.saved === S.dirty) return;
  S.saving = true;
  const generation = S.dirty,
    snapshot = clone(S.project),
    revision = S.revision;
  S.savePromise = (async () => {
    try {
      const result = await api(path(), "PUT", { project: snapshot, revision });
      S.revision = result.revision;
      S.saved = generation;
      S.base = clone(result.project);
      if ($("#save-status"))
        $("#save-status").textContent = S.saved < S.dirty ? "正在保存…" : "已保存";
    } catch (e) {
      if (e.status === 409) {
        // 磁盘上的项目被 agent 改过：不弹「二选一」，交给合并（エイ 的修改保留，agent 的修改并进来）
        e.message = "agent 刚改过这个项目，正在合并，请稍后再试";
        if ($("#save-status")) $("#save-status").textContent = "正在保存…";
        setTimeout(() => S.sync?.notify(), 0);
      } else {
        notice(e.message);
        if ($("#save-status")) $("#save-status").textContent = "保存失败";
      }
      throw e;
    } finally {
      S.saving = false;
    }
  })();
  await S.savePromise;
  if (S.saved < S.dirty) return flush();
}

// 两边改了同一处：已经保留エイ 的修改，这里告诉她是哪些地方，并让她可以改用 agent 的
function conflictDialog() {
  const labels = S.lastConflict?.labels || [];
  modal(
    `<h2>你和 agent 改了同一处</h2><p class="g-sheet__note">已保留你的修改。agent 的其他修改已经并进来了。</p><div class="g-sheet__list">${labels.map((label) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon("alert", 15)}</span><span class="g-row__text">${esc(label)}</span></div>`).join("")}</div><div class="g-sheet__actions">${gbtn("export-local", "下载我的副本")}${gbtn("conflict-agent", "这几处改用 agent 的")}${gbtn("close", "保留我的", { cls: "g-btn--prism" })}</div>`,
  );
}
function bindDrag() {
  const list = $(".page-list");
  list.ondragstart = (e) => {
    const item = e.target.closest("[data-page-index]");
    if (item) e.dataTransfer.setData("application/x-vw-page", item.dataset.pageIndex);
  };
  list.ondragover = (e) => {
    if (e.target.closest("[data-page-index]")) e.preventDefault();
  };
  list.ondrop = (e) => {
    const item = e.target.closest("[data-page-index]");
    if (!item) return;
    e.preventDefault();
    const payload = e.dataTransfer.getData("application/x-vw-page");
    if (!payload) return;
    const from = Number(payload),
      to = Number(item.dataset.pageIndex);
    if (Number.isInteger(from) && from !== to) {
      S.pageId = reorderPages(S.project, S.pageId, from, to);
      changed();
    }
  };
  $(".inspector").ondragstart = (e) => {
    const row = e.target.closest("[data-asset]");
    if (row) e.dataTransfer.setData("application/x-vw-asset", row.dataset.asset);
    const lib = e.target.closest("[data-library-file]");
    if (lib) e.dataTransfer.setData("application/x-vw-library", lib.dataset.libraryFile);
  };
  $("#canvas-well").ondragover = (e) => e.preventDefault();
  $("#canvas-well").ondrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("application/x-vw-asset");
    if (id) placeAsset(id, e.clientX, e.clientY);
    else if (e.dataTransfer.getData("application/x-vw-library")) {
      const file = e.dataTransfer.getData("application/x-vw-library");
      const a = S.libraryChoices?.find((x) => x.file === file);
      if (a)
        addAsset(
          { libraryFile: a.file, width: a.width, height: a.height },
          { x: e.clientX, y: e.clientY },
        ).catch((err) => notice(err.message));
    } else if (e.dataTransfer.files.length)
      upload(e.dataTransfer.files, false, { x: e.clientX, y: e.clientY });
  };
}
function addElement(type) {
  const p = page(),
    z = Math.max(0, ...allElements(p).map((e) => e.zIndex)) + 1,
    b = {
      id: uid("el"),
      type,
      name: type === "text" ? "新文字" : "新形状",
      x: Math.round(S.project.artboard.width * 0.2),
      y: Math.round(S.project.artboard.height * 0.2),
      width: type === "text" ? 520 : 300,
      height: type === "text" ? 100 : 240,
      zIndex: z,
    };
  p.elements.push(
    type === "text"
      ? { ...b, text: "改这里开始创作", font: null, fontSize: 60, color: "#343047" }
      : { ...b, shape: "rect", fill: "#dad5f3", cornerRadius: 24 },
  );
  S.selected = [b.id];
  changed();
}
function placeAsset(id, cx, cy) {
  const a = S.project.assets.find((a) => a.id === id);
  if (!a) return;
  const r = $("#artboard").getBoundingClientRect(),
    w = Math.min(a.width || 500, S.project.artboard.width * 0.55),
    h = (w * (a.height || 300)) / (a.width || 500),
    e = {
      id: uid("el"),
      type: "image",
      name: a.name || "图片",
      x: cx
        ? Math.round((cx - r.left) / S.scale - w / 2)
        : Math.round((S.project.artboard.width - w) / 2),
      y: cy
        ? Math.round((cy - r.top) / S.scale - h / 2)
        : Math.round((S.project.artboard.height - h) / 2),
      width: w,
      height: h,
      zIndex: Math.max(0, ...allElements(page()).map((e) => e.zIndex)) + 1,
      asset: id,
      fit: "contain",
    };
  page().elements.push(e);
  S.selected = [e.id];
  changed();
}
async function imagePayload(file) {
  // SVG 原样上传（保留矢量，才能用「颜色」重新着色）；尺寸和安全检查由服务器做
  if (file.type === "image/svg+xml") {
    const data = await new Promise((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.onerror = () => fail(reader.error || new Error("读不出这个文件"));
      reader.readAsDataURL(file);
    });
    return { name: file.name, data, mime: "image/svg+xml" };
  }
  const image = await createImageBitmap(file),
    factor = Math.min(1, 2400 / Math.max(image.width, image.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * factor);
  canvas.height = Math.round(image.height * factor);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/webp", 0.86));
  const data = await new Promise((done) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });
  image.close();
  return {
    name: file.name.replace(/\.[^.]+$/, ".webp"),
    data,
    width: canvas.width,
    height: canvas.height,
    mime: "image/webp",
  };
}
async function addAsset(body, coords) {
  await flush();
  const generation = S.dirty;
  S.assetPromise = api(`${path()}/assets`, "POST", { ...body, revision: S.revision });
  let result;
  try {
    result = await S.assetPromise;
  } finally {
    S.assetPromise = null;
  }
  S.revision = result.revision;
  S.project.assets.push(result.asset);
  S.project.updatedAt = result.project.updatedAt;
  if (S.dirty === generation) S.history.commit(S.project);
  else schedule();
  closeModal();
  S.tab = "assets";
  placeAsset(result.asset.id, coords?.x, coords?.y);
}

async function upload(files, toLibrary = false, coords) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const body = await imagePayload(file);
      if (toLibrary) {
        await api("/api/library", "POST", body);
        await library();
      } else {
        await addAsset(body, coords);
        notice("图片已放入页面，并标记为待排版");
      }
    } catch (e) {
      notice(e.message);
    }
  }
}

async function library() {
  await flush();
  S.view = "library";
  S.project = null;
  S.focus = false;
  disconnectEvents();
  const assets = await api("/api/library");
  const card = (a) =>
    `<div class="hm-card hm-card--asset"><div class="hm-card__thumb hm-card__thumb--asset"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></div><div class="hm-card__info"><strong>${esc(a.name)}</strong><small>${a.width} × ${a.height}</small></div></div>`;
  shell(
    "library",
    `${head("公共素材库", `${assets.length} 个素材`, `<button class="ed-play" data-action="upload-library">${icon("upload", 15)}<span>上传素材</span></button>`)}<section class="hm-panel" ${glassAttr("library:panel")} data-glass-frost><div class="hm-scroll ed-scroll">${assets.length ? `<div class="hm-grid hm-grid--assets">${assets.map(card).join("")}</div>` : `<p class="hm-empty">还没有素材</p>`}</div></section>`,
  );
  liven(app);
  syncGlass(app);
}
async function browseLibrary() {
  S.libraryChoices = await api("/api/library");
  S.tab = "library";
  renderEditor();
}

async function versions() {
  await flush();
  const list = await api(`${path()}/versions`);
  modal(
    `<h2>版本列表</h2><div class="g-sheet__list">${list.length ? list.map((v) => `<div class="g-row g-row--tall g-row--static"><span class="g-row__icon">${icon("history", 15)}</span><span class="g-row__text"><strong>${esc(v.note || "未命名版本")}</strong><small>${esc(versionTime(v))} · ${{ user: "エイ", system: "自动" }[v.by] || "agent"}</small></span>${tbtn("restore", "退回", "undo", "", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}${ibtn("version-delete", "trash", "删除这个版本", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}</div>`).join("") : '<p class="g-sheet__empty">还没有手动保存的版本</p>'}</div><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("version", "存一版", { icon: "bookmark", cls: "g-btn--prism" })}</div>`,
  );
}
function versionTime(v) {
  const t = new Date(v.savedAt || v.createdAt || v.timestamp || "");
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString("zh-CN", { hour12: false });
}
// 退回前再问一次；退回时服务器会先把当前内容自动存一版
function restoreDialog(id, note) {
  modal(
    `<h2>退回到这个版本？</h2><p class="g-sheet__note">「${esc(note)}」· 当前内容会先自动存一版，随时可以再退回来</p><div class="g-sheet__actions">${gbtn("versions", "返回列表")}${gbtn("restore-confirm", "退回", { icon: "history", cls: "g-btn--prism", extra: `data-id="${esc(id)}"` })}</div>`,
  );
}
// 删除版本前再问一次（删除后不能恢复）
function deleteVersionDialog(id, note) {
  modal(
    `<h2>删除这个版本？</h2><p class="g-sheet__note">「${esc(note)}」· 删除后不能恢复，其他版本和当前内容不受影响</p><div class="g-sheet__actions">${gbtn("versions", "返回列表")}${gbtn("version-delete-confirm", "删除", { icon: "trash", cls: "g-btn--prism", extra: `data-id="${esc(id)}"` })}</div>`,
  );
}
async function deleteVersion(id) {
  const out = await api(`${path()}/versions/${encodeURIComponent(id)}`, "DELETE");
  await versions();
  notice(out.freedBytes ? `版本已删除，腾出 ${formatBytes(out.freedBytes)}` : "版本已删除");
}
async function restore(id) {
  await flush();
  const d = await api(`${path()}/versions/${encodeURIComponent(id)}/restore`, "POST", {});
  S.project = d.project;
  S.revision = d.revision;
  S.base = clone(d.project);
  S.history.commit(S.project);
  S.saved = S.dirty;
  S.stale.clear();
  for (const a of S.project.assets) S.stale.set(a.file, Date.now());
  keepSelection();
  closeModal();
  renderEditor();
  notice("已退回；退回前的内容已自动存了一版");
}
function versionDialog() {
  modal(
    `<h2>存一版</h2><form id="version-form"><label class="g-field g-field--stack"><span>版本备注</span><input name="note" maxlength="200" required placeholder="例如：调整了封面布局" autofocus></label><div class="g-sheet__actions">${gbtn("versions", "版本列表", { icon: "history" })}${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("bookmark", 17)}保存版本</button></div></form>`,
  );
  $("#version-form").onsubmit = async (e) => {
    e.preventDefault();
    // 备注要在等待之前读出来：等保存完成后 e.currentTarget 已经是空的了
    const note = e.currentTarget.note.value.trim();
    try {
      await flush();
      await api(`${path()}/versions`, "POST", { note });
      closeModal();
      notice("版本已保存");
    } catch (err) {
      notice(err.message);
    }
  };
}
// 更换背景：选自己电脑上的图片，或换回默认
function backgroundDialog() {
  modal(
    `<h2>背景</h2><div class="g-sheet__actions g-sheet__actions--start">${gbtn("bg-pick", "选择图片", { icon: "imagePlus", cls: "g-btn--prism" })}${gbtn("bg-default", "恢复默认")}${gbtn("close", "关闭")}</div>`,
  );
}
function pickBackground() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await setBackgroundFile(file);
      closeModal();
      notice("背景已更换");
    } catch (err) {
      notice("这张图片用不了：" + err.message);
    }
  };
  input.click();
}
function copyDialog() {
  const ids = [...S.checked];
  if (!ids.length) {
    notice("请先勾选要复制的页面");
    return;
  }
  modal(
    `<h2>复制到新项目</h2><p class="g-sheet__note">已选 ${ids.length} 页 · 素材和字体一起复制</p><form id="copy-form"><label class="g-field g-field--stack"><span>新项目名称</span><input name="name" required autofocus placeholder="例如：课程精选页"></label><label class="g-field g-field--stack"><span>项目编号</span><input name="id" pattern="[a-z0-9][a-z0-9-]{1,63}" required placeholder="例如：course-highlights"></label><div class="g-sheet__actions">${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("copyPlus", 17)}创建副本</button></div></form>`,
  );
  $("#copy-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget; // 同上：先取表单，再等待
    try {
      await flush();
      const pages = S.project.pages.map((p, i) => (ids.includes(p.id) ? i + 1 : null)).filter(Boolean),
        data = await api(`${path()}/copy`, "POST", { pages, id: f.id.value, name: f.name.value });
      closeModal();
      await open(data.project?.id || f.id.value, data.project ? data : undefined);
    } catch (err) {
      notice(err.message);
    }
  };
}
// ---------- 预览动效 ----------
// 在画板上面盖一层临时画面，把本页动效从头播到尾（不播换页过渡）；按 Esc 或再点一次按钮提前结束
function previewButton(on) {
  const button = $('[data-action="preview-motion"]');
  if (!button) return;
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.title = on ? "停止预览" : "预览动效";
  button.querySelector("span").textContent = on ? "停止预览" : "预览动效";
}
function stopPreview() {
  const preview = S.preview;
  if (!preview) return;
  S.preview = null;
  preview.stop();
  previewButton(false);
}
function togglePreview() {
  if (S.preview) return stopPreview();
  const p = page();
  if (!p.motion) {
    notice("这一页还没有动效");
    return;
  }
  // 预览从头播：步骤视图回到静止，画板按静止状态重画
  if (resetStepView()) renderBoard();
  const holder = $("#artboard-holder"),
    artboard = $("#artboard");
  if (!holder || !artboard) return;
  S.selected = [];
  const preview = startMotionPreview({
    project: S.project,
    page: p,
    holder,
    artboard,
    scale: S.scale,
    assetBase: base(),
    onError: (error) => notice(`动效错误：${error.message}`),
  });
  S.preview = preview;
  previewButton(true);
  preview.done.then((result) => {
    if (S.preview !== preview) return;
    S.preview = null;
    previewButton(false);
    if (result === "finished") notice("动效预览完了");
  });
}

// ---------- 导出 ----------
const EXPORT_KINDS = [
  ["html", "放映版 HTML", "一个网页文件，双击就能在浏览器里放映（带动效）", "play"],
  ["images", "每页图片", "每一页存成一张 PNG 图片", "image"],
  ["pdf", "PDF", "所有页面合成一个 PDF 文件", "copy"],
];
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
function exportDialog() {
  const kind = S.exportKind;
  modal(
    `<h2>导出</h2><p class="g-sheet__note">导出的文件放在数据目录的 exports 文件夹里，不会改动项目</p><div class="g-sheet__list" role="radiogroup" aria-label="导出类型" id="export-kinds">${EXPORT_KINDS.map(([k, label, desc, ic]) => `<button class="g-row g-row--tall ${k === kind ? "selected" : ""}" data-action="export-kind" data-kind="${k}" role="radio" aria-checked="${k === kind}"><span class="g-row__icon">${icon(ic, 15)}</span><span class="g-row__text"><strong>${label}</strong><small>${desc}</small></span></button>`).join("")}</div><div class="g-sheet__actions">${gbtn("close", "取消")}${gbtn("export-start", "开始导出", { icon: "upload", cls: "g-btn--prism" })}</div>`,
  );
}
function chooseExportKind(kind) {
  if (!EXPORT_KINDS.some(([k]) => k === kind)) return;
  S.exportKind = kind;
  document.querySelectorAll('[data-action="export-kind"]').forEach((row) => {
    const on = row.dataset.kind === kind;
    row.classList.toggle("selected", on);
    row.setAttribute("aria-checked", on ? "true" : "false");
  });
}
async function startExport(button) {
  if (S.exporting) return;
  const kind = S.exportKind,
    label = EXPORT_KINDS.find(([k]) => k === kind)?.[1] || kind,
    sheet = button.closest(".g-sheet");
  S.exporting = true;
  const controls = [...sheet.querySelectorAll("button")];
  controls.forEach((c) => (c.disabled = true));
  button.innerHTML = `${icon("loader", 17)}正在导出…`;
  sheet.setAttribute("aria-busy", "true");
  try {
    await flush();
    const result = await api(`${path()}/export`, "POST", { kind });
    if (!sheet.isConnected) notice(`${label}已导出到：${result.outDir}`);
    else exportResult(result, label);
  } catch (err) {
    if (sheet.isConnected) {
      controls.forEach((c) => (c.disabled = false));
      button.innerHTML = `${icon("upload", 17)}开始导出`;
      sheet.removeAttribute("aria-busy");
    }
    notice(err.message);
  } finally {
    S.exporting = false;
  }
}
function exportResult({ outDir, files }, label) {
  const target = files.length === 1 ? files[0].path : outDir;
  const total = files.reduce((n, f) => n + (f.bytes || 0), 0);
  modal(
    `<h2>${esc(label)}已导出</h2><p class="g-sheet__note">保存在：<br><span id="export-path" style="overflow-wrap:anywhere;user-select:text">${esc(outDir)}</span></p><div class="g-sheet__list" id="export-files">${files.map((f) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : "copy", 15)}</span><span class="g-row__text">${esc(f.name)}</span><span class="g-row__meta">${formatBytes(f.bytes)}</span></div>`).join("") || '<p class="g-sheet__empty">没有生成文件</p>'}</div><p class="g-sheet__note" style="margin:10px 0 0">共 ${files.length} 个文件 · ${formatBytes(total)}</p><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("reveal", "在访达中显示", { icon: "library", cls: "g-btn--prism", extra: `data-path="${esc(target)}"` })}</div>`,
  );
}

// 放映：作品画面不透明，四周铺背景图；下面一条磨砂白控制条（加载画面结束后才出现）。
// 放映会进全屏，全屏画面里看不到玻璃层，所以背景图直接铺在放映画面上，控制条用 CSS 磨砂
function play() {
  S.view = "play";
  stopLoops();
  closeModalGlass();
  hideGlass();
  app.innerHTML = `<div class="player g-player" style="--g-player-bg: url('${backgroundURL()}')"><div id="player-stage"></div><div class="g-player-bar" hidden>${tbtn("stop", "返回编辑", "arrowLeft")}<span class="ed-sep"></span><span class="g-player-bar__page">${esc(S.project.name)}<b id="player-page"></b></span><button class="ed-add" data-action="prev" title="上一页" aria-label="上一页">${icon("chevronLeft", 16)}</button><button class="ed-add" data-action="next" title="下一页" aria-label="下一页">${icon("chevronRight", 16)}</button></div></div>`;
  playLoader(() => showPage(S.pageId));
}
// 放映开始前的加载画面（约 1 秒）；期间按键不生效，按 Esc 直接退出
function playLoader(done) {
  const el = document.createElement("div");
  el.className = "g-loader";
  el.innerHTML = `<div class="g-loader__stage"><span class="g-loader__halo"></span><span class="g-disc-badge g-disc-badge--lg">${mascot({ size: 46, disc: true })}</span></div><span>准备放映</span>`;
  $(".player").append(el);
  liven(el);
  const loops = loaderLoop(el);
  const finish = () => {
    clearTimeout(timer);
    window.removeEventListener("keydown", block, true);
    const bar = $(".g-player-bar");
    if (bar) bar.hidden = false;
    fadeOut(el, () => {
      loops.forEach((a) => a.cancel());
      el.remove();
    });
  };
  const block = (e) => {
    if (e.key === "Escape") return finish();
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("keydown", block, true);
  const timer = setTimeout(() => {
    if (S.view === "play") done();
    finish();
  }, 1100);
}
function showPage(id) {
  showMotionPage(S, id, { stage: $("#player-stage"), label: $("#player-page"), assetBase: base(), onError: error => notice(`动效错误：${error.message}`) });
  $("#player-stage").onclick = advancePlay;
}
function advancePlay() {
  if (S.motionChanging || S.playback?.isPlaying()) return;
  if (S.playback?.getState().nextStep < (page().motion?.steps || 0)) S.playback.next();
  else nextPage();
}
function nextPage(delta = 1) {
  if (S.motionChanging || S.playback?.isPlaying()) return;
  const n = S.project.pages.findIndex((p) => p.id === S.pageId) + delta;
  if (n >= 0 && n < S.project.pages.length) showPage(S.project.pages[n].id);
  else notice("已经是最后一页");
}
app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action,
    id = b.dataset.id;
  try {
    switch (a) {
      case "home":
        await home();
        break;
      case "library":
        await library();
        break;
      case "new":
        newDialog();
        break;
      case "open":
        await open(id);
        break;
      case "close":
        closeModal();
        break;
      case "switch":
        S.pageId = id;
        S.selected = [];
        renderEditor();
        break;
      case "select":
        if (!editable(page(), id)) {
          notice("这个元素或所在分组已锁定");
          break;
        }
        S.selected = e.shiftKey ? [...new Set([...S.selected, id])] : [id];
        renderEditor();
        break;
      case "tab-layers":
        S.tab = "layers";
        renderEditor();
        break;
      case "tab-assets":
        S.tab = "assets";
        renderEditor();
        break;
      case "undo":
        if (S.history.canUndo) {
          S.project = S.history.undo();
          S.selected = [];
          S.dirty++;
          schedule();
          renderEditor();
        }
        break;
      case "redo":
        if (S.history.canRedo) {
          S.project = S.history.redo();
          S.selected = [];
          S.dirty++;
          schedule();
          renderEditor();
        }
        break;
      case "add-page":
        S.project.pages.push({
          id: uid("page"),
          name: `页面 ${S.project.pages.length + 1}`,
          background: "#ffffff",
          elements: [],
        });
        S.pageId = S.project.pages.at(-1).id;
        changed();
        break;
      case "add-text":
        addElement("text");
        break;
      case "add-shape":
        addElement("shape");
        break;
      case "duplicate":
        S.selected = duplicateElements(page(), rootSelection(page(), S.selected));
        changed();
        break;
      case "delete":
        deleteElements(page(), rootSelection(page(), S.selected));
        S.selected = [];
        changed();
        break;
      case "place":
        placeAsset(id);
        break;
      case "browse-library":
        await browseLibrary();
        break;
      case "library-copy": {
        const a = S.libraryChoices[+b.dataset.index];
        await addAsset({ libraryFile: a.file, width: a.width, height: a.height });
        notice("素材已复制到项目并放入页面");
        break;
      }
      case "import":
        $("#file-picker").dataset.target = "project";
        $("#file-picker").click();
        break;
      case "upload-library":
        $("#file-picker").dataset.target = "library";
        $("#file-picker").click();
        break;
      case "version":
        versionDialog();
        break;
      case "versions":
        await versions();
        break;
      case "copy":
        copyDialog();
        break;
      case "background":
        backgroundDialog();
        break;
      case "bg-pick":
        pickBackground();
        break;
      case "bg-default":
        await resetBackground();
        closeModal();
        notice("已换回默认背景");
        break;
      case "reference":
        // 带上项目编号和页码，agent 拿到就能找到（例：项目 autumn-deck · 第 3 页（page_intro） · el_title）
        await navigator.clipboard.writeText(
          referenceText(S.project, {
            checkedPageIds: [...S.checked],
            currentPageId: S.pageId,
            selectedIds: S.selected,
          }),
        );
        notice("引用已复制");
        break;
      case "brief": {
        await flush();
        const { text } = await api(`${path()}/brief`);
        await navigator.clipboard.writeText(text);
        notice("已复制，开新的 agent 对话时直接粘贴");
        break;
      }
      case "master": {
        const on = b.dataset.on !== "1";
        await api(`/api/projects/${encodeURIComponent(id)}/master`, "PUT", { master: on });
        await home();
        notice(on ? "已设为系列母版，新建项目时可以选「从母版开始」" : "已取消系列母版");
        break;
      }
      case "restore":
        restoreDialog(id, b.dataset.note || "");
        break;
      case "restore-confirm":
        await restore(id);
        break;
      case "version-delete":
        deleteVersionDialog(id, b.dataset.note || "");
        break;
      case "version-delete-confirm":
        await deleteVersion(id);
        break;
      case "preview-motion":
        togglePreview();
        break;
      case "focus":
        setFocus(!S.focus);
        break;
      case "clear-style":
        clearStyle(b.dataset.clear);
        break;
      case "export":
        exportDialog();
        break;
      case "export-kind":
        chooseExportKind(b.dataset.kind);
        break;
      case "export-start":
        await startExport(b);
        break;
      case "reveal":
        await api("/api/reveal", "POST", { path: b.dataset.path });
        break;
      case "play":
        stopPreview();
        resetStepView();
        await flush();
        play();
        document
          .querySelector(".player")
          ?.requestFullscreen?.()
          .catch(() => {});
        break;
      case "stop":
        S.playback?.destroy();
        document.fullscreenElement && document.exitFullscreen();
        S.view = "editor";
        renderEditor();
        break;
      case "next":
        advancePlay();
        break;
      case "prev":
        nextPage(-1);
        break;
      case "export-local": {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(S.project, null, 2)], { type: "application/json" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = `${S.project.id}-local.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "conflict-agent": {
        // 冲突的那几处改用 agent 的版本（同样进撤销记录）
        const c = S.lastConflict;
        if (c) {
          S.project = mergeProjects(c.base, c.local, c.remote, { prefer: "remote" }).merged;
          S.history.commit(S.project);
          keepSelection();
          S.dirty++;
          schedule();
          S.lastConflict = null;
        }
        closeModal();
        renderEditor();
        break;
      }
    }
  } catch (err) {
    notice(err.message);
  }
});
// 描边、投影（文字）和重新着色（图片）：属性名 → 适用的元素类型；没有时的默认值
const STYLE_TYPE = { stroke: "text", shadow: "text", tint: "image" };
const STYLE_DEFAULT = {
  stroke: { color: "#000000", width: 2 },
  shadow: { color: "#00000066", x: 0, y: 4, blur: 8 },
};
// 颜色框只能选 #rrggbb：原来的颜色带透明度（#rrggbbaa）时，换颜色保留原来的透明度
function keepAlpha(picked, old) {
  return typeof old === "string" && /^#[0-9a-f]{8}$/i.test(old) ? picked + old.slice(7) : picked;
}
function hex6(color, fallback) {
  return typeof color === "string" && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : fallback;
}
// 改「描边.颜色」这类嵌套属性；改了返回 true
function setStyle(e, root, sub, value) {
  if (!sub) {
    const next = value ? keepAlpha(value, e[root]) : null;
    if ((e[root] ?? null) === next) return false;
    e[root] = next;
    return true;
  }
  const old = e[root] || null,
    start = old || STYLE_DEFAULT[root];
  const next =
    root === "stroke" && sub === "width" && !(value > 0)
      ? null // 描边粗细为 0（或清空）= 没有描边
      : { ...start, [sub]: sub === "color" ? keepAlpha(value, start.color) : value };
  if (JSON.stringify(old) === JSON.stringify(next)) return false;
  e[root] = next;
  return true;
}
// 「无」/「原色」：把选中元素的描边 / 投影 / 重新着色清掉
function clearStyle(root) {
  if (!STYLE_TYPE[root] || !S.selected.length) return;
  let different = false;
  mutateElements(page(), rootSelection(page(), S.selected), (e) => {
    if (e.type !== STYLE_TYPE[root] || (e[root] ?? null) === null) return;
    e[root] = null;
    different = true;
  });
  if (different) changed();
}
function updateProp(input) {
  const key = input.dataset.prop;
  if (!S.selected.length) return;
  const [root, sub] = key.split(".");
  let value = input.value;
  if (input.type === "number") {
    value = Number(value);
    if (!Number.isFinite(value)) return;
    if (["width", "height"].includes(key)) value = Math.max(0, value);
    if (key === "fontSize") value = Math.max(1, value);
    if (key === "fontWeight") value = Math.round(Math.min(900, Math.max(100, value)) / 100) * 100;
    if (key === "zIndex") value = Math.round(value);
    if (key === "rotation") value = Math.min(360, Math.max(-360, value));
    if (key === "stroke.width" || key === "shadow.blur") value = Math.max(0, value);
  }
  if (key === "font") value = value || null;
  let different = false;
  mutateElements(page(), rootSelection(page(), S.selected), (e) => {
    if (STYLE_TYPE[root]) {
      if (e.type === STYLE_TYPE[root] && setStyle(e, root, sub, value)) different = true;
      return;
    }
    if (e[key] !== value) {
      if (
        (["text", "fontSize", "fontWeight", "color", "font"].includes(key) && e.type !== "text") ||
        (key === "fill" && e.type !== "shape")
      )
        return;
      if (e.type === "group" && ["width", "height"].includes(key))
        resizeGroup(
          e,
          clone(e),
          key === "width" ? value : e.width,
          key === "height" ? value : e.height,
        );
      else e[key] = value;
      different = true;
    }
  });
  if (different) changed();
}
app.addEventListener("change", (e) => {
  if (e.target.matches("[data-step-view]")) {
    S.stepView = Number(e.target.value) || 0;
    renderBoard();
    return;
  }
  if (e.target.matches("[data-check]")) {
    const id = e.target.dataset.check;
    e.target.checked ? S.checked.add(id) : S.checked.delete(id);
  }
  if (e.target.matches("select[data-prop],input[data-prop],textarea[data-prop]"))
    updateProp(e.target);
});
app.addEventListener("focusout", (e) => {
  // 描边 / 投影 / 图片颜色只在真的改了值时（change）生效：元素没有描边时，框里显示的默认值不能因为失去焦点就被写进去
  if (e.target.matches("textarea[data-prop],input[data-prop]") && !STYLE_TYPE[e.target.dataset.prop.split(".")[0]])
    updateProp(e.target);
});
$("#file-picker").onchange = (e) => {
  upload(e.target.files, e.target.dataset.target === "library");
  e.target.value = "";
};
// Safari 全屏时按 Esc 只退出全屏、不把按键交给页面；所以全屏一结束就回到编辑（Chrome 同样适用）
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement || S.view !== "play") return;
  S.playback?.destroy();
  S.view = "editor";
  renderEditor();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.preview) {
    e.preventDefault();
    stopPreview();
    return;
  }
  if (e.key === "Escape" && S.view === "editor" && S.focus && !$("#modal-root")?.childElementCount) {
    // 专注模式里按 Esc：先退出专注模式（有弹窗时先关弹窗）
    e.preventDefault();
    setFocus(false);
    return;
  }
  if (e.key === "Escape") {
    if (S.view === "play") {
      S.playback?.destroy();
      document.fullscreenElement && document.exitFullscreen();
      S.view = "editor";
      renderEditor();
    } else closeModal();
    return;
  }
  if (S.view === "play" && [" ", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    advancePlay();
    return;
  }
  if (S.view === "play" && e.key === "ArrowLeft") {
    e.preventDefault();
    nextPage(-1);
    return;
  }
  if (S.view !== "editor" || S.preview || e.target.matches("input,textarea,select")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $(`[data-action="${e.shiftKey ? "redo" : "undo"}"]`)?.click();
  } else if (["Backspace", "Delete"].includes(e.key) && S.selected.length) {
    e.preventDefault();
    deleteElements(page(), rootSelection(page(), S.selected));
    S.selected = [];
    changed();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    S.selected = duplicateElements(page(), rootSelection(page(), S.selected));
    changed();
  }
});
window.addEventListener("resize", () => {
  if (S.view === "editor") renderBoard();
  else if (S.view === "play") showPage(S.pageId);
});
home().catch((e) => {
  app.innerHTML = '<div class="startup-error">无法打开工作台，请检查本地服务。</div>';
  notice(e.message);
});
