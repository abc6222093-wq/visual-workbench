import { updateElementNode } from './render.js';

const clone = value => structuredClone(value);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const FILTER_DEFAULTS = { grayscale: 0, sepia: 0, blur: 0, brightness: 1, contrast: 1, saturate: 1 };
function cubicBezier(x1, y1, x2, y2) {
  const sample = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  return progress => {
    if (progress === 0 || progress === 1) return progress;
    let low = 0, high = 1;
    for (let i = 0; i < 24; i++) {
      const midpoint = (low + high) / 2;
      if (sample(midpoint, x1, x2) < progress) low = midpoint;
      else high = midpoint;
    }
    return sample((low + high) / 2, y1, y2);
  };
}
const EASINGS = {
  linear: t => t,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1)
};

function allElements(elements, map = new Map()) {
  for (const element of elements) {
    map.set(element.id, element);
    if (element.children) allElements(element.children, map);
  }
  return map;
}

export function initialPlaybackState(page) {
  const elements = clone(page.elements);
  const map = allElements(elements);
  const seen = new Set();
  for (const step of page.steps || []) for (const track of step.tracks) {
    if (!track.change.appear && !track.change.disappear) continue;
    if (!seen.has(track.target)) {
      seen.add(track.target);
      if (track.change.appear && map.has(track.target)) {
        map.get(track.target).visible = false;
        map.get(track.target).playbackVisibility = 0;
      }
    }
  }
  return { elements, nextStep: 0 };
}

export function stepDuration(step) {
  return (step.delay || 0) + Math.max(0, ...step.tracks.map(track => (track.delay || 0) + (track.duration ?? 400)));
}

function mixNumber(a, b, t) { return a + (b - a) * t; }
function mixColor(from, to, t) {
  if (t === 0) return from;
  if (t === 1) return to;
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(from || '') || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(to || '')) return t < 1 ? from : to;
  const channels = from.length === 9 || to.length === 9 ? [1, 3, 5, 7] : [1, 3, 5];
  return '#' + channels.map(i => Math.round(mixNumber(parseInt(from.slice(i, i + 2) || 'ff', 16), parseInt(to.slice(i, i + 2) || 'ff', 16), t)).toString(16).padStart(2, '0')).join('');
}
function polygonAt(points, fraction) {
  const lengths = points.map((point, i) => Math.hypot(points[(i + 1) % points.length][0] - point[0], points[(i + 1) % points.length][1] - point[1]));
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  if (!perimeter) return points[0];
  let distance = fraction * perimeter;
  for (let i = 0; i < points.length; i++) {
    if (distance <= lengths[i] || i === points.length - 1) {
      const ratio = lengths[i] ? distance / lengths[i] : 0;
      return points[i].map((value, axis) => mixNumber(value, points[(i + 1) % points.length][axis], ratio));
    }
    distance -= lengths[i];
  }
  return points[0];
}
function mixClip(from, to, t) {
  if (!from || !to || from.type !== to.type) return t < 1 ? from : to;
  if (t === 0) return from;
  if (t === 1) return to;
  if (from.points.length === to.points.length) return { type: to.type, points: from.points.map((point, i) => point.map((n, axis) => mixNumber(n, to.points[i][axis], t))) };
  const count = Math.max(from.points.length, to.points.length) * 4;
  return { type: to.type, points: Array.from({ length: count }, (_, i) => {
    const a = polygonAt(from.points, i / count);
    const b = polygonAt(to.points, i / count);
    return a.map((value, axis) => mixNumber(value, b[axis], t));
  }) };
}
function maskOpacity(stops, offset) {
  if (offset <= stops[0].offset) return stops[0].opacity;
  for (let i = 1; i < stops.length; i++) {
    if (offset <= stops[i].offset) {
      const left = stops[i - 1], right = stops[i];
      return mixNumber(left.opacity, right.opacity, (offset - left.offset) / (right.offset - left.offset || 1));
    }
  }
  return stops[stops.length - 1].opacity;
}
function mixMask(from, to, t) {
  if (t === 0) return from;
  if (t === 1) return to;
  if (from && to && from.type !== to.type) return from;
  if (!from && !to) return null;
  const reference = from || to;
  from ||= { type: reference.type, angle: reference.angle, stops: [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }] };
  to ||= { type: reference.type, angle: reference.angle, stops: [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 1 }] };
  const offsets = [...new Set([...from.stops, ...to.stops].map(stop => stop.offset))].sort((a, b) => a - b);
  return { type: to.type, angle: mixNumber(from.angle || 0, to.angle || 0, t), stops: offsets.map(offset => ({ offset, opacity: mixNumber(maskOpacity(from.stops, offset), maskOpacity(to.stops, offset), t) })) };
}

export function applyChange(start, change, progress = 1) {
  const t = clamp(progress, 0, 1);
  const element = clone(start);
  for (const key of ['x', 'y', 'width', 'height', 'rotation']) {
    if (change[key]) element[key] = (start[key] || 0) + change[key].by * t;
  }
  if (change.scale) {
    const factor = 1 + (change.scale.times - 1) * t;
    element.playbackScale = (start.playbackScale ?? 1) * factor;
  }
  if (change.opacity) element.opacity = clamp((start.opacity ?? 1) + change.opacity.by * t, 0, 1);
  if (change.appear) {
    element.visible = t > 0;
    element.playbackVisibility = t;
  }
  if (change.disappear) {
    element.playbackVisibility = 1 - t;
    element.visible = t < 1;
  }
  if (change.color) {
    if (element.type === 'text') element.color = mixColor(start.color, change.color.to, t);
    else if (element.type === 'shape') element.fill = mixColor(start.fill, change.color.to, t);
  }
  if (change.blend || change.filters || change.mask || change.clip) {
    element.effects ||= {};
    const startEffects = start.effects || {};
    if (change.blend) element.effects.blend = t < 1 ? startEffects.blend : change.blend.to;
    if (change.mask) element.effects.mask = mixMask(startEffects.mask, change.mask.to, t);
    if (change.clip) element.effects.clip = mixClip(startEffects.clip, change.clip.to, t);
    if (change.filters) {
      element.effects.filters ||= {};
      for (const [name, amount] of Object.entries(change.filters)) {
        const baseline = startEffects.filters?.[name] ?? FILTER_DEFAULTS[name] ?? 0;
        element.effects.filters[name] = baseline + amount.by * t;
      }
    }
  }
  return element;
}

export function advanceState(state, step, elapsed = stepDuration(step)) {
  const local = elapsed - (step.delay || 0);
  const tracks = step.tracks.map((track, index) => ({ track, index }))
    .sort((a, b) => (a.track.delay || 0) - (b.track.delay || 0) || a.index - b.index);
  const cache = new Map();
  function evaluate(time, limit = tracks.length) {
    const key = `${time}:${limit}`;
    if (cache.has(key)) return cache.get(key);
    const result = clone(state);
    const map = allElements(result.elements);
    for (let i = 0; i < limit; i++) {
      const track = tracks[i].track;
      const startTime = track.delay || 0;
      if (time < startTime) continue;
      const target = map.get(track.target);
      if (!target) continue;
      const baseline = allElements(evaluate(startTime, i).elements).get(track.target);
      const duration = track.duration ?? 400;
      const raw = duration === 0 ? 1 : clamp((time - startTime) / duration, 0, 1);
      const eased = (EASINGS[track.easing || 'ease-out'] || EASINGS.linear)(raw);
      const changed = applyChange(baseline, track.change, eased);
      for (const key of ['x', 'y', 'width', 'height', 'rotation', 'opacity']) if (track.change[key]) target[key] = changed[key];
      if (track.change.scale) target.playbackScale = changed.playbackScale;
      if (track.change.appear || track.change.disappear) {
        target.visible = changed.visible;
        target.playbackVisibility = changed.playbackVisibility;
      }
      if (track.change.color) {
        if (target.type === 'text') target.color = changed.color;
        if (target.type === 'shape') target.fill = changed.fill;
      }
      for (const key of ['blend', 'mask', 'clip']) if (track.change[key]) {
        target.effects ||= {};
        target.effects[key] = changed.effects[key];
      }
      if (track.change.filters) {
        target.effects ||= {};
        target.effects.filters ||= {};
        for (const key of Object.keys(track.change.filters)) target.effects.filters[key] = changed.effects.filters[key];
      }
    }
    cache.set(key, result);
    return result;
  }
  const next = local < 0 ? clone(state) : evaluate(local);
  if (elapsed >= stepDuration(step)) next.nextStep = state.nextStep + 1;
  return next;
}

export function createPlayback(project, page, { root, onRender, onComplete } = {}) {
  let state = initialPlaybackState(page);
  let frame = null;
  let playing = false;
  let destroyed = false;
  const steps = page.steps || [];
  function render() {
    if (root) for (const [id, element] of allElements(state.elements)) {
      const node = [...root.querySelectorAll('[data-element-id]')].find(item => item.dataset.elementId === id);
      if (node) updateElementNode(node, element);
    }
    onRender?.(state);
  }
  function runNext() {
    if (destroyed || playing || state.nextStep >= steps.length) return false;
    const step = steps[state.nextStep];
    playing = true;
    const startState = clone(state);
    const startTime = performance.now();
    function tick(now) {
      if (destroyed) return;
      const elapsed = Math.min(now - startTime, stepDuration(step));
      state = advanceState(startState, step, elapsed);
      render();
      if (elapsed < stepDuration(step)) frame = requestAnimationFrame(tick);
      else {
        frame = null; playing = false;
        if (state.nextStep < steps.length && steps[state.nextStep].trigger === 'auto') runNext();
        else if (state.nextStep >= steps.length) onComplete?.();
      }
    }
    frame = requestAnimationFrame(tick);
    return true;
  }
  render();
  return {
    start() { if (steps[state.nextStep]?.trigger === 'auto') return runNext(); return false; },
    next() { return runNext(); },
    reset() { if (frame != null) cancelAnimationFrame(frame); frame = null; playing = false; state = initialPlaybackState(page); render(); this.start(); },
    destroy() { destroyed = true; if (frame != null) cancelAnimationFrame(frame); },
    getState() { return clone(state); },
    isPlaying() { return playing; }
  };
}
