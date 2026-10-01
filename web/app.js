import { renderPage } from "./render.js";
import { createPlayback } from "./playback.js";
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
} from "./editor.js";
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
function btn(a, t, c = "", extra = "") {
  return `<button class="btn ${c}" data-action="${a}" ${extra}>${t}</button>`;
}
function shell(active, body) {
  app.innerHTML = `<div class="shell"><aside class="rail"><div class="brand-mark">✦</div><button class="rail-btn ${active === "home" ? "active" : ""}" data-action="home" title="项目总览">▦</button><button class="rail-btn ${active === "library" ? "active" : ""}" data-action="library" title="公共素材库">◇</button><div class="rail-spacer"></div><div class="rail-dot">E</div></aside><main class="main">${body}</main></div><div id="modal-root"></div>`;
}
function head(name, section, actions = "") {
  return `<header class="top"><div><p class="eyebrow">VISUAL WORKBENCH <span>/ ${section}</span></p><h1>${esc(name)}</h1></div><div class="top-actions">${actions}</div></header>`;
}
function modal(html) {
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $(".modal-backdrop").onpointerdown = (e) => {
    if (e.target === e.currentTarget) closeModal();
  };
}
function closeModal() {
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
  const list = await api("/api/projects");
  shell(
    "home",
    `${head("项目总览页", "PROJECTS", btn("new", "＋ 新建项目", "primary"))}<div class="overview-head"><div><h2>最近的项目</h2><p>继续你的创作，所有修改会自动保存在本机。</p></div><span class="count">${list.length} 个项目</span></div><div class="projects-grid">${list.map((item, i) => `<button class="project-card" data-action="open" data-id="${esc(item.id)}"><div class="project-thumb" data-thumb="${i}"></div><div class="project-info"><span class="project-type">${esc(item.project.artboard.preset)}</span><h3>${esc(item.name)}</h3><p>${item.project.pages.length} 页 · ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</p></div><span class="card-arrow">↗</span></button>`).join("")}<button class="project-card add-card" data-action="new"><span class="add-orb">＋</span><strong>开启新项目</strong><small>为想法留出空间</small></button></div>`,
  );
  list.forEach((x, i) => $(`[data-thumb="${i}"]`).append(thumb(x.project, x.project.pages[0])));
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
    `<p class="eyebrow">NEW PROJECT</p><h2>新建项目</h2><p class="muted">选择画板尺寸，开始一份新的设计。</p><form id="new-form"><label>项目名称<input name="name" required maxlength="200" placeholder="例如：秋季课程提案" autofocus></label><label>画板类型<select name="preset">${presets.map((p) => `<option value="${p[0]}">${p[1]} · ${p[2]} × ${p[3]}</option>`).join("")}</select></label><div class="field-row"><label>宽度<input name="width" type="number" min="1" value="1920" required></label><label>高度<input name="height" type="number" min="1" value="1080" required></label></div><div class="modal-actions">${btn("close", "取消")}<button class="btn primary" type="submit">创建项目</button></div></form>`,
  );
  const f = $("#new-form");
  f.preset.onchange = () => {
    const p = presets.find((p) => p[0] === f.preset.value);
    f.width.value = p[2];
    f.height.value = p[3];
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const result = await api("/api/projects", "POST", {
        name: f.name.value.trim(),
        preset: f.preset.value,
        width: +f.width.value,
        height: +f.height.value,
      });
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
  S.view = "editor";
  renderEditor();
}
function pageItem(p, i) {
  return `<div class="page-item ${p.id === S.pageId ? "active" : ""}" data-page-index="${i}" draggable="true"><input class="page-check" type="checkbox" data-check="${p.id}" ${S.checked.has(p.id) ? "checked" : ""} aria-label="选择第 ${i + 1} 页"><button class="page-open" data-action="switch" data-id="${p.id}"><span class="page-preview" data-preview="${p.id}"></span><span class="page-label"><b>${String(i + 1).padStart(2, "0")}</b> ${esc(p.name)}</span></button></div>`;
}
function layers(items, depth = 0) {
  return [...items]
    .sort((a, b) => b.zIndex - a.zIndex)
    .map(
      (e) =>
        `<button class="layer ${S.selected.includes(e.id) ? "selected" : ""}" data-action="select" data-id="${e.id}" style="padding-left:${14 + depth * 16}px"><span class="layer-glyph">${{ text: "T", image: "▧", shape: "◯", group: "▣" }[e.type]}</span><span>${esc(e.name || e.text || e.type)}</span>${e.locked ? "<small>锁定</small>" : ""}</button>${e.children ? layers(e.children, depth + 1) : ""}`,
    )
    .join("");
}
function property() {
  if (!S.selected.length)
    return `<div class="empty-properties"><span>✦</span><h3>选择一个元素</h3><p>在画布或图层中点选，即可调整位置、大小和样式。</p></div>`;
  const e = findElement(page(), S.selected[0])?.element;
  if (!e) return "";
  const field = (k, label, v = e[k], type = "number") =>
    `<label class="property-field">${label}<input data-prop="${k}" type="${type}" value="${esc(v ?? "")}"></label>`;
  return `<div class="panel-section"><div class="selection-heading"><span class="selection-icon">${{ text: "T", image: "▧", shape: "◯", group: "▣" }[e.type]}</span><div><strong>${S.selected.length > 1 ? `${S.selected.length} 个元素` : esc(e.name || e.type)}</strong><small>${esc(e.type)} · ${esc(e.id)}</small></div></div><div class="property-grid">${field("x", "X")}${field("y", "Y")}${field("width", "宽度")}${field("height", "高度")}${field("rotation", "旋转")}</div></div>${e.type === "text" ? `<div class="panel-section"><h3>文字</h3><label class="property-field full">内容<textarea data-prop="text" rows="4">${esc(e.text)}</textarea></label><div class="property-grid">${field("fontSize", "字号")}${field("fontWeight", "字重")}${field("color", "颜色", e.color, "color")}<label class="property-field">字体<select data-prop="font"><option value="">系统默认</option>${S.project.fonts.map((f) => `<option value="${f.id}" ${e.font === f.id ? "selected" : ""}>${esc(f.family)}</option>`).join("")}</select></label></div></div>` : ""}${e.type === "shape" ? `<div class="panel-section"><h3>形状</h3><div class="property-grid">${field("fill", "填充", typeof e.fill === "string" ? e.fill : "#d9d3ef", "color")}</div></div>` : ""}<div class="panel-section"><h3>排列</h3><div class="property-grid">${field("zIndex", "层级")}</div><div class="inline-actions">${btn("duplicate", "复制")}${btn("delete", "删除")}</div></div>`;
}
function renderEditor() {
  if (!S.project) return;
  const p = page();
  shell(
    "editor",
    `${head(S.project.name, "EDITOR", `${btn("undo", "↶", "icon-btn", S.history.canUndo ? 'aria-label="撤销" title="撤销"' : 'disabled aria-label="撤销" title="撤销"')}${btn("redo", "↷", "icon-btn", S.history.canRedo ? 'aria-label="重做" title="重做"' : 'disabled aria-label="重做" title="重做"')}<span id="save-status" class="save-status">${S.conflict ? "保存冲突" : "已保存"}</span>${btn("version", "◈ 存一版")}${btn("versions", "版本列表")}${btn("play", "▶ 放映", "primary")}`)}<div class="editor-layout"><aside class="pages-panel panel"><div class="panel-title"><span>页面栏 <em>${S.project.pages.length}</em></span>${btn("add-page", "＋", "round-btn", 'title="添加页面"')}</div><div class="page-list">${S.project.pages.map(pageItem).join("")}</div><div class="page-panel-footer">${btn("copy", "▣ 复制到新项目", "wide subtle")}${btn("reference", "⧉ 选中复制引用", "wide subtle")}</div></aside><section class="workspace"><div class="workspace-toolbar"><span class="crumb">${esc(p.name)}</span><div class="toolbar-actions">${btn("add-text", "T 文字", "subtle")}${btn("add-shape", "◯ 形状", "subtle")}${btn("import", "⇧ 素材导入", "subtle")}<span class="zoom-label" id="zoom-label"></span></div></div><div class="canvas-well" id="canvas-well"><div id="artboard-holder"></div></div><div class="workspace-foot">${S.project.artboard.width} × ${S.project.artboard.height} px <span>·</span> ${esc(S.project.artboard.preset)}<span class="foot-right">拖拽移动 · Shift 多选 · 右下角缩放</span></div></section><aside class="inspector panel"><div class="inspector-tabs"><button data-action="tab-layers" class="tab ${S.tab === "layers" ? "active" : ""}">图层</button><button data-action="tab-assets" class="tab ${S.tab === "assets" ? "active" : ""}">素材</button><button data-action="versions" class="tab">版本</button></div>${S.tab === "library" ? `<div class="asset-list"><p class="muted">拖到画布，或点击放入当前页面。</p>${(S.libraryChoices || []).map((a, i) => `<button class="asset-row" data-action="library-copy" data-index="${i}" draggable="true" data-library-file="${esc(a.file)}"><img src="${esc(a.url)}" alt=""><span>${esc(a.name)}</span></button>`).join("")}</div>` : S.tab === "assets" ? `<div class="asset-list">${btn("browse-library", "◇ 公共素材库", "wide subtle")}${S.project.assets.map((a) => `<button class="asset-row" data-action="place" data-id="${a.id}" draggable="true" data-asset="${a.id}"><img src="${base()}/${a.file}" alt=""><span>${esc(a.name || a.file)}${a.pendingLayout ? "<small>待排版</small>" : ""}</span></button>`).join("")}</div>` : `<div class="layer-list">${layers(p.elements)}</div><div class="properties"><h3 class="basic-heading">基础编辑</h3>${property()}</div>`}</aside></div>`,
  );
  renderBoard();
  S.project.pages.forEach((p) => $(`[data-preview="${p.id}"]`)?.append(thumb(S.project, p)));
  bindDrag();
}
function renderBoard() {
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
  board.onpointerdown = (e) => {
    if (e.target === board) {
      S.selected = [];
      renderEditor();
    }
  };
  board.querySelectorAll("[data-element-id]").forEach((n) => {
    if (S.selected.includes(n.dataset.elementId)) {
      const h = document.createElement("span");
      h.className = "resize-handle";
      h.dataset.resize = n.dataset.elementId;
      n.append(h);
    }
  });
}
function selectCanvas(id, event) {
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
  const resizing = !!event.target.closest("[data-resize]");
  const start = {
    x: event.clientX,
    y: event.clientY,
    values: ids.map((id) => ({ id, element: clone(findElement(page(), id).element) })),
  };
  event.preventDefault();
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
    }
    renderBoard();
  };
  const up = (e) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 2) changed();
    else renderEditor();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  renderBoard();
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
      if ($("#save-status"))
        $("#save-status").textContent = S.saved < S.dirty ? "正在保存…" : "已保存";
    } catch (e) {
      if (e.status === 409) {
        S.conflict = true;
        conflictDialog();
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

function conflictDialog() {
  modal(
    `<p class="eyebrow">SAVE CONFLICT</p><h2>项目已在别处更新</h2><p class="muted">本地修改与磁盘版本不同。请选择要保留的内容。</p><div class="modal-actions">${btn("export-local", "下载本地副本")}${btn("reload", "载入磁盘版本")}${btn("keep", "保留本地修改", "primary")}</div>`,
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
  const assets = await api("/api/library");
  shell(
    "library",
    `${head("公共素材库", "ASSET LIBRARY", btn("upload-library", "⇧ 上传素材", "primary"))}<div class="overview-head"><div><h2>随时取用的灵感</h2><p>公共素材会在使用时复制到项目中。</p></div><span class="count">${assets.length} 个素材</span></div><div class="library-grid">${assets.map((a) => `<div class="library-card"><img src="${esc(a.url)}" alt="${esc(a.name)}"><div><strong>${esc(a.name)}</strong><small>${a.width} × ${a.height}</small></div></div>`).join("")}</div>`,
  );
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
    `<p class="eyebrow">SAVED VERSIONS</p><h2>版本列表</h2><p class="muted">手动保存的项目快照。</p><div class="version-list">${list.length ? list.map((v) => `<div class="version-row"><span class="version-dot">◈</span><div><strong>${esc(v.note || "未命名版本")}</strong><small>${esc(v.savedAt || v.createdAt || v.timestamp || "")}</small></div></div>`).join("") : '<p class="muted">还没有手动保存的版本。</p>'}</div><div class="modal-actions">${btn("close", "关闭")}${btn("version", "＋ 存一版", "primary")}</div>`,
  );
}
function versionDialog() {
  modal(
    `<p class="eyebrow">SAVE A VERSION</p><h2>存一版</h2><p class="muted">给这一刻的设计留一份完整快照。</p><form id="version-form"><label>版本备注<input name="note" maxlength="200" required placeholder="例如：调整了封面布局" autofocus></label><div class="modal-actions">${btn("versions", "版本列表")}${btn("close", "取消")}<button class="btn primary" type="submit">保存版本</button></div></form>`,
  );
  $("#version-form").onsubmit = async (e) => {
    e.preventDefault();
    await flush();
    try {
      await api(`${path()}/versions`, "POST", { note: e.currentTarget.note.value.trim() });
      closeModal();
      notice("版本已保存");
    } catch (err) {
      notice(err.message);
    }
  };
}
function copyDialog() {
  const ids = [...S.checked];
  if (!ids.length) {
    notice("请先勾选要复制的页面");
    return;
  }
  modal(
    `<p class="eyebrow">COPY PAGES</p><h2>复制到新项目</h2><p class="muted">已选 ${ids.length} 页，相关素材和字体会一起复制。</p><form id="copy-form"><label>新项目名称<input name="name" required autofocus placeholder="例如：课程精选页"></label><label>项目编号<input name="id" pattern="[a-z0-9][a-z0-9-]{1,63}" required placeholder="例如：course-highlights"></label><div class="modal-actions">${btn("close", "取消")}<button class="btn primary" type="submit">创建副本</button></div></form>`,
  );
  $("#copy-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await flush();
      const f = e.currentTarget,
        pages = S.project.pages.map((p, i) => (ids.includes(p.id) ? i + 1 : null)).filter(Boolean),
        data = await api(`${path()}/copy`, "POST", { pages, id: f.id.value, name: f.name.value });
      closeModal();
      await open(data.project?.id || f.id.value, data.project ? data : undefined);
    } catch (err) {
      notice(err.message);
    }
  };
}
function play() {
  S.view = "play";
  app.innerHTML = `<div class="player"><div id="player-stage"></div><div class="player-controls"><button data-action="stop">← 返回编辑</button><span>${esc(S.project.name)} · <b id="player-page"></b></span><button data-action="prev">上一页</button><button data-action="next">下一页 →</button></div></div>`;
  showPage(S.pageId);
}
function showPage(id) {
  S.playback?.destroy();
  S.pageId = id;
  const p = page(),
    stage = $("#player-stage");
  stage.replaceChildren();
  const board = renderPage(S.project, p, { assetBase: base() });
  stage.append(board);
  const scale = Math.min(
    innerWidth / S.project.artboard.width,
    (innerHeight - 90) / S.project.artboard.height,
  );
  board.style.transform = `scale(${scale})`;
  board.style.transformOrigin = "top left";
  stage.style.width = `${S.project.artboard.width * scale}px`;
  stage.style.height = `${S.project.artboard.height * scale}px`;
  $("#player-page").textContent = `${S.project.pages.indexOf(p) + 1} / ${S.project.pages.length}`;
  S.playback = createPlayback(S.project, p, { root: board });
  S.playback.start();
  stage.onclick = () => {
    if (S.playback.isPlaying()) return;
    advancePlay();
  };
}
function advancePlay() {
  if (S.playback?.isPlaying()) return;
  if (S.playback?.getState().nextStep < page().steps.length) S.playback.next();
  else nextPage();
}
function nextPage(delta = 1) {
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
          steps: [],
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
      case "reference": {
        const refs = [...S.checked].map((id) => {
          const i = S.project.pages.findIndex((p) => p.id === id);
          return `${i + 1}页:${id}`;
        });
        if (!refs.length)
          refs.push(`${S.project.pages.findIndex((p) => p.id === S.pageId) + 1}页:${S.pageId}`);
        if (S.selected.length) refs.push(...S.selected);
        await navigator.clipboard.writeText(refs.join(" · "));
        notice("引用已复制");
        break;
      }
      case "play":
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
      case "reload": {
        const d = await api(path());
        S.project = d.project;
        S.revision = d.revision;
        S.history.replace(d.project);
        S.conflict = false;
        S.dirty = S.saved = 0;
        closeModal();
        renderEditor();
        break;
      }
      case "keep": {
        const d = await api(path());
        S.revision = d.revision;
        S.conflict = false;
        S.dirty++;
        closeModal();
        schedule();
        break;
      }
    }
  } catch (err) {
    notice(err.message);
  }
});
function updateProp(input) {
  const key = input.dataset.prop;
  if (!S.selected.length) return;
  let value = input.value;
  if (input.type === "number") {
    value = Number(value);
    if (!Number.isFinite(value)) return;
    if (["width", "height"].includes(key)) value = Math.max(0, value);
    if (key === "fontSize") value = Math.max(1, value);
    if (key === "fontWeight") value = Math.round(Math.min(900, Math.max(100, value)) / 100) * 100;
    if (key === "zIndex") value = Math.round(value);
    if (key === "rotation") value = Math.min(360, Math.max(-360, value));
  }
  if (key === "font") value = value || null;
  let different = false;
  mutateElements(page(), rootSelection(page(), S.selected), (e) => {
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
  if (e.target.matches("[data-check]")) {
    const id = e.target.dataset.check;
    e.target.checked ? S.checked.add(id) : S.checked.delete(id);
  }
  if (e.target.matches("select[data-prop],input[data-prop],textarea[data-prop]"))
    updateProp(e.target);
});
app.addEventListener("focusout", (e) => {
  if (e.target.matches("textarea[data-prop],input[data-prop]")) updateProp(e.target);
});
$("#file-picker").onchange = (e) => {
  upload(e.target.files, e.target.dataset.target === "library");
  e.target.value = "";
};
window.addEventListener("keydown", (e) => {
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
  if (S.view !== "editor" || e.target.matches("input,textarea,select")) return;
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
setInterval(async () => {
  if (S.view !== "editor" || S.dirty !== S.saved || S.saving || S.conflict) return;
  try {
    const d = await api(path());
    if (d.revision !== S.revision) {
      S.project = d.project;
      S.revision = d.revision;
      S.history.replace(d.project);
      S.selected = [];
      renderEditor();
      notice("已载入 agent 的最新修改");
    }
  } catch {}
}, 5000);
home().catch((e) => {
  app.innerHTML = '<div class="startup-error">无法打开工作台，请检查本地服务。</div>';
  notice(e.message);
});
