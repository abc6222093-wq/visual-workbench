import { copyElements, pasteElements, elementInPage, elementWithParents, selectableIds, marqueeIds, nudgeElements, groupElements, ungroupElements, escapeSelection, isTypingTarget } from './element-operations.js';
import { copyPages, pastePages, duplicatePages, deletePages, movePages, insertPage } from './page-operations.js';
import { renderPageItems, mountPageViews, readPageViewPreference, writePageViewPreference } from './page-views.js';
import { showContextMenu, closeContextMenu } from './context-menu.js';
import { snapMove, snapResize, snapTransformedResize, resizeFromPointer, snapPointerResize, selectionBounds, alignElements, distributeElements } from './layout-tools.js';
import { appearanceControls } from './appearance-controls.js';
import { createProjectManagement } from './project-management.js';
import { createWorkbenchClose } from './workbench-close.js';
import { mountRuntimeSettings } from './runtime-settings.js';
import { mountOutlinePanel } from "./outline-panel.js";
import { captureOutlinePage } from "./outline-capture.js";
import { reconcileDocument } from "./outline-document.js";
import { pickCanvasElement } from "./editor-hit-test.js";
// 第 9 轮：画布上就地编辑文字、旋转把手、总览选择
import { startTextEdit, isEditingTextNode } from "./text-edit.js";
import { rotateFromPointer, rotateHandlePlacement } from "./rotate-tool.js";
// 第 10 轮：文字框高度由内容决定
import { measureTextNode, createTextMeasurer, fitTextHeights } from "./text-metrics.js";
// 第 10 轮：画布上裁切图片、替换图片
import { startCrop, isCropping } from "./crop-tool.js";
import { pickImage } from "./image-picker.js";
// 第 10 轮：旧 HTML 导入
import { openImportDialog } from "./import-html.js";
import { mountHomeSelection } from "./home-selection.js";
import { renderPage, patchPage, updateElementNode } from "./render.js";
import { patchPageItems } from "./page-items.js";
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
  createHistory,
  rootSelection,
  resizeGroup,
  resizeBounds,
  referenceText,
} from "./editor.js";
// 实时连接（第 3 轮）：合并用户和 agent 的修改
import { createSyncController, mergeProjects, summarizeConflicts } from "./sync.js";
// 玻璃界面组件（第 2 轮视觉）
import { icon } from "./ui/icons.js";
import { mascot } from "./ui/mascot.js";
import { liven, stopLoops, fadeOut, loaderLoop } from "./ui/motion.js";
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
  pageViewMode: readPageViewPreference(),
  pageAnchor: null,
  pageClipboard: null,
  elementClipboard: null,
  pageViewsDispose: null,
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
  stepView: 0, // 0 = 全部显示；-1 = 初始化；k >= 1 = 第 k 步之后
  stepPage: null, // 步骤视图对应的页面（换页就回到静止）
  pendingSnapshot: null,
  stepRun: null, // 正在画板上生效的步骤视图 { ready, dispose }
  inspectorCollapsed: localStorage.getItem("vw-inspector-collapsed") === "true",
  pagesCollapsed: localStorage.getItem("vw-pages-collapsed") === "true",
  outlineView: null,
  outlineBusy: false,
  focus: false, // 专注模式：藏起顶栏和左右面板，画板放大（刷新后不记得）
  ownRevisions: new Set(), // 工作台自己写盘得到的版本号：文件监听读回这些版本时不再刷新画面
  echoRevision: null, // 自己的保存还没回来时收到的「文件变了」：保存回来后再判断是不是别人写的
  pageViewRoots: new Set(), // 已挂好事件的页面视图根（每个根只挂一次）
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
    if(r.status===423) window.dispatchEvent(new Event("vw-session-blocked"));
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
  S.textEdit?.finish();
  finishCrop();
  S.homeSel?.dispose();
  S.homeSel = null;
  stopPreview(); // 换画面时，正在播的动效预览一起结束
  stopLoops();
  closeModalGlass();
  // 左侧导航：当前所在的页面那一格浮起来
  const nav = (a, name, title) =>
    `<button class="ed-ibtn ${active === a ? "is-on" : ""}" data-action="${a}" title="${title}" aria-label="${title}" ${active === a ? 'aria-current="page"' : ""}>${icon(name, 18)}</button>`;
  disposeStepView();
  const focus = active === "editor" && S.focus ? " is-focus" : "";
  app.innerHTML = `<div class="ed-shell${focus}"><aside class="ed-rail"><div class="ed-logo g-disc-badge" title="视觉工作台">${mascot({ size: 38, disc: true, label: "视觉工作台" })}</div><nav class="ed-dock">${nav("home", "grid", "项目总览")}${nav("library", "library", "公共素材库")}${ibtn("background", "image", "更换背景")}</nav><div class="ed-rail__spacer"></div><div class="ed-avatar" title="用户">用</div></aside><main class="ed-main">${body}</main></div><div id="modal-root"></div>`;
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
  const pending=S.confirmResolve;S.confirmResolve=null;pending?.(false);
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
  requestAnimationFrame(() => fitThumb(wrapper, board, project));
  return wrapper;
}
function fitThumb(wrapper, board, project) {
  if (!wrapper.clientWidth) return;
  const s = Math.min(
    wrapper.clientWidth / project.artboard.width,
    wrapper.clientHeight / project.artboard.height,
  );
  if (board.style.transform !== `scale(${s})`) board.style.transform = `scale(${s})`;
  board.style.transformOrigin = "top left";
}
// 编辑器里的素材地址：被 agent 换过内容的文件带上时间戳（只有这些图片重新加载，其余 <img> 不动）
function assetSrc(file) {
  const stamp = S.stale.get(file);
  return `${base()}/${String(file).split("/").map(encodeURIComponent).join("/")}${stamp ? `?v=${stamp}` : ""}`;
}
// 编辑器左侧的缩略图：节点不带 data-page-id、不带 .is-selected（它们只是静态预览，不是页面卡片）
const thumbOptions = () => ({ assetBase: base(), resolveAsset: assetSrc, pageId: false });
function editorThumb(p) {
  const wrapper = document.createElement("div");
  wrapper.className = "miniature";
  const board = renderPage(S.project, p, thumbOptions());
  board.removeAttribute("data-page-id");
  wrapper.append(board);
  requestAnimationFrame(() => fitThumb(wrapper, board, S.project));
  return wrapper;
}
// 缩略图：空的宿主立刻填上；内容变了的页（按页 JSON 签名比较）空闲时在原来的迷你画板上原地更新，图片复用、不闪
function refreshThumbnails() {
  if (!S.project) return;
  const signatures = new Map();
  const signature = (p) => {
    if (!signatures.has(p.id)) signatures.set(p.id, JSON.stringify([p, S.project.artboard, S.project.fonts, S.project.assets, [...S.stale]]));
    return signatures.get(p.id);
  };
  let pending = false;
  for (const host of app.querySelectorAll("[data-preview]")) {
    const p = S.project.pages.find((x) => x.id === host.dataset.preview);
    if (!p) continue;
    if (!host.querySelector(":scope > .miniature")) { host.replaceChildren(editorThumb(p)); host._thumbSig = signature(p); }
    else if (host._thumbSig !== signature(p)) pending = true;
  }
  if (!pending) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
  (window.cancelIdleCallback || clearTimeout)(refreshThumbnails.handle);
  refreshThumbnails.handle = idle(() => {
    if (S.view !== "editor" || !S.project) return;
    signatures.clear();
    for (const host of app.querySelectorAll("[data-preview]")) {
      const p = S.project.pages.find((x) => x.id === host.dataset.preview);
      const wrapper = host.querySelector(":scope > .miniature"), board = wrapper?.querySelector(":scope > .vw-artboard");
      if (!p || !board || host._thumbSig === signature(p)) continue;
      host._thumbSig = signature(p);
      patchPage(board, S.project, p, thumbOptions());
      fitThumb(wrapper, board, S.project);
    }
  }, { timeout: 400 });
}
async function home() {
  await flush();
  S.view = "home";
  disposeTextMeasurer();
  S.outlineView?.dispose();
  S.outlineView = null;
  S.project = null;
  S.focus = false;
  disconnectEvents();
  const list = await api("/api/projects");
  S.homeProjects = list;
  S.masters = list.filter((x) => x.master).map((x) => ({ id: x.id, name: x.name }));
  // 缩略图框是 16:10，作品按自己的比例居中放进去（竖版海报不会被裁）
  const fit = ({ width, height }) => {
    const r = width / height / 1.6;
    return r >= 1 ? `width:100%;height:${100 / r}%` : `width:${100 * r}%;height:100%`;
  };
  const card = (item, i) =>
    `<div class="hm-cell" data-project-id="${esc(item.id)}"><button class="hm-card" data-action="open" data-id="${esc(item.id)}"><div class="hm-card__thumb"><div class="hm-card__art" style="${fit(item.project.artboard)}" data-thumb="${i}"></div></div><div class="hm-card__info"><strong>${esc(item.name)}</strong><small>${item.project.pages.length} 页 · ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></div><span class="hm-card__tag">${item.master ? "系列母版" : esc(item.project.artboard.preset)}</span></button><button class="ed-add hm-master ${item.master ? "is-on" : ""}" data-action="master" data-id="${esc(item.id)}" data-on="${item.master ? 1 : 0}" title="${item.master ? "取消系列母版" : "设为系列母版"}" aria-label="${item.master ? "取消系列母版" : "设为系列母版"}" aria-pressed="${item.master ? "true" : "false"}">${icon("bookmark", 15)}</button><div class="hm-project-actions">${[ ["project-rename","重命名"],["project-duplicate","复制项目"],["project-delete","删除项目"] ].map(([action,label])=>`<button class="g-btn" data-action="${action}" data-id="${esc(item.id)}">${label}</button>`).join("")}</div></div>`;
  shell(
    "home",
    `${head("项目总览", `${list.length} 个项目`, `<button class="g-btn" data-action="close-workbench">关闭工作台</button><button class="g-btn" data-action="project-trash">回收站</button><button class="g-btn" data-action="data-settings">数据文件夹</button><button class="g-btn" data-action="import-html">导入旧 HTML</button><button class="ed-play" data-action="new">${icon("plus", 15)}<span>新建项目</span></button>`)}<section class="hm-panel" ${glassAttr("home:panel")} data-glass-frost><div class="hm-scroll ed-scroll"><div class="hm-grid">${list.map(card).join("")}<button class="hm-card hm-card--add" data-action="new"><span class="ed-add" aria-hidden="true">${icon("plus", 18)}</span><span>新建项目</span></button></div></div></section>`,
  );
  list.forEach((x, i) => $(`[data-thumb="${i}"]`).append(thumb(x.project, x.project.pages[0])));
  // 总览的选择习惯与画布、页面区一致：Shift/Cmd 加选、拖框、点空白与 Esc 取消、右键菜单
  const scroll = app.querySelector(".hm-scroll"); // 只认自己画的总览，不碰页面上别的同名节点
  if (scroll) S.homeSel = mountHomeSelection(scroll, {
    onOpen: (id) => open(id).catch((e) => notice(e.message)),
    onAction: (action, ids) => homeAction(action, ids),
  });
  liven(app);
  syncGlass(app);
}
function homeAction(action, ids) {
  const items = ids.map((id) => S.homeProjects.find((p) => p.id === id)).filter(Boolean);
  if (!items.length) return;
  if (action === "rename") return projectManagement.rename(items[0]);
  if (action === "duplicate") return projectManagement.duplicate(items[0]);
  if (action === "delete") return items.length === 1 ? projectManagement.remove(items[0]) : projectManagement.removeMany(items);
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
  const reconciled = reconcileLinkedPages();
  if (reconciled) { S.history.commit(S.project); S.dirty++; schedule(); }
  S.lastConflict = null;
  S.stale.clear();
  S.ownRevisions.clear();
  S.echoRevision = null;
  S.stepView = 0;

  S.focus = false;
  S.view = "editor";
  // 文字框高度校正尽量赶在第一次画出编辑器之前（最多等 2.5 秒，字体慢时在后台继续），打开后画面不再跳一次
  const correction = correctTextHeights(S.project.id).catch((e) => notice(e.message));
  await Promise.race([correction, pause(2500)]);
  if (S.project?.id !== id || S.view !== "editor") return;
  renderEditor();
  connectEvents(S.project.id);
  if(data.syncConflicts?.length) modal(`<h2>发现疑似同步冲突副本</h2><p class="g-sheet__note">这些文件可能是网盘留下的另一份修改，请先核对；工作台不会自动删除或合并。</p><ul>${data.syncConflicts.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><div class="g-sheet__actions">${gbtn("close","知道了")}</div>`);
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
  return `<div class="ed-selected"><span class="ed-selected__icon">${icon(TYPE_ICON[e.type], 16)}</span><div><strong>${S.selected.length > 1 ? `${S.selected.length} 个元素` : esc(e.name || e.type)}</strong><small>${esc(e.type)} · ${esc(e.id)}</small></div></div><section class="ed-section"><h3 class="ed-heading">位置与大小</h3><div class="ed-pair">${field("x", "X")}${field("y", "Y")}${field("width", "宽度")}${e.type === "text" ? `<label class="g-field" title="文字框高度由内容决定"><span>高度</span><input data-prop="height" type="number" value="${esc(e.height)}" readonly></label>` : field("height", "高度")}${field("rotation", "旋转")}</div></section>${e.type === "text" ? `<section class="ed-section"><h3 class="ed-heading">文字</h3><label class="g-area">内容<textarea data-prop="text" rows="3">${esc(e.text)}</textarea></label><div class="ed-pair">${field("fontSize", "字号")}${field("fontWeight", "字重")}${field("color", "颜色", e.color, "color")}<label class="g-field"><span>字体</span><select data-prop="font"><option value="">系统默认</option>${S.project.fonts.map((f) => `<option value="${f.id}" ${e.font === f.id ? "selected" : ""}>${esc(f.family)}</option>`).join("")}</select></label></div></section>${paragraphFields(e)}${textStyleFields(e, field)}` : ""}${e.type === "image" ? `<section class="ed-section"><h3 class="ed-heading">图片</h3><div class="ed-pair">${fitField(e)}${field("tint", "颜色", hex6(e.tint, "#000000"), "color")}${tbtn("clear-style", "原色", "undo", "", `data-clear="tint" ${e.tint ? "" : "disabled"}`)}</div><div class="ed-actions">${tbtn("crop-image", "裁切", "maximize")}${tbtn("replace-image", "替换图片", "imagePlus")}</div></section>` : ""}${e.type === "shape" ? `<section class="ed-section"><h3 class="ed-heading">形状</h3><div class="ed-pair">${field("fill", "填充", typeof e.fill === "string" ? e.fill : "#d9d3ef", "color")}${e.shape === "rect" ? field("cornerRadius", "圆角", e.cornerRadius ?? 0) : ""}</div></section>` : ""}<section class="ed-section"><h3 class="ed-heading">排列</h3><div class="ed-pair">${field("zIndex", "层级")}</div><div class="ed-actions">${tbtn("duplicate", "复制", "copy")}${tbtn("delete", "删除", "trash", "ed-tbtn--danger")}</div></section>`;
}
// 段落：对齐、行高、字距（格式里一直有，第 9 轮补上属性栏入口）
function choice(prop, label, value, options) {
  return `<label class="g-field"><span>${label}</span><select data-prop="${prop}" aria-label="${label}">${options.map(([v, text]) => `<option value="${v}" ${value === v ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}
function paragraphFields(e) {
  const number = (prop, label, value, step) => `<label class="g-field"><span>${label}</span><input data-prop="${prop}" type="number" step="${step}" value="${esc(value)}"></label>`;
  return `<section class="ed-section"><h3 class="ed-heading">段落</h3><div class="ed-pair">${choice("align", "对齐", e.align || "left", [["left", "左对齐"], ["center", "居中"], ["right", "右对齐"]])}${number("lineHeight", "行高", e.lineHeight ?? 1.4, "0.05")}${number("letterSpacing", "字距", e.letterSpacing ?? 0, "0.5")}</div></section>`;
}
function fitField(e) {
  return choice("fit", "显示方式", e.fit || "cover", [["cover", "填满裁切"], ["contain", "完整显示"], ["fill", "拉伸"]]);
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
// 用户正忙（拖动、输入框里有没提交的字、弹窗开着、正在保存、在放映）时不打断她，等她忙完再合并
function isBusy() {
  if(nudgePending)return true;
  if (S.view !== "editor" || !S.project) return true;
  if (S.dragging || S.saving || S.assetPromise || S.preview || S.outlineBusy || S.textEdit) return true;
  if ($("#modal-root")?.childElementCount) return true;
  const field = document.activeElement;
  if (field?.matches?.("input[data-prop],textarea[data-prop],input[data-outline-field],textarea[data-outline-field],select[data-outline-field],textarea[data-outline-document],textarea[data-outline-notes]") && field.value !== field.defaultValue)
    return true;
  return false;
}
function keepSelection() {
  if (!S.project.pages.some((p) => p.id === S.pageId)) S.pageId = S.project.pages[0].id;
  S.selected = S.selected.filter((id) => findElement(page(), id));
  for (const id of [...S.checked]) if (!S.project.pages.some((p) => p.id === id)) S.checked.delete(id);
}
// 合并结果落到界面：agent 的修改进撤销记录（撤销一步就回到她原来的样子）；两边改了同一处时保留用户的并提示
function reconcileLinkedPages() {
  let changed = false;
  for (const p of S.project.pages) if (p.outline?.mode === 'document') changed = reconcileDocument(S.project,p).changed || changed;
  return changed;
}
// ---------- 文字框自动长高 ----------
// 宽度由用户决定，高度按内容测量后写回元素 height（进撤销、保存、同步）；渲染和导出只读 height。
const fontsSig = (project) => JSON.stringify((project?.fonts || []).map((f) => [f.id, f.file, f.weight, f.style]));
function fitPageTexts(pages = [page()]) {
  const measure = S.textMeasurer?.measure;
  return measure && S.project ? fitTextHeights(S.project, measure, { pages }) : [];
}
async function mountTextMeasurer() {
  S.textMeasurer?.dispose();
  const measurer = createTextMeasurer(S.project, { assetBase: base(), resolveAsset: assetSrc });
  measurer.sig = fontsSig(S.project);
  S.textMeasurer = measurer;
  await measurer.ready;
  return measurer;
}
function disposeTextMeasurer() { S.textMeasurer?.dispose(); S.textMeasurer = null; }
// 打开项目：文字框高度和内容不一致（旧项目）时先自动存版，再按新规则校正一次
// 尽量在编辑器画出来之前做完（open 里限时等待），字体慢时剩下的部分在后台继续
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function correctTextHeights(projectId) {
  const measurer = await mountTextMeasurer();
  const current = () => S.project?.id === projectId && S.textMeasurer === measurer && S.view === "editor";
  if (!current()) return;
  // 字体可能还在加载（慢机器上尤其）：等字体就绪，再连量两次结果一致才算数；用户正在拖动 / 打字 / 裁切时稍后再来
  await document.fonts.ready;
  for (let attempt = 0; attempt < 40 && current() && (S.dragging || S.textEdit || S.crop || nudgePending || S.preview); attempt++) await pause(500);
  if (!current()) return;
  const first = fitTextHeights(clone(S.project), measurer.measure);
  if (!first.length) return;
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await document.fonts.ready;
  if (!current()) return;
  const second = fitTextHeights(clone(S.project), measurer.measure);
  if (JSON.stringify(first) !== JSON.stringify(second)) return; // 两次结果不同：字体还没稳定，这次不校正
  await flush();
  await api(`${path()}/versions`, "POST", { note: "文字框自动长高校正前自动存版" });
  if (!current()) return;
  const applied = fitTextHeights(S.project, measurer.measure);
  if (!applied.length) return;
  S.history.commit(S.project);
  S.dirty++;
  schedule();
  updateEditor();
  notice(`已按内容校正 ${applied.length} 个文字框的高度（退回前的内容已自动存了一版）`);
  await flush(); // 赶在第一次画出编辑器之前存好，之后的第一下操作不会撞上这次保存
}
// 字体表变了（agent 加了字体）要重建测量器，然后再校正一遍
function refitAfterFontChange() {
  if (!S.project || S.textMeasurer?.sig === fontsSig(S.project)) return;
  const id = S.project.id;
  mountTextMeasurer().then(() => {
    if (S.project?.id !== id) return;
    if (!fitPageTexts(S.project.pages).length) return;
    S.history.commit(S.project); S.dirty++; schedule(); updateEditor();
  }).catch((e) => notice(e.message));
}
function applySync({ project, base, revision, remoteChanged, needsSave, conflicts }) {
  const before = { base: S.base, local: clone(S.project), remote: clone(base) };
  S.base = clone(base);
  S.revision = revision;
  S.conflict = false;
  let reconciled = false;
  if (remoteChanged) {
    S.project = clone(project);
    reconciled = reconcileLinkedPages();
    if (fitPageTexts(S.project.pages).length) reconciled = true; // agent 改了文字：高度按内容重算，作为本地修改保存
    S.history.commit(S.project);
    keepSelection();
    refitAfterFontChange();
  }
  if (needsSave || reconciled) {
    S.dirty++;
    schedule();
  } else S.saved = S.dirty;
  if (remoteChanged || conflicts.length) updateEditor(); // 只更新变了的部分，不整页重建
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
// agent 只换了素材 / 动效代码文件内容（项目文件没变）：等用户不忙时重画，图片地址带上时间戳重新加载
function refreshFiles(files) {
  const stamp = Date.now();
  for (const file of files) if (file !== "project.json") S.stale.set(file, stamp);
  clearTimeout(refreshFiles.t);
  const attempt = () => {
    if (S.view === "editor" && S.project && !isBusy()) return refreshAssets();
    if (S.project) refreshFiles.t = setTimeout(attempt, 300);
  };
  attempt();
}
// 只给受影响的图片 / 遮罩换地址（画板和缩略图按 assetSrc 重新取地址）；动效附属文件变了时步骤视图重新准备、动效检查重跑
function refreshAssets() {
  refreshBoard();
  refreshThumbnails();
  const body = $(".ed-inspector__body");
  if (body) bustStale(body);
  scheduleMotionStatus(true);
}
// 自己写盘拿到的版本号记下来（只留最近一些）
function ownRevision(revision) {
  S.revision = revision;
  S.ownRevisions.add(revision);
  if (S.ownRevisions.size > 40) S.ownRevisions.delete(S.ownRevisions.values().next().value);
}
// 自己的保存进行中收到过「文件变了」：保存回来后，如果那个版本不是自己写的，再去同步
function checkEcho() {
  const revision = S.echoRevision;
  S.echoRevision = null;
  if (revision && revision !== S.revision && !S.ownRevisions.has(revision)) S.sync?.notify();
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
    if (d.external && (d.files || []).some((f) => f !== "project.json")) refreshFiles(d.files);
    if (!d.revision || d.revision === S.revision) return;
    // 工作台自己写的文件被监听读回：不拉取、不刷新画面；自己的保存还没回来时，等它回来再判断
    if (!d.external) {
      if (S.ownRevisions.has(d.revision)) return;
      if (S.saving || S.assetPromise) { S.echoRevision = d.revision; return; }
    }
    S.sync.notify();
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
  if (S.tab === "outline") return '<div id="outline-host"></div>';
  if (S.tab === "library") {
    const list = S.libraryChoices || [];
    return `<div class="ed-assets">${list.length ? list.map((a, i) => `<button class="g-row g-row--tall" data-action="library-copy" data-index="${i}" draggable="true" data-library-file="${esc(a.file)}"><img class="g-row__thumb" src="${esc(a.url)}" alt=""><span class="g-row__text">${esc(a.name)}</span></button>`).join("") : `<p class="ed-note">公共素材库里还没有素材</p>`}</div>`;
  }
  if (S.tab === "assets")
    return `${tbtn("browse-library", "公共素材库", "library", "ed-tbtn--block")}<div class="ed-assets">${S.project.assets.map((a) => `<button class="g-row g-row--tall" data-action="place" data-id="${a.id}" draggable="true" data-asset="${a.id}"><img class="g-row__thumb" src="${base()}/${a.file}" alt=""><span class="g-row__text">${esc(a.name || a.file)}</span>${a.pendingLayout ? `<span class="g-chip g-chip--quiet g-chip--pink">待排版</span>` : ""}</button>`).join("")}</div>`;
  return `<div class="ed-layers ed-scroll">${layers(p.elements)}</div><h3 class="ed-heading ed-heading--main">基础编辑</h3><div class="ed-props">${property()}</div>`;
}
// ---------- 编辑器画面：一次性挂好外壳，之后只做增量更新 ----------
// 全量重建（renderEditor）只用于打开项目、从放映返回等真正换画面的场合；
// 编辑、撤销重做、换页、同步载入都走 updateEditor()：画板、左右面板、缩略图节点保持同一个，只更新内容。
const SAVE_TEXT = { warn: "保存冲突", busy: "正在保存…", ok: "已保存" };
function gridClass() {
  return `ed-grid${S.inspectorCollapsed ? " is-inspector-collapsed" : ""}${S.pagesCollapsed || S.pageViewMode === "timeline" ? " is-pages-collapsed" : ""}${S.pageViewMode === "grid" ? " is-page-grid" : ""}${S.pageViewMode === "timeline" ? " is-page-timeline" : ""}`;
}
const pagesToggleButton = () => ibtn("toggle-pages", S.pagesCollapsed || S.pageViewMode === "timeline" ? "chevronRight" : "chevronLeft", S.pageViewMode === "timeline" ? "切回页面列表" : S.pagesCollapsed ? "展开页面栏" : "收起页面栏", `aria-expanded="${!S.pagesCollapsed && S.pageViewMode !== "timeline"}"`);
const inspectorToggleButton = () => ibtn("toggle-inspector", S.inspectorCollapsed ? "chevronLeft" : "chevronRight", S.inspectorCollapsed ? "展开属性栏" : "收起属性栏", `aria-expanded="${!S.inspectorCollapsed}"`);
const headTimelineButton = () => tbtn("page-timeline", S.pageViewMode === "timeline" ? "列表" : "时间轴", "layers");
const toolGridButton = () => tbtn("page-grid", S.pageViewMode === "grid" ? "回到画布" : "网格", "maximize");
const toolTimelineButton = () => tbtn("page-timeline", S.pageViewMode === "timeline" ? "页面列表" : "时间轴", "layers");
const focusExitBar = () => `<div class="ed-bar ed-focus-exit" ${glassAttr("focus-exit:panel")}>${ibtn("focus", "minimize", "退出专注模式", 'aria-pressed="true"')}</div>`;
const pageViewHost = (mode) => `<div class="ed-page-${mode} ed-scroll">${renderPageItems(pageViewContext(mode))}</div>`;
const footText = () => `${S.project.artboard.width} × ${S.project.artboard.height} px <span>·</span> ${esc(S.project.artboard.preset)}`;
function renderEditor() {
  if (!S.project) return;
  stopPreview();
  S.pageViewsDispose?.();
  S.outlineView?.dispose();
  S.outlineView = null;
  clampStepView();
  const p = page();
  const saveState = S.conflict ? "warn" : S.dirty !== S.saved ? "busy" : "ok";
  // 保存状态：#save-status 只给读屏（文字照旧实时变化），看得见的标签去抖后才变，普通保存画面上没有任何变化
  shell(
    "editor",
    `<header class="ed-top"><div class="ed-titlebox"><h1 class="ed-title">${esc(S.project.name)}</h1>${agentChip()}</div><div class="ed-spacer"></div><div class="ed-bar" ${glassAttr("actions:panel")}>${ibtn("undo", "undo", "撤销", S.history.canUndo ? "" : "disabled")}${ibtn("redo", "redo", "重做", S.history.canRedo ? "" : "disabled")}<span class="ed-save" id="save-chip"><i class="${saveDotClass(saveState === "warn" ? SAVE_TEXT.warn : SAVE_TEXT.ok)}"></i><span class="ed-save__label" aria-hidden="true">${SAVE_TEXT[saveState === "warn" ? "warn" : "ok"]}</span><span id="save-status" class="vw-sr-only" role="status">${SAVE_TEXT[saveState]}</span></span><span class="ed-sep"></span>${tbtn("close-workbench", "关闭工作台", "close")}${tbtn("brief", "复制给 agent", "copy")}${tbtn("version", "存一版", "bookmark")}${tbtn("versions", "版本列表", "history")}${tbtn("export", "导出", "upload")}<button class="ed-play" data-action="play">${icon("play", 15)}<span>放映</span></button></div></header><div class="${gridClass()}"><aside class="ed-col ed-pages" ${glassAttr("pages:panel")} data-glass-frost>${pagesToggleButton()}<div class="ed-col-head"><h2>页面</h2>${tbtn("page-grid", "网格", "maximize")}${headTimelineButton()}<span class="ed-count">${S.project.pages.length}</span><div class="ed-spacer"></div><button class="ed-add" data-action="add-page" title="添加页面" aria-label="添加页面">${icon("plus", 16)}</button></div><div class="page-list ed-scroll">${renderPageItems(pageViewContext("list"))}</div><div class="ed-pages__foot">${tbtn("copy", "复制到新项目", "copyPlus")}${tbtn("reference", "复制引用", "link")}</div></aside><section class="ed-work" ${glassAttr("work:panel")} data-glass-frost><div class="ed-toolbar"><span class="ed-crumb" title="${esc(p.name)}">${esc(p.name)}</span><div class="ed-tools">${toolGridButton()}${toolTimelineButton()}${tbtn("add-text", "文字", "type")}${tbtn("add-shape", "形状", "shapes")}${tbtn("import", "素材导入", "imagePlus")}${stepSwitcher(p)}${tbtn("preview-motion", "预览动效", "play", "", 'aria-pressed="false"')}<span class="ed-sep"></span><span class="ed-zoom" id="zoom-label"></span>${focusButton()}</div></div><div class="ed-well" id="canvas-well"><div id="artboard-holder"></div></div>${S.pageViewMode === "grid" ? pageViewHost("grid") : ""}${S.pageViewMode === "timeline" ? pageViewHost("timeline") : ""}<div class="ed-foot">${footText()}</div></section><aside class="ed-col inspector ed-inspector" ${glassAttr("inspector:panel")} data-glass-frost>${inspectorToggleButton()}<div class="g-seg"><button data-action="tab-layers" class="${S.tab === "layers" ? "active" : ""}">图层</button><button data-action="tab-assets" class="${S.tab === "assets" || S.tab === "library" ? "active" : ""}">素材</button><button data-action="tab-outline" class="${S.tab === "outline" ? "active" : ""}">大纲</button></div><div class="ed-inspector__body ed-scroll"></div></aside></div>${S.focus ? focusExitBar() : ""}`,
  );
  if (saveState === "busy") saveStatus(SAVE_TEXT.busy);
  $("#canvas-well").onpointerdown = (e) => { if (e.button === 0 && !e.target.closest("#artboard-holder")) { if (S.preview) return; startMarquee($("#artboard"), e); } };
  renderBoard();
  $(".ed-inspector__body")._key = null;
  refreshInspector();
  S.motionSig = null;
  refreshMotionStatus();
  refreshThumbnails();
  mountEditorPageViews();
  bindDrag();
  liven(app); // 小兔眨眼呼吸
  syncGlass(app);
}
// 增量刷新入口：数据变了以后调用它，只更新变了的部分（不替换 #app、画板、面板、缩略图节点）
function updateEditor() {
  if (!S.project || S.view !== "editor") return;
  if (!$(".ed-shell .ed-grid") || !$("#artboard-holder")) return renderEditor();
  clampStepView();
  refreshTopbar();
  refreshToolbar();
  refreshPageViews();
  refreshBoard();
  refreshInspector();
  scheduleMotionStatus();
}
function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
function setHTML(node, html) { if (node && node._html !== html) { node.innerHTML = html; node._html = html; } }
// 按钮换成新的样子（图标、文字、aria 变了才换）
function replaceButton(selector, html) {
  const node = $(selector);
  if (!node || node._html === html) return;
  const box = document.createElement("div");
  box.innerHTML = html;
  const next = box.firstElementChild;
  next._html = html;
  node.replaceWith(next);
}
// 顶栏：标题、撤销重做按钮（保存状态由 saveStatus 管）
function refreshTopbar() {
  setText($(".ed-title"), S.project.name);
  refreshHistoryButtons();
}
// 画板上方的工具条和底部尺寸：页面名、屏幕下拉（选项变了才换）、尺寸
function refreshToolbar() {
  const p = page(), crumb = $(".ed-crumb");
  setText(crumb, p.name);
  if (crumb && crumb.title !== p.name) crumb.title = p.name;
  const html = stepSwitcher(p), current = $(".ed-stepview");
  if (!html) current?.remove();
  else if (!current) $('.ed-tools [data-action="preview-motion"]')?.insertAdjacentHTML("beforebegin", html);
  else if (current._html !== html) { current.outerHTML = html; }
  const fresh = $(".ed-stepview");
  if (fresh) fresh._html = html;
  setHTML($(".ed-foot"), footText());
}
// 布局开关（专注模式、折叠面板、网格 / 时间轴）：只切 class、换对应按钮、挂 / 卸对应容器
function refreshLayout() {
  const shellNode = $(".ed-shell"), grid = $(".ed-grid");
  if (!shellNode || !grid) return renderEditor();
  shellNode.classList.toggle("is-focus", S.focus);
  if (grid.className !== gridClass()) grid.className = gridClass();
  replaceButton('.ed-pages > [data-action="toggle-pages"]', pagesToggleButton());
  replaceButton('.ed-inspector > [data-action="toggle-inspector"]', inspectorToggleButton());
  replaceButton('.ed-col-head [data-action="page-timeline"]', headTimelineButton());
  replaceButton('.ed-tools [data-action="page-grid"]', toolGridButton());
  replaceButton('.ed-tools [data-action="page-timeline"]', toolTimelineButton());
  replaceButton('.ed-tools [data-action="focus"]', focusButton());
  const exit = $(".ed-focus-exit");
  if (S.focus && !exit) $(".ed-main").insertAdjacentHTML("beforeend", focusExitBar());
  else if (!S.focus) exit?.remove();
  for (const mode of ["grid", "timeline"]) {
    const host = $(`.ed-page-${mode}`), want = S.pageViewMode === mode;
    if (want && !host) {
      $(".ed-foot").insertAdjacentHTML("beforebegin", pageViewHost(mode));
      mountEditorPageViews();
    } else if (!want && host) {
      host.querySelectorAll("[data-page-view]").forEach(unmountPageView);
      host.remove();
    }
  }
  refreshThumbnails();
  if (!S.stepView) fitBoard();
  else renderBoard(); // 步骤视图里画板尺寸变了：重新准备
  syncGlass(app);
}
function renderBoard() {
  finishCrop();
  stopPreview();
  disposeStepView();
  clampStepView();
  const holder = $("#artboard-holder");
  if (!holder) return;
  holder.replaceChildren();
  pageNodes.clear();
  const board = renderPage(S.project, page(), boardOptions());
  board.id = "artboard";
  holder.append(board);
  fitBoard();
  // 按下时自己挑要操作的元素（捕获阶段，先于各元素自己的处理）：
  // 锁定的元素（例如盖满整页的纸纹）点不中、也不挡住下面的元素；已选中的元素优先，被别的元素盖住也能接着拖、拉把手。
  bindBoardPointer(holder);
  markSelection();
  if (S.stepView) startStepView(board);
}
const boardOptions = () => ({ assetBase: base(), resolveAsset: assetSrc, interactive: true, selectedIds: S.selected, onSelect: selectCanvas });
// 画板增量刷新：静止画面在同一个 #artboard 上原地更新（换页也是）；
// 步骤视图（动效会任意改 DOM）例外：照旧在隐藏层准备好新快照再一次替换；刚离开步骤视图的画板被动效改过，重画一次
function refreshBoard() {
  finishCrop();
  const board = $("#artboard");
  if (!board) return renderBoard();
  if (S.stepView) return refreshBoardSnapshot();
  cancelSnapshot();
  if (S.stepRun || board.dataset.stepShown) return renderBoard();
  stopPreview();
  if (board.dataset.pageId !== page().id) swapPageNodes(board);
  patchPage(board, S.project, page(), boardOptions());
  fitBoard();
  bindBoardPointer($("#artboard-holder"));
  markSelection();
}
// 换页时把旧页的元素节点收起来（最近几页），换回来时放回去再原地更新：同一页上的 <img> 节点复用，图片不重新加载
const pageNodes = new Map();
function swapPageNodes(board) {
  const nodes = [...board.children].filter((node) => node.dataset.elementId !== undefined);
  nodes.forEach((node) => node.remove());
  if (board.dataset.pageId) { pageNodes.delete(board.dataset.pageId); pageNodes.set(board.dataset.pageId, nodes); }
  if (pageNodes.size > 8) pageNodes.delete(pageNodes.keys().next().value);
  const cached = pageNodes.get(page().id);
  pageNodes.delete(page().id);
  if (cached) board.prepend(...cached);
}
// 画板按画布区大小缩放（窗口大小、面板开合变了时调用）
function fitBoard() {
  const board = $("#artboard"), holder = $("#artboard-holder"), well = $("#canvas-well");
  if (!board || !holder || !well) return;
  S.scale = Math.max(
    0.07,
    Math.min(
      (well.clientWidth - 100) / S.project.artboard.width,
      (well.clientHeight - 100) / S.project.artboard.height,
      1,
    ),
  );
  const transform = `scale(${S.scale})`;
  if (board.style.transform !== transform) board.style.transform = transform;
  board.style.transformOrigin = "top left";
  const width = `${S.project.artboard.width * S.scale}px`, height = `${S.project.artboard.height * S.scale}px`;
  if (holder.style.width !== width) holder.style.width = width;
  if (holder.style.height !== height) holder.style.height = height;
  setText($("#zoom-label"), `${Math.round(S.scale * 100)}%`);
}
// 每个画板宿主只挂一次；每次按下时读当前的 #artboard（步骤视图换了画板也不用重挂）
function bindBoardPointer(holder) {
  if (!holder || holder._pickController) return;
  const controller = new AbortController(); holder._pickController = controller;
  holder.addEventListener('pointerdown', e => {
    if(e.button!==0){e.stopPropagation();return;}
    const editing = e.target.closest?.('[data-element-id]');
    if (editing && (isEditingTextNode(editing) || isCropping(editing))) return; // 正在编辑的文字 / 裁切中：交给文字编辑或裁切工具
    if (S.preview) { e.preventDefault();e.stopPropagation();return; }
    const board = holder.querySelector('#artboard'); if (!board) return;
    const rotate = [...board.querySelectorAll('[data-rotate]')].find(h => { const b = h.getBoundingClientRect(); return e.clientX >= b.left - 3 && e.clientX <= b.right + 3 && e.clientY >= b.top - 3 && e.clientY <= b.bottom + 3; });
    if (rotate) { e.stopPropagation(); startRotate(rotate.dataset.rotate, e); return; }
    const {id,resize}=pickElement(board,e);e.stopPropagation();
    if(id)selectCanvas(id,e,resize);else startMarquee(board,e);
  }, {capture:true,signal:controller.signal});
}
// 保存状态：#save-status 的文字照旧实时变化（读屏、测试都读它）；
// 看得见的标签去抖：1.5 秒内完成的普通保存没有任何可见变化，超过 1.5 秒才显示「正在保存…」，失败 / 冲突立即显示
function saveStatus(text) {
  setText($("#save-status"), text);
  clearTimeout(saveStatus.t);
  if (text === SAVE_TEXT.busy) saveStatus.t = setTimeout(() => showSaveLabel(text), 1500);
  else showSaveLabel(text);
}
const saveDotClass = (text) => `g-dot ed-save__dot${text === SAVE_TEXT.ok ? "" : text === SAVE_TEXT.busy ? " g-dot--busy" : " g-dot--warn"}`;
function showSaveLabel(text) {
  const chip = $("#save-chip");
  if (!chip) return;
  const dot = chip.querySelector(".ed-save__dot"), cls = saveDotClass(text);
  if (dot && dot.className !== cls) dot.className = cls;
  setText(chip.querySelector(".ed-save__label"), text);
}
// 动效检查状态：内容变了才重查（停手 0.8 秒后）；新结果出来前旧的状态留着，结果出来再一次换上，不闪「正在检查」
function scheduleMotionStatus(force = false) {
  clearTimeout(scheduleMotionStatus.t);
  if (force) S.motionSig = null;
  scheduleMotionStatus.t = setTimeout(refreshMotionStatus, 800);
}
function refreshMotionStatus() {
  const toolbar = $(".ed-toolbar");
  if (!toolbar || !S.project || S.view !== "editor") return;
  // 没有任何动效的项目检查结果不会变：不为每次编辑重跑检查
  const sig = S.project.pages.some((p) => p.motion) ? JSON.stringify({ ...S.project, updatedAt: null }) : `static:${S.project.formatVersion}`;
  if (sig === S.motionSig) return;
  const first = S.motionSig == null && !toolbar.querySelector(":scope > .ed-motion-status");
  S.motionSig = sig;
  if (first) return mountMotionStatus(S.project, base(), toolbar);
  toolbar.querySelectorAll(":scope > .ed-motion-stage").forEach((node) => node.remove());
  const stage = document.createElement("span");
  stage.className = "ed-motion-stage";
  stage.hidden = true;
  toolbar.append(stage);
  mountMotionStatus(S.project, base(), stage);
  const swap = () => {
    observer.disconnect();
    if (!stage.isConnected) return;
    toolbar.querySelectorAll(":scope > .ed-motion-status, :scope > .ed-motion-detail").forEach((node) => node.remove());
    stage.replaceWith(...stage.childNodes);
  };
  const observer = new MutationObserver(swap);
  if (stage.firstElementChild?.textContent !== "正在检查动效…") swap();
  else observer.observe(stage, { childList: true, subtree: true, characterData: true });
}
// ---------- 步骤视图 ----------
// 下拉选「第 k 步后」：画板按本页动效快进到第 k 步之后的样子（还没出现的元素藏着、移动过的在移动后的位置）。
// 拖动、缩放照样改元素自己的 x / y / 宽 / 高；松手后在隐藏容器准备新快照，完成后一次替换。
function stepSwitcher(p) {
  const steps = p.outline?.mode === "document" ? p.outline.screens - 1 : Math.max(p.motion?.steps || 0, (p.outline?.screens || 1) - 1);
  if (!p.motion && !p.outline) return "";
  const options = [`<option value="0" ${S.stepView ? "" : "selected"}>全部显示</option>`, `<option value="-1" ${S.stepView === -1 ? "selected" : ""}>第 1 屏</option>`];
  for (let k = 1; k <= steps; k++)
    options.push(`<option value="${k}" ${S.stepView === k ? "selected" : ""}>第 ${k + 1} 屏</option>`);
  return `<label class="g-field ed-stepview" title="按动效步骤查看这一页（只是看，不改动效）"><span>屏幕</span><select data-step-view aria-label="屏幕视图">${options.join("")}</select></label>`;
}
function clampStepView() {
  if (!S.project) return;
  const p = page();
  const steps = p.outline?.mode === "document" ? p.outline.screens - 1 : Math.max(p.motion?.steps || 0, (p.outline?.screens || 1) - 1);
  if (S.stepPage !== S.pageId || !Number.isInteger(S.stepView) || S.stepView < -1 || S.stepView > steps || (!page().motion && !page().outline))
    S.stepView = 0;
  S.stepPage = S.pageId;
}
function syncStepSelect() {
  const select = $("[data-step-view]");
  if (select) select.value = String(S.stepView);
}
function disposeStepView() {
  cancelSnapshot();
  const run = S.stepRun;
  S.stepRun = null;
  run?.dispose();
}
function startStepView(board) {
  const count = Math.max(0, S.stepView);
  const run = applyStepView({ project: S.project, page: page(), root: board, assetBase: base(), count });
  S.stepRun = run;
  run.ready.then(
    () => {
      if (S.stepRun !== run) return;
      board.dataset.stepShown = String(S.stepView);
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
function paintStepDragged(target, old, resizing, translate = "none") {
  const node = $(`#artboard [data-element-id="${CSS.escape(target.id)}"]`);
  if (!node) return;
  const [tx = '0px', ty = '0px'] = translate === 'none' ? [] : translate.split(/\s+/);
  node.style.translate = `calc(${tx} + ${target.x-old.x}px) calc(${ty} + ${target.y-old.y}px)`;
  if (!resizing) return;
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
  refreshLayout();
}
// 点下去的位置上从上到下有哪些元素；跳过锁定的（含锁定分组里的），选中的元素排在最前面
function pickElement(board, e) {
  const hit = pickCanvasElement({ board, page: page(), selected: S.selected, screen: !!S.stepView, event: e });
  if (!hit.id || hit.resize) return hit;
  if(e.button===2 && S.selected.includes(hit.id))return hit;
  const found = findElement(page(), hit.id);
  const selectedGroup = S.selected.length === 1 && findElement(page(),S.selected[0])?.element.type === 'group' ? S.selected[0] : null;
  if (selectedGroup) {
    const deep = pickCanvasElement({board,page:page(),selected:[],screen:!!S.stepView,event:e});
    const f = deep.id && findElement(page(),deep.id);
    const chain = f && [...f.ancestors.map(a=>a.id),deep.id];
    const at = chain?.indexOf(selectedGroup) ?? -1;
    if(at>=0 && chain[at+1])return {...hit,id:chain[at+1]};
  }
  // A selected child keeps being draggable inside its group until Escape.
  if(S.selected.includes(hit.id)) return hit;
  return {...hit,id:found?.ancestors[0]?.id || hit.id};
}
// 拖动中只改画面上对应节点的样式，不重画整块画板（重画会让图片重新加载，画面一闪一闪）
function paintDragged(target) {
  const node = $(`#artboard [data-element-id="${CSS.escape(target.id)}"]`);
  if (!node) return;
  updateElementNode(node, target);
  if (target.type === "text") node.style.fontSize = `${target.fontSize}px`;
  for (const child of target.children || []) paintDragged(child);
}
function deltaInParents(dx, dy, ancestors) {
  for (const ancestor of ancestors) {
    const angle = -(ancestor.rotation || 0) * Math.PI / 180;
    [dx, dy] = [dx * Math.cos(angle) - dy * Math.sin(angle), dx * Math.sin(angle) + dy * Math.cos(angle)];
    if (ancestor.flipX) dx = -dx;
    if (ancestor.flipY) dy = -dy;
  }
  return [dx, dy];
}
function selectCanvas(id, event, resize) {
  const editing = event.target?.closest?.('[data-element-id]');
  if (editing && isEditingTextNode(editing)) return;
  finishNudge();
  if (!editable(page(), id)) {
    notice("这个元素或所在分组已锁定");
    return;
  }
  S.selected = event.shiftKey
    ? S.selected.includes(id)
      ? S.selected.filter((x) => x !== id)
      : [...S.selected, id]
    : S.selected.includes(id) ? S.selected : [id];
  const ids = rootSelection(page(), S.selected);
  const resizing = resize ?? event.target.closest("[data-resize]")?.dataset.handle;
  const start = {
    x: event.clientX,
    y: event.clientY,
    globalElements: ids.map(id=>elementInPage(page(),id)),
    values: ids.map((id) => ({ id, element: clone(findElement(page(), id).element), translate: getComputedStyle($(`#artboard [data-element-id="${CSS.escape(id)}"]`)).translate })),
  };
  event.preventDefault();
  S.dragging = true;
  const move = (e) => {
    const dx = (e.clientX - start.x) / S.scale,
      dy = (e.clientY - start.y) / S.scale;
    let snappedDx=dx,snappedDy=dy;
    const bounds=selectionBounds(start.globalElements);
    const references=allElements(page()).filter(e=>!ids.includes(e.id)&&!findElement(page(),e.id).ancestors.some(a=>ids.includes(a.id))&&!ids.some(id=>findElement(page(),id).ancestors.some(a=>a.id===e.id))).map(e=>elementInPage(page(),e.id));
    const hasParent=start.values.some(v=>findElement(page(),v.id)?.parent);
    if(!resizing) {
      const snap=snapMove({bounds:{...bounds,x:bounds.x+dx,y:bounds.y+dy},references,page:S.project.artboard,scale:S.scale,disabled:e.altKey,movingIds:ids});
      snappedDx=snap.bounds.x-bounds.x;snappedDy=snap.bounds.y-bounds.y;paintGuides(snap);
    } else if (ids.length > 1) {
      const project = (pointerX, pointerY) => selectionBounds(start.values.map(({ id, element }) => {
        const { ancestors } = findElement(page(), id);
        const [localX, localY] = deltaInParents(pointerX, pointerY, ancestors);
        return elementWithParents(resizeFromPointer(element, resizing, localX, localY), ancestors);
      }));
      const snap = snapPointerResize({ dx, dy, project, references, page: S.project.artboard, scale: S.scale, disabled: e.altKey, movingIds: ids });
      snappedDx = snap.dx; snappedDy = snap.dy; paintGuides(snap);
    } else clearGuides();
    for (const { id, element: old, translate } of start.values) {
      const found = findElement(page(), id),
        target = found?.element;
      if (!target) continue;
      const [localX, localY] = deltaInParents(snappedDx, snappedDy, found.ancestors);
      if (resizing) {
        const resized = ids.length > 1 ? resizeFromPointer(old, resizing, localX, localY) : resizeBounds(old, resizing, localX, localY);
        let bounds = { x: resized.x, y: resized.y, width: resized.width, height: resized.height };
        if(ids.length===1){
          const options={bounds:{...old,...bounds},references,page:S.project.artboard,scale:S.scale,handle:resizing,rotation:old.rotation||0,disabled:e.altKey,movingIds:ids};
          const snap=hasParent||old.rotation?snapTransformedResize({...options,project:element=>elementWithParents(element,found.ancestors)}):snapResize(options);
          bounds={x:snap.bounds.x,y:snap.bounds.y,width:snap.bounds.width,height:snap.bounds.height};paintGuides(snap);
        }
        if (target.type === "group") resizeGroup(target, old, bounds.width, bounds.height);
        Object.assign(target, bounds);
        if (target.type === "text") { // 文字框只改宽度，高度按内容量
          paintDragged(target);
          const node = $(`#artboard [data-element-id="${CSS.escape(id)}"]`);
          if (node) target.height = measureTextNode(node);
        } else if (target.type === "group") fitPageTexts();
      } else {
        target.x = Math.round(old.x + localX);
        target.y = Math.round(old.y + localY);
      }
      if (S.stepView) paintStepDragged(target, old, resizing, translate);
      else paintDragged(target);
    }
  };
  const up = (e) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    S.dragging = false;
    clearGuides();
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 2) {
      for (const { id } of start.values) clearDocumentDraft(findElement(page(), id).element);
      changed({ boardOnly: true });
    } else refreshSelection();
    swapReadySnapshot();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  markSelection();
}
// 旋转把手：单选时在元素下方（贴近画板底边时放到上方）；大小按画板缩放补偿，屏幕上看起来一样大
function markRotateHandle(n, on) {
  let handle = n.querySelector(":scope > [data-rotate]");
  if (!on) { handle?.remove(); return; }
  if (!handle) {
    handle = document.createElement("span");
    handle.className = "rotate-handle";
    handle.dataset.rotate = n.dataset.elementId;
    handle.title = "拖动旋转";
    handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    n.append(handle);
  }
  const size = 22 / S.scale, gap = 18 / S.scale, board = $("#artboard")?.getBoundingClientRect(), box = n.getBoundingClientRect();
  // 贴着画板边时换到看得见的一侧（上下都贴边放左右，四面贴边放元素内部），始终能点到
  const placed = rotateHandlePlacement({ box, board, need: (gap + size) * S.scale, size, gap });
  handle.dataset.side = placed.side;
  Object.assign(handle.style, { width: `${size}px`, height: `${size}px` }, placed.style);
}
function startRotate(id, event) {
  finishNudge();
  const found = findElement(page(), id), target = found?.element;
  if (!target || !editable(page(), id)) return;
  event.preventDefault();
  const node = $(`#artboard [data-element-id="${CSS.escape(id)}"]`), box = node.getBoundingClientRect();
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }, from = { x: event.clientX, y: event.clientY }, start = target.rotation || 0;
  // 祖先翻转奇数次时，屏幕上的转向和元素自己的角度相反
  const mirrored = found.ancestors.reduce((n, a) => n + (a.flipX ? 1 : 0) + (a.flipY ? 1 : 0), 0) % 2 === 1;
  S.dragging = true;
  const label = () => { let tag = $("#artboard .ed-rotate-label"); if (!tag) { tag = document.createElement("span"); tag.className = "ed-gap ed-rotate-label"; $("#artboard").append(tag); } return tag; };
  const move = (e) => {
    const result = rotateFromPointer({ start: mirrored ? -start : start, center, from, to: { x: e.clientX, y: e.clientY }, disabled: e.altKey });
    target.rotation = mirrored ? -result.rotation || 0 : result.rotation;
    paintDragged(target);
    const board = $("#artboard").getBoundingClientRect(), tag = label();
    tag.textContent = `${Math.round(target.rotation)}°`;
    tag.style.left = `${(e.clientX - board.left) / S.scale + 16 / S.scale}px`;
    tag.style.top = `${(e.clientY - board.top) / S.scale + 16 / S.scale}px`;
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    S.dragging = false;
    clearGuides();
    if ((target.rotation || 0) !== start) { clearDocumentDraft(target); changed({ boardOnly: true }); }
    else refreshSelection();
    swapReadySnapshot();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
// ---------- 画布上就地编辑文字 ----------
// 双击文字 / 选中后按 Enter / 右键「编辑文字」/ 新建文字：在原节点上编辑，位置样式与平时一致。
// 一次编辑会话一条撤销记录：第一次改动记一条，之后合并；大纲文档框随打字实时同步；结束后照常保存。
function editText(id, { point = null, selectAll = false } = {}) {
  finishNudge();
  if (S.preview || S.view !== "editor") return false;
  const element = findElement(page(), id)?.element;
  if (!element || element.type !== "text" || !editable(page(), id)) return false;
  const node = $(`#artboard [data-element-id="${CSS.escape(id)}"]`);
  if (!node || isEditingTextNode(node)) return false;
  S.textEdit?.finish();
  S.selected = [id];
  markSelection();
  node.querySelector(":scope > [data-rotate]")?.remove();
  let recorded = false;
  const apply = (text) => {
    const target = findElement(page(), id)?.element;
    if (!target || target.text === text) return;
    target.text = text;
    const height = measureTextNode(node, text); // 边打边长
    if (height !== target.height) { target.height = height; node.style.height = `${height}px`; }
    reconcileLinkedPages();
    if (recorded) S.history.amend(S.project);
    else { S.history.commit(S.project); recorded = true; }
    refreshHistoryButtons();
    if (S.tab === "layers") refreshInspector(); else S.outlineView?.refresh();
  };
  node.classList.add("is-text-editing");
  const session = startTextEdit(node, {
    text: element.text, point, selectAll,
    onInput: apply,
    onCommit: ({ text }) => {
      node.classList.remove("is-text-editing");
      if (S.textEdit === session) S.textEdit = null;
      apply(text);
      if (recorded) { S.dirty++; schedule(); }
      if (S.view === "editor" && S.project) updateEditor();
    },
  });
  S.textEdit = session;
  return true;
}
// 按下时只在原节点上换选中框和缩放把手，不重画画板
function markSelection() {
  const single = S.selected.length === 1 ? S.selected[0] : null;
  document.querySelectorAll("#artboard [data-element-id]").forEach((n) => {
    const on = S.selected.includes(n.dataset.elementId);
    if (n.parentElement?.id === "artboard") n.toggleAttribute("data-vw-locked", !!findElement(page(), n.dataset.elementId)?.element.locked); // 悬停描边跳过锁定元素
    if (isEditingTextNode(n) || isCropping(n)) return; // 正在就地编辑 / 裁切：不往节点里加把手
    markRotateHandle(n, on && single === n.dataset.elementId && editable(page(), single));
    n.style.outline = on ? "2px solid #38bdf8" : "";
    const handles = n.querySelectorAll(":scope > [data-resize]");
    if (on && !handles.length) {
      const isText = findElement(page(), n.dataset.elementId)?.element.type === "text";
      for (const edge of isText ? ["nw", "ne", "e", "se", "sw", "w"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) { // 文字框高度由内容决定，不给上下把手
        const h = document.createElement("span");
        h.className = "resize-handle";
        h.dataset.resize = n.dataset.elementId;
        h.dataset.handle = edge;
        n.append(h);
      }
    } else if (!on) handles.forEach(handle => handle.remove());
  });
}
function changed({ boardOnly = false } = {}) {
  S.typingField = null;
  for (const p of S.project.pages) if (p.outline?.mode === 'document') reconcileDocument(S.project, p);
  fitPageTexts();
  S.history.commit(S.project);
  S.dirty++;
  schedule();
  // boardOnly（拖动、对齐、外观滑块等只动画板的修改）与其他修改一样只做增量更新；参数保留给调用方表明意图
  void boardOnly;
  updateEditor();
}
function schedule() {
  clearTimeout(S.timer);
  saveStatus(SAVE_TEXT.busy);
  S.timer = setTimeout(() => flush().catch(() => {}), 600);
}
async function flush() {
  finishNudge();
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
      ownRevision(result.revision);
      S.saved = generation;
      S.base = clone(result.project);
      if (S.saved < S.dirty) setText($("#save-status"), SAVE_TEXT.busy); // 还有没保存的：看得见的标签继续按原来的计时
      else saveStatus(SAVE_TEXT.ok);
    } catch (e) {
      if (e.status === 409) {
        // 磁盘上的项目被 agent 改过：不弹「二选一」，交给合并（用户的修改保留，agent 的修改并进来）
        e.message = "agent 刚改过这个项目，正在合并，请稍后再试";
        setText($("#save-status"), SAVE_TEXT.busy);
        setTimeout(() => S.sync?.notify(), 0);
      } else {
        notice(e.message);
        saveStatus("保存失败");
      }
      throw e;
    } finally {
      S.saving = false;
      checkEcho();
    }
  })();
  await S.savePromise;
  if (S.saved < S.dirty) return flush();
}

// 两边改了同一处：已经保留用户的修改，这里告诉她是哪些地方，并让她可以改用 agent 的
function conflictDialog() {
  const labels = S.lastConflict?.labels || [];
  modal(
    `<h2>你和 agent 改了同一处</h2><p class="g-sheet__note">已保留你的修改。agent 的其他修改已经并进来了。</p><div class="g-sheet__list">${labels.map((label) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon("alert", 15)}</span><span class="g-row__text">${esc(label)}</span></div>`).join("")}</div><div class="g-sheet__actions">${gbtn("export-local", "下载我的副本")}${gbtn("conflict-agent", "这几处改用 agent 的")}${gbtn("close", "保留我的", { cls: "g-btn--prism" })}</div>`,
  );
}
function bindDrag() {
  // Page drag gestures are handled by mountPageViews.
  $(".inspector").ondragstart = (e) => {
    const row = e.target.closest("[data-asset]");
    if (row) e.dataTransfer.setData("application/x-vw-asset", row.dataset.asset);
    const lib = e.target.closest("[data-library-file]");
    if (lib) e.dataTransfer.setData("application/x-vw-library", lib.dataset.libraryFile);
  };
  $("#canvas-well").ondragover = (e) => { e.preventDefault(); markDropTarget(imageAt(e.clientX, e.clientY)); };
  $("#canvas-well").ondragleave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) markDropTarget(null); };
  $("#canvas-well").ondrop = (e) => {
    e.preventDefault();
    markDropTarget(null);
    const replaceId = imageAt(e.clientX, e.clientY);
    const id = e.dataTransfer.getData("application/x-vw-asset");
    if (id) { if (!replaceId || !replaceImage(replaceId, id)) placeAsset(id, e.clientX, e.clientY); }
    else if (e.dataTransfer.getData("application/x-vw-library")) {
      const file = e.dataTransfer.getData("application/x-vw-library");
      const a = S.libraryChoices?.find((x) => x.file === file);
      if (a)
        addAsset(
          { libraryFile: a.file, width: a.width, height: a.height },
          { x: e.clientX, y: e.clientY },
          replaceId,
        ).catch((err) => notice(err.message));
    } else if (e.dataTransfer.files.length)
      upload(e.dataTransfer.files, false, { x: e.clientX, y: e.clientY }, replaceId);
  };
}
function addElement(type, shape = "rect") {
  const p = page(),
    z = Math.max(0, ...allElements(p).map((e) => e.zIndex)) + 1,
    b = {
      id: uid("el"),
      type,
      name: type === "text" ? "新文字" : "新形状",
      x: Math.round(S.project.artboard.width * 0.2),
      y: Math.round(S.project.artboard.height * 0.2),
      width: type === "text" ? 520 : shape === "ellipse" ? 240 : 300,
      height: type === "text" ? 100 : 240,
      zIndex: z,
    };
  p.elements.push(
    type === "text"
      ? { ...b, text: "改这里开始创作", font: null, fontSize: 60, color: "#343047" }
      : shape === "ellipse" ? { ...b, shape: "ellipse", fill: "#dad5f3" } : { ...b, shape: "rect", fill: "#dad5f3", cornerRadius: 24 },
  );
  S.selected = [b.id];
  changed();
  if (type === "text") editText(b.id, { selectAll: true }); // 新建文字直接进入编辑，打字即替换占位字
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
async function addAsset(body, coords, replaceId = null) {
  await flush();
  const generation = S.dirty;
  S.assetPromise = api(`${path()}/assets`, "POST", { ...body, revision: S.revision });
  let result;
  try {
    result = await S.assetPromise;
  } finally {
    S.assetPromise = null;
  }
  ownRevision(result.revision);
  checkEcho();
  S.project.assets.push(result.asset);
  S.project.updatedAt = result.project.updatedAt;
  if (S.dirty === generation) S.history.commit(S.project);
  else schedule();
  closeModal();
  S.tab = "assets";
  if (replaceId && replaceImage(replaceId, result.asset.id)) return;
  placeAsset(result.asset.id, coords?.x, coords?.y);
}
// 拖到画布上的图片元素上 = 替换图片（位置、大小、外观不变，一条撤销记录）
function imageAt(x, y) {
  for (const hit of document.elementsFromPoint(x, y)) {
    const node = hit.closest?.("#artboard [data-element-id]");
    if (!node) continue;
    const found = findElement(page(), node.dataset.elementId);
    if (!found || found.element.locked || found.ancestors.some((a) => a.locked)) continue;
    return found.element.type === "image" ? found.element.id : null;
  }
  return null;
}
// ---------- 画布上裁切图片 ----------
// 双击图片 / 右键「裁切」/ 属性栏「裁切」进入：覆盖层由 crop-tool 画，这里只负责预览和提交（一次裁切 = 一条撤销记录）
function finishCrop() { const session = S.crop; if (session?.active) session.finish(); }
function cropImage(id) {
  finishNudge();
  if (S.preview || S.view !== "editor" || S.stepView) return false;
  const element = findElement(page(), id)?.element;
  if (!element || element.type !== "image" || !editable(page(), id)) return false;
  const node = $(`#artboard [data-element-id="${CSS.escape(id)}"]`);
  if (!node || isCropping(node)) return false;
  S.textEdit?.finish();
  finishCrop();
  const asset = S.project.assets.find((a) => a.id === element.asset);
  S.selected = [id];
  markSelection();
  node.querySelectorAll(":scope > [data-resize], :scope > [data-rotate]").forEach((h) => h.remove());
  node.classList.add("is-cropping");
  const session = startCrop(node, element, {
    image: asset ? { width: asset.width, height: asset.height } : null,
    scale: S.scale,
    onPreview: (patch) => { const current = findElement(page(), id)?.element; if (current) updateElementNode(node, { ...current, ...patch }); },
    onCommit: (patch) => {
      node.classList.remove("is-cropping");
      if (S.crop === session) S.crop = null;
      const current = findElement(page(), id)?.element;
      if (patch && current) { Object.assign(current, patch); clearDocumentDraft(current); changed(); }
      else if (S.view === "editor" && S.project) updateEditor();
    },
  });
  S.crop = session;
  return true;
}
// 换了宽高比不同的图：以原裁切中心、按元素框的比例重算一个裁切，图不变形；比例相同就原样保留
function fitCropToImage(crop, frame, image) {
  if (!crop || !image?.width || !image?.height || !frame.width || !frame.height) return crop ?? null;
  const want = frame.width / frame.height, ratio = (crop.width * image.width) / (crop.height * image.height);
  if (Math.abs(want - ratio) < 1e-3) return crop;
  let width = 1, height = (image.width / image.height) / want;
  if (height > 1) { height = 1; width = want * (image.height / image.width); }
  const cx = crop.x + crop.width / 2, cy = crop.y + crop.height / 2;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { x: r4(Math.min(1 - width, Math.max(0, cx - width / 2))), y: r4(Math.min(1 - height, Math.max(0, cy - height / 2))), width: r4(width), height: r4(height) };
}
async function replaceImageDialog(id) {
  const element = findElement(page(), id)?.element;
  if (!element || element.type !== "image") return;
  const choice = await pickImage({ modal, closeModal, api, projectAssets: S.project.assets, assetBase: base() });
  if (!choice) return;
  if (choice.kind === "asset") replaceImage(id, choice.id);
  else if (choice.kind === "library") await addAsset({ libraryFile: choice.file, width: choice.width, height: choice.height }, undefined, id);
  else if (choice.kind === "upload") await upload([choice.file], false, undefined, id);
}
function replaceImage(id, assetId) {
  const target = findElement(page(), id)?.element;
  const asset = S.project.assets.find((a) => a.id === assetId);
  if (!target || target.type !== "image" || !asset) return false;
  if (target.asset !== assetId) { target.asset = assetId; target.crop = fitCropToImage(target.crop, target, asset); clearDocumentDraft(target); }
  S.selected = [id];
  changed();
  notice("图片已替换，位置和大小不变");
  return true;
}
function markDropTarget(id) {
  document.querySelectorAll("#artboard .is-drop-target").forEach((n) => { if (n.dataset.elementId !== id) n.classList.remove("is-drop-target"); });
  if (id) $(`#artboard [data-element-id="${CSS.escape(id)}"]`)?.classList.add("is-drop-target");
}

async function upload(files, toLibrary = false, coords, replaceId = null) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const body = await imagePayload(file);
      if (toLibrary) {
        await api("/api/library", "POST", body);
        await library();
      } else {
        await addAsset(body, coords, replaceId);
        if (!replaceId) notice("图片已放入页面，并标记为待排版");
        replaceId = null; // 一次拖入多张：只有第一张替换
      }
    } catch (e) {
      notice(e.message);
    }
  }
}

async function library() {
  await flush();
  S.view = "library";
  disposeTextMeasurer();
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
  refreshInspector();
}

async function versions() {
  await flush();
  const list = await api(`${path()}/versions`);
  modal(
    `<h2>版本列表</h2><div class="g-sheet__list">${list.length ? list.map((v) => `<div class="g-row g-row--tall g-row--static"><span class="g-row__icon">${icon("history", 15)}</span><span class="g-row__text"><strong>${esc(v.note || "未命名版本")}</strong><small>${esc(versionTime(v))} · ${{ user: "用户", system: "自动" }[v.by] || "agent"}</small></span>${tbtn("restore", "退回", "undo", "", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}${ibtn("version-delete", "trash", "删除这个版本", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}</div>`).join("") : '<p class="g-sheet__empty">还没有手动保存的版本</p>'}</div><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("version", "存一版", { icon: "bookmark", cls: "g-btn--prism" })}</div>`,
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
  ownRevision(d.revision);
  S.base = clone(d.project);
  S.history.commit(S.project);
  S.saved = S.dirty;
  saveStatus(SAVE_TEXT.ok);
  S.stale.clear();
  for (const a of S.project.assets) S.stale.set(a.file, Date.now());
  keepSelection();
  closeModal();
  updateEditor();
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
    `<h2>${esc(label)}已导出</h2><p class="g-sheet__note">保存在：<br><span id="export-path" style="overflow-wrap:anywhere;user-select:text">${esc(outDir)}</span></p><div class="g-sheet__list" id="export-files">${files.map((f) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : "copy", 15)}</span><span class="g-row__text">${esc(f.name)}</span><span class="g-row__meta">${formatBytes(f.bytes)}</span></div>`).join("") || '<p class="g-sheet__empty">没有生成文件</p>'}</div><p class="g-sheet__note" style="margin:10px 0 0">共 ${files.length} 个文件 · ${formatBytes(total)}</p><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("reveal", runtimeSettings.revealLabel, { icon: "library", cls: "g-btn--prism", extra: `data-path="${esc(target)}"` })}</div>`,
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
    finishNudge();
    switch (a) {
      case "page-grid":
        setPageView(S.pageViewMode === "grid" ? readPageViewPreference() : "grid");
        break;
      case "page-timeline":
        if(S.pageViewMode === "timeline"){S.pagesCollapsed=false;localStorage.setItem("vw-pages-collapsed","false");}
        setPageView(S.pageViewMode === "timeline" ? "list" : "timeline");
        break;
      case "close-workbench":
        await workbenchClose.close();
        break;
      case "project-trash": await projectManagement.openTrash(); break;
      case "project-delete": await projectManagement.remove(S.homeProjects.find(p=>p.id===id)); break;
      case "project-duplicate": await projectManagement.duplicate(S.homeProjects.find(p=>p.id===id)); break;
      case "project-rename": await projectManagement.rename(S.homeProjects.find(p=>p.id===id)); break;
      case "home":
        await home();
        break;
      case "library":
        await library();
        break;
      case "new":
        newDialog();
        break;
      case "import-html":
        openImportDialog({ api, modal, closeModal, notice, onCreated: () => { if (S.view === "home") home().catch(() => {}); }, onDone: (projectId) => open(projectId).catch((err) => notice(err.message)) });
        break;
      case "open":
        await open(id);
        break;
      case "close":
        closeModal();
        break;
      case "switch":
        switchPage(id);
        break;
      case "select":
        if (!editable(page(), id)) {
          notice("这个元素或所在分组已锁定");
          break;
        }
        S.selected = e.shiftKey ? [...new Set([...S.selected, id])] : [id];
        refreshSelection();
        break;
      case "tab-layers":
        S.tab = "layers";
        refreshInspector();
        break;
      case "tab-assets":
        S.tab = "assets";
        refreshInspector();
        break;
      case "undo":
        finishCrop();
        if (S.history.canUndo) {
          S.typingField = null;
          S.project = S.history.undo();
          S.selected = [];
          keepSelection();
          S.dirty++;
          schedule();
          updateEditor();
        }
        break;
      case "redo":
        finishCrop();
        if (S.history.canRedo) {
          S.typingField = null;
          S.project = S.history.redo();
          S.selected = [];
          keepSelection();
          S.dirty++;
          schedule();
          updateEditor();
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
      case "crop-image":
        if (S.selected.length === 1) cropImage(S.selected[0]);
        break;
      case "replace-image":
        if (S.selected.length === 1) await replaceImageDialog(S.selected[0]);
        break;
      case "add-text":
        addElement("text");
        break;
      case "add-shape": {
        const box = b.getBoundingClientRect();
        showContextMenu({ x: box.left, y: box.bottom + 6, items: [{ action: "rect", label: "矩形" }, { action: "ellipse", label: "圆形" }], onAction: (kind) => { try { addElement("shape", kind); } catch (error) { notice(error.message); } } });
        break;
      }
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
      case "tab-outline":
        S.tab = "outline";
        refreshInspector();
        break;
      case "toggle-pages":
        if(S.pageViewMode === "timeline") {S.pagesCollapsed=false;localStorage.setItem("vw-pages-collapsed","false");setPageView("list");break;}
        S.pagesCollapsed = !S.pagesCollapsed;
        localStorage.setItem("vw-pages-collapsed", String(S.pagesCollapsed));
        refreshLayout();
        break;
      case "toggle-inspector":
        S.inspectorCollapsed = !S.inspectorCollapsed;
        localStorage.setItem("vw-inspector-collapsed", String(S.inspectorCollapsed));
        refreshLayout();
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
      case "data-settings":
        await runtimeSettings.showSettings();
        break;
      case "reveal":
        await api("/api/reveal", "POST", { path: b.dataset.path });
        break;
      case "play":
        finishCrop();
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
        updateEditor();
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
function clearDocumentDraft(element) {
  delete element.documentDraft;
  for (const child of element.children || []) clearDocumentDraft(child);
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
    if (key === "lineHeight") value = Math.max(0.1, Math.round(value * 100) / 100);
    if (key === "cornerRadius") value = Math.max(0, value);
  }
  if (key === "font") value = value || null;
  if (key === "height" && findElement(page(), S.selected[0])?.element.type === "text") return; // 文字框高度由内容决定
  let different = false;
  mutateElements(page(), rootSelection(page(), S.selected), (e) => {
    if (STYLE_TYPE[root]) {
      if (e.type === STYLE_TYPE[root] && setStyle(e, root, sub, value)) different = true;
      return;
    }
    if (e[key] !== value) {
      if (
        (["text", "fontSize", "fontWeight", "color", "font", "align", "lineHeight", "letterSpacing"].includes(key) && e.type !== "text") ||
        (key === "fill" && e.type !== "shape") ||
        (key === "cornerRadius" && (e.type !== "shape" || e.shape !== "rect")) ||
        (key === "fit" && e.type !== "image")
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
      if (key !== "text") clearDocumentDraft(e);
      different = true;
    }
  });
  if (different) changed();
}
// 颜色框拖动时画面实时跟着变（不记撤销）；松手（change）时才写进项目、记一条撤销
function previewProp(input) {
  if (S.stepView) return; // 步骤视图里动效控制着 transform，松手后统一刷新
  const key = input.dataset.prop, [root, sub] = key.split(".");
  for (const id of rootSelection(page(), S.selected)) {
    const element = findElement(page(), id)?.element;
    if (!element) continue;
    const draft = clone(element);
    if (STYLE_TYPE[root]) { if (draft.type !== STYLE_TYPE[root]) continue; setStyle(draft, root, sub, input.value); }
    else if ((key === "color" && draft.type === "text") || (key === "fill" && draft.type === "shape")) draft[key] = input.value;
    else continue;
    paintDragged(draft);
  }
}
app.addEventListener("input", (event) => {
  const input = event.target;
  if (input.matches('input[type="color"][data-prop]')) return previewProp(input);
  if (!input.matches('textarea[data-prop="text"]') || event.isComposing) return;
  const before=clone(page()); let different=false;
  mutateElements(page(),rootSelection(page(),S.selected),element=>{
    if(element.type==='text' && element.text!==input.value){element.text=input.value;different=true;}
  });
  if(!different)return;
  // 同一次在文本框里连续打字合并成一条撤销记录
  reconcileLinkedPages();fitPageTexts();if(S.typingField===input)S.history.amend(S.project);else{S.history.commit(S.project);S.typingField=input;}S.dirty++;schedule();
  patchDocumentCanvas(before);refreshHistoryButtons();if(S.tab==="layers")refreshInspector();else S.outlineView?.refresh(); // 图层名跟着字变，正在输入的框不动
});
app.addEventListener("change", (e) => {
  if (e.target.matches("[data-step-view]")) {
    finishCrop();
    S.stepView = Number(e.target.value) || 0;
    renderBoard();
    S.outlineView?.refresh();
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
  if (e.target === S.typingField) S.typingField = null;
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
window.addEventListener("keydown", e => {
  if(S.outlineBusy)return;
  const typing=isTypingTarget(e.target);
  if(e.key==='Escape'){
    e.preventDefault();finishNudge();
    if(S.preview){stopPreview();return;}
    if(document.querySelector('.g-context-menu')){closeContextMenu();return;}
    if($('#modal-root')?.childElementCount){closeModal();return;}
    if(S.view==='play'){S.playback?.destroy();document.fullscreenElement&&document.exitFullscreen();S.view='editor';renderEditor();return;}
    if(S.view!=='editor')return;
    // 逐层退出：有选中页先取消，再退出网格
    if(S.pageViewMode==='grid'){if(S.checked.size){clearCheckedPages();return;}setPageView(readPageViewPreference());return;}
    if(S.focus){setFocus(false);return;}
    if(S.selected.length){S.selected=escapeSelection(page(),S.selected);refreshSelection();return;}
    if(S.checked.size){clearCheckedPages();return;}
    return;
  }
  if(typing)return;
  if(S.view==='play'){
    if([' ','ArrowRight'].includes(e.key)){e.preventDefault();advancePlay();}
    else if(e.key==='ArrowLeft'){e.preventDefault();nextPage(-1);}return;
  }
  if(S.view!=='editor'||S.preview||$('#modal-root')?.childElementCount||$('.g-context-menu'))return;
  // Page-view key handlers own their focused surface and stop propagation.
  const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
  try {
    if(mod&&key==='z'){e.preventDefault();finishNudge();$(`[data-action="${e.shiftKey?'redo':'undo'}"]`)?.click();return;}
    if(mod&&['a','c','v','d'].includes(key)){
      e.preventDefault();
      if(S.pageViewMode==='grid'||(!S.selected.length&&S.checked.size&&key!=='a'))pageAction({'a':'select-pages','c':'copy-pages','v':'paste-pages','d':'duplicate-pages'}[key]);
      else elementAction({'a':'select-all','c':'copy-elements','v':'paste-elements','d':'duplicate-elements'}[key]);return;
    }
    if(e.key==='Enter'&&!mod&&S.selected.length===1&&findElement(page(),S.selected[0])?.element.type==='text'){e.preventDefault();editText(S.selected[0],{selectAll:true});return;}
    if(['Backspace','Delete'].includes(e.key)){e.preventDefault();if(S.selected.length)elementAction('delete-elements');else if(S.checked.size)pageAction('delete-pages');return;}
    const arrow={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if(arrow&&S.selected.length){e.preventDefault();nudge(arrow[0]*(e.shiftKey?10:1),arrow[1]*(e.shiftKey?10:1));return;}
    const direction=['PageUp','ArrowUp'].includes(e.key)?-1:['PageDown','ArrowDown'].includes(e.key)?1:0;
    if(direction){e.preventDefault();finishNudge();const i=S.project.pages.findIndex(p=>p.id===S.pageId),p=S.project.pages[i+direction];if(p)switchPage(p.id,{clearChecked:true});}
  }catch(error){notice(error.message);}
});
window.addEventListener("resize", () => {
  if (S.view === "editor") { if (S.stepView) renderBoard(); else fitBoard(); }
  else if (S.view === "play") showPage(S.pageId);
});
// 换页：同一个 #artboard 上原地更新成新页（根节点不换），左右面板只更新内容
function switchPage(id, { clearChecked = false } = {}) {
  finishNudge();
  finishCrop();
  S.pageId = id;
  S.selected = [];
  if (clearChecked) S.checked.clear();
  updateEditor();
}
// ---------- 页面操作：三种视图共用同一份选择和历史 ----------
function clearCheckedPages() { S.checked.clear();S.pageAnchor=null;refreshPageViews(); }
function pageViewContext(mode = S.pageViewMode) {
  return { project:S.project,currentPageId:S.pageId,selectedPageIds:[...S.checked],anchorId:S.pageAnchor,mode,returnMode:readPageViewPreference(),canPaste:S.pageClipboard?.projectId===S.project?.id };
}
function setPageView(mode) { finishNudge(); S.pageViewMode=mode;writePageViewPreference(mode);refreshLayout(); }
// 每个视图根只挂一次事件（mountPageViews 用事件委托，之后原地更新页面项不用重挂）
function mountEditorPageViews() {
  for (const root of app.querySelectorAll('[data-page-view]')) {
    if (root._vwDispose) continue;
    root._vwDispose=mountPageViews(root,{getContext:()=>pageViewContext(root.dataset.pageView),callbacks:{
      selection(ids,anchor){S.checked=new Set(ids);S.pageAnchor=anchor;S.selected=[];refreshPageViews();refreshSelection();},
      openPage(id){if(S.pageId===id)return;switchPage(id);},
      view:setPageView,
      action:(name,payload)=>{try{pageAction(name,payload);}catch(e){notice(e.message);}}
    }});
    S.pageViewRoots.add(root);
  }
  S.pageViewsDispose=()=>{for(const root of S.pageViewRoots)unmountPageView(root);};
}
function unmountPageView(root) { root._vwDispose?.();root._vwDispose=null;S.pageViewRoots.delete(root); }
// 页面列表 / 网格 / 时间轴：原地协调页面项（序号、名称、当前页、勾选），新页的缩略图立刻填上，内容变了的稍后更新
function refreshPageViews() {
  for (const root of app.querySelectorAll('[data-page-view]')) patchPageItems(root, pageViewContext(root.dataset.pageView));
  mountEditorPageViews();
  setText($('.ed-col-head .ed-count'), String(S.project.pages.length));
  refreshThumbnails();
}
function pageAction(name,{ids=[...S.checked],targetId=S.pageId,position='after'}={}) {
  finishNudge(); if(!ids.length)ids=[targetId];let result;
  if(name==='select-pages'){S.checked=new Set(S.project.pages.map(p=>p.id));refreshPageViews();return;}
  if(name==='copy-pages'){S.pageClipboard=copyPages(S.project,ids);notice('页面已复制，可在同一个项目中粘贴');return;}
  if(name==='paste-pages')result=pastePages(S.project,S.pageClipboard,targetId);
  if(name==='duplicate-pages')result=duplicatePages(S.project,ids,targetId);
  if(name==='delete-pages')result=deletePages(S.project,ids,S.pageId);
  if(name==='move-pages')result=movePages(S.project,ids,targetId,position);
  if(name==='insert-page-before'||name==='insert-page-after')result=insertPage(S.project,targetId,name.endsWith('before')?'before':'after');
  if(!result)return;S.project=result.project;S.checked=new Set(result.selectedPageIds);S.pageId=result.currentPageId||S.pageId;S.selected=[];changed();
}
// ---------- 元素操作 ----------
function elementAction(action) {
  finishNudge();const ids=rootSelection(page(),S.selected);
  if(action==='edit-text'){editText(S.selected[0],{selectAll:true});return;}
  if(action==='crop-image'){cropImage(S.selected[0]);return;}
  if(action==='replace-image'){replaceImageDialog(S.selected[0]).catch(e=>notice(e.message));return;}
  if(action==='copy-elements'){S.elementClipboard=copyElements(S.project,page(),ids);notice('元素已复制，可粘贴到本项目的其他页');return;}
  if(action==='paste-elements')S.selected=pasteElements(S.project,page(),S.elementClipboard,S.elementClipboard?.pageId===S.pageId?24:0);
  else if(action==='duplicate-elements')S.selected=pasteElements(S.project,page(),copyElements(S.project,page(),ids));
  else if(action==='delete-elements'){deleteElements(page(),ids);S.selected=[];}
  else if(action==='select-all'){S.selected=selectableIds(page());refreshSelection();return;}
  else if(action==='group-elements')S.selected=groupElements(page(),ids);
  else if(action==='ungroup-elements')S.selected=ungroupElements(page(),ids);
  else if(action==='lock-elements'||action==='unlock-elements')ids.forEach(id=>{const f=findElement(page(),id);if(f)f.element.locked=action==='lock-elements';});
  else return;
  changed();
}
// 双击文字进入就地编辑：组里的文字也直接编辑（Canva 习惯）
app.addEventListener('dblclick',e=>{
  if(S.view!=='editor'||S.preview||e.button!==0||!e.target.closest('#artboard-holder'))return;
  const node=e.target.closest('[data-element-id]');if(node&&isEditingTextNode(node))return;
  const board=$('#artboard');if(!board)return;
  const deep=pickCanvasElement({board,page:page(),selected:[],screen:!!S.stepView,event:e});
  const hit=pickElement(board,e);
  const deepType=deep.id&&findElement(page(),deep.id)?.element.type;
  const id=deepType==='text'||deepType==='image'?deep.id:hit.id;
  const type=id&&findElement(page(),id)?.element.type;
  if(type==='image'){if(cropImage(id))e.preventDefault();return;}
  if(id&&editText(id,{point:{clientX:e.clientX,clientY:e.clientY}}))e.preventDefault();
});
app.addEventListener('contextmenu',e=>{
  if(S.view!=='editor'||isTypingTarget(e.target)||!e.target.closest('#canvas-well'))return;
  e.preventDefault();finishNudge();
  const board=$('#artboard');const hit=pickElement(board,e);
  // Locked elements still offer Unlock from their visible node.
  const native=e.target.closest('[data-element-id]'),nativeFound=native&&findElement(page(),native.dataset.elementId);const id=hit.id||nativeFound?.ancestors.find(e=>e.locked)?.id||native?.dataset.elementId;
  if(id && !S.selected.includes(id))S.selected=[id];
  if(!id)S.selected=[];refreshSelection();
  const selected=S.selected.map(id=>findElement(page(),id)?.element).filter(Boolean),locked=selected.some(el=>el.locked);
  const canPaste=S.elementClipboard?.projectId===S.project.id;
  const editableText=selected.length===1&&selected[0].type==='text'&&!locked&&editable(page(),selected[0].id);
  const editableImage=selected.length===1&&selected[0].type==='image'&&!locked&&editable(page(),selected[0].id);
  const items=id?[
    ...(editableText?[{action:'edit-text',label:'编辑文字'},{separator:true}]:[]),
    ...(editableImage?[{action:'crop-image',label:'裁切',disabled:!!S.stepView},{action:'replace-image',label:'替换图片'},{separator:true}]:[]),
    {action:'copy-elements',label:'复制'},{action:'paste-elements',label:'粘贴',disabled:!canPaste},{action:'duplicate-elements',label:'创建副本',disabled:locked},
    {action:'delete-elements',label:'删除',disabled:locked},{separator:true},{action:locked?'unlock-elements':'lock-elements',label:locked?'解锁':'锁定'},
    {action:'group-elements',label:'编组',disabled:locked||selected.length<2||!selected.every(el=>findElement(page(),el.id).items===findElement(page(),selected[0].id).items)},
    {action:'ungroup-elements',label:'取消编组',disabled:locked||!selected.some(el=>el.type==='group')}
  ]:[{action:'paste-elements',label:'粘贴',disabled:!canPaste},{action:'select-all',label:'全选'}];
  showContextMenu({x:e.clientX,y:e.clientY,items,onAction:action=>{try{elementAction(action);}catch(error){notice(error.message);}}});
});
function startMarquee(board,event) {
  finishNudge();event.preventDefault();
  const start={x:event.clientX,y:event.clientY}, original=event.shiftKey?S.selected.slice():[];
  const overlay=document.createElement('div');overlay.className='ed-marquee';$('#canvas-well').append(overlay);
  const wellRect=$('#canvas-well').getBoundingClientRect();S.dragging=true;
  function move(e){
    const box={x:Math.min(start.x,e.clientX),y:Math.min(start.y,e.clientY),width:Math.abs(e.clientX-start.x),height:Math.abs(e.clientY-start.y)};
    Object.assign(overlay.style,{left:`${box.x-wellRect.left}px`,top:`${box.y-wellRect.top}px`,width:`${box.width}px`,height:`${box.height}px`});
    const rects=new Map();page().elements.forEach(el=>{const node=board.querySelector(`[data-element-id="${CSS.escape(el.id)}"]`);if(!node)return;const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||(S.stepView&&Number(style.opacity)===0))return;const r=node.getBoundingClientRect();rects.set(el.id,{x:r.left,y:r.top,width:r.width,height:r.height});});
    const available={...page(),elements:page().elements.filter(e=>rects.has(e.id))};S.selected=[...new Set([...original,...marqueeIds(available,box,rects)])];markSelection();
  }
  function up(e){window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);overlay.remove();S.dragging=false;if(Math.abs(e.clientX-start.x)+Math.abs(e.clientY-start.y)<=2)S.selected=original;refreshSelection();swapReadySnapshot();}
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
}
// One uninterrupted run of arrow keys makes one undo record and one save request.
let nudgeTimer=null,nudgePending=false;
function finishNudge() { clearTimeout(nudgeTimer);if(!nudgePending)return;nudgePending=false;changed({boardOnly:true}); }
function nudge(dx,dy) {
  const before=new Map(S.selected.map(id=>[id,clone(findElement(page(),id)?.element)]));
  nudgeElements(page(),S.selected,dx,dy);S.selected.forEach(id=>{const el=findElement(page(),id)?.element;if(el){clearDocumentDraft(el);const node=$(`#artboard [data-element-id="${CSS.escape(id)}"]`);if(S.stepView)paintStepDragged(el,before.get(id),false,node?getComputedStyle(node).translate:'none');else paintDragged(el);}});
  nudgePending=true;clearTimeout(nudgeTimer);nudgeTimer=setTimeout(finishNudge,350);
}
function clearGuides(){document.querySelectorAll('.ed-guide,.ed-gap').forEach(node=>node.remove());}
function paintGuides(snap){
  clearGuides();const board=$('#artboard');if(!board)return;
  for(const guide of snap.guides||[]){const n=document.createElement('div');n.className='ed-guide';n.dataset.axis=guide.axis;const value=guide.value??guide.position;n.style.cssText=guide.axis==='x'?`left:${value}px;top:0;height:100%`:`top:${value}px;left:0;width:100%`;board.append(n);}
  for(const gap of snap.gaps||[]){const n=document.createElement('span');n.className='ed-gap';n.textContent=`间距 ${Math.round(gap.value??gap.distance??gap.gap)} px`;n.style.left=`${snap.bounds.x}px`;n.style.top=`${Math.max(0,snap.bounds.y-30)}px`;board.append(n);}
}
// 外观（透明度、翻转）和对齐控件：选中的元素对象没变就留着原来的控件（拖滑块时不被打断）；
// 撤销、同步后 S.project 换了对象，控件持有的旧元素引用失效，重新挂
function mountAppearance(){
  const host=$('.ed-props');if(!host)return;
  const elements=S.selected.length?rootSelection(page(),S.selected).map(id=>findElement(page(),id)?.element).filter(Boolean):[];
  if(host._elements&&host._elements.length===elements.length&&host._elements.every((e,i)=>e===elements[i]))return;
  host.querySelectorAll(':scope > [data-appearance]').forEach(node=>node.remove());
  host._elements=elements;
  if(!elements.length)return;
  const appearance=appearanceControls(elements,{
    change(patch){for(const e of elements){Object.assign(e,patch);clearDocumentDraft(e);const node=$(`#artboard [data-element-id="${CSS.escape(e.id)}"]`),transform=node?.style.transform;paintDragged(e);if(S.stepView&&node)node.style.transform=transform;}},
    commit(patch){for(const e of elements){Object.assign(e,patch);clearDocumentDraft(e);}changed({boardOnly:true});}
  });
  appearance.dataset.appearance='1';host.append(appearance);
  if(elements.length<2)return;
  const controls=document.createElement('section');controls.className='ed-section';controls.dataset.appearance='1';controls.innerHTML='<h3 class="ed-heading">对齐与分布</h3><div class="ed-align"></div>';
  const choices=[['left','左对齐'],['center','水平居中'],['right','右对齐'],['top','顶对齐'],['middle','垂直居中'],['bottom','底对齐'],['distribute-x','水平分布'],['distribute-y','垂直分布']];
  for(const [mode,label]of choices){const b=document.createElement('button');b.className='g-btn';b.textContent=label;b.dataset.align=mode;b.disabled=mode.startsWith('distribute')&&elements.length<3;b.onclick=()=>{finishNudge();const globalElements=elements.map(e=>elementInPage(page(),e.id));const result=mode.startsWith('distribute')?distributeElements(globalElements,mode.endsWith('x')?'x':'y'):alignElements(globalElements,mode);for(let i=0;i<result.length;i++){const e=result[i],target=findElement(page(),e.id)?.element;if(target){nudgeElements(page(),[e.id],e.x-globalElements[i].x,e.y-globalElements[i].y);clearDocumentDraft(target);}}changed({boardOnly:true});};controls.querySelector('.ed-align').append(b);}host.append(controls);
}
function confirmAction(message,description="") {
  return new Promise(resolve=>{modal(`<h2>${esc(message)}</h2><p class="g-sheet__note">${esc(description)}</p><div class="g-sheet__actions"><button class="g-btn" data-confirm-no>取消</button><button class="g-btn g-btn--prism" data-confirm-yes>确认</button></div>`);const root=$('#modal-root');S.confirmResolve=resolve;const finish=value=>{S.confirmResolve=null;closeModal();resolve(value);};root.querySelector('[data-confirm-no]').onclick=()=>finish(false);root.querySelector('[data-confirm-yes]').onclick=()=>finish(true);root.onclick=e=>{if(e.target===root)finish(false);};});
}
const projectManagement=createProjectManagement({api,confirm:confirmAction,modal,closeModal,notice,refresh:home,onOpen:open,onDeleted:async()=>{}});
const workbenchClose=createWorkbenchClose({api,flush:async()=>{finishNudge();await flush();},confirm:confirmAction,notice,renderClosed(){disposeTextMeasurer();S.pageViewsDispose?.();S.outlineView?.dispose();disconnectEvents();disposeStepView();S.project=null;S.view='closed';shell('home','<section class="hm-panel"><h1>工作台已关闭，可以关掉这个窗口了</h1></section>');}});

const runtimeSettings = mountRuntimeSettings({api,app,modal,closeModal,notice,glass:openModalGlass,closeGlass:closeModalGlass});
runtimeSettings.ready().then(home).catch((e) => {
  app.innerHTML = '<div class="startup-error">无法打开工作台，请检查本地服务。</div>';
  notice(e.message);
});

// 属性栏刷新入口：只更新内容，不换 .ed-inspector / .ed-inspector__body，不丢滚动位置。
// 选择没变时原地改各 [data-prop] 的值（焦点所在的输入框不覆盖）；选择、页面、标签页变了才重写面板内容。
// Selection changes only update controls: never restart page motion on a click.
function inspectorKey() {
  const p = page();
  return JSON.stringify([S.tab, S.pageId, S.selected, S.selected.map(id => findElement(p, id)?.element?.type || ""), S.project.fonts.map(f => [f.id, f.family])]);
}
function refreshInspector() {
  const body = $('.ed-inspector__body');
  if (!body) return;
  document.querySelectorAll('.ed-inspector .g-seg button').forEach(b => { const on = b.dataset.action === `tab-${S.tab === 'library' ? 'assets' : S.tab}`; if (b.classList.contains('active') !== on) b.classList.toggle('active', on); });
  if (S.tab === 'outline') {
    // 大纲：同一页的文稿面板留着，只刷新；换页或刚切到大纲才重新挂
    if ($('#outline-host') && S.outlinePage === S.pageId && (S.outlineView || S.outlineBusy)) { S.outlineView?.refresh(); return; }
    S.outlineView?.dispose(); S.outlineView = null;
    body.innerHTML = inspectorBody(page()); body._key = null; S.outlinePage = S.pageId;
    mountEditorOutline();
    syncGlass(app);
    return;
  }
  S.outlineView?.dispose(); S.outlineView = null;
  const key = inspectorKey();
  if (body._key === key && patchInspector(body)) return;
  const scroll = body.scrollTop, layersScroll = body.querySelector('.ed-layers')?.scrollTop || 0;
  body.innerHTML = inspectorBody(page());
  body._key = key; body._html = S.tab === 'layers' ? null : body.innerHTML;
  const list = body.querySelector('.ed-layers');
  if (list) { list._html = list.innerHTML; list.scrollTop = layersScroll; }
  mountAppearance();
  bustStale(body);
  body.scrollTop = scroll;
  syncGlass(app);
}
// 原地更新属性栏；结构对不上（字段不同）时返回 false，交给整块重写
function patchInspector(body) {
  if (S.tab !== 'layers') {
    const box = document.createElement('div');
    box.innerHTML = inspectorBody(page());
    return box.innerHTML === body._html;
  }
  const list = body.querySelector('.ed-layers'), props = body.querySelector('.ed-props');
  if (!list || !props) return false;
  const box = document.createElement('div');
  box.innerHTML = property();
  const fresh = [...box.querySelectorAll('[data-prop]')], live = [...props.querySelectorAll('[data-prop]')];
  if (fresh.length !== live.length || fresh.some((node, i) => node.dataset.prop !== live[i].dataset.prop || node.tagName !== live[i].tagName || node.type !== live[i].type)) return false;
  const html = layers(page().elements);
  if (list._html !== html) { const top = list.scrollTop; list.innerHTML = html; list._html = html; list.scrollTop = top; }
  fresh.forEach((node, i) => {
    const field = live[i];
    if (field === document.activeElement) return; // 正在输入的框不打断
    if (field.tagName === 'SELECT') { if (field.value !== node.value) field.value = node.value; return; }
    if (field.defaultValue !== node.defaultValue) field.defaultValue = node.defaultValue;
    if (field.value !== node.value) field.value = node.value;
  });
  const freshClear = [...box.querySelectorAll('[data-clear]')], liveClear = [...props.querySelectorAll('[data-clear]')];
  freshClear.forEach((node, i) => { if (liveClear[i] && liveClear[i].disabled !== node.disabled) liveClear[i].disabled = node.disabled; });
  for (const selector of ['.ed-selected strong', '.ed-selected small']) setText(props.querySelector(selector), box.querySelector(selector)?.textContent ?? '');
  mountAppearance();
  return true;
}
function refreshSelection() {
  markSelection();
  if (S.tab === 'outline') S.outlineView?.refresh();
  else if (S.tab === 'layers') refreshInspector();
  refreshHistoryButtons();
}
function refreshHistoryButtons() {
  const undo = $('[data-action="undo"]'), redo = $('[data-action="redo"]');
  if (undo) undo.disabled = !S.history.canUndo;
  if (redo) redo.disabled = !S.history.canRedo;
}
// After geometry edits, prepare a new motion snapshot beside the still-visible old
// board, then swap only when ready. Async initializers never expose a blank frame.
let snapshotGeneration = 0;
function cancelSnapshot() {
  snapshotGeneration++;
  const pending=S.pendingSnapshot; S.pendingSnapshot=null;
  pending?.run.dispose(); pending?.staging.remove();
}
function swapReadySnapshot() {
  const pending = S.pendingSnapshot;
  if (!pending?.ready || S.dragging) return;
  const { generation, view, pageId, old, oldRun, board, holder, run, staging, error } = pending;
  if (generation !== snapshotGeneration || !old.isConnected || S.pageId !== pageId || S.stepView !== view) {
    cancelSnapshot();
    return;
  }
  S.pendingSnapshot = null;
  if (error) {
    run.dispose(); staging.remove();
    notice(`动效错误：${error.message}`);
    S.stepView = 0; syncStepSelect(); renderBoard();
    return;
  }
  oldRun?.dispose();
  S.stepRun = run; board.id = 'artboard'; board.dataset.stepShown = String(view);
  holder.replaceChildren(board);
  bindBoardPointer(holder, board);
  markSelection();
}
async function refreshBoardSnapshot() {
  cancelSnapshot(); // Each new request supersedes both preparing and ready frames.
  if (!S.stepView) { refreshBoard(); return; }
  const holder = $('#artboard-holder'), old = $('#artboard'), oldRun = S.stepRun;
  if (!holder || !old) return;
  const generation = ++snapshotGeneration, view = S.stepView, pageId = S.pageId;
  const board = renderPage(S.project, page(), { assetBase: base() });
  board.style.transform = old.style.transform;
  board.style.transformOrigin = 'top left';
  const staging = document.createElement('div');
  staging.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none';
  staging.append(board); holder.append(staging);
  const run = applyStepView({project:S.project,page:page(),root:board,assetBase:base(),count:Math.max(0,view)});
  const pending = { run, staging, board, holder, old, oldRun, generation, view, pageId, ready: false };
  S.pendingSnapshot = pending;
  try {
    await run.ready;
  } catch (error) {
    pending.error = error;
  }
  if (S.pendingSnapshot !== pending) return; // Superseded frames were already disposed.
  pending.ready = true;
  swapReadySnapshot(); // Retain the latest ready frame until the pointer is released.
}
// Live document mutations retain the textarea/caret and existing animated DOM.
function patchDocumentCanvas(before) {
  cancelSnapshot();
  const board = $('#artboard'); if (!board) return;
  refreshThumbnails();
  // 静止画面：直接原地更新（样式、增删都照顾到）；步骤视图里只补文字和几何，保留动效改过的 DOM
  if (!S.stepView && !S.stepRun && !board.dataset.stepShown) {
    patchPage(board, S.project, page(), boardOptions());
    S.selected = S.selected.filter(id=>findElement(page(),id)); markSelection();
    return;
  }
  const current = allElements(page()), prior = new Map(allElements(before).map(e=>[e.id,e]));
  const ids = new Set(current.map(e=>e.id));
  board.querySelectorAll('[data-element-id]').forEach(node=>{if(!ids.has(node.dataset.elementId))node.remove();});
  const rendered = renderPage(S.project,page(),{assetBase:base()});
  for (const element of current) {
    let node = board.querySelector(`[data-element-id="${CSS.escape(element.id)}"]`);
    const old = prior.get(element.id);
    if (!node) {
      const fresh = rendered.querySelector(`[data-element-id="${CSS.escape(element.id)}"]`);
      if (fresh && !findElement(page(),element.id).ancestors.length) board.append(fresh);
      continue;
    }
    if (element.type === 'text' && old?.text !== element.text) {
      const content=node.querySelector(':scope > [data-vw-flip]')||node;
      content.replaceChildren(document.createTextNode(element.text));
    }
    if (old && ['fontSize','fontWeight','height','width','x','y'].some(k=>old[k]!==element[k])) {
      for (const key of ['fontSize','height','width']) node.style[key]=`${element[key]}px`;
      node.style.fontWeight=String(element.fontWeight);
      node.style.left=`${element.x}px`;node.style.top=`${element.y}px`;
    }
  }
  S.selected = S.selected.filter(id=>ids.has(id)); markSelection();
}
async function mountEditorOutline() {
  const host = $('#outline-host'), currentPage = page(), projectId = S.project.id;
  if (!host) return;
  // Migration is automatic but preserves a restore point for legacy pending edits.
  if (currentPage.outline?.mode !== 'document') {
    S.outlineBusy = true; host.textContent='正在准备文稿…';
    try {
      await flush();
      if (currentPage.outline) await api(`${path()}/versions`, 'POST', {note:'大纲文档联动前自动存版'});
      if (S.project.id !== projectId || page().id !== currentPage.id || !host.isConnected) return;
      const before = clone(page());
      let frames;
      if (!before.outline && before.motion) {
        try { frames = await captureOutlinePage(S.project,before,base()); }
        catch(error) { notice(`文稿已显示全部文字；屏幕可见性待 agent 校对：${error.message}`); }
        if (!host.isConnected || page().id !== before.id) return;
        if (JSON.stringify(page()) !== JSON.stringify(before)) { queueMicrotask(mountEditorOutline); return; }
      }
      reconcileDocument(S.project,page());
      if (frames) for (const row of page().outline.rows) {
        row.visibleOn=frames.flatMap((items,index)=>items.some(e=>e.id===row.elementId && e.visible)?[index+1]:[]);
        row.from=row.visibleOn[0]||1;row.until=null;
      }
      reconcileDocument(S.project,page()); S.history.commit(S.project); S.dirty++;schedule();
      patchDocumentCanvas(before);
      const priorView=S.stepView;clampStepView();if(priorView!==S.stepView)renderBoard();
      const switcher = $('.ed-stepview');
      if (switcher) switcher.outerHTML=stepSwitcher(page());
      else $('.ed-tools')?.insertAdjacentHTML('afterbegin',stepSwitcher(page()));
      refreshHistoryButtons();
    } catch(error) {host.textContent=error.message;return;}
    finally {S.outlineBusy=false;}
  }
  if (!host.isConnected) return;
  S.outlineView = mountOutlinePanel({
    host, getProject:()=>S.project, getPage:page,
    getScreen:()=>S.stepView===0?null:S.stepView===-1?1:S.stepView+1,
    setScreen:screen=>{S.stepView=screen==null?0:screen===1?-1:screen-1;syncStepSelect();renderBoard();S.outlineView?.refresh();},
    mutate: (fn,{kind}={})=>{
      const before = clone(page()), result=fn(S.project,page());
      if (JSON.stringify(before)===JSON.stringify(page())) return result;
      fitPageTexts();S.history.commit(S.project);S.dirty++;schedule();refreshHistoryButtons();
      if (kind!=='metadata' || JSON.stringify(before.elements)!==JSON.stringify(page().elements)) patchDocumentCanvas(before);
      const switcher=$('.ed-stepview');if(switcher)switcher.outerHTML=stepSwitcher(page());
      S.outlineView?.refresh(); return result;
    },
    flush, request:(suffix,method,body)=>api(`${path()}${suffix}`,method,body),
    notice,openLibrary:outlineLibrary,
  });
}
async function outlineLibrary() {
  const choices = await api("/api/library");
  return new Promise(resolve => {
    modal(`<h2>选择大纲图片</h2><div class="g-sheet__list">${choices.map((a,i) => `<button class="g-row" data-outline-library="${i}"><img class="g-row__thumb" src="${esc(a.url)}" alt=""><span>${esc(a.name || a.file)}</span></button>`).join("")}</div><div class="g-sheet__actions"><button class="g-btn" data-outline-library-cancel>取消</button></div>`);
    const root = $("#modal-root");
    let settled = false;
    const finish = asset => { if (settled) return; settled = true; observer.disconnect(); resolve(asset); };
    const observer = new MutationObserver(() => { if (!root.querySelector('[data-outline-library-cancel]')) finish(null); });
    observer.observe(root, {childList:true});
    root.querySelector('[data-outline-library-cancel]').onclick = () => { closeModal(); finish(null); };
    root.querySelectorAll('[data-outline-library]').forEach(button => button.onclick = async () => {
      try {
        await flush();
        const asset = choices[Number(button.dataset.outlineLibrary)];
        const result = await api(`${path()}/assets`, "POST", {libraryFile:asset.file,width:asset.width,height:asset.height,revision:S.revision});
        S.project = result.project; ownRevision(result.revision); S.base = clone(S.project); S.history.commit(S.project);
        closeModal(); finish(result.asset);
      } catch(error) { notice(error.message); }
    });
  });
}
