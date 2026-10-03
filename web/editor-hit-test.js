import { editable, findElement } from './editor.js';

// Motion may disable native pointer events. Keep editing hit tests independent of
// that setting, while respecting the actual painted visibility of each ancestor.
function visible(node, board, page, screen) {
  const id = node.closest('[data-element-id]')?.dataset.elementId;
  const found = id && findElement(page, id);
  if (found && [found.element, ...found.ancestors].some(e => e.visible === false)) return false;
  const ownVisibility = getComputedStyle(node).visibility;
  if (ownVisibility === 'hidden' || ownVisibility === 'collapse') return false;
  for (let parent = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || (screen && Number(style.opacity) === 0)) return false;
    if (parent === board) return true;
  }
  return false;
}

function insidePolygon(points, x, y) {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 0.001) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return false;
    sign = next;
  }
  return sign !== 0;
}

function containsPoint(node, x, y) {
  if (typeof node.getBoxQuads === 'function') {
    try {
      return node.getBoxQuads().some(q => insidePolygon([q.p1, q.p2, q.p3, q.p4], x, y));
    } catch { /* Chromium uses the affine fallback below. */ }
  }
  const rect = node.getBoundingClientRect();
  if (!rect.width || !rect.height || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
  // Recover the transformed quadrilateral from its linear transform and bounding
  // rectangle. Layout offsets and transform origins only translate these corners;
  // aligning their minima with the measured rect accounts for both exactly in 2D.
  let matrix = new DOMMatrix();
  for (let parent = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    let local = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
    if (!local.is2D) return false; // Avoid falsely selecting a perspective bbox corner.
    if (style.rotate && style.rotate !== 'none') {
      const angle = parseFloat(style.rotate);
      if (Number.isFinite(angle)) local = new DOMMatrix().rotate(angle).multiply(local);
    }
    if (style.scale && style.scale !== 'none') {
      const scales = style.scale.split(/\s+/).map(Number);
      local = new DOMMatrix().scale(scales[0], scales[1] ?? scales[0]).multiply(local);
    }
    matrix = local.multiply(matrix);
  }
  const width = node.offsetWidth, height = node.offsetHeight;
  const points = [[0, 0], [width, 0], [width, height], [0, height]].map(([px, py]) => ({ x: matrix.a * px + matrix.c * py, y: matrix.b * px + matrix.d * py }));
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  return insidePolygon(points.map(p => ({ x: p.x + rect.left - minX, y: p.y + rect.top - minY })), x, y);
}

function stackingPath(node, board) {
  const path = [];
  for (let parent = node; parent && parent !== board; parent = parent.parentElement) {
    const z = Number.parseFloat(getComputedStyle(parent).zIndex) || 0;
    const siblings = parent.parentElement ? [...parent.parentElement.children] : [];
    path.unshift([z, siblings.indexOf(parent)]);
  }
  return path;
}
function frontFirst(a, b, board) {
  const ap = stackingPath(a, board), bp = stackingPath(b, board);
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    const delta = bp[i][0] - ap[i][0] || bp[i][1] - ap[i][1];
    if (delta) return delta;
  }
  return bp.length - ap.length;
}

export function pickCanvasElement({ board, page, selected = [], screen, event }) {
  const x = event.clientX, y = event.clientY;
  const native = document.elementsFromPoint(x, y).filter(node => board.contains(node));
  const handles = [...board.querySelectorAll('[data-resize]')];
  if (!event.shiftKey) {
    const handle = handles.filter(node => selected.includes(node.dataset.resize) && editable(page, node.dataset.resize) && visible(node, board, page, screen) && containsPoint(node, x, y)).sort((a, b) => frontFirst(a, b, board))[0];
    if (handle) return { id: handle.dataset.resize, resize: handle.dataset.handle };
  }
  const hits = [];
  const add = node => {
    const owner = node.closest('[data-element-id]'), id = owner?.dataset.elementId;
    if (!id || hits.includes(id) || !editable(page, id) || !visible(owner, board, page, screen)) return;
    hits.push(id);
  };
  native.forEach(add);
  const fallback = (screen ? [...board.querySelectorAll('[data-element-id]')] : []).filter(node => visible(node, board, page, screen) && containsPoint(node, x, y)).sort((a, b) => frontFirst(a, b, board));
  fallback.forEach(add);
  if (!event.shiftKey) {
    const chosen = hits.find(id => selected.includes(id));
    if (chosen) return { id: chosen, resize: false };
  }
  return { id: hits[0] || null, resize: false };
}
