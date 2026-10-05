// 总览页（第 13 轮抽出）：项目卡片、新建项目、项目右键 / 多选动作。编辑器主体在 app.js。
// 依赖由 app.js 注入（createHome(deps)），这里不直接碰 app.js 的状态以外的东西。
import { pageViewport } from "./project-kinds.js";
import { mountHomeSelection } from "./home-selection.js";
import { openImportDialog } from "./import-html.js";
import { icon } from "./ui/icons.js";

export const PRESETS = [
  ["slide-16x9", "演示文稿", 1920, 1080],
  ["poster-a4", "A4 海报", 2480, 3508],
  ["poster-a3", "A3 海报", 3508, 4961],
  ["custom", "自定义", 1200, 800],
];

/**
 * deps：{ api, S, app, $, esc, shell, head, modal, closeModal, notice, open, glassAttr, homeThumbs, liven, syncGlass, projectManagement() }
 * 返回 { show(), action(a, button), newDialog() }：show 画总览；action 处理总览相关的 data-action（处理了返回 true）。
 */
export function createHome(deps) {
  const { api, S, app, $, esc, shell, head, modal, closeModal, notice, open, glassAttr, homeThumbs, liven, syncGlass } = deps;
  const projectManagement = () => deps.projectManagement();
  async function show() {
  const list = await api("/api/projects");
  S.homeProjects = list;
  S.masters = list.filter((x) => x.master).map((x) => ({ id: x.id, name: x.name }));
  // 缩略图框是 16:10，作品按自己的比例居中放进去（竖版海报不会被裁）
  const fit = (item) => {
    const first = item.project.pages?.[0];
    const { width, height } = first ? pageViewport(item.project, first) : item.project.artboard;
    const r = width / height / 1.6;
    return r >= 1 ? `width:100%;height:${100 / r}%` : `width:${100 * r}%;height:100%`;
  };
  const card = (item, i) =>
    `<div class="hm-cell" data-project-id="${esc(item.id)}"><button class="hm-card" data-action="open" data-id="${esc(item.id)}"><div class="hm-card__thumb"><div class="hm-card__art" style="${fit(item)}" data-thumb="${i}"></div></div><div class="hm-card__info"><strong>${esc(item.name)}</strong><small>${item.project.pages.length} 页 · ${new Date(item.updatedAt).toLocaleDateString("zh-CN")}</small></div><span class="hm-card__tag">${item.master ? "系列母版" : item.legacy ? "旧格式 · 打开时转换" : esc(item.project.artboard?.preset || "")}</span></button><button class="ed-add hm-master ${item.master ? "is-on" : ""}" data-action="master" data-id="${esc(item.id)}" data-on="${item.master ? 1 : 0}" title="${item.master ? "取消系列母版" : "设为系列母版"}" aria-label="${item.master ? "取消系列母版" : "设为系列母版"}" aria-pressed="${item.master ? "true" : "false"}">${icon("bookmark", 15)}</button><div class="hm-project-actions">${[["project-rename", "重命名"], ["project-duplicate", "复制项目"], ["project-delete", "删除项目"]].map(([action, label]) => `<button class="g-btn" data-action="${action}" data-id="${esc(item.id)}">${label}</button>`).join("")}</div></div>`;
  shell(
    "home",
    `${head("项目总览", `${list.length} 个项目`, `<button class="g-btn" data-action="close-workbench">关闭工作台</button><button class="g-btn" data-action="project-trash">回收站</button><button class="g-btn" data-action="data-settings">数据文件夹</button><button class="g-btn" data-action="import-html">导入 HTML / 网页</button><button class="ed-play" data-action="new">${icon("plus", 15)}<span>新建项目</span></button>`)}<section class="hm-panel" ${glassAttr("home:panel")} data-glass-frost><div class="hm-scroll ed-scroll"><div class="hm-grid">${list.map(card).join("")}<button class="hm-card hm-card--add" data-action="new"><span class="ed-add" aria-hidden="true">${icon("plus", 18)}</span><span>新建项目</span></button></div></div></section>`,
  );
  list.forEach((x, i) => { const first = x.project.pages?.[0]; if (first && !x.legacy && first.file) $(`[data-thumb="${i}"]`)?.append(homeThumbs.make(x.project, first)); });
  const scroll = app.querySelector(".hm-scroll");
  if (scroll) S.homeSel = mountHomeSelection(scroll, { onOpen: (id) => open(id), onAction: (action, ids) => homeAction(action, ids) });
  liven(app);
  syncGlass(app);
}
  function homeAction(action, ids) {
  const items = ids.map((id) => S.homeProjects.find((p) => p.id === id)).filter(Boolean);
  if (!items.length) return;
  if (action === "rename") return projectManagement().rename(items[0]);
  if (action === "duplicate") return projectManagement().duplicate(items[0]);
  if (action === "delete") return items.length === 1 ? projectManagement().remove(items[0]) : projectManagement().removeMany(items);
}
  function newDialog() {
  modal(
    `<h2>新建项目</h2><form id="new-form"><label class="g-field g-field--stack"><span>项目名称</span><input name="name" required maxlength="200" placeholder="例如：秋季课程提案" autofocus></label>${(S.masters || []).length ? `<label class="g-field g-field--stack"><span>从母版开始</span><select name="master"><option value="">不用母版</option>${S.masters.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select></label>` : ""}<fieldset class="import-html__kind" data-new-kind><legend>项目类型</legend><label><input type="radio" name="kind" value="deck" checked> 课件 / 海报</label><label><input type="radio" name="kind" value="web"> 网页</label></fieldset><p class="g-sheet__note" data-web-note hidden>电脑端 1440×900 窗口、手机端 390×844 窗口，页面高度按内容自定</p><div data-deck-fields><label class="g-field g-field--stack"><span>画板类型</span><select name="preset">${presets.map((p) => `<option value="${p[0]}">${p[1]} · ${p[2]} × ${p[3]}</option>`).join("")}</select></label><div class="g-sheet__pair"><label class="g-field g-field--stack"><span>宽度</span><input name="width" type="number" min="1" value="1920" required></label><label class="g-field g-field--stack"><span>高度</span><input name="height" type="number" min="1" value="1080" required></label></div></div><div class="g-sheet__actions">${gbtn("close", "取消")}<button class="g-btn g-btn--prism" type="submit">${icon("plus", 17)}创建项目</button></div></form>`,
  );
  const f = $("#new-form");
  f.preset.onchange = () => { const p = PRESETS.find((p) => p[0] === f.preset.value); f.width.value = p[2]; f.height.value = p[3]; };
  const kind = () => f.querySelector('input[name="kind"]:checked')?.value || "deck";
  const refreshKind = () => {
    const isWeb = kind() === "web";
    f.querySelector("[data-deck-fields]").hidden = isWeb;
    f.querySelector("[data-web-note]").hidden = !isWeb;
    for (const field of [f.preset, f.width, f.height]) field.disabled = isWeb || !!f.master?.value;
    if (f.master) f.master.disabled = isWeb;
  };
  for (const r of f.querySelectorAll('input[name="kind"]')) r.onchange = refreshKind;
  if (f.master) f.master.onchange = refreshKind;
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const name = f.name.value.trim();
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
      case "import-html":
        openImportDialog({ api, modal, closeModal, notice, onCreated: () => { if (S.view === "home") show().catch(() => {}); }, onDone: (projectId) => open(projectId) });
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
  return { show, action, newDialog };
}
