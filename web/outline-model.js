export const ROLES = ["title", "subtitle", "english", "body", "note"];
const clone = (v) => structuredClone(v),
  uid = (p) => `${p}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const flat = (els) => (els || []).flatMap((e) => [e, ...flat(e.children)]);
export const createOutline = () => ({
  screens: 1,
  notes: "",
  rows: [],
  images: [],
});
export function addPage(project, afterId) {
  const p = {
      id: uid("page"),
      name: "新页面",
      background: "#ffffff",
      elements: [],
      outline: createOutline(),
    },
    i = project.pages.findIndex((p) => p.id === afterId);
  project.pages.splice(i < 0 ? project.pages.length : i + 1, 0, p);
  return p;
}
export function deletePage(project, id) {
  if (project.pages.length <= 1) return false;
  const i = project.pages.findIndex((p) => p.id === id);
  if (i < 0) return false;
  project.pages.splice(i, 1);
  return true;
}
export function reorderPages(project, ids) {
  if (
    ids.length !== project.pages.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !project.pages.some((p) => p.id === id))
  )
    throw Error("Invalid order");
  project.pages = ids.map((id) => project.pages.find((p) => p.id === id));
  return project;
}
export function addRow(outline, role = "body", screen = 1, text = "") {
  if (!ROLES.includes(role)) throw Error("Invalid role");
  const r = {
    id: uid("row"),
    role,
    text,
    emphasis: [],
    from: screen,
    until: null,
  };
  outline.rows.push(r);
  return r;
}
export function deleteRow(outline, id) {
  const i = outline.rows.findIndex((r) => r.id === id);
  if (i >= 0) outline.rows.splice(i, 1);
}
export function setRowRole(row, role) {
  if (!ROLES.includes(role)) throw Error("Invalid role");
  row.role = role;
  return row;
}
export function toggleEmphasis(row, start, end) {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > row.text.length ||
    start >= end
  )
    return row;
  const ranges = row.emphasis || [],
    covered = ranges.some((r) => r.start <= start && r.end >= end),
    next = [];
  for (const r of ranges) {
    if (r.end <= start || r.start >= end) next.push({ ...r });
    else {
      if (r.start < start) next.push({ start: r.start, end: start });
      if (r.end > end) next.push({ start: end, end: r.end });
    }
  }
  if (!covered) next.push({ start, end });
  next.sort((a, b) => a.start - b.start);
  row.emphasis = next.reduce((out, r) => {
    const last = out.at(-1);
    if (last && last.end >= r.start) last.end = Math.max(last.end, r.end);
    else out.push(r);
    return out;
  }, []);
  return row;
}
export function addScreen(o) {
  const last = o.screens;
  for (const r of [...o.rows, ...o.images])
    if (r.visibleOn?.includes(last)) r.visibleOn.push(last + 1);
  return ++o.screens;
}
export function markDisappear(item, screen) {
  if (screen <= item.from) throw Error("Screen must follow appearance");
  item.until = screen;
  delete item.visibleOn;
  return item;
}
export const isVisible = (r, s) =>
  r.visibleOn
    ? r.visibleOn.includes(s)
    : s >= r.from && (r.until == null || s < r.until);
export const visibleItems = (o, s) => ({
  rows: o.rows.filter((r) => isVisible(r, s)),
  images: o.images.filter((r) => isVisible(r, s)),
});
const snap = (r) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => k !== "baseline"));
export function extractOutline(project, page, map) {
  const old = page.outline,
    screens = Math.max(1, (page.motion?.steps || 0) + 1),
    o = {
      screens,
      notes: old?.notes ?? page.notes ?? "",
      rows: [],
      images: [],
    },
    els = flat(page.elements),
    max = Math.max(
      0,
      ...els.filter((e) => e.type === "text").map((e) => e.fontSize),
    );
  for (const e of els) {
    if (!["text", "image"].includes(e.type)) continue;
    const kind = e.type === "text" ? "rows" : "images",
      prior = old?.[kind].find((r) => r.elementId === e.id),
      visible = [];
    for (let s = 1; s <= screens; s++) {
      const state = map?.[s];
      if (
        state === undefined
          ? e.opacity !== 0
          : Array.isArray(state)
            ? state.includes(e.id)
            : state[e.id] === true
      )
        visible.push(s);
    }
    const range = {
      from: visible[0] || 1,
      until:
        visible.length && visible.at(-1) < screens ? visible.at(-1) + 1 : null,
    };
    if (!visible.length || visible.length !== visible.at(-1) - visible[0] + 1)
      range.visibleOn = visible;
    const fields =
      e.type === "text"
        ? {
            role:
              prior?.role ||
              (e.fontSize === max && max >= 48
                ? "title"
                : e.fontSize >= max * 0.7 && e.fontSize >= 32
                  ? "subtitle"
                  : e.fontSize < max * 0.3
                    ? "note"
                    : /^[\x00-\x7f]+$/.test(e.text) && /[A-Za-z]/.test(e.text)
                      ? "english"
                      : "body"),
            text: e.text,
            emphasis: prior?.text === e.text ? clone(prior.emphasis) : [],
          }
        : { asset: e.asset, caption: prior?.caption || e.name || "" };
    o[kind].push({
      id: prior?.id || uid(e.type === "text" ? "row" : "image"),
      ...fields,
      ...range,
      elementId: e.id,
      baseline: clone({ ...fields, ...range }),
    });
  }
  o.baseline = { screens, rows: o.rows.map(snap), images: o.images.map(snap) };
  return o;
}
export function planApplyText(
  project,
  pageIds = project.pages.map((p) => p.id),
) {
  const output = clone(project),
    changes = [],
    applied = [];
  for (const p of output.pages.filter((p) => pageIds.includes(p.id))) {
    const o = p.outline;
    if (!o) continue;
    const els = flat(p.elements),
      change = (r, type) =>
        changes.push({
          pageId: p.id,
          id: r?.id,
          type,
          message: "需要 agent 排版",
        });
    for (const r of o.rows) {
      const e = els.find((e) => e.id === r.elementId && e.type === "text");
      if (!e) {
        change(r, r.elementId ? "missing-element" : "new");
        continue;
      }
      if (!r.baseline) {
        change(r, "unmapped-baseline");
        continue;
      }
      if (
        r.baseline &&
        r.text !== r.baseline.text &&
        e.text !== r.baseline.text &&
        e.text !== r.text
      ) {
        change(r, "text-conflict");
        continue;
      }
      if (r.baseline && r.text !== r.baseline.text) {
        e.text = r.text;
        r.baseline.text = r.text;
        const b = o.baseline?.rows.find((b) => b.id === r.id);
        if (b) b.text = r.text;
        applied.push({ pageId: p.id, rowId: r.id, elementId: e.id });
      }
      for (const k of ["role", "emphasis", "from", "until", "visibleOn"])
        if (
          r.baseline &&
          JSON.stringify(r[k]) !== JSON.stringify(r.baseline[k])
        )
          change(r, k);
    }
    for (const kind of ["rows", "images"])
      for (const b of o.baseline?.[kind] || [])
        if (!o[kind].some((r) => r.id === b.id)) change(b, "deleted");
    for (const r of o.images) {
      if (
        !r.elementId ||
        !els.some((e) => e.id === r.elementId && e.type === "image") ||
        !r.baseline ||
        ["asset", "caption", "from", "until", "visibleOn"].some(
          (k) => JSON.stringify(r[k]) !== JSON.stringify(r.baseline[k]),
        )
      )
        change(r, "image");
    }
    if (o.baseline && o.screens !== o.baseline.screens) change(null, "screens");
  }
  return { project: output, changes, applied, unapplied: changes };
}
export function outlineStatus(project, page) {
  const p = planApplyText(project, [page.id]);
  return {
    pendingText: p.applied.length,
    unapplied: p.changes,
    needsLayout: p.changes.length > 0,
  };
}
export function copyBrief(
  project,
  pageIds = project.pages.map((p) => p.id),
  filePath = "project.json",
  repoDir,
  mode = "layout",
  dataDir,
) {
  if (!["layout", "fill"].includes(mode)) throw new Error("说明类型只能是 fill 或 layout");
  const lines = [
    `${mode === "fill" ? "请按文档填大纲（只填不排）" : "请按大纲排版"}：${project.name}（${project.id}）。只处理下面列出的页面。`,
    `项目文件：${filePath}`,
    ...(dataDir ? [`当前数据文件夹：${dataDir}（以工作台设置为准，不要假设固定路径）。`] : []),
    ...(repoDir ? [`工作台仓库与规则：${repoDir}`] : []),
    "大纲在 project.json 的 pages[].outline；先读最新文件、CLAUDE.md、docs/format.md 与 schema/project.schema.json，改前运行 npm run save-version -- <项目路径> -m <说明>。",
    ...project.pages.filter(p => pageIds.includes(p.id)).map(p =>
      `第 ${project.pages.indexOf(p) + 1} 页（${p.id}） · ${p.name} · ${p.outline ? `${p.outline.screens} 屏` : mode === 'fill' ? '尚无大纲，请按文档填写' : '尚无大纲，请保留此页并说明'}`),
    "大纲是右侧实时联动文稿：每段对应独立文字元素。保留 elementId；联动页修改文字时同时更新元素 text 和行 text，排版完成清除 documentDraft。纯装饰文字标 decorative:true。",
    "按大纲里的层级、强调、图片说明和备注排版；保留用户调整的位置、大小、颜色、字体、层级和其他页面。N 屏写 motion.steps = N−1，第 1 屏是初始化后、step(0) 前。",
    "排好后为每条文字和图片写 elementId；更新条目 baseline 及 outline.baseline（screens、rows、images）的已落实快照，供后续联动与识别尚未落实的排版要求。",
    "完成后运行 npm run validate -- <项目路径> 与 npm run check-motion -- <项目路径>，两者通过再交付。",
  ];
  if (mode === "fill") {
    lines.splice(lines.length - 3, 2,
      "按文档的分页或主题填入以上页面；页数不够就在最后一个指定页后新建，不改其他页面。判断 title/subtitle/english/body/note 层级，把正文空行分为独立段；强调记 UTF-16 范围，图片要求写 images[].caption，这页要求写 notes。",
      "只填不排：新段创建 documentDraft:true 的独立草稿文字并保持 rows[].elementId 对应；已有段只同步文字，不移动、缩放或改样式，不写或修改 motion，不把尚未排版的内容标成已排版快照。保留原文，不擅自删减；不明确的分页或要求写进备注。",
      "文档内容或本机文档路径：\n【用户在这里粘贴文档，或填写文档的完整路径】");
  }
  return lines.join("\n");
}
