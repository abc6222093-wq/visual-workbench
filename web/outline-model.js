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
      notes: old?.notes || page.notes || "",
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
) {
  const lines = [
    `项目 ${project.id} · ${project.name}`,
    `项目文件：${filePath}`,
    "请先读 CLAUDE.md、docs/format.md、schema/project.schema.json 和最新 project.json，再运行 npm run save-version -- <项目路径> -m <说明>。",
    "保留使用者调整的位置、大小、颜色、字体和层级；按大纲排版并编写动效。N 个画面对应该页 motion.steps = N−1；画面 1 是初始化后的状态。",
    "排版完成后，给每条文字和图片写 elementId，并更新条目 baseline 与 outline.baseline 为本次实际排版的快照；包含 screens、rows 和 images，以便识别新增、删除和未应用变化。",
    "完成后运行 npm run validate -- <项目路径> 与 npm run check-motion -- <项目路径>，两者通过再交付。",
  ];
  for (const p of project.pages.filter((p) => pageIds.includes(p.id))) {
    lines.push(
      `\n第 ${project.pages.indexOf(p) + 1} 页（${p.id}） · ${p.name}`,
    );
    const o = p.outline;
    if (!o) {
      lines.push("尚无大纲");
      continue;
    }
    lines.push(`画面数：${o.screens}`, `备注：${o.notes}`);
    for (let s = 1; s <= o.screens; s++) {
      lines.push(`画面 ${s}`);
      const v = visibleItems(o, s);
      for (const r of v.rows)
        lines.push(
          `[${r.role}] ${r.text}（${r.id}${r.elementId ? ` → ${r.elementId}` : ""}；强调 ${JSON.stringify(r.emphasis)}）`,
        );
      for (const i of v.images)
        lines.push(
          `[图片] ${i.caption} · ${i.asset} · ${project.assets.find((a) => a.id === i.asset)?.file || ""}`,
        );
    }
  }
  return lines.join("\n");
}
