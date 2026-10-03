import { ROLES, isVisible, createOutline, addScreen } from './outline-model.js';

const flat = elements => (elements || []).flatMap(e => [e, ...flat(e.children)]);
const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
const signature = page => JSON.stringify(page);
const snapshot = row => Object.fromEntries(['role', 'text', 'emphasis', 'from', 'until', 'visibleOn'].filter(k => k in row).map(k => [k, structuredClone(row[k])]));
const baseline = page => {
  for (const row of page.outline.rows) row.baseline = snapshot(row);
  // Keep old snapshots intact: they describe the agent's last layout, not this document edit.
};
const inferRole = (e, max) => e.fontSize === max && max >= 48 ? 'title' : e.fontSize >= max * .7 && e.fontSize >= 32 ? 'subtitle' : e.fontSize < max * .3 ? 'note' : /^[\x00-\x7f]+$/.test(e.text) && /[A-Za-z]/.test(e.text) ? 'english' : 'body';

// Bounds include overflowing group children and conservative rotation extents.
function occupiedBounds(e) {
  let left = 0, top = 0, right = e.width, bottom = e.height;
  for (const child of e.children || []) {
    const b = occupiedBounds(child);
    left = Math.min(left, b.left); top = Math.min(top, b.top);
    right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
  }
  if (e.rotation) {
    const cx = e.width / 2, cy = e.height / 2;
    const radius = Math.max(...[left, right].flatMap(x => [top, bottom].map(y => Math.hypot(x - cx, y - cy))));
    left = cx - radius; right = cx + radius; top = cy - radius; bottom = cy + radius;
  }
  return { left: e.x + left, top: e.y + top, right: e.x + right, bottom: e.y + bottom };
}
const sizes = { title: 64, subtitle: 40, english: 28, body: 28, note: 20 };
const defaultStyle = role => ({ font: null, fontSize: sizes[role] || 28, fontWeight: role === 'title' ? 700 : 400, lineHeight: 1.4, color: '#111111' });
const boxHeight = (text, fontSize, width) => Math.max(fontSize * 1.4, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil([...line].length * fontSize / width)), 0) * fontSize * 1.4);
const overlaps = (a, b) => a.left < b.right + 24 && a.right + 24 > b.left && a.top < b.bottom + 24 && a.bottom + 24 > b.top;
function findPlacement(project, page, width, height, excludeId) {
  const board = project?.artboard || { width: 1920, height: 1080 }, margin = 48;
  // Full-board shape/image layers are background decoration, not content obstacles.
  const occupied = page.elements.filter(e => e.id !== excludeId && !e.decorative && !(['shape', 'image'].includes(e.type) && e.x <= 0 && e.y <= 0 && e.width >= board.width && e.height >= board.height)).map(occupiedBounds);
  const xs = [...new Set([margin, ...occupied.map(b => b.right + 24)])].sort((a, b) => a - b);
  const ys = [...new Set([margin, ...occupied.map(b => b.bottom + 24)])].sort((a, b) => a - b);
  for (const y of ys) for (const x of xs) {
    if (x + width > board.width - margin || y + height > board.height - margin) continue;
    if (!occupied.some(b => overlaps({ left: x, top: y, right: x + width, bottom: y + height }, b))) return { x, y, overflow: false };
  }
  return { x: margin, y: Math.max(margin, ...occupied.map(b => b.bottom + 24)), overflow: true };
}
function materialize(project, page, row) {
  const boardWidth = project.artboard?.width || 1920;
  const width = Math.max(1, Math.min(640, boardWidth - 96));
  const style = defaultStyle(row.role), height = boxHeight(row.text, style.fontSize, width);
  const placement = findPlacement(project, page, width, height);
  const e = { id: uid('el'), type: 'text', x: placement.x, y: placement.y, width, height, zIndex: Math.max(0, ...flat(page.elements).map(e => e.zIndex || 0)) + 1, text: row.text, ...style, documentDraft: true };
  page.elements.push(e); row.elementId = e.id;
  return { element: e, overflow: placement.overflow };
}

/** Reconcile in place. First conversion retains pending legacy copy and conflicts. */
export function reconcileDocument(project, page) {
  const before = signature(page), beforeElements = JSON.stringify(page.elements), converted = page.outline?.mode !== 'document';
  page.outline ||= { ...createOutline(), screens: Math.max(1, (page.motion?.steps || 0) + 1) };
  const o = page.outline, els = flat(page.elements), textEls = els.filter(e => e.type === 'text' && !e.decorative), max = Math.max(0, ...textEls.map(e => e.fontSize));
  const next = [], mapped = new Set(), overflow = [];
  for (const row of o.rows) {
    const e = textEls.find(e => e.id === row.elementId);
    if (e && !mapped.has(e.id)) {
      mapped.add(e.id);
      if (converted && row.text !== e.text && row.text !== row.baseline?.text) {
        if (row.baseline && e.text === row.baseline.text) e.text = row.text;
        else {
          const pending = { ...structuredClone(row), id: uid('row') };
          delete pending.elementId; delete pending.baseline;
          if (materialize(project, page, pending).overflow) overflow.push(pending.elementId); mapped.add(pending.elementId); next.push(pending);
        }
      }
      if (row.text !== e.text) { row.text = e.text; row.emphasis = []; }
      next.push(row);
    } else if (converted && !els.some(e => e.id === row.elementId && e.decorative)) {
      if (materialize(project, page, row).overflow) overflow.push(row.elementId); mapped.add(row.elementId); next.push(row);
    }
  }
  for (const e of textEls) if (!mapped.has(e.id)) next.push({ id: uid('row'), role: inferRole(e, max), text: e.text, emphasis: [], from: 1, until: null, elementId: e.id });
  o.rows = next; o.mode = 'document'; baseline(page);
  return { changed: before !== signature(page), converted, canvasChanged: beforeElements !== JSON.stringify(page.elements), overflow, rows: o.rows };
}

export function documentParagraphs(page, screen = 1) {
  let offset = 0;
  return (page.outline?.rows || []).filter(row => screen == null || isVisible(row, screen)).map(row => {
    const paragraph = { row, text: row.text, start: offset, end: offset + row.text.length };
    offset = paragraph.end + 2; return paragraph;
  });
}
export const documentText = (page, screen = 1) => documentParagraphs(page, screen).map(p => p.text).join('\n\n');
export const rowAtOffset = (page, screen, offset) => {
  const paragraphs = documentParagraphs(page, screen);
  return (paragraphs.find(p => offset <= p.end + 1) || paragraphs.at(-1))?.row || null;
};
const removeElement = (elements, id) => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (e.id === id) elements.splice(i, 1);
    else if (e.children) { removeElement(e.children, id); if (!e.children.length) elements.splice(i, 1); }
  }
};

/** Match unchanged prefix/suffix and interior paragraphs before reusing edited rows. */
export function updateDocument(project, page, screen, text, { role = 'body' } = {}) {
  if (!ROLES.includes(role)) throw Error('Invalid role');
  const before = signature(page), beforeElements = JSON.stringify(page.elements);
  const reconciliation = reconcileDocument(project, page);
  const old = documentParagraphs(page, screen).map(p => p.row);
  const parts = String(text).replaceAll('\r\n', '\n').split(/\n[\t ]*\n+/).filter(t => t.length);
  const assigned = Array(parts.length), used = new Set();
  let prefix = 0;
  while (prefix < old.length && prefix < parts.length && old[prefix].text === parts[prefix]) { assigned[prefix] = old[prefix]; used.add(old[prefix++]); }
  let a = old.length - 1, b = parts.length - 1;
  while (a >= prefix && b >= prefix && old[a].text === parts[b]) { assigned[b--] = old[a]; used.add(old[a--]); }
  // Ordered exact anchors prevent deleted paragraphs donating style to a new
  // paragraph on the other side of an unchanged paragraph.
  const n = Math.max(0, a - prefix + 1), m = Math.max(0, b - prefix + 1);
  const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    lengths[i][j] = old[prefix + i].text === parts[prefix + j] ? 1 + lengths[i + 1][j + 1] : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (old[prefix + i].text === parts[prefix + j]) { assigned[prefix + j] = old[prefix + i]; used.add(old[prefix + i]); i++; j++; }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  }
  const anchors = [[-1, -1], ...assigned.flatMap((r, index) => r ? [[old.indexOf(r), index]] : []), [old.length, parts.length]];
  for (let k = 1; k < anchors.length; k++) {
    const [oldStart, newStart] = anchors[k - 1], [oldEnd, newEnd] = anchors[k];
    const count = Math.min(oldEnd - oldStart - 1, newEnd - newStart - 1);
    for (let offset = 1; offset <= count; offset++) {
      assigned[newStart + offset] = old[oldStart + offset]; used.add(old[oldStart + offset]);
    }
  }
  const added = [], overflow = [...reconciliation.overflow];
  for (let i = 0; i < parts.length; i++) {
    let row = assigned[i];
    if (!row) {
      row = { id: uid('row'), role, text: parts[i], emphasis: [], from: screen || 1, until: null };
      if (materialize(project, page, row).overflow) overflow.push(row.elementId); added.push(row.id);
    }
    if (row.text !== parts[i]) { row.text = parts[i]; row.emphasis = []; }
    const element = flat(page.elements).find(e => e.id === row.elementId);
    const textChanged = element.text !== parts[i];
    element.text = parts[i];
    if (textChanged && element.documentDraft) {
      const style = defaultStyle(row.role);
      if (Object.entries(style).every(([k, v]) => element[k] === v)) {
        element.height = boxHeight(element.text, element.fontSize, element.width);
        const position = findPlacement(project, page, element.width, element.height, element.id);
        element.x = position.x; element.y = position.y;
        if (position.overflow) overflow.push(element.id);
      } else delete element.documentDraft;
    }
    assigned[i] = row; used.add(row);
  }
  const deleted = old.filter(r => !used.has(r));
  for (const r of deleted) removeElement(page.elements, r.elementId);
  const visible = new Set(old), next = [], insert = page.outline.rows.findIndex(r => visible.has(r));
  for (let i = 0; i < page.outline.rows.length; i++) {
    if (i === insert) next.push(...assigned);
    if (!visible.has(page.outline.rows[i])) next.push(page.outline.rows[i]);
  }
  if (insert < 0) next.push(...assigned);
  page.outline.rows = next; baseline(page);
  return { changed: before !== signature(page), canvasChanged: beforeElements !== JSON.stringify(page.elements), rows: assigned, added, overflow, deleted: deleted.map(r => r.id) };
}

export function setDocumentRole(page, rowId, role, project) {
  if (!ROLES.includes(role)) throw Error('Invalid role');
  const row = page.outline.rows.find(r => r.id === rowId);
  if (!row || row.role === role) return false;
  const e = flat(page.elements).find(e => e.id === row.elementId), prior = defaultStyle(row.role);
  if (e?.documentDraft) {
    if (Object.entries(prior).every(([k, v]) => e[k] === v) && !e.stroke && !e.shadow && !e.effects && !e.letterSpacing && (!e.align || e.align === 'left')) {
      Object.assign(e, defaultStyle(role));
      e.height = boxHeight(e.text, e.fontSize, e.width);
      if (project) { const position = findPlacement(project, page, e.width, e.height, e.id); e.x = position.x; e.y = position.y; }
    } else delete e.documentDraft;
  }
  row.role = role; row.baseline = snapshot(row); return true;
}
export function setDocumentVisibility(page, rowId, screens) {
  const row = page.outline.rows.find(r => r.id === rowId);
  if (!row) return false;
  if (screens.some(s => !Number.isInteger(s) || s < 1 || s > page.outline.screens)) throw Error('Invalid screen');
  row.visibleOn = [...new Set(screens)].sort((a, b) => a - b);
  row.from = row.visibleOn[0] || 1; row.until = null; row.baseline = snapshot(row); return true;
}
export const addDocumentScreen = page => addScreen(page.outline);
export function deleteDocumentScreen(page, screen) {
  const o = page.outline, count = o.screens;
  if (!Number.isInteger(screen) || screen < 1 || screen > count) throw Error('Invalid screen');
  const nextCount = Math.max(1, count - 1);
  for (const row of [...o.rows, ...o.images]) {
    const previouslyVisible = Array.from({ length: count }, (_, i) => i + 1).filter(s => isVisible(row, s));
    let visible = previouslyVisible.filter(s => s !== screen).map(s => s > screen ? s - 1 : s);
    if (!visible.length && previouslyVisible.length) visible = [Math.min(screen, nextCount)];
    row.visibleOn = visible; row.from = visible[0] || 1; row.until = null;
    if (row.baseline) { row.baseline.from = row.from; row.baseline.until = null; row.baseline.visibleOn = [...visible]; }
  }
  o.screens = nextCount;
  return Math.min(screen, nextCount);
}
