// 视觉工作台 · 界面主体（第 12 轮重写）。
// 每一页 = agent 写的网页（pages/<页面编号>.html），编辑画布用 web/page-frame.js 的隔离 iframe 显示；
// 用户在 iframe 里做的修改由运行时回报（postMessage），这里记进 project.json 的 pages[].edits（修改单），
// 走撤销 / 自动保存 / 实时同步。工作台不对设计做任何判断或提示。
import { selectPageIds, movePages, pageClipboard, readPageClipboard, writePageClipboard } from "./page-operations.js";
import { renderPageItems, mountPageViews, readPageViewPreference, writePageViewPreference } from "./page-views.js";
import { showContextMenu, closeContextMenu } from "./context-menu.js";
import { createProjectManagement } from "./project-management.js";
import { createWorkbenchClose } from "./workbench-close.js";
import { mountRuntimeSettings, desktopShellStatus } from "./runtime-settings.js";
import { createHome } from "./home.js";
import { createThumbnails, fetchPageText, pageFileURL, loadFrameModule } from "./thumbnails.js";
import { patchPageItems } from "./page-items.js";
import { upsertEdit, removeUserImage, newUserImageId, isUserImage } from "./edits-model.js";
import { isWebProject, pageSize, pageViewport, WEB_DEVICES } from "./project-kinds.js";
// 实时连接（第 3 轮）：合并用户和 agent 的修改
import { createSyncController, mergeProjects, summarizeConflicts } from "./sync.js";
// 玻璃界面组件（第 2 轮视觉）
import { icon } from "./ui/icons.js";
import { mascot } from "./ui/mascot.js";
import { liven, stopLoops } from "./ui/motion.js";
import { syncGlass, openModalGlass, closeModalGlass, setBackgroundFile, resetBackground } from "./ui/glass.js";

const $ = (s) => document.querySelector(s),
  app = $("#app"),
  toast = $("#toast");
const clone = (value) => structuredClone(value);
const S = {
  view: "home",
  project: null,
  revision: null,
  pageId: null,
  checked: new Set(),
  pageViewMode: readPageViewPreference(),
  pageAnchor: null,
  pageClipboard: readPageClipboard(),
  history: null,
  dirty: 0,
  saved: 0,
  saving: false,
  conflict: false,
  base: null, // 上次和磁盘一致时的项目（合并 agent 修改时当作共同起点）
  events: null,
  sync: null,
  lastConflict: null,
  stale: new Map(), // 被 agent 换过内容的文件（页面、素材）→ 时间戳
  exportKind: "pdf",
  inspectorCollapsed: localStorage.getItem("vw-inspector-collapsed") === "true",
  pagesCollapsed: localStorage.getItem("vw-pages-collapsed") === "true",
  focus: false, // 专注模式：藏起顶栏和左右面板（刷新后不记得）
  ownRevisions: new Set(), // 工作台自己写盘得到的版本号
  echoRevision: null,
  pageViewRoots: new Set(),
  mark: null, // 画布里选中的可改元素 { id, caps, values }
  editingText: false, // 运行时正在改字
  scrollTop: 0, // 网页页面：窗口里往下浏览了多少（运行时回报）
  screen: 1, // 带动效的页面：画布停在第几屏（换页回到 1）
};
const web = () => isWebProject(S.project);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function api(path, method = "GET", body) {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || data.message || `请求失败 ${r.status}`);
    e.status = r.status;
    e.data = data;
    if (r.status === 423) window.dispatchEvent(new Event("vw-session-blocked"));
    throw e;
  }
  return data;
}
const path = () => `/api/projects/${encodeURIComponent(S.project.id)}`,
  page = () => S.project.pages.find((p) => p.id === S.pageId) || S.project.pages[0];
function notice(m) {
  toast.textContent = m;
  toast.classList.add("visible");
  clearTimeout(notice.t);
  notice.t = setTimeout(() => toast.classList.remove("visible"), 3200);
}
// 撤销记录：整份项目的快照
function createHistory(initial, limit = 60) {
  let current = clone(initial), past = [], future = [];
  return {
    commit(next) { past.push(current); if (past.length > limit) past.shift(); current = clone(next); future = []; },
    undo() { if (!past.length) return clone(current); future.push(current); current = past.pop(); return clone(current); },
    redo() { if (!future.length) return clone(current); past.push(current); current = future.pop(); return clone(current); },
    // 页面文件已经删掉的页：从所有快照里拿掉（撤销不能把指向已删文件的页带回来）
    drop(pageIds) { const set = new Set(pageIds); const strip = (p) => ({ ...p, pages: p.pages.filter((x) => !set.has(x.id)) }); past = past.map(strip).filter((p) => p.pages.length); future = future.map(strip).filter((p) => p.pages.length); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
// 给 agent 看的引用：每行「项目 <编号> · 第 N 页（<页面编号>）」，选中的可改元素接在当前页后面
function referenceText(project, { checkedPageIds = [], currentPageId, markId = null } = {}) {
  const pages = project.pages || [], head = `项目 ${project.id}`;
  if (!pages.length) return head;
  const current = pages.find((p) => p.id === currentPageId) || pages[0], checked = new Set(checkedPageIds);
  const any = pages.some((p) => checked.has(p.id));
  return pages.filter((p) => checked.has(p.id) || (p === current && (markId || !any))).map((p) => {
    const line = `${head} · 第 ${pages.indexOf(p) + 1} 页（${p.id}）`;
    return p === current && markId ? `${line} · ${markId}` : line;
  }).join("\n");
}
// glass：在这个按钮下面垫一块真玻璃（见 ui/glass.js）
function glassAttr(glass) {
  if (!glass) return "";
  const [key, layer = "control"] = glass.split(":");
  return `data-glass="${key}" data-glass-layer="${layer}"`;
}
function gbtn(a, label, { icon: name, cls = "", extra = "", glass = "" } = {}) {
  return `<button class="g-btn ${glass ? "g-on-glass" : ""} ${cls}" data-action="${a}" ${glassAttr(glass)} ${extra}>${name ? icon(name, 17) : ""}${label}</button>`;
}
function ibtn(a, name, title, extra = "") {
  return `<button class="ed-ibtn" data-action="${a}" title="${title}" aria-label="${title}" ${extra}>${icon(name, 18)}</button>`;
}
function tbtn(a, label, name, cls = "", extra = "") {
  return `<button class="ed-tbtn ${cls}" data-action="${a}" title="${label}" ${extra}>${name ? icon(name, 16) : ""}<span>${label}</span></button>`;
}
function shell(active, body) {
  document.documentElement.classList.add("glass-mode");
  S.homeSel?.dispose();
  S.homeSel = null;
  destroyFrame();
  stopLoops();
  closeModalGlass();
  const nav = (a, name, title) => `<button class="ed-ibtn ${active === a ? "is-on" : ""}" data-action="${a}" title="${title}" aria-label="${title}" ${active === a ? 'aria-current="page"' : ""}>${icon(name, 18)}</button>`;
  const focus = active === "editor" && S.focus ? " is-focus" : "";
  showDesktopNotice();
  app.innerHTML = `<div class="ed-shell${focus}"><aside class="ed-rail"><div class="ed-logo g-disc-badge" title="视觉工作台">${mascot({ size: 38, disc: true, label: "视觉工作台" })}</div><nav class="ed-dock">${nav("home", "grid", "项目总览")}${nav("library", "library", "公共素材库")}${ibtn("background", "image", "更换背景")}</nav><div class="ed-rail__spacer"></div><div class="ed-avatar" title="用户">用</div></aside><main class="ed-main">${body}</main></div><div id="modal-root"></div>`;
}
// 旧版桌面应用（没有右键菜单等）：顶部一条可关闭的提示，关掉后这次打开不再出现
function showDesktopNotice() {
  if (showDesktopNotice.closed || document.querySelector("#desktop-notice")) return;
  if (!desktopShellStatus(navigator.userAgent).outdated) return;
  try { if (sessionStorage.getItem("vw-desktop-notice-closed") === "1") return; } catch {}
  const bar = document.createElement("div");
  bar.id = "desktop-notice";
  bar.className = "vw-shell-notice";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>桌面应用是旧版本，右键菜单等功能要重新制作应用才有，见 docs/desktop.md</span><button class="ed-ibtn" data-close-desktop-notice title="关闭提示" aria-label="关闭提示">${icon("x", 16)}</button>`;
  bar.querySelector("[data-close-desktop-notice]").onclick = () => {
    showDesktopNotice.closed = true;
    try { sessionStorage.setItem("vw-desktop-notice-closed", "1"); } catch {}
    bar.remove();
  };
  document.body.append(bar);
}
function head(name, count, action) {
  return `<header class="ed-top"><div class="ed-titlebox"><h1 class="ed-title">${esc(name)}</h1>${count ? `<span class="ed-count ed-count--bg">${count}</span>` : ""}</div><div class="ed-spacer"></div>${action}</header>`;
}
function modal(html) {
  // 焦点留在画布的 iframe 里时按键进不了父页面（Esc 关不掉弹窗）：开弹窗前把焦点拿回来
  if (document.activeElement?.tagName === "IFRAME") document.activeElement.blur();
  $("#modal-root").innerHTML = `<div class="modal-backdrop g-backdrop"><div class="g-sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $(".modal-backdrop").onpointerdown = (e) => { if (e.target === e.currentTarget) closeModal(); };
  openModalGlass($(".g-sheet"));
}
function closeModal() {
  const pending = S.confirmResolve;
  S.confirmResolve = null;
  pending?.(false);
  closeModalGlass();
  $("#modal-root")?.replaceChildren();
}
function confirmAction(message, description = "") {
  return new Promise((resolve) => {
    modal(`<h2>${esc(message)}</h2><p class="g-sheet__note">${esc(description)}</p><div class="g-sheet__actions"><button class="g-btn" data-confirm-no>取消</button><button class="g-btn g-btn--prism" data-confirm-yes>确认</button></div>`);
    const root = $("#modal-root");
    S.confirmResolve = resolve;
    const finish = (value) => { S.confirmResolve = null; closeModal(); resolve(value); };
    root.querySelector("[data-confirm-no]").onclick = () => finish(false);
    root.querySelector("[data-confirm-yes]").onclick = () => finish(true);
  });
}

// ---------- 缩略图 ----------
// 编辑器（页面栏三种视图）和总览卡片共用 thumbnails.js：静态文档 + 无脚本 iframe，只给看得见的建
const stampOf = (file) => S.stale.get(file) || "";
const thumbnails = createThumbnails({ getProject: () => S.project, host: app, stamp: stampOf, active: () => S.view === "editor" });
const homeThumbs = createThumbnails({ getProject: () => null, host: app, active: () => S.view === "home" });
function refreshThumbnails() { if (S.project) thumbnails.refresh(); }

// ---------- 项目总览 ----------
async function home() {
  await flush();
  S.view = "home";
  S.project = null;
  S.focus = false;
  disconnectEvents();
  await homeUI.show();
}
// 打开项目：服务端转换旧项目失败等情况会带中文说明（409 / 4xx），在总览弹提示
async function open(id, data) {
  try {
    await flush();
    data ||= await api(`/api/projects/${encodeURIComponent(id)}`);
  } catch (e) {
    modal(`<h2>打不开这个项目</h2><p class="g-sheet__note" data-open-error>${esc(e.message)}</p><div class="g-sheet__actions">${gbtn("close", "知道了")}</div>`);
    return;
  }
  S.project = data.project;
  S.revision = data.revision;
  S.pageId = S.project.pages[0]?.id;
  S.mark = null;
  S.checked.clear();
  S.history = createHistory(S.project);
  S.dirty = S.saved = 0;
  S.conflict = false;
  S.base = clone(S.project);
  S.lastConflict = null;
  S.stale.clear();
  S.ownRevisions.clear();
  S.echoRevision = null;
  S.focus = false;
  S.view = "editor";
  renderEditor();
  connectEvents(S.project.id);
  if (data.syncConflicts?.length) modal(`<h2>发现疑似同步冲突副本</h2><p class="g-sheet__note">这些文件可能是网盘留下的另一份修改，请先核对；工作台不会自动删除或合并。</p><ul>${data.syncConflicts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul><div class="g-sheet__actions">${gbtn("close", "知道了")}</div>`);
}

// ---------- agent 状态 ----------
const agentUI = { state: "idle" };
function agentChip() {
  const awake = agentUI.state === "working";
  return `<span class="g-chip ed-agent ${awake ? "is-awake" : ""}" id="agent-chip"><span class="g-disc-badge g-disc-badge--sm">${mascot({ pose: awake ? "awake" : "sleep", size: 17, disc: true })}</span><span>${awake ? "agent 正在改" : "agent 空闲"}</span></span>`;
}
function setAgent(state) {
  const next = state === "working" ? "working" : "idle";
  if (agentUI.state === next) return;
  agentUI.state = next;
  const chip = $("#agent-chip");
  if (chip) { chip.outerHTML = agentChip(); liven($("#agent-chip")); }
}

// ---------- 实时连接 ----------
// 用户正忙（改字、输入框里有没提交的字、弹窗开着、正在保存）时不打断她，等她忙完再合并
function isBusy() {
  if (S.view !== "editor" || !S.project) return true;
  if (S.saving || S.assetPromise || S.pagesBusy || S.editingText) return true;
  if ($("#modal-root")?.childElementCount) return true;
  const field = document.activeElement;
  if (field?.matches?.("input[data-page-name],input[data-page-height],input[data-q]") && field.value !== field.defaultValue) return true;
  return false;
}
function keepSelection() {
  if (!S.project.pages.some((p) => p.id === S.pageId)) S.pageId = S.project.pages[0].id;
  for (const id of [...S.checked]) if (!S.project.pages.some((p) => p.id === id)) S.checked.delete(id);
}
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
  if (needsSave) { S.dirty++; schedule(); } else S.saved = S.dirty;
  if (remoteChanged || conflicts.length) updateEditor();
  if (conflicts.length) {
    S.lastConflict = { ...before, labels: summarizeConflicts(conflicts) };
    conflictDialog();
  } else if (remoteChanged) notice("已载入 agent 的最新修改（可以撤销）");
}
function makeSync() {
  return createSyncController({ isBusy, getLocal: () => ({ project: S.project, base: S.base, revision: S.revision }), fetchRemote: () => api(path()), apply: applySync });
}
// agent 换了页面文件 / 素材（项目文件没变）：当前页重载 iframe（尽量保留选中），缩略图按新内容重画
function refreshFiles(files) {
  const stamp = Date.now();
  for (const file of files) if (file !== "project.json") S.stale.set(file, stamp);
  clearTimeout(refreshFiles.t);
  const attempt = () => {
    if (S.view === "editor" && S.project && !S.editingText && !S.pagesBusy) { refreshBoard({ force: files.some((f) => /^assets\/|^fonts\//.test(f)) }); refreshThumbnails(); return; }
    if (S.project) refreshFiles.t = setTimeout(attempt, 300);
  };
  attempt();
}
function ownRevision(revision) {
  S.revision = revision;
  S.ownRevisions.add(revision);
  if (S.ownRevisions.size > 40) S.ownRevisions.delete(S.ownRevisions.values().next().value);
}
function checkEcho() {
  const revision = S.echoRevision;
  S.echoRevision = null;
  if (revision && revision !== S.revision && !S.ownRevisions.has(revision)) S.sync?.notify();
}
function connectEvents(id) {
  disconnectEvents();
  S.sync = makeSync();
  const events = new EventSource(`/api/projects/${encodeURIComponent(id)}/events`);
  S.events = events;
  const mine = () => S.events === events && S.project?.id === id;
  const data = (e) => { try { return JSON.parse(e.data); } catch { return {}; } };
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
    if (!d.external) {
      if (S.ownRevisions.has(d.revision)) return;
      if (S.saving || S.assetPromise || S.pagesBusy) { S.echoRevision = d.revision; return; }
    }
    S.sync.notify();
  });
  events.addEventListener("agent", (e) => { if (mine()) setAgent(data(e).state); });
}
function disconnectEvents() {
  S.events?.close();
  S.events = null;
  S.sync?.dispose();
  S.sync = null;
  clearTimeout(refreshFiles.t);
  agentUI.state = "idle";
}

// ---------- 编辑器外壳：一次性挂好，之后只做增量更新 ----------
const SAVE_TEXT = { warn: "保存冲突", busy: "正在保存…", ok: "已保存" };
function gridClass() {
  return `ed-grid${S.inspectorCollapsed ? " is-inspector-collapsed" : ""}${S.pagesCollapsed || S.pageViewMode === "timeline" ? " is-pages-collapsed" : ""}${S.pageViewMode === "grid" ? " is-page-grid" : ""}${S.pageViewMode === "timeline" ? " is-page-timeline" : ""}`;
}
const pagesToggleButton = () => ibtn("toggle-pages", S.pagesCollapsed || S.pageViewMode === "timeline" ? "chevronRight" : "chevronLeft", S.pageViewMode === "timeline" ? "切回页面列表" : S.pagesCollapsed ? "展开页面栏" : "收起页面栏", `aria-expanded="${!S.pagesCollapsed && S.pageViewMode !== "timeline"}"`);
const inspectorToggleButton = () => ibtn("toggle-inspector", S.inspectorCollapsed ? "chevronLeft" : "chevronRight", S.inspectorCollapsed ? "展开属性栏" : "收起属性栏", `aria-expanded="${!S.inspectorCollapsed}"`);
const headTimelineButton = () => tbtn("page-timeline", S.pageViewMode === "timeline" ? "列表" : "时间轴", "layers");
const toolGridButton = () => tbtn("page-grid", S.pageViewMode === "grid" ? "回到画布" : "网格", "maximize");
const toolTimelineButton = () => tbtn("page-timeline", S.pageViewMode === "timeline" ? "页面列表" : "时间轴", "layers");
const focusButton = () => ibtn("focus", S.focus ? "minimize" : "maximize", S.focus ? "退出专注模式" : "专注模式", `aria-pressed="${S.focus ? "true" : "false"}"`);
const focusExitBar = () => `<div class="ed-bar ed-focus-exit" ${glassAttr("focus-exit:panel")}>${ibtn("focus", "minimize", "退出专注模式", 'aria-pressed="true"')}</div>`;
const pageViewHost = (mode) => `<div class="ed-page-${mode} ed-scroll">${renderPageItems(pageViewContext(mode))}</div>`;
const footText = () => {
  const p = page();
  if (web()) {
    const view = pageViewport(S.project, p), size = pageSize(S.project, p), label = WEB_DEVICES[p.device]?.label || "电脑端";
    return `${label}窗口 ${view.width}×${view.height} <span>·</span> 整页 ${size.width}×${size.height}`;
  }
  return `${S.project.artboard.width} × ${S.project.artboard.height} px <span>·</span> ${esc(S.project.artboard.preset)}`;
};
function renderEditor() {
  if (!S.project) return;
  S.pageViewsDispose?.();
  const p = page();
  const saveState = S.conflict ? "warn" : S.dirty !== S.saved ? "busy" : "ok";
  shell(
    "editor",
    `<header class="ed-top"><div class="ed-titlebox"><h1 class="ed-title">${esc(S.project.name)}</h1>${agentChip()}</div><div class="ed-spacer"></div><div class="ed-bar" ${glassAttr("actions:panel")}>${ibtn("undo", "undo", "撤销", S.history.canUndo ? "" : "disabled")}${ibtn("redo", "redo", "重做", S.history.canRedo ? "" : "disabled")}<span class="ed-save" id="save-chip"><i class="${saveDotClass(saveState === "warn" ? SAVE_TEXT.warn : SAVE_TEXT.ok)}"></i><span class="ed-save__label" aria-hidden="true">${SAVE_TEXT[saveState === "warn" ? "warn" : "ok"]}</span><span id="save-status" class="vw-sr-only" role="status">${SAVE_TEXT[saveState]}</span></span><span class="ed-sep"></span>${tbtn("close-workbench", "关闭工作台", "close")}${tbtn("export", "导出", "upload")}<button class="ed-play" data-action="play">${icon("play", 15)}<span>放映</span></button></div></header><div class="${gridClass()}"><aside class="ed-col ed-pages" ${glassAttr("pages:panel")} data-glass-frost>${pagesToggleButton()}<div class="ed-col-head"><h2>页面</h2>${tbtn("page-grid", "网格", "maximize")}${headTimelineButton()}<span class="ed-count">${S.project.pages.length}</span><div class="ed-spacer"></div><button class="ed-add" data-action="add-page" title="添加页面" aria-label="添加页面">${icon("plus", 16)}</button></div><div class="page-list ed-scroll">${renderPageItems(pageViewContext("list"))}</div><div class="ed-pages__foot">${tbtn("copy", "复制到新项目", "copyPlus")}${tbtn("reference", "复制引用", "link")}</div></aside><section class="ed-work" ${glassAttr("work:panel")} data-glass-frost><div class="ed-toolbar"><span class="ed-crumb" title="${esc(p.name)}">${esc(p.name)}</span>${screenBar()}<div class="ed-tools">${toolGridButton()}${toolTimelineButton()}<span class="ed-sep"></span><span class="ed-zoom" id="zoom-label"></span>${focusButton()}</div></div><div class="ed-bar ed-quickbar" ${glassAttr("quickbar:control")} role="toolbar" aria-label="修改选中的内容" hidden></div><div class="ed-well" id="canvas-well"><div id="artboard-holder"><div id="artboard" class="vw-artboard vw-stage"></div></div></div>${S.pageViewMode === "grid" ? pageViewHost("grid") : ""}${S.pageViewMode === "timeline" ? pageViewHost("timeline") : ""}<div class="ed-foot">${footText()}</div></section><aside class="ed-col inspector ed-inspector" ${glassAttr("inspector:panel")} data-glass-frost>${inspectorToggleButton()}<div class="ed-inspector__body ed-scroll"></div></aside></div>${S.focus ? focusExitBar() : ""}`,
  );
  if (saveState === "busy") saveStatus(SAVE_TEXT.busy);
  const well = $("#canvas-well");
  well.ondragover = (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); };
  well.ondrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    (async () => { for (const file of files) await pasteImage(file); })().catch((err) => notice(err.message));
  };
  well.onpointerdown = (e) => { if (e.target === well || e.target.id === "artboard-holder") clearMark(); };
  if (!S.resizeObserver) S.resizeObserver = new ResizeObserver(() => fitBoard());
  S.resizeObserver.disconnect();
  S.resizeObserver.observe(well);
  refreshBoard();
  refreshInspector();
  refreshQuickToolbar();
  refreshThumbnails();
  mountEditorPageViews();
  liven(app);
  syncGlass(app);
}
// 增量刷新入口：数据变了以后调用它，只更新变了的部分（不替换 #app、画布、面板、缩略图节点）
function updateEditor() {
  if (!S.project || S.view !== "editor") return;
  if (!$(".ed-shell .ed-grid") || !$("#artboard")) return renderEditor();
  refreshTopbar();
  refreshToolbar();
  refreshPageViews();
  refreshBoard();
  refreshInspector();
  refreshQuickToolbar();
}
function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
function setHTML(node, html) { if (node && node._html !== html) { node.innerHTML = html; node._html = html; } }
function replaceButton(selector, html) {
  const node = $(selector);
  if (!node || node._html === html) return;
  const box = document.createElement("div");
  box.innerHTML = html;
  const next = box.firstElementChild;
  next._html = html;
  node.replaceWith(next);
}
function refreshTopbar() {
  setText($(".ed-title"), S.project.name);
  refreshHistoryButtons();
}
function refreshToolbar() {
  const p = page(), crumb = $(".ed-crumb");
  setText(crumb, p.name);
  if (crumb && crumb.title !== p.name) crumb.title = p.name;
  setHTML($(".ed-foot"), footText());
  refreshScreenBar();
}
// ---------- 第 N 屏：带动效的页面，画布停在选定那一屏播完的样子，照常修改 ----------
// 屏数 = motion.steps + 1；第 1 屏 = 初始化完成、还没执行第 1 步。
const screenTotal = (p = page()) => { const n = Number(p?.motion?.steps); return Number.isInteger(n) && n > 0 ? n + 1 : 0; };
const clampScreen = (k, p = page()) => Math.min(Math.max(1, Math.round(Number(k)) || 1), Math.max(1, screenTotal(p)));
// 给画布 iframe 的 screen 选项：没有动效的页面不给（照原样显示，不跑初始化）
const screenOption = (p = page()) => (screenTotal(p) ? clampScreen(S.screen, p) : null);
function screenButtons(p = page()) {
  const total = screenTotal(p);
  let html = "";
  for (let k = 1; k <= total; k++) html += `<button class="ed-tbtn ed-screen" data-action="screen" data-screen="${k}" aria-pressed="${k === S.screen}" title="画布停在第 ${k} 屏${k === 1 ? "（动效开始前）" : `（第 ${k - 1} 步播完）`}"><span>第 ${k} 屏</span></button>`;
  return html;
}
const screenBar = () => { const html = screenButtons(); return `<div class="ed-screens" role="group" aria-label="画布显示第几屏" ${html ? "" : "hidden"}>${html}</div>`; };
function refreshScreenBar() {
  const bar = $(".ed-screens");
  if (!bar) return;
  const html = screenButtons();
  if (bar.hidden !== !html) bar.hidden = !html;
  setHTML(bar, html);
}
function refreshHistoryButtons() {
  const undo = $('[data-action="undo"]'), redo = $('[data-action="redo"]');
  if (undo) undo.disabled = !S.history.canUndo;
  if (redo) redo.disabled = !S.history.canRedo;
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
    if (want && !host) { $(".ed-foot").insertAdjacentHTML("beforebegin", pageViewHost(mode)); mountEditorPageViews(); }
    else if (!want && host) { host.querySelectorAll("[data-page-view]").forEach(unmountPageView); host.remove(); }
  }
  refreshThumbnails();
  fitBoard();
  syncGlass(app);
}
function setFocus(on) {
  if (S.focus === on) return;
  S.focus = on;
  refreshLayout();
}

// ---------- 画布：当前页的隔离 iframe ----------
// 课件页：画板尺寸，整体 CSS 缩放进画布区（留白居中）。网页页：固定设备窗口（1440×900 / 390×844）按比例缩放，
// 页面在 iframe 里自然滚动（滚轮）。缩放只改外层的 transform，iframe 本身不重建。
let F = null; // { frame, stage, pageId, file, sig, stamp, token }
let frameToken = 0;
const editsSig = (p) => JSON.stringify(p?.edits || []);
const viewOf = (p = page()) => pageViewport(S.project, p);
function pageBase(p) {
  const dir = String(p.file || `pages/${p.id}.html`).split("/").slice(0, -1).map(encodeURIComponent).join("/");
  return new URL(`/data/projects/${encodeURIComponent(S.project.id)}/${dir ? `${dir}/` : ""}`, location.href).href;
}
function destroyFrame() {
  frameToken++;
  try { F?.frame?.destroy(); } catch {}
  F = null;
  S.mark = null;
  S.editingText = false;
}
function fitBoard() {
  const well = $("#canvas-well"), holder = $("#artboard-holder"), stage = $("#artboard");
  if (!well || !holder || !stage || !S.project) return;
  const view = viewOf();
  const pad = 28 * 2, W = Math.max(40, well.clientWidth - pad), H = Math.max(40, well.clientHeight - pad);
  const scale = Math.max(0.02, Math.min(W / view.width, H / view.height));
  S.scale = scale;
  const w = `${view.width}px`, h = `${view.height}px`, t = `scale(${scale})`;
  if (stage.style.width !== w) stage.style.width = w;
  if (stage.style.height !== h) stage.style.height = h;
  if (stage.style.transform !== t) stage.style.transform = t;
  holder.style.width = `${Math.round(view.width * scale)}px`;
  holder.style.height = `${Math.round(view.height * scale)}px`;
  setText($("#zoom-label"), `${Math.round(scale * 100)}%`);
  // 运行时的选中框、把手按缩放补偿粗细
  if (F?.frame && F.uiScale !== scale) { F.uiScale = scale; F.frame.setUiScale?.(scale); }
}
// 当前页变了 → 重载 iframe；只是修改单变了（撤销 / 重做 / 同步）→ setEdits；页面文件被 agent 换了 → 重载并尽量保留选中
async function refreshBoard({ force = false } = {}) {
  const stage = $("#artboard");
  if (!stage || !S.project) return;
  fitBoard();
  const p = page();
  stage.dataset.pageId = p.id;
  const stamp = stampOf(p.file);
  if (F && F.stage === stage && F.pageId === p.id && F.file === p.file && F.stamp === stamp && !force) {
    const sig = editsSig(p);
    if (F.sig !== sig) { F.sig = sig; F.frame?.setEdits(clone(p.edits || [])); if (S.mark && !markAlive(p)) clearMark(); }
    // 动效步数被改了（agent 改了 motion.steps）：屏号夹到范围内，画布换到对应的屏
    const want = screenOption(p);
    if (want !== F.screen) goScreen(want);
    refreshScreenBar();
    return;
  }
  if (!F || F.pageId !== p.id) S.screen = 1;
  S.screen = clampScreen(S.screen, p);
  refreshScreenBar();
  const keep = F && F.pageId === p.id ? S.mark?.id : null;
  const token = ++frameToken;
  screenToken++;
  const reuse = F && F.stage === stage && F.frame ? F.frame : null;
  const screen = screenOption(p);
  F = { frame: reuse, stage, pageId: p.id, file: p.file, sig: editsSig(p), stamp, token, screen, html: null };
  S.mark = null;
  S.editingText = false;
  refreshQuickToolbar();
  stage.dataset.ready = "";
  try {
    const [mod, html] = await Promise.all([loadFrameModule(), fetchPageText(pageFileURL(S.project, p, stamp))]);
    if (token !== frameToken || !F || F.token !== token) return;
    F.html = html;
    const edits = clone(p.edits || []);
    if (reuse) {
      F.pendingSelect = keep;
      reuse.reload({ page: p, edits, html, project: S.project, screen });
      F.uiScale = null;
      fitBoard();
    } else {
      stage.replaceChildren();
      F.pendingSelect = keep;
      F.uiScale = S.scale || 1;
      F.frame = mountFrame({ mod, stage, p, html, edits, screen, token });
    }
  } catch (error) {
    if (token === frameToken) notice(`这一页显示不出来：${error.message}`);
  }
}
// 在 #artboard 里放一个编辑用的 iframe。消息只认当前显示的那个（F.frame）：
// 换屏时新 iframe 先藏在旧的后面加载，加载好之前它的消息不处理。
function mountFrame({ mod, stage, p, html, edits, screen, token, pending = false }) {
  let frame = null;
  frame = mod.createPageFrame({
    project: S.project, page: p, mode: "edit", container: null, baseHref: pageBase(p), html, edits, uiScale: S.scale || 1,
    ...(screen ? { screen } : {}),
    onMessage: (msg) => { if (F?.frame === frame) onFrameMessage(token, msg); },
    onReady: (msg) => { if (F?.frame === frame) onFrameReady(token, msg); },
    onError: (err) => { if (F?.frame === frame && F?.token === token) console.warn("页面显示出错", err); },
  });
  if (pending) frame.iframe.classList.add("vw-frame-pending");
  stage.append(frame.iframe);
  return frame;
}
// 选屏：往后（k ≥ 当前屏）在原 iframe 里原地快进；往回不能原地退，另建一个 iframe（双缓冲，不闪白）
let screenToken = 0;
function goScreen(k) {
  const p = page();
  const want = screenTotal(p) && k != null ? clampScreen(k, p) : null;
  if (want != null) S.screen = want;
  refreshScreenBar();
  if (!F?.frame || !F.html) return;
  if (want === F.screen) return;
  const my = ++screenToken, frame = F.frame;
  if (want != null && F.screen != null && want > F.screen) {
    F.screen = want;
    frame.screen(want).then((msg) => {
      if (my !== screenToken || F?.frame !== frame) return;
      if (!msg?.applied) swapFrame(want, my);
    });
    return;
  }
  swapFrame(want, my);
}
async function swapFrame(screen, my) {
  if (!F?.frame) return;
  const old = F.frame, stage = F.stage, token = F.token, p = S.project.pages.find((x) => x.id === F.pageId);
  if (!p || !stage) return;
  F.screen = screen;
  try {
    const mod = await loadFrameModule();
    if (my !== screenToken || F?.frame !== old) return;
    const sig = editsSig(p);
    const next = mountFrame({ mod, stage, p, html: F.html, edits: clone(p.edits || []), screen, token, pending: true });
    const ready = await next.ready;
    if (my !== screenToken || F?.frame !== old || !next.iframe.isConnected) { next.destroy(); return; }
    // 加载期间修改单变了（比如撤销）：补上
    if (editsSig(p) !== sig) next.setEdits(clone(p.edits || []));
    const keep = S.mark?.id;
    F.frame = next;
    next.iframe.classList.remove("vw-frame-pending");
    old.destroy();
    S.editingText = false;
    F.uiScale = null;
    fitBoard();
    onFrameReady(token, ready || {});
    if (keep && (ready?.marks || []).some((m) => m.id === keep)) next.select(keep);
    else if (S.mark) { S.mark = null; refreshQuickToolbar(); }
  } catch (error) {
    notice(`这一屏显示不出来：${error.message}`);
  }
}
function markAlive(p) {
  if (!S.mark) return false;
  if (!isUserImage(S.mark.id)) return true;
  return (p.edits || []).some((e) => e.target === S.mark.id && e.kind === "addImage");
}
function onFrameReady(token, msg = {}) {
  if (!F) return;
  const stage = $("#artboard");
  if (stage) stage.dataset.ready = "1";
  F.ready = msg;
  const keep = F.pendingSelect;
  F.pendingSelect = null;
  if (keep && (msg.marks || []).some((m) => m.id === keep)) F.frame?.select(keep);
  if (!S.mark) refreshQuickToolbar(); // 没选中东西时也要按这一页有没有整页背景标记决定工具条
}
// iframe 回报的消息（只认当前这个 iframe 的）
function onFrameMessage(token, msg = {}) {
  if (!F || !F.frame || !S.project) return;
  const type = msg.vw || msg.type;
  try {
    switch (type) {
      case "ready": return onFrameReady(token, msg);
      case "edit": return recordEdit(msg);
      case "select": return setMark(msg.id ? { id: msg.id, caps: msg.caps || [], values: msg.values || msg.style || null } : null);
      case "editing": S.editingText = !!msg.on; return;
      case "paste-image": return pasteImage(new File([msg.buffer], msg.name || "paste.png", { type: msg.type || msg.mime || "image/png" })).catch((e) => notice(e.message));
      case "menu": return imageMenu(msg);
      case "delete": return deleteUserImage(msg.id || msg.target);
      case "scroll": S.scrollTop = Number(msg.top) || 0; return;
      case "height": if (F.ready) F.ready.height = msg.height; return;
      case "key": return frameKey(msg);
      case "error": console.warn("页面运行时：", msg.message); return;
    }
  } catch (error) {
    notice(error.message);
  }
}
// 运行时已经把修改叠到页面上：这里只记进修改单（同一目标同一种修改只留一条）
function recordEdit({ target, kind, before, after }) {
  const p = S.project.pages.find((x) => x.id === F.pageId);
  if (!p) return;
  const next = upsertEdit(p.edits || [], { target, kind, before, after });
  p.edits = next;
  F.sig = editsSig(p);
  if (S.mark?.id === target && S.mark.values) S.mark.values = { ...S.mark.values, ...(after || {}) };
  commit();
}
function commit() {
  S.history.commit(S.project);
  S.dirty++;
  schedule();
  updateEditor();
}
function changed() { commit(); }
// 运行时转来的按键（焦点在 iframe 里、不在改字时）：撤销 / 重做、删除用户贴的图、Esc
function frameKey({ key = "", metaKey, ctrlKey, shiftKey, id } = {}) {
  const k = key.toLowerCase();
  if (metaKey || ctrlKey) {
    if (k === "z") (shiftKey ? redo : undo)();
    else if (k === "y") redo();
    return;
  }
  if ((key === "Delete" || key === "Backspace") && isUserImage(id)) return deleteUserImage(id);
  if (key === "Escape" && !id) { if (S.mark) { S.mark = null; refreshQuickToolbar(); } }
}
function setMark(mark) {
  S.mark = mark;
  refreshQuickToolbar();
  refreshInspector();
}
function clearMark() {
  if (!S.mark) return false;
  S.mark = null;
  F?.frame?.select(null);
  refreshQuickToolbar();
  return true;
}

// ---------- 选中时画布上方的窄工具条：字号、文字颜色、底色（按能力显示），用户贴的图多一个「删除」 ----------
const toHex = (value, fallback) => {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toLowerCase();
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : fallback;
};
function markValue(kind) {
  const p = page(), id = S.mark?.id;
  const edit = (p.edits || []).find((e) => e.target === id && e.kind === kind);
  if (edit) return edit.after?.[kind];
  return S.mark?.values?.[kind] ?? null;
}
// 整页背景（页面文件里标在 <body> 上、只能改颜色的那条标记）：没选中东西时工具条给「页面底色」
function pageBgMark() { return (F?.ready?.marks || []).find((m) => m.page && (m.caps || []).includes("background")) || null; }
function quickbarHTML() {
  const mark = S.mark;
  if (!mark) {
    const bg = pageBgMark();
    if (!bg) return "";
    const edit = (page().edits || []).find((e) => e.target === bg.id && e.kind === "background");
    return `<div class="qt-inner" data-mark="${esc(bg.id)}"><label class="g-field qt-field qt-color" title="整页背景颜色"><span>页面底色</span><input type="color" data-q="background" value="${toHex(edit ? edit.after?.background : bg.values?.background, "#ffffff")}" aria-label="页面底色"></label></div>`;
  }
  const caps = new Set(mark.caps || []), parts = [];
  if (caps.has("text")) { const size = markValue("fontSize"); parts.push(`<label class="g-field qt-field" title="字号（像素）"><span>字号</span><input type="number" min="1" max="2000" step="1" data-q="fontSize" value="${size == null ? "" : Math.round(Number(size) * 100) / 100}" aria-label="字号"></label>`); }
  if (caps.has("color")) parts.push(`<label class="g-field qt-field qt-color" title="文字颜色"><span>文字颜色</span><input type="color" data-q="color" value="${toHex(markValue("color"), "#000000")}" aria-label="文字颜色"></label>`);
  if (caps.has("background")) parts.push(`<label class="g-field qt-field qt-color" title="底色"><span>底色</span><input type="color" data-q="background" value="${toHex(markValue("background"), "#ffffff")}" aria-label="底色"></label>`);
  if (isUserImage(mark.id)) parts.push(`<button class="ed-tbtn qt-btn ed-tbtn--danger" data-action="delete-user-image" title="删除这张图">${icon("trash", 16)}<span>删除图片</span></button>`);
  return parts.length ? `<div class="qt-inner" data-mark="${esc(mark.id)}">${parts.join("")}</div>` : "";
}
function refreshQuickToolbar() {
  const bar = $(".ed-quickbar");
  if (!bar) return;
  const html = quickbarHTML(), key = JSON.stringify([S.mark?.id || pageBgMark()?.id, S.mark?.caps]);
  const hide = !html;
  if (bar.hidden !== hide) { bar.hidden = hide; queueMicrotask(() => syncGlass(app)); }
  if (hide) { bar.replaceChildren(); bar._key = null; return; }
  if (bar._key !== key) { bar.innerHTML = html; bar._key = key; return; }
  const box = document.createElement("div");
  box.innerHTML = html;
  for (const fresh of box.querySelectorAll("[data-q]")) {
    const live = bar.querySelector(`[data-q="${fresh.dataset.q}"]`);
    if (!live || live === document.activeElement) continue;
    if (live.value !== fresh.value) live.value = fresh.value;
    live.defaultValue = fresh.value;
  }
}
function quickChange(input) {
  const id = S.mark?.id || pageBgMark()?.id, kind = input.dataset.q;
  if (!id || !F?.frame) return;
  let after;
  if (kind === "fontSize") { const n = Number(input.value); if (!Number.isFinite(n) || n <= 0) return refreshQuickToolbar(); after = { fontSize: Math.min(2000, n) }; }
  else after = { [kind]: input.value.toLowerCase() };
  F.frame.set(id, kind, after); // 运行时叠上后回 edit，由 recordEdit 记进修改单
}

// ---------- 贴图：剪贴板 / 拖进来的图片存成素材，再放进页面可见区域中央 ----------
async function imagePayload(file) {
  if (file.type === "image/svg+xml") {
    const data = await new Promise((done, fail) => { const reader = new FileReader(); reader.onload = () => done(reader.result); reader.onerror = () => fail(reader.error || new Error("读不出这个文件")); reader.readAsDataURL(file); });
    return { name: file.name, data, mime: "image/svg+xml" };
  }
  const image = await createImageBitmap(file),
    factor = Math.min(1, 2400 / Math.max(image.width, image.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * factor);
  canvas.height = Math.round(image.height * factor);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/webp", 0.86));
  const data = await new Promise((done) => { const reader = new FileReader(); reader.onload = () => done(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
  image.close();
  return { name: (file.name || "paste.png").replace(/\.[^.]+$/, ".webp"), data, width: canvas.width, height: canvas.height, mime: "image/webp" };
}
async function addAsset(body) {
  await flush();
  const generation = S.dirty;
  S.assetPromise = api(`${path()}/assets`, "POST", { ...body, revision: S.revision });
  let result;
  try { result = await S.assetPromise; } finally { S.assetPromise = null; }
  ownRevision(result.revision);
  checkEcho();
  // 服务端可能顺手改了素材登记（例如标记），以它返回的项目为准合并素材表
  S.project.assets = result.project?.assets ? clone(result.project.assets) : [...S.project.assets, result.asset];
  S.project.updatedAt = result.project?.updatedAt || S.project.updatedAt;
  S.base = result.project ? clone(result.project) : S.base;
  if (S.dirty === generation) S.history.commit(S.project); else schedule();
  return result.asset;
}
async function pasteImage(file) {
  if (S.view !== "editor" || !S.project || !file?.type?.startsWith("image/")) return;
  const pageId = S.pageId;
  const body = await imagePayload(file);
  const asset = await addAsset(body);
  const p = S.project.pages.find((x) => x.id === pageId);
  if (!p) return;
  const view = viewOf(p);
  let w = asset.width || body.width || 400, h = asset.height || body.height || 300;
  const k = Math.min(1, (view.width * 0.6) / w, (view.height * 0.6) / h);
  w = Math.round(w * k); h = Math.round(h * k);
  const top = web() ? S.scrollTop : 0;
  const after = { asset: asset.id, x: Math.round((view.width - w) / 2), y: Math.round(top + (view.height - h) / 2), width: w, height: h };
  const id = newUserImageId();
  p.edits = upsertEdit(p.edits || [], { target: id, kind: "addImage", before: null, after });
  const entry = p.edits.find((e) => e.target === id && e.kind === "addImage");
  if (F && F.pageId === p.id) {
    F.sig = editsSig(p);
    const mod = await loadFrameModule();
    F.frame?.addImage(clone(entry), mod.assetUrlMap ? mod.assetUrlMap(S.project, p) : undefined);
  }
  commit();
  notice("图片已贴进页面");
}
function imageMenu({ id, x = 0, y = 0 }) {
  if (!isUserImage(id)) return;
  const box = $("#artboard")?.getBoundingClientRect() || { left: 0, top: 0 };
  const s = S.scale || 1;
  showContextMenu({ x: box.left + x * s, y: box.top + y * s, items: [{ action: "delete", label: "删除" }], onAction: () => deleteUserImage(id) });
}
async function deleteUserImage(id) {
  if (!isUserImage(id)) return;
  if (!(await confirmAction("删除这张图片？", "只删除你贴进来的这张图，可以撤销。"))) return;
  const p = page();
  p.edits = removeUserImage(p.edits || [], id);
  if (F) { F.sig = editsSig(p); F.frame?.removeImage(id); }
  if (S.mark?.id === id) S.mark = null;
  commit();
}

// ---------- 保存 ----------
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
function schedule() {
  clearTimeout(S.timer);
  saveStatus(SAVE_TEXT.busy);
  S.timer = setTimeout(() => flush().catch(() => {}), 600);
}
async function flush() {
  clearTimeout(S.timer);
  if (!S.project) return;
  if (S.assetPromise) await S.assetPromise.catch(() => {});
  if (S.saving) { await S.savePromise.catch(() => {}); if (S.saved < S.dirty) return flush(); return; }
  if (S.conflict) throw new Error("请先处理保存冲突");
  if (S.saved === S.dirty) return;
  S.saving = true;
  const generation = S.dirty, snapshot = clone(S.project), revision = S.revision;
  S.savePromise = (async () => {
    try {
      const result = await api(path(), "PUT", { project: snapshot, revision });
      ownRevision(result.revision);
      S.saved = generation;
      S.base = clone(result.project);
      if (S.saved < S.dirty) setText($("#save-status"), SAVE_TEXT.busy);
      else saveStatus(SAVE_TEXT.ok);
    } catch (e) {
      if (e.status === 409) {
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
function conflictDialog() {
  const labels = S.lastConflict?.labels || [];
  modal(`<h2>你和 agent 改了同一处</h2><p class="g-sheet__note">已保留你的修改。agent 的其他修改已经并进来了。</p><div class="g-sheet__list">${labels.map((label) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon("alert", 15)}</span><span class="g-row__text">${esc(label)}</span></div>`).join("")}</div><div class="g-sheet__actions">${gbtn("export-local", "下载我的副本")}${gbtn("conflict-agent", "这几处改用 agent 的")}${gbtn("close", "保留我的", { cls: "g-btn--prism" })}</div>`);
}
function undo() {
  if (!S.history?.canUndo || S.view !== "editor") return;
  S.project = S.history.undo();
  keepSelection();
  S.dirty++;
  schedule();
  updateEditor();
}
function redo() {
  if (!S.history?.canRedo || S.view !== "editor") return;
  S.project = S.history.redo();
  keepSelection();
  S.dirty++;
  schedule();
  updateEditor();
}

// ---------- 页面整理：增删、复制走服务端（页面文件一起处理），排序、改名走整份保存 ----------
async function pagesOp(op, body) {
  if (S.pagesBusy) return null;
  await flush();
  S.pagesBusy = true;
  const before = new Set(S.project.pages.map((p) => p.id));
  try {
    const result = await api(`${path()}/pages`, "POST", { revision: S.revision, op, ...body });
    ownRevision(result.revision);
    S.project = result.project;
    S.base = clone(result.project);
    if (op === "delete") S.history.drop(body.pageIds || []);
    S.history.commit(S.project);
    S.saved = S.dirty;
    saveStatus(SAVE_TEXT.ok);
    const added = Array.isArray(result.pageIds) && op !== "delete" ? result.pageIds.filter((id) => S.project.pages.some((p) => p.id === id)) : S.project.pages.filter((p) => !before.has(p.id)).map((p) => p.id);
    return { ...result, added };
  } catch (e) {
    if (e.status === 409) { S.sync?.notify(); throw new Error("agent 刚改过这个项目，已重新载入，请再试一次"); }
    throw e;
  } finally {
    S.pagesBusy = false;
    checkEcho();
  }
}
async function addPage({ after = S.pageId, device } = {}) {
  const out = await pagesOp("create", { after, ...(device ? { device } : {}) });
  if (!out) return;
  if (out.added[0]) S.pageId = out.added[0];
  S.checked.clear();
  updateEditor();
  return out;
}
async function pageAction(name, { ids = [...S.checked], targetId = S.pageId, position = "after" } = {}) {
  if (!ids.length) ids = [targetId];
  if (name === "select-pages") { S.checked = new Set(S.project.pages.map((p) => p.id)); refreshPageViews(); return; }
  if (name === "copy-pages") {
    S.pageClipboard = pageClipboard(S.project, ids);
    writePageClipboard(S.pageClipboard);
    refreshPageViews();
    notice(`已复制 ${ids.length} 页，可以粘贴到这个或别的项目`);
    return;
  }
  if (name === "move-pages") {
    const result = movePages(S.project, ids, targetId, position);
    S.project = result.project;
    S.checked = new Set(result.selectedPageIds);
    changed();
    return;
  }
  let out;
  if (name === "paste-pages") {
    const clip = S.pageClipboard;
    if (!clip?.pageIds?.length) return notice("还没有复制页面");
    out = clip.fromProject === S.project.id ? await pagesOp("duplicate", { pageIds: clip.pageIds, after: targetId }) : await pagesOp("copy-from", { fromProject: clip.fromProject, pageIds: clip.pageIds, after: targetId });
  } else if (name === "duplicate-pages") {
    const order = S.project.pages.map((p) => p.id).filter((id) => ids.includes(id));
    out = await pagesOp("duplicate", { pageIds: order, after: order.at(-1) });
  } else if (name === "delete-pages") {
    if (ids.length >= S.project.pages.length) return notice("请至少保留一页");
    const names = ids.map((id) => S.project.pages.find((p) => p.id === id)?.name).filter(Boolean);
    if (!(await confirmAction(`删除 ${ids.length} 页？`, `${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}的页面文件会一起删除。需要找回时可以在版本列表里退回。`))) return;
    const index = S.project.pages.findIndex((p) => p.id === S.pageId);
    out = await pagesOp("delete", { pageIds: ids });
    if (out && !S.project.pages.some((p) => p.id === S.pageId)) S.pageId = S.project.pages[Math.min(Math.max(index, 0), S.project.pages.length - 1)].id;
    S.checked.clear();
    updateEditor();
    if (out) notice("页面已删除；删除前已自动存版，需要时可在版本列表退回");
    return;
  } else if (name === "insert-page-before" || name === "insert-page-after") {
    const device = page()?.device;
    out = await addPage({ after: targetId, ...(web() ? { device: S.project.pages.find((p) => p.id === targetId)?.device || device } : {}) });
    if (out?.added[0] && name === "insert-page-before") { const r = movePages(S.project, out.added, targetId, "before"); S.project = r.project; changed(); }
    return;
  }
  if (!out) return;
  if (out.added.length) { S.checked = new Set(out.added); S.pageId = out.added[0]; }
  updateEditor();
}

// ---------- 素材库、版本、背景、复制、导出 ----------
async function library() {
  await flush();
  S.view = "library";
  S.project = null;
  S.focus = false;
  disconnectEvents();
  const assets = await api("/api/library");
  const card = (a) => `<div class="hm-card hm-card--asset"><div class="hm-card__thumb hm-card__thumb--asset"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></div><div class="hm-card__info"><strong>${esc(a.name)}</strong><small>${a.width} × ${a.height}</small></div></div>`;
  shell("library", `${head("公共素材库", `${assets.length} 个素材`, `<button class="ed-play" data-action="upload-library">${icon("upload", 15)}<span>上传素材</span></button>`)}<section class="hm-panel" ${glassAttr("library:panel")} data-glass-frost><div class="hm-scroll ed-scroll">${assets.length ? `<div class="hm-grid hm-grid--assets">${assets.map(card).join("")}</div>` : `<p class="hm-empty">还没有素材</p>`}</div></section>`);
  liven(app);
  syncGlass(app);
}
async function uploadLibrary(files) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try { await api("/api/library", "POST", await imagePayload(file)); } catch (e) { notice(e.message); }
  }
  await library();
}
async function versions() {
  await flush();
  const list = await api(`${path()}/versions`);
  modal(`<h2>版本列表</h2><div class="g-sheet__list">${list.length ? list.map((v) => `<div class="g-row g-row--tall g-row--static"><span class="g-row__icon">${icon("history", 15)}</span><span class="g-row__text"><strong>${esc(v.note || "未命名版本")}</strong><small>${esc(versionTime(v))} · ${{ user: "用户", system: "自动" }[v.by] || "agent"}</small></span>${tbtn("restore", "退回", "undo", "", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}${ibtn("version-delete", "trash", "删除这个版本", `data-id="${esc(v.id)}" data-note="${esc(v.note || "未命名版本")}"`)}</div>`).join("") : '<p class="g-sheet__empty">还没有手动保存的版本</p>'}</div><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("version", "存一版", { icon: "bookmark", cls: "g-btn--prism" })}</div>`);
}
function versionTime(v) {
  const t = new Date(v.savedAt || v.createdAt || v.timestamp || "");
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString("zh-CN", { hour12: false });
}
function restoreDialog(id, note) {
  modal(`<h2>退回到这个版本？</h2><p class="g-sheet__note">「${esc(note)}」· 当前内容会先自动存一版，随时可以再退回来</p><div class="g-sheet__actions">${gbtn("versions", "返回列表")}${gbtn("restore-confirm", "退回", { icon: "history", cls: "g-btn--prism", extra: `data-id="${esc(id)}"` })}</div>`);
}
function deleteVersionDialog(id, note) {
  modal(`<h2>删除这个版本？</h2><p class="g-sheet__note">「${esc(note)}」· 删除后不能恢复，其他版本和当前内容不受影响</p><div class="g-sheet__actions">${gbtn("versions", "返回列表")}${gbtn("version-delete-confirm", "删除", { icon: "trash", cls: "g-btn--prism", extra: `data-id="${esc(id)}"` })}</div>`);
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
  const stamp = Date.now();
  S.stale.clear();
  for (const p of S.project.pages) if (p.file) S.stale.set(p.file, stamp);
  for (const a of S.project.assets) S.stale.set(a.file, stamp);
  keepSelection();
  closeModal();
  updateEditor();
  notice("已退回；退回前的内容已自动存了一版");
}
function versionDialog() {
  modal(`<h2>存一版</h2><form id="version-form"><label class="g-field g-field--stack"><span>版本备注</span><input name="note" maxlength="200" required placeholder="例如：调整了封面文字" autofocus></label><div class="g-sheet__actions">${gbtn("versions", "版本列表", { icon: "history" })}${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("bookmark", 17)}保存版本</button></div></form>`);
  $("#version-form").onsubmit = async (e) => {
    e.preventDefault();
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
function backgroundDialog() {
  modal(`<h2>背景</h2><div class="g-sheet__actions g-sheet__actions--start">${gbtn("bg-pick", "选择图片", { icon: "imagePlus", cls: "g-btn--prism" })}${gbtn("bg-default", "恢复默认")}${gbtn("close", "关闭")}</div>`);
}
function pickBackground() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try { await setBackgroundFile(file); closeModal(); notice("背景已更换"); } catch (err) { notice("这张图片用不了：" + err.message); }
  };
  input.click();
}
function copyDialog() {
  const ids = [...S.checked];
  if (!ids.length) return notice("请先勾选要复制的页面");
  modal(`<h2>复制到新项目</h2><p class="g-sheet__note">已选 ${ids.length} 页 · 页面引用的素材和字体一起复制</p><form id="copy-form"><label class="g-field g-field--stack"><span>新项目名称</span><input name="name" required autofocus placeholder="例如：课程精选页"></label><label class="g-field g-field--stack"><span>项目编号</span><input name="id" pattern="[a-z0-9][a-z0-9-]{1,63}" required placeholder="例如：course-highlights"></label><div class="g-sheet__actions">${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("copyPlus", 17)}创建副本</button></div></form>`);
  $("#copy-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
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
const EXPORT_KINDS = [
  ["html", "放映版 HTML", "一个网页文件，双击就能在浏览器里放映（带动效）", "play"],
  ["images", "每页图片", "每一页存成一张 PNG 图片", "image"],
  ["pdf", "PDF", "所有页面合成一个 PDF 文件", "copy"],
  ["handoff", "交接包（改动清单 + 对比图）", "改前 = agent 写的样子，改后 = 加上你的修改；给写前端的 agent", "link"],
];
function formatBytes(n) {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
function exportDialog() {
  const kind = S.exportKind;
  modal(`<h2>导出</h2><p class="g-sheet__note">导出的文件放在数据目录的 exports 文件夹里，不会改动项目</p><div class="g-sheet__list" role="radiogroup" aria-label="导出类型" id="export-kinds">${EXPORT_KINDS.map(([k, label, desc, ic]) => `<button class="g-row g-row--tall ${k === kind ? "selected" : ""}" data-action="export-kind" data-kind="${k}" role="radio" aria-checked="${k === kind}"><span class="g-row__icon">${icon(ic, 15)}</span><span class="g-row__text"><strong>${label}</strong><small>${desc}</small></span></button>`).join("")}</div><div class="g-sheet__actions">${gbtn("close", "取消")}${gbtn("export-start", "开始导出", { icon: "upload", cls: "g-btn--prism" })}</div>`);
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
// 导出进度（docs/round12-contract.md 约定 2）：先连进度流，再发导出请求；弹窗里显示进度条和「取消」
const newProgressId = () => (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(12, "0");
function exportProgressHTML() {
  return `<div class="ex-progress" id="export-progress"><progress id="export-progress-bar" max="1" aria-label="导出进度"></progress><p class="g-sheet__note ex-progress__label" id="export-progress-label" role="status">正在准备导出…</p></div>`;
}
function showExportProgress(sheet, { current, total, label } = {}) {
  const bar = sheet.querySelector("#export-progress-bar"), text = sheet.querySelector("#export-progress-label");
  if (!bar || !text) return;
  const t = Math.max(0, Number(total) || 0), c = Math.min(t, Math.max(0, Number(current) || 0));
  if (t > 0) { bar.max = t; bar.value = c; }
  text.textContent = label || (t > 0 ? `正在导出第 ${c} / ${t} 页` : "正在导出…");
}
async function startExport(button) {
  if (S.exporting) return;
  const kind = S.exportKind, label = EXPORT_KINDS.find(([k]) => k === kind)?.[1] || kind, sheet = button.closest(".g-sheet");
  S.exporting = true;
  const controls = [...sheet.querySelectorAll("button")];
  controls.forEach((c) => (c.disabled = true));
  button.innerHTML = `${icon("loader", 17)}正在导出…`;
  sheet.setAttribute("aria-busy", "true");
  sheet.querySelector("#export-progress")?.remove();
  sheet.querySelector(".g-sheet__actions")?.insertAdjacentHTML("beforebegin", exportProgressHTML());
  // 交接包没有分页进度：进度条只转圈；放映版 / 图片 / PDF 带进度编号，可以看进度、可以取消
  const progressId = kind === "handoff" ? null : newProgressId();
  const base = `${path()}/export`;
  let stream = null;
  const cancelButton = sheet.querySelector('.g-sheet__actions [data-action="close"]');
  if (progressId && cancelButton) {
    cancelButton.dataset.action = "export-cancel";
    cancelButton.dataset.progressId = progressId;
    cancelButton.textContent = "取消导出";
    cancelButton.disabled = false;
  }
  const restore = () => {
    controls.forEach((c) => (c.disabled = false));
    button.innerHTML = `${icon("upload", 17)}开始导出`;
    sheet.removeAttribute("aria-busy");
    if (cancelButton) { cancelButton.dataset.action = "close"; delete cancelButton.dataset.progressId; cancelButton.textContent = "关闭"; }
  };
  try {
    await flush();
    if (progressId && typeof EventSource === "function") {
      stream = new EventSource(`${base}/progress/${progressId}`);
      stream.addEventListener("progress", (event) => { try { showExportProgress(sheet, JSON.parse(event.data)); } catch {} });
      stream.addEventListener("done", () => stream?.close());
      stream.onerror = () => {}; // 进度只是提示：连不上不影响导出本身
      // 等进度流连上（最多 1 秒）再发导出，开头几页的进度不会漏
      await new Promise((done) => { const t = setTimeout(done, 1000); stream.addEventListener("open", () => { clearTimeout(t); done(); }, { once: true }); stream.addEventListener("error", () => { clearTimeout(t); done(); }, { once: true }); });
    }
    const result = kind === "handoff" ? await api(`${path()}/handoff`, "POST", {}) : await api(base, "POST", progressId ? { kind, progressId } : { kind });
    if (!sheet.isConnected) notice(`${label}已导出到：${result.outDir}`);
    else if (kind === "handoff") handoffResult(result);
    else exportResult(result, label);
  } catch (err) {
    const cancelled = err.status === 409 && (err.data?.cancelled || /取消/.test(err.message));
    if (sheet.isConnected) {
      restore();
      const bar = sheet.querySelector("#export-progress-bar"), text = sheet.querySelector("#export-progress-label");
      if (cancelled) { bar?.remove(); if (text) text.textContent = "已取消"; }
      else sheet.querySelector("#export-progress")?.remove();
    }
    if (cancelled) { if (!sheet.isConnected) notice("已取消导出"); }
    else notice(err.message);
  } finally {
    stream?.close();
    S.exporting = false;
  }
}
async function cancelExport(button) {
  const id = button.dataset.progressId;
  if (!id) return closeModal();
  button.disabled = true;
  const text = button.closest(".g-sheet")?.querySelector("#export-progress-label");
  if (text) text.textContent = "正在取消…";
  try { await api(`${path()}/export/cancel/${id}`, "POST", {}); }
  catch (err) { button.disabled = false; notice(err.message); }
}
function exportResult({ outDir, files }, label) {
  const target = files.length === 1 ? files[0].path : outDir;
  const total = files.reduce((n, f) => n + (f.bytes || 0), 0);
  modal(`<h2>${esc(label)}已导出</h2><p class="g-sheet__note">保存在：<br><span id="export-path" style="overflow-wrap:anywhere;user-select:text">${esc(outDir)}</span></p><div class="g-sheet__list" id="export-files">${files.map((f) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : "copy", 15)}</span><span class="g-row__text">${esc(f.name)}</span><span class="g-row__meta">${formatBytes(f.bytes)}</span></div>`).join("") || '<p class="g-sheet__empty">没有生成文件</p>'}</div><p class="g-sheet__note" style="margin:10px 0 0">共 ${files.length} 个文件 · ${formatBytes(total)}</p><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("reveal", runtimeSettings.revealLabel, { icon: "library", cls: "g-btn--prism", extra: `data-path="${esc(target)}"` })}</div>`);
}
function handoffResult({ outDir, files = [], agentText = "" }) {
  S.handoffText = agentText;
  const names = files.map((f) => (typeof f === "string" ? f : f.name));
  modal(`<h2>交接包已生成</h2><p class="g-sheet__note">保存在：<br><span id="export-path" style="overflow-wrap:anywhere;user-select:text">${esc(outDir)}</span></p><div class="g-sheet__list" id="export-files">${names.map((name) => `<div class="g-row g-row--static"><span class="g-row__icon">${icon(/\.(png|jpe?g|webp)$/i.test(name) ? "image" : "copy", 15)}</span><span class="g-row__text">${esc(name)}</span></div>`).join("") || '<p class="g-sheet__empty">没有生成文件</p>'}</div><label class="g-area" style="margin-top:10px">复制给 agent<textarea id="handoff-text" rows="6" readonly>${esc(agentText)}</textarea></label><div class="g-sheet__actions">${gbtn("close", "关闭")}${gbtn("reveal", runtimeSettings.revealLabel, { icon: "library", extra: `data-path="${esc(outDir)}"` })}${gbtn("copy-handoff", "复制", { icon: "copy", cls: "g-btn--prism" })}</div>`);
}
// 放映：打开放映页（新标签），从当前页开始
function playURL() { return `/player.html?project=${encodeURIComponent(S.project.id)}&page=${encodeURIComponent(S.pageId)}`; }
async function play() {
  await flush();
  const win = window.open(playURL(), "_blank");
  if (!win) location.href = playURL();
}

// ---------- 右侧栏：页面名、备注、网页设备 / 高度、版本、复制给 agent ----------
function inspectorHTML() {
  const p = page();
  const count = (p.edits || []).length;
  const webFields = web() ? (() => {
    const view = pageViewport(S.project, p), size = pageSize(S.project, p);
    return `<div class="ed-pair" data-web-page><label class="g-field"><span>设备</span><input type="text" value="${esc(WEB_DEVICES[p.device]?.label || "电脑端")}" readonly aria-label="设备" data-page-device></label><label class="g-field" title="整页内容长度，不小于窗口高 ${view.height}"><span>整页高度</span><input data-page-height type="number" min="${view.height}" step="10" value="${size.height}" aria-label="整页高度"></label></div><p class="g-sheet__note" data-web-note>窗口 ${view.width}×${view.height}，在画布上用鼠标滚轮上下浏览</p>`;
  })() : "";
  return `<section class="ed-section" data-page-section><h3 class="ed-heading ed-heading--main">页面</h3><label class="g-field g-field--stack"><span>页面名</span><input data-page-name type="text" maxlength="200" value="${esc(p.name)}" aria-label="页面名"></label>${webFields}<p class="ed-note" data-edit-count>${count ? `你在这一页改了 ${count} 处` : "这一页还没有修改"}</p></section><section class="ed-section"><h3 class="ed-heading">备注</h3><p class="ed-note ed-notes" data-page-notes>${p.notes ? esc(p.notes) : "没有备注"}</p></section><section class="ed-section"><h3 class="ed-heading">版本</h3><div class="ed-actions">${tbtn("version", "存一版", "bookmark")}${tbtn("versions", "版本列表", "history")}</div></section><section class="ed-section"><h3 class="ed-heading">交给 agent</h3><div class="ed-actions">${tbtn("brief", "复制给 agent", "copy")}</div></section>`;
}
function refreshInspector() {
  const body = $(".ed-inspector__body");
  if (!body || !S.project) return;
  const p = page(), key = JSON.stringify([p.id, web(), p.device]);
  if (body._key !== key) { body.innerHTML = inspectorHTML(); body._key = key; syncGlass(app); return; }
  const name = body.querySelector("[data-page-name]");
  if (name && name !== document.activeElement && name.value !== p.name) { name.value = p.name; name.defaultValue = p.name; }
  const height = body.querySelector("[data-page-height]");
  if (height && height !== document.activeElement) { const v = String(pageSize(S.project, p).height); if (height.value !== v) { height.value = v; height.defaultValue = v; } }
  const count = (p.edits || []).length;
  setText(body.querySelector("[data-edit-count]"), count ? `你在这一页改了 ${count} 处` : "这一页还没有修改");
  setText(body.querySelector("[data-page-notes]"), p.notes || "没有备注");
}
function renamePage(value) {
  const p = page(), name = String(value || "").trim();
  if (!name) { refreshInspector(); return; }
  if (name === p.name) return;
  p.name = name.slice(0, 200);
  changed();
}
function setPageHeight(value) {
  const p = page(), view = pageViewport(S.project, p), height = Math.round(Number(value));
  if (!web() || !Number.isFinite(height)) return refreshInspector();
  const next = Math.max(view.height, height);
  if (p.size?.height === next) { refreshInspector(); return; }
  p.size = { width: p.size?.width || view.width, height: next };
  changed();
}

// ---------- 页面栏：三种视图共用同一份选择 ----------
function switchPage(id, { clearChecked = false } = {}) {
  if (!S.project.pages.some((p) => p.id === id)) return;
  if (S.pageId !== id) S.screen = 1;
  S.pageId = id;
  S.scrollTop = 0;
  if (clearChecked) S.checked.clear();
  updateEditor();
}
function clearCheckedPages() { S.checked.clear(); S.pageAnchor = null; refreshPageViews(); }
function pageViewContext(mode = S.pageViewMode) {
  return { project: S.project, currentPageId: S.pageId, selectedPageIds: [...S.checked], anchorId: S.pageAnchor, mode, returnMode: readPageViewPreference(), canPaste: !!S.pageClipboard?.pageIds?.length };
}
function setPageView(mode) { S.pageViewMode = mode; writePageViewPreference(mode); refreshLayout(); }
function mountEditorPageViews() {
  for (const root of app.querySelectorAll("[data-page-view]")) {
    if (root._vwDispose) continue;
    root._vwDispose = mountPageViews(root, {
      getContext: () => pageViewContext(root.dataset.pageView),
      callbacks: {
        selection(ids, anchor) { S.checked = new Set(ids); S.pageAnchor = anchor; refreshPageViews(); },
        openPage(id) { if (S.pageId !== id) switchPage(id); },
        view: setPageView,
        action: (name, payload) => pageAction(name, payload).catch((e) => notice(e.message)),
      },
    });
    S.pageViewRoots.add(root);
  }
  S.pageViewsDispose = () => { for (const root of S.pageViewRoots) unmountPageView(root); };
}
function unmountPageView(root) { root._vwDispose?.(); root._vwDispose = null; S.pageViewRoots.delete(root); }
function refreshPageViews() {
  for (const root of app.querySelectorAll("[data-page-view]")) patchPageItems(root, pageViewContext(root.dataset.pageView));
  mountEditorPageViews();
  setText($(".ed-col-head .ed-count"), String(S.project.pages.length));
  refreshThumbnails();
}

// ---------- 点击 ----------
app.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action, id = b.dataset.id;
  try {
    if (await homeUI.action(a, b)) return; // 总览相关（新建、导入、项目菜单、母版）在 web/home.js
    switch (a) {
      case "screen": goScreen(Number(b.dataset.screen)); break;
      case "page-grid": setPageView(S.pageViewMode === "grid" ? readPageViewPreference() : "grid"); break;
      case "page-timeline":
        if (S.pageViewMode === "timeline") { S.pagesCollapsed = false; localStorage.setItem("vw-pages-collapsed", "false"); }
        setPageView(S.pageViewMode === "timeline" ? "list" : "timeline");
        break;
      case "close-workbench": await workbenchClose.close(); break;
      case "home": await home(); break;
      case "library": await library(); break;
      case "open": await open(id); break;
      case "close": closeModal(); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "add-page":
        if (web()) {
          const box = b.getBoundingClientRect();
          showContextMenu({ x: box.left, y: box.bottom + 6, items: [{ action: "desktop", label: "电脑端页面" }, { action: "mobile", label: "手机端页面" }], onAction: (device) => addPage({ device }).catch((error) => notice(error.message)) });
          break;
        }
        await addPage();
        break;
      case "delete-user-image": if (S.mark) await deleteUserImage(S.mark.id); break;
      case "upload-library": $("#file-picker").click(); break;
      case "version": versionDialog(); break;
      case "versions": await versions(); break;
      case "copy": copyDialog(); break;
      case "background": backgroundDialog(); break;
      case "bg-pick": pickBackground(); break;
      case "bg-default": await resetBackground(); closeModal(); notice("已换回默认背景"); break;
      case "reference":
        await navigator.clipboard.writeText(referenceText(S.project, { checkedPageIds: [...S.checked], currentPageId: S.pageId, markId: S.mark?.id }));
        notice("引用已复制");
        break;
      case "brief": {
        await flush();
        const { text } = await api(`${path()}/brief`);
        await navigator.clipboard.writeText(text);
        notice("已复制，开新的 agent 对话时直接粘贴");
        break;
      }
      case "restore": restoreDialog(id, b.dataset.note || ""); break;
      case "restore-confirm": await restore(id); break;
      case "version-delete": deleteVersionDialog(id, b.dataset.note || ""); break;
      case "version-delete-confirm": await deleteVersion(id); break;
      case "toggle-pages":
        if (S.pageViewMode === "timeline") { S.pagesCollapsed = false; localStorage.setItem("vw-pages-collapsed", "false"); setPageView("list"); break; }
        S.pagesCollapsed = !S.pagesCollapsed;
        localStorage.setItem("vw-pages-collapsed", String(S.pagesCollapsed));
        refreshLayout();
        break;
      case "toggle-inspector":
        S.inspectorCollapsed = !S.inspectorCollapsed;
        localStorage.setItem("vw-inspector-collapsed", String(S.inspectorCollapsed));
        refreshLayout();
        break;
      case "focus": setFocus(!S.focus); break;
      case "export": exportDialog(); break;
      case "export-kind": chooseExportKind(b.dataset.kind); break;
      case "copy-handoff": await navigator.clipboard.writeText(S.handoffText || ""); notice("已复制，开新的 agent 对话时直接粘贴"); break;
      case "export-start": await startExport(b); break;
      case "export-cancel": await cancelExport(b); break;
      case "data-settings": await runtimeSettings.showSettings(); break;
      case "reveal": await api("/api/reveal", "POST", { path: b.dataset.path }); break;
      case "play": await play(); break;
      case "export-local": {
        const url = URL.createObjectURL(new Blob([JSON.stringify(S.project, null, 2)], { type: "application/json" })), link = document.createElement("a");
        link.href = url;
        link.download = `${S.project.id}-local.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "conflict-agent": {
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
app.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("input[data-q]")) return quickChange(t);
  if (t.matches("input[data-page-name]")) return renamePage(t.value);
  if (t.matches("input[data-page-height]")) return setPageHeight(t.value);
});
app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("input[data-page-name],input[data-page-height],input[data-q]")) { e.preventDefault(); e.target.blur(); }
});
$("#file-picker").onchange = (e) => {
  uploadLibrary([...e.target.files]).catch((err) => notice(err.message));
  e.target.value = "";
};
const isTyping = (el) => !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset)$/i.test(el.type)));
// 点到 iframe 外面（iframe 自己看不到这次点击）：取消画布里的选中、结束改字。工具条、弹窗、右键菜单里的点击不算
document.addEventListener("pointerdown", (e) => {
  if (S.view !== "editor" || !S.mark) return;
  if (e.target.closest?.("#artboard, .ed-quickbar, #modal-root, .g-context-menu")) return;
  clearMark();
}, true);
// 父页面里的粘贴（焦点不在 iframe 里时）：剪贴板里有图片就贴进当前页
document.addEventListener("paste", (e) => {
  if (S.view !== "editor" || !S.project || isTyping(e.target)) return;
  const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (!file) return;
  e.preventDefault();
  pasteImage(file).catch((err) => notice(err.message));
});
window.addEventListener("keydown", (e) => {
  const typing = isTyping(e.target);
  if (e.key === "Escape") {
    if (document.querySelector(".g-context-menu")) { closeContextMenu(); return; }
    if ($("#modal-root")?.childElementCount) { e.preventDefault(); closeModal(); return; }
    if (S.view !== "editor") return;
    if (typing) { e.target.blur(); return; }
    e.preventDefault();
    if (clearMark()) return;
    if (S.pageViewMode === "grid") { if (S.checked.size) { clearCheckedPages(); return; } setPageView(readPageViewPreference()); return; }
    if (S.focus) { setFocus(false); return; }
    if (S.checked.size) clearCheckedPages();
    return;
  }
  if (typing || S.view !== "editor" || $("#modal-root")?.childElementCount || $(".g-context-menu")) return;
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  try {
    if (mod && key === "z") { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
    if (mod && key === "y") { e.preventDefault(); redo(); return; }
    // 页面的全选 / 复制 / 粘贴 / 创建副本：选了页面或在网格里时才接管（否则 Cmd+V 交给 paste 事件贴图）
    if (mod && ["a", "c", "v", "d"].includes(key) && (S.checked.size || S.pageViewMode === "grid")) {
      if (key === "v" && !S.pageClipboard?.pageIds?.length) return;
      e.preventDefault();
      pageAction({ a: "select-pages", c: "copy-pages", v: "paste-pages", d: "duplicate-pages" }[key]).catch((err) => notice(err.message));
      return;
    }
    if (["Backspace", "Delete"].includes(e.key)) {
      if (S.mark && isUserImage(S.mark.id)) { e.preventDefault(); deleteUserImage(S.mark.id); return; }
      if (S.checked.size) { e.preventDefault(); pageAction("delete-pages").catch((err) => notice(err.message)); }
      return;
    }
    const direction = ["PageUp", "ArrowUp"].includes(e.key) ? -1 : ["PageDown", "ArrowDown"].includes(e.key) ? 1 : 0;
    if (direction && !mod) {
      e.preventDefault();
      const i = S.project.pages.findIndex((p) => p.id === S.pageId), p = S.project.pages[i + direction];
      if (p) switchPage(p.id, { clearChecked: true });
    }
  } catch (error) {
    notice(error.message);
  }
});
window.addEventListener("resize", () => { if (S.view === "editor") fitBoard(); });

const projectManagement = createProjectManagement({ api, confirm: confirmAction, modal, closeModal, notice, refresh: home, onOpen: open, onDeleted: async () => {} });
const homeUI = createHome({ api, S, app, $, esc, shell, head, modal, closeModal, notice, open, home, glassAttr, homeThumbs, liven, syncGlass, projectManagement: () => projectManagement });
const workbenchClose = createWorkbenchClose({
  api, flush, confirm: confirmAction, notice,
  renderClosed() { S.pageViewsDispose?.(); disconnectEvents(); S.project = null; S.view = "closed"; shell("home", '<section class="hm-panel"><h1>工作台已关闭，可以关掉这个窗口了</h1></section>'); },
});
// 桌面应用关窗前调用：等自动保存写完
window.vwFlushBeforeClose = async () => { await flush(); };
const runtimeSettings = mountRuntimeSettings({ api, app, modal, closeModal, notice, glass: openModalGlass, closeGlass: closeModalGlass });
runtimeSettings.ready().then(home).catch((e) => {
  app.innerHTML = '<div class="startup-error">无法打开工作台，请检查本地服务。</div>';
  notice(e.message);
});
