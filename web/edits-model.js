// 修改单（第 12 轮）：纯逻辑，浏览器和 Node 共用（src/ 与 web/ 都 import 这里）。
// 规则见 docs/format.md §7：同一目标同一种修改只有一条，before 是第一次改之前的原样，after 是最新值；改回原样就删掉。
export const EDIT_KINDS = Object.freeze(['text', 'fontSize', 'move', 'resize', 'color', 'background', 'crop', 'addImage']);
// 每种修改需要页面给出的能力（addImage 不需要：用户贴的图只在修改单里）
export const KIND_CAP = Object.freeze({ text: 'text', fontSize: 'text', move: 'move', resize: 'resize', color: 'color', background: 'background', crop: 'crop', addImage: null });
export const CAPS = Object.freeze(['text', 'move', 'resize', 'color', 'background', 'crop']);
export const USER_IMAGE_PREFIX = 'u_';
export const USER_IMAGE_CAPS = Object.freeze(['move', 'resize', 'crop']);
export const EDIT_ID = /^ed_[A-Za-z0-9_-]{4,}$/;
export const MARK_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
export const newEditId = () => `ed_${hex(8)}`;
export const newUserImageId = () => `${USER_IMAGE_PREFIX}${hex(8)}`;
export const isUserImage = id => typeof id === 'string' && id.startsWith(USER_IMAGE_PREFIX);

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}

const round2 = v => Math.round(Number(v) * 100) / 100;
/** 把 after 规整：数字取两位小数，颜色小写。 */
export function normalizeValue(kind, value) {
  if (value === null || value === undefined) return value;
  const v = { ...value };
  for (const k of ['x', 'y', 'dx', 'dy', 'width', 'height', 'fontSize']) if (k in v && v[k] !== null) v[k] = round2(v[k]);
  for (const k of ['color', 'background']) if (typeof v[k] === 'string') v[k] = v[k].trim().toLowerCase();
  if (kind === 'crop' && v.crop) v.crop = { x: round2(v.crop.x), y: round2(v.crop.y), width: round2(v.crop.width), height: round2(v.crop.height) };
  return v;
}

/** 「after 等于没改」：move 的 dx/dy 都是 0；crop 为 null；其他与 before 相同。 */
export function isNoop(kind, before, after) {
  if (kind === 'move') return !after || (round2(after.dx) === 0 && round2(after.dy) === 0);
  if (kind === 'crop') return !after || after.crop === null || after.crop === undefined;
  if (kind === 'addImage') return false;
  return deepEqual(before, after);
}

/**
 * 记一条修改（不改入参，返回新数组）。已有同目标同种类的条目：保留它的 before，只换 after；
 * 新条目用传入的 before（第一次改之前的原样）。after 等于没改时删掉该条。
 */
export function upsertEdit(edits, { target, kind, before, after, at = new Date().toISOString() }) {
  if (!EDIT_KINDS.includes(kind)) throw new Error(`未知的修改种类：${kind}`);
  if (typeof target !== 'string' || !MARK_ID.test(target)) throw new Error(`修改目标编号不合法：${target}`);
  const list = Array.isArray(edits) ? edits.slice() : [];
  const index = list.findIndex(e => e && e.target === target && e.kind === kind);
  const existing = index >= 0 ? list[index] : null;
  const base = existing ? existing.before : normalizeValue(kind, before ?? null);
  const next = normalizeValue(kind, after);
  if (isNoop(kind, base, next)) { if (existing) list.splice(index, 1); return list; }
  const entry = { id: existing?.id || newEditId(), target, kind, at, before: base, after: next };
  if (existing) list[index] = entry; else list.push(entry);
  return list;
}

/** 删掉用户贴进来的图片：它的 addImage 条目和所有指向它的条目一起删。 */
export function removeUserImage(edits, target) {
  return (edits || []).filter(e => e.target !== target);
}

/** 删掉指定编号的条目（agent 清单用）；ids 为空删全部。 */
export function clearEdits(edits, ids = null) {
  if (!ids || !ids.length) return [];
  const set = new Set(ids);
  return (edits || []).filter(e => !set.has(e.id));
}

/** 目标在页面里的能力：marks 是 scanMarks 得到的 Map(id → caps[])；用户贴的图按 addImage 条目认。 */
export function targetCaps(target, marks, edits = []) {
  if (isUserImage(target)) return edits.some(e => e.target === target && e.kind === 'addImage') ? [...USER_IMAGE_CAPS] : null;
  const caps = marks instanceof Map ? marks.get(target) : marks?.[target];
  return Array.isArray(caps) ? caps : null;
}

/** 'ok' 或 'stale'（对不上：目标不存在、或页面没给这种能力）。 */
export function editStatus(edit, marks, edits = []) {
  if (!edit || !EDIT_KINDS.includes(edit.kind)) return 'stale';
  const caps = targetCaps(edit.target, marks, edits);
  if (!caps) return 'stale';
  const need = KIND_CAP[edit.kind];
  return need === null || caps.includes(need) ? 'ok' : 'stale';
}

/** 按修改单把每条标上 status（不改入参）。 */
export function annotateEdits(edits, marks) {
  const list = Array.isArray(edits) ? edits : [];
  return list.map(e => ({ ...e, status: editStatus(e, marks, list) }));
}

const fmt = v => (Number.isInteger(v) ? String(v) : String(round2(v)));
const clip = (s, n = 60) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** 一条修改的大白话（给 agent 和改动清单用）。 */
export function describeEdit(edit) {
  const { kind, before, after, target } = edit;
  switch (kind) {
    case 'text': return `「${target}」文字从「${clip(before?.text)}」改成「${clip(after?.text)}」`;
    case 'fontSize': return `「${target}」字号从 ${fmt(before?.fontSize)}px 改成 ${fmt(after?.fontSize)}px`;
    case 'move': { const dx = after?.dx || 0, dy = after?.dy || 0; const parts = []; if (dx) parts.push(`${dx > 0 ? '右' : '左'}移 ${fmt(Math.abs(dx))}px`); if (dy) parts.push(`${dy > 0 ? '下' : '上'}移 ${fmt(Math.abs(dy))}px`); return `「${target}」${parts.join('、') || '位置未变'}（原位置 ${fmt(before?.x)},${fmt(before?.y)}）`; }
    case 'resize': return `「${target}」尺寸从 ${fmt(before?.width)}×${fmt(before?.height)} 改成 ${fmt(after?.width)}×${fmt(after?.height)}`;
    case 'color': return `「${target}」文字颜色从 ${before?.color ?? '（未设）'} 改成 ${after?.color}`;
    case 'background': return `「${target}」底色从 ${before?.background ?? '（未设）'} 改成 ${after?.background}`;
    case 'crop': { const c = after?.crop; return c ? `「${target}」裁切为源图的 (${fmt(c.x * 100)}%, ${fmt(c.y * 100)}%) 起、宽 ${fmt(c.width * 100)}%、高 ${fmt(c.height * 100)}%` : `「${target}」取消裁切`; }
    case 'addImage': return `新增图片「${target}」（素材 ${after?.asset}），位置 (${fmt(after?.x)}, ${fmt(after?.y)})，尺寸 ${fmt(after?.width)}×${fmt(after?.height)}`;
    default: return `「${target}」${kind}`;
  }
}
