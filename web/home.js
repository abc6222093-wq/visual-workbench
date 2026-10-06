// 总览页（第 13 轮抽出）：项目卡片、文件夹、新建项目（含「从文案开始」）、拖进来导入、项目右键 / 多选动作。编辑器主体在 app.js。
// 依赖由 app.js 注入（createHome(deps)），这里不直接碰 app.js 的状态以外的东西。
import { pageViewport } from "./project-kinds.js";
import { mountHomeSelection } from "./home-selection.js";
import * as importHtml from "./import-html.js";
import { icon } from "./ui/icons.js";
import { openModalGlass } from "./ui/glass.js";
import { showContextMenu } from "./context-menu.js";
import { breadcrumbHtml, createFolderActions, folderCardHtml, folderIcon, folderView, formatBackupTime, mountFolderDrops, moveMenuItems } from "./folders.js";
import { openDesignCard, renderDesignCardIcon } from "./design-card.js";

export const PRESETS = [
  ["slide-16x9", "演示文稿", 1920, 1080],
  ["poster-a4", "A4 海报", 2480, 3508],
  ["poster-a3", "A3 海报", 3508, 4961],
  ["custom", "自定义", 1200, 800],
];
// 拖进来 / 选文件当文案读的扩展名
const TEXT_FILE = /\.(md|markdown|txt)$/i;
const baseName = (name) => String(name || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

/** 拖进来的东西 → [{ path, file }]：优先用 import-html.js 的 filesFromDataTransfer（支持文件夹、.zip），没有时退回普通文件列表。必须在 drop 事件里同步调用。 */
export function droppedFiles(dataTransfer) {
  if (typeof importHtml.filesFromDataTransfer === "function") return importHtml.filesFromDataTransfer(dataTransfer);
  return Promise.resolve([...(dataTransfer?.files || [])].map((file) => ({ path: file.webkitRelativePath || file.name, file })));
}
/** 拖进来的全是 .md / .txt（没有文件夹）时返回这些文件，否则返回 null（交给导入）。 */
export function textFilesOf(dataTransfer) {
  const files = [...(dataTransfer?.files || [])];
  const dirs = [...(dataTransfer?.items || [])].some((item) => item.kind === "file" && item.webkitGetAsEntry?.()?.isDirectory);
  return files.length && !dirs && files.every((f) => TEXT_FILE.test(f.name)) ? files : null;
}

/**
 * deps：{ api, S, app, $, esc, shell, head, modal, closeModal, notice, open, home, glassAttr, homeThumbs, liven, syncGlass, projectManagement(), confirm? }
 * 返回 { show(), action(a, button), newDialog(), createFromDraft(text, opts) }：show 画总览；action 处理总览相关的 data-action（处理了返回 true）。
 * 总览当前所在的文件夹记在 S.homeFolder（'' = 根）。
 */
export function createHome(deps) {
  const { api, S, app, $, esc, shell, modal, closeModal, notice, open, glassAttr, homeThumbs, liven, syncGlass } = deps;
  const projectManagement = () => deps.projectManagement();
  // app.js 传了 confirm（confirmAction）就用它；否则用同样样式的玻璃确认框
  const confirm = (title, text) => deps.confirm ? deps.confirm(title, text) : new Promise((resolve) => {
    modal(`<h2>${esc(title)}</h2><p class="g-sheet__note">${esc(text)}</p><div class="g-sheet__actions"><button type="button" class="g-btn" data-hm-confirm="0">取消</button><button type="button" class="g-btn g-btn--prism" data-hm-confirm="1">确认</button></div>`);
    for (const b of document.querySelectorAll("[data-hm-confirm]")) b.onclick = () => { closeModal(); resolve(b.dataset.hmConfirm === "1"); };
  });
  const refresh = async () => { if (S.view === "home") await show(); };
  const folders = createFolderActions({
    api, modal, closeModal, confirm, notice,
    refresh: async (change) => {
      if (change?.renamed && S.homeFolder === change.renamed[0]) S.homeFolder = change.renamed[1];
      if (change?.removed && S.homeFolder === change.removed) S.homeFolder = "";
      await refresh();
    },
  });

  // 总览「复制给 agent」：请整理文件夹走服务端 brief；从零开始做设计在这里拼（取 /api/health、/api/settings）
  async function copyHomeBrief(intent) {
    const text = intent === "organize" ? (await api("/api/brief/organize")).text : await scratchBrief();
    await navigator.clipboard.writeText(text);
    notice("已复制，开新的 agent 对话时直接粘贴");
  }
  async function scratchBrief() {
    const [{ repoDir }, { dataDir }] = await Promise.all([api("/api/health"), api("/api/settings")]);
    const win = /^[A-Za-z]:\\|\\\\/.test(dataDir || repoDir || "");
    const j = (...xs) => xs.join(win ? "\\" : "/");
    const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const proj = j(dataDir, "projects", "<项目编号>");
    return [
      "请在「视觉工作台」里从零开始做一个新设计。",
      "",
      `工作台代码文件夹：${repoDir}`,
      `数据目录：${dataDir}`,
      `规则：${j(repoDir, "CLAUDE.md")}（Claude Code）或 ${j(repoDir, "AGENTS.md")}（Codex）`,
      `格式：${j(repoDir, "docs", "format.md")}、${j(repoDir, "schema", "project.schema.json")}（格式 v3：每页一个 HTML 文件）`,
      `示例：${j(repoDir, "examples", "sample-deck")}（照着写）`,
      "",
      "新项目：",
      `- 放在 ${proj}（project.json + pages/ + assets/ + fonts/）；编号用小写字母、数字和短横线`,
      `- 项目名按「日期 + 简短名」，日期用今天，例如「${today} 水曜会话课表」`,
      "",
      "开工前：",
      "1. 读规则文件、format.md 和 schema，不要凭记忆；看一遍示例项目。",
      "",
      "做页面：",
      "- 每页 pages/<页面编号>.html 是完整的 HTML 文档，样式、脚本随意；库复制进 assets/，用 ../assets/x.js 引用。",
      "- 不引用任何网络地址（字体、CDN、图片、外部链接都不行）。",
      "- 标出用户可以动的地方：data-vw-id=\"<稳定编号>\" data-vw=\"<能力>\"。文字 text move resize color；图片 move resize crop；纯色色块 move resize background；整页背景只标 background。",
      "- data-vw-id 一页内唯一，以后改版面也不改。",
      `- 常用字体（站酷小薇、思源宋体 SC / JP、思源黑体 SC / JP）从 ${j(dataDir, "library", "fonts", "<key>")} 复制进项目 fonts/ 并登记（key：zcool-xiaowei、source-han-serif-sc、source-han-serif-jp、source-han-sans-sc、source-han-sans-jp），不要上网下载。`,
      "- 有动效用 vw.motion({ init, step, leave, dispose }) 登记，并在 project.json 的 pages[].motion.steps 写点击次数；没有动效省略 motion。",
      "",
      "做完：",
      "1. 在 project.json 写设计卡片 designCard（方向、概念、配色、字体与字号、特征、at），格式见 docs/format.md §17。",
      `2. 在 ${repoDir} 里运行，两项都要通过：`,
      `   npm run validate -- ${proj}`,
      `   npm run check-motion -- ${proj}`,
      "",
      "设计内容：",
    ].join("\n");
  }

  async function show() {
    const [list, folderInfo] = await Promise.all([
      api("/api/projects"),
      api("/api/folders").catch(() => null), // 接口没上线时按项目上的 folder 字段推出文件夹
    ]);
    let backup = folderInfo?.backup;
    if (backup === undefined) backup = (await api("/api/organize").catch(() => null))?.backup ?? null;
    S.homeProjects = list;
    S.homeFolders = folderInfo?.folders || [];
    S.homeBackup = backup;
    S.masters = list.filter((x) => x.master).map((x) => ({ id: x.id, name: x.name }));
    if (S.homeFolder && !folderView(list, S.homeFolders, "").all.some((f) => f.name === S.homeFolder)) S.homeFolder = "";
    const here = S.homeFolder || "";
    const view = folderView(list, S.homeFolders, here);
    // 缩略图框是 16:10，作品按自己的比例居中放进去（竖版海报不会被裁）
    const fit = (item) => {
      const first = item.project.pages?.[0];
      const { width, height } = first ? pageViewport(item.project, first) : item.project.artboard;
      const r = width / height / 1.6;
      return r >= 1 ? `width:100%;height:${100 / r}%` : `width:${100 * r}%;height:100%`;
    };
    const chips = (item) => {
      const out = [];
      if (item.drafts > 0) out.push(`<span class="hm-chip hm-chip--draft">草稿 ${item.drafts} 页</span>`);
      if (item.folder && item.folder !== here) out.push(`<span class="hm-chip hm-chip--folder">${folderIcon(11)}${esc(item.folder)}</span>`);
      return out.length ? `<span class="hm-card__chips">${out.join("")}</span>` : "";
    };
    const card = (item) => {
      const i = list.indexOf(item);
      const dc = renderDesignCardIcon({ id: item.id, name: item.name, designCard: item.designCard ?? item.project?.designCard });
      return `<div class="hm-cell${dc ? " has-design" : ""}" data-project-id="${esc(item.id)}"><button class="hm-card" data-action="open" data-id="${esc(item.id)}"><div class="hm-card__thumb"><div class="hm-card__art" style="${fit(item)}" data-thumb="${i}"></div></div><div class="hm-card__info"><strong>${esc(item.name)}</strong><small>${item.project.pages.length} 页 · ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small>${chips(item)}</div><span class="hm-card__tag">${item.master ? "系列母版" : item.legacy ? "旧格式 · 打开时转换" : esc(item.project.artboard?.preset || "")}</span></button>${dc}<button class="ed-add hm-master ${item.master ? "is-on" : ""}" data-action="master" data-id="${esc(item.id)}" data-on="${item.master ? 1 : 0}" title="${item.master ? "取消系列母版" : "设为系列母版"}" aria-label="${item.master ? "取消系列母版" : "设为系列母版"}" aria-pressed="${item.master ? "true" : "false"}">${icon("bookmark", 15)}</button><div class="hm-project-actions">${[["project-rename", "重命名"], ["project-duplicate", "复制项目"], ["project-delete", "删除项目"]].map(([action, label]) => `<button class="g-btn" data-action="${action}" data-id="${esc(item.id)}">${label}</button>`).join("")}</div></div>`;
    };
    const count = `${here ? view.projects.length : list.length} 个项目`;
    const restoreBtn = backup?.at ? `<button class="g-btn" data-action="organize-restore">退回整理前（${esc(formatBackupTime(backup.at))}）</button>` : "";
    const actions = `<button class="g-btn" data-action="close-workbench">关闭工作台</button><button class="g-btn" data-action="project-trash">回收站</button><button class="g-btn" data-action="data-settings">数据文件夹</button>${restoreBtn}<button class="g-btn" data-action="home-brief">复制给 agent</button><button class="g-btn" data-action="folder-new">新建文件夹</button><button class="g-btn" data-action="import-html">导入 HTML / 网页</button><button class="ed-play" data-action="new">${icon("plus", 15)}<span>新建项目</span></button>`;
    const header = `<header class="ed-top"><div class="ed-titlebox">${breadcrumbHtml(here, esc)}<span class="ed-count ed-count--bg">${count}</span></div><div class="ed-spacer"></div>${actions}</header>`;
    const empty = here && !view.projects.length ? `<p class="hm-folder-empty">这个文件夹是空的。在项目上右键「移到…」，或把项目卡片拖到文件夹上。</p>` : "";
    shell(
      "home",
      `${header}<section class="hm-panel" ${glassAttr("home:panel")} data-glass-frost><div class="hm-scroll ed-scroll"><div class="hm-grid">${view.folders.map((f) => folderCardHtml(f, esc)).join("")}${view.projects.map(card).join("")}<button class="hm-card hm-card--add" data-action="new"><span class="ed-add" aria-hidden="true">${icon("plus", 18)}</span><span>新建项目</span></button></div>${empty}</div><div class="hm-drop-hint" aria-hidden="true"><span>${icon("upload", 22)}松开导入</span><small>HTML、文件夹、.zip 导入成项目；.md / .txt 文案按草稿分页新建</small></div></section>`,
    );
    list.forEach((x, i) => { const first = x.project.pages?.[0]; if (first && !x.legacy && first.file) $(`[data-thumb="${i}"]`)?.append(homeThumbs.make(x.project, first)); });
    const scroll = app.querySelector(".hm-scroll");
    if (scroll) {
      S.homeSel = mountHomeSelection(scroll, { canMove: true, onOpen: (id) => open(id), onAction: (action, ids, at) => homeAction(action, ids, at) });
      mountFolderDrops(scroll.closest(".ed-main") || app, { selectedIds: () => S.homeSel?.selected || [], onMove: (ids, folder) => folders.move(ids, folder) });
      scroll.addEventListener("contextmenu", folderMenu);
      mountImportDrop(scroll);
    }
    liven(app);
    syncGlass(app);
  }

  // 文件夹卡片右键：打开、重命名、删除
  function folderMenu(e) {
    const cell = e.target.closest?.(".hm-cell--folder"); if (!cell) return;
    e.preventDefault();
    const name = cell.dataset.folder;
    showContextMenu({ x: e.clientX, y: e.clientY, items: [{ label: "打开", action: "open" }, { separator: true }, { label: "重命名", action: "rename" }, { label: "删除文件夹", action: "delete" }], document, onAction: (a) => {
      if (a === "open") enterFolder(name);
      else if (a === "rename") folders.rename(name);
      else if (a === "delete") folders.remove(name);
    } });
  }
  function enterFolder(name) { S.homeFolder = name || ""; return show(); }
  // 「移到…」：在右键的位置再弹一个小菜单（文件夹 + 总览）
  function moveMenu(ids, at = { x: 200, y: 200 }) {
    const names = folderView(S.homeProjects, S.homeFolders, "").all.map((f) => f.name);
    const folderOf = (id) => S.homeProjects.find((p) => p.id === id)?.folder || "";
    const same = ids.every((id) => folderOf(id) === folderOf(ids[0])) ? folderOf(ids[0]) : null;
    const items = moveMenuItems(names, same ?? "\u0000").map((it) => (same === null && it.folder === "" ? { ...it, disabled: false } : it));
    showContextMenu({ x: at.x, y: at.y, items, document, onAction: (_a, item) => folders.move(ids, item.folder) });
  }

  // 拖进来导入：.html / 文件夹 / .zip → 导入对话框直接开始；.md / .txt → 从文案新建
  function mountImportDrop(scroll) {
    const panel = scroll.closest(".hm-panel") || scroll;
    const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    let depth = 0;
    const off = () => { depth = 0; panel.classList.remove("is-drop-import"); };
    panel.addEventListener("dragenter", (e) => { if (!isFiles(e)) return; e.preventDefault(); depth++; panel.classList.add("is-drop-import"); });
    panel.addEventListener("dragover", (e) => { if (!isFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; panel.classList.add("is-drop-import"); });
    panel.addEventListener("dragleave", (e) => { if (!isFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth || !panel.contains(e.relatedTarget)) off(); });
    panel.addEventListener("drop", (e) => {
      if (!isFiles(e)) return;
      e.preventDefault(); off();
      const texts = textFilesOf(e.dataTransfer);
      if (texts) { importTexts(texts); return; }
      const pending = droppedFiles(e.dataTransfer); // 同步调用：过了这个事件 dataTransfer 就读不到了
      pending.then((files) => {
        if (!files?.length) { notice("没有读到可以导入的文件"); return; }
        importHtml.openImportDialog({ api, modal, closeModal, notice, files, autoStart: true, onCreated: () => { if (S.view === "home") show().catch(() => {}); }, onDone: (projectId) => open(projectId) });
      }).catch((err) => notice(err.message));
    });
  }
  async function importTexts(files) {
    const created = [];
    for (const file of files) {
      try { created.push(await createFromDraft(await file.text(), { name: baseName(file.name), openIt: files.length === 1 })); }
      catch (err) { notice(`「${file.name}」没能新建：${err.message}`); }
    }
    if (files.length > 1 && created.length) { await refresh(); notice(`已从文案新建 ${created.length} 个项目`); }
  }
  /** 从文案新建：POST /api/projects { draft, name?, preset?/width?/height? }；成功后打开项目并提示服务端说明的分页方式。 */
  async function createFromDraft(text, { name = "", board = null, openIt = true } = {}) {
    const result = await api("/api/projects", "POST", { draft: text, ...(name ? { name } : {}), ...(board || {}) });
    if (openIt) {
      await open(result.project.id, result);
      if (result.draft?.note) notice(result.draft.note);
    }
    return result;
  }

  function homeAction(action, ids, at) {
    const items = ids.map((id) => S.homeProjects.find((p) => p.id === id)).filter(Boolean);
    if (!items.length) return;
    if (action === "move") return moveMenu(items.map((p) => p.id), at);
    if (action === "rename") return projectManagement().rename(items[0]);
    if (action === "duplicate") return projectManagement().duplicate(items[0]);
    if (action === "delete") return items.length === 1 ? projectManagement().remove(items[0]) : projectManagement().removeMany(items);
  }

  function newDialog() {
    modal(
      `<h2>新建项目</h2><form id="new-form"><fieldset class="import-html__kind" data-new-kind><legend>项目类型</legend><label><input type="radio" name="kind" value="deck" checked> 课件 / 海报</label><label><input type="radio" name="kind" value="web"> 网页</label><label><input type="radio" name="kind" value="draft"> 从文案开始</label></fieldset><label class="g-field g-field--stack"><span data-name-label>项目名称</span><input name="name" required maxlength="200" placeholder="例如：秋季课程提案" autofocus></label>${(S.masters || []).length ? `<label class="g-field g-field--stack" data-master-field><span>从母版开始</span><select name="master"><option value="">不用母版</option>${S.masters.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label>` : ""}<div class="hm-draft-fields" data-draft-fields hidden><label class="g-area hm-draft-area">文案<textarea name="draft" rows="9" placeholder="把文案粘贴到这里。&#10;# 一级标题当项目名；--- 或「## Page 2 ｜ 页名」分页；没有记号的文字按空行和字数自动分页"></textarea></label><div class="hm-draft-file"><button type="button" class="g-btn" data-draft-pick>选择 .md / .txt 文件…</button><span class="g-sheet__note" data-draft-file></span><input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" data-draft-input hidden></div></div><p class="g-sheet__note" data-web-note hidden>电脑端 1440×900 窗口、手机端 390×844 窗口，页面高度按内容自定</p><div data-deck-fields><label class="g-field g-field--stack"><span>画板类型</span><select name="preset">${PRESETS.map((p) => `<option value="${p[0]}">${p[1]} · ${p[2]} × ${p[3]}</option>`).join("")}</select></label><div class="g-sheet__pair"><label class="g-field g-field--stack"><span>宽度</span><input name="width" type="number" min="1" value="1920" required></label><label class="g-field g-field--stack"><span>高度</span><input name="height" type="number" min="1" value="1080" required></label></div></div><div class="g-sheet__actions"><button type="button" class="g-btn" data-action="close">取消</button><button class="g-btn g-btn--prism" type="submit">${icon("plus", 17)}创建项目</button></div></form>`,
    );
    const f = $("#new-form");
    f.preset.onchange = () => { const p = PRESETS.find((p) => p[0] === f.preset.value); f.width.value = p[2]; f.height.value = p[3]; };
    const kind = () => f.querySelector('input[name="kind"]:checked')?.value || "deck";
    const refreshKind = () => {
      const k = kind(), isWeb = k === "web", isDraft = k === "draft";
      f.querySelector("[data-deck-fields]").hidden = isWeb;
      f.querySelector("[data-web-note]").hidden = !isWeb;
      f.querySelector("[data-draft-fields]").hidden = !isDraft;
      const masterField = f.querySelector("[data-master-field]"); if (masterField) masterField.hidden = isDraft;
      f.name.required = !isDraft;
      f.querySelector("[data-name-label]").textContent = isDraft ? "项目名称（文案里没有 # 标题时用）" : "项目名称";
      for (const field of [f.preset, f.width, f.height]) field.disabled = isWeb || (!isDraft && !!f.master?.value);
      if (f.master) f.master.disabled = isWeb || isDraft;
    };
    // 切到「从文案开始」弹窗变高：玻璃底板按新尺寸重铺
    for (const r of f.querySelectorAll('input[name="kind"]')) r.onchange = () => { refreshKind(); openModalGlass(f.closest(".g-sheet")); };
    if (f.master) f.master.onchange = refreshKind;
    const picker = f.querySelector("[data-draft-input]");
    f.querySelector("[data-draft-pick]").onclick = () => picker.click();
    picker.onchange = async () => {
      const file = picker.files?.[0]; if (!file) return;
      f.draft.value = await file.text();
      f.querySelector("[data-draft-file]").textContent = file.name;
      if (!f.name.value.trim()) f.name.value = baseName(file.name);
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const name = f.name.value.trim();
        if (kind() === "draft") {
          if (!f.draft.value.trim()) { notice("请先粘贴文案，或选择一个 .md / .txt 文件"); return; }
          const board = { preset: f.preset.value, width: +f.width.value, height: +f.height.value };
          closeModal();
          await createFromDraft(f.draft.value, { name, board });
          return;
        }
        const result = await api("/api/projects", "POST", kind() === "web" ? { name, kind: "web" } : f.master?.value ? { name, fromMaster: f.master.value } : { name, preset: f.preset.value, width: +f.width.value, height: +f.height.value });
        closeModal();
        open(result.project.id, result);
      } catch (err) {
        notice(err.message);
      }
    };
  }

  // 总览相关的按钮（app.js 的点击分发先问这里）
  async function action(a, b) {
    const id = b?.dataset?.id;
    switch (a) {
      case "new": newDialog(); return true;
      case "project-trash": await projectManagement().openTrash(); return true;
      case "project-delete": await projectManagement().remove(S.homeProjects.find((p) => p.id === id)); return true;
      case "project-duplicate": await projectManagement().duplicate(S.homeProjects.find((p) => p.id === id)); return true;
      case "project-rename": await projectManagement().rename(S.homeProjects.find((p) => p.id === id)); return true;
      case "folder-open": await enterFolder(b.dataset.folder); return true;
      case "folder-root": await enterFolder(""); return true;
      case "folder-new": folders.create(); return true;
      case "organize-restore": await folders.restore(S.homeBackup); return true;
      case "home-brief": {
        const box = b.getBoundingClientRect();
        showContextMenu({ x: box.left, y: box.bottom + 6, items: [{ action: "scratch", label: "从零开始做设计" }, { action: "organize", label: "请整理文件夹" }], onAction: (intent) => copyHomeBrief(intent).catch((err) => notice(err.message)) });
        return true;
      }
      case "design-card": {
        const item = S.homeProjects.find((p) => p.id === id);
        if (item) openDesignCard({ project: { id: item.id, name: item.name, designCard: item.designCard ?? item.project?.designCard }, modal, closeModal, notice });
        return true;
      }
      case "import-html":
        importHtml.openImportDialog({ api, modal, closeModal, notice, onCreated: () => { if (S.view === "home") show().catch(() => {}); }, onDone: (projectId) => open(projectId) });
        return true;
      case "master": {
        const on = b.dataset.on !== "1";
        await api(`/api/projects/${encodeURIComponent(id)}/master`, "PUT", { master: on });
        await deps.home();
        notice(on ? "已设为系列母版，新建项目时可以选「从母版开始」" : "已取消系列母版");
        return true;
      }
    }
    return false;
  }
  return { show, action, newDialog, createFromDraft };
}
