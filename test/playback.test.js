import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPlaybackState, applyChange, stepDuration, advanceState, createPlayback } from '../web/playback.js';

test('color transitions preserve alpha and reach the exact target', () => {
  const base = { type: 'text', color: '#000000' };
  assert.equal(applyChange(base, { color: { to: '#ffffff00' } }, 0.5).color, '#80808080');
  assert.equal(applyChange(base, { color: { to: '#ffffff00' } }).color, '#ffffff00');
  assert.equal(applyChange({ type: 'shape', fill: '#00000000' }, { color: { to: '#ffffff' } }).fill, '#ffffff');
});

test('named easing matches CSS cubic bezier progress', () => {
  const state = { elements: [{ id: 'a', x: 0 }], nextStep: 0 };
  const step = { tracks: [{ target: 'a', duration: 1000, easing: 'ease', change: { x: { by: 100 } } }] };
  assert.ok(Math.abs(advanceState(state, step, 500).elements[0].x - 80.2403) < 0.001);
});

const page = {
  elements: [{ id: 'el_one', type: 'shape', shape: 'rect', x: 100, y: 50, width: 200, height: 100, opacity: 0.8, fill: '#000000', effects: { filters: { grayscale: 0.2 } } }],
  steps: [
    { trigger: 'click', delay: 100, tracks: [{ target: 'el_one', delay: 50, duration: 400, easing: 'linear', change: { appear: true, x: { by: 40 }, scale: { times: 0.5 }, color: { to: '#ffffff' }, filters: { grayscale: { by: 0.5 } } } }] },
    { trigger: 'auto', tracks: [{ target: 'el_one', duration: 0, change: { y: { by: 25 }, disappear: true } }] }
  ]
};

test('initial visibility follows first visibility change', () => {
  const initial = initialPlaybackState(page);
  assert.equal(initial.elements[0].visible, false);
  assert.equal(initial.elements[0].x, 100);
  assert.equal(page.elements[0].visible, undefined);
});

test('step timing includes step delay and latest track', () => {
  assert.equal(stepDuration(page.steps[0]), 550);
});

test('relative geometry scales around the current center and accumulates', () => {
  const initial = initialPlaybackState(page);
  const first = advanceState(initial, page.steps[0], 550);
  assert.equal(first.elements[0].x, 140);
  assert.equal(first.elements[0].width, 200);
  assert.equal(first.elements[0].height, 100);
  assert.equal(first.elements[0].y, 50);
  assert.equal(first.elements[0].playbackScale, 0.5);
  assert.equal(first.elements[0].visible, true);
  assert.equal(first.elements[0].fill, '#ffffff');
  assert.equal(first.elements[0].effects.filters.grayscale, 0.7);
  const second = advanceState(first, page.steps[1], 0);
  assert.equal(second.elements[0].y, 75);
  assert.equal(second.elements[0].visible, false);
  assert.equal(second.nextStep, 2);
});

test('track delays hold initial state and interpolation stays relative', () => {
  const initial = initialPlaybackState(page);
  assert.equal(advanceState(initial, page.steps[0], 149).elements[0].x, 100);
  const midway = advanceState(initial, page.steps[0], 350).elements[0];
  assert.equal(midway.x, 120);
  assert.equal(midway.width, 200);
  assert.equal(midway.playbackScale, 0.75);
  assert.equal(midway.playbackVisibility, 0.5);
});

test('effects switch at end unless compatible geometry allows interpolation', () => {
  const base = { id: 'el_one', type: 'image', x: 0, y: 0, width: 100, height: 100, effects: { blend: 'normal', clip: { type: 'polygon', points: [[0, 0], [100, 0], [50, 100]] } } };
  const half = applyChange(base, { blend: { to: 'multiply' }, clip: { to: { type: 'polygon', points: [[0, 0], [50, 0], [50, 50]] } } }, 0.5);
  assert.equal(half.effects.blend, 'normal');
  assert.deepEqual(half.effects.clip.points[1], [75, 0]);
  assert.equal(applyChange(base, { blend: { to: 'multiply' } }, 1).effects.blend, 'multiply');
});

test('first visibility change controls initial hiding even after geometry tracks', () => {
  const sample = { elements: [{ id: 'a', x: 0 }], steps: [{ tracks: [{ target: 'a', change: { x: { by: 1 } } }, { target: 'a', change: { appear: true } }] }] };
  assert.equal(initialPlaybackState(sample).elements[0].visible, false);
});

test('disappear then appear restores base opacity', () => {
  const base = { opacity: 0.6, playbackVisibility: 1 };
  const gone = applyChange(base, { disappear: true }, 1);
  assert.equal(gone.playbackVisibility, 0);
  const returned = applyChange(gone, { appear: true }, 1);
  assert.equal(returned.playbackVisibility, 1);
  assert.equal(returned.opacity, 0.6);
});

test('multiple tracks on the same target combine changes', () => {
  const sample = { elements: [{ id: 'a', x: 10, y: 10 }], steps: [{ tracks: [{ target: 'a', duration: 0, change: { x: { by: 20 } } }, { target: 'a', duration: 0, change: { y: { by: 30 } } }] }] };
  const result = advanceState(initialPlaybackState(sample), sample.steps[0], 0);
  assert.equal(result.elements[0].x, 30);
  assert.equal(result.elements[0].y, 40);
});

test('clip morph interpolates polygons with different point counts', () => {
  const from = { effects: { clip: { type: 'polygon', points: [[50,0],[100,50],[50,100],[0,50]] } } };
  const to = { type: 'polygon', points: [[25,0],[75,0],[100,50],[75,100],[25,100],[0,50]] };
  const half = applyChange(from, { clip: { to } }, 0.5).effects.clip;
  assert.equal(half.points.length, 24);
  assert.notDeepEqual(half, from.effects.clip);
  assert.deepEqual(applyChange(from, { clip: { to } }, 1).effects.clip, to);
});

test('step delay preserves the starting state, including visibility', () => {
  const initial = initialPlaybackState(page);
  assert.deepEqual(advanceState(initial, page.steps[0], 50).elements, initial.elements);
});

test('later same-target tracks start from the state at their own delay', () => {
  const sample = { elements: [{ id: 'a', x: 10, visible: true }], steps: [{ tracks: [
    { target: 'a', duration: 100, easing: 'linear', change: { x: { by: 100 }, disappear: true } },
    { target: 'a', delay: 50, duration: 100, easing: 'linear', change: { x: { by: 20 }, appear: true } }
  ] }] };
  const initial = initialPlaybackState(sample);
  assert.equal(advanceState(initial, sample.steps[0], 25).elements[0].playbackVisibility, 0.75);
  const later = advanceState(initial, sample.steps[0], 75).elements[0];
  assert.equal(later.x, 65);
  assert.equal(later.playbackVisibility, 0.25);
  assert.equal(advanceState(initial, sample.steps[0], 150).elements[0].x, 80);
});

test('mask gradients resample differing stops and fade from no mask', () => {
  const a = { effects: { mask: { type: 'linear', angle: 0, stops: [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }] } } };
  const b = { type: 'linear', angle: 90, stops: [{ offset: 0, opacity: 1 }, { offset: 0.5, opacity: 0.5 }, { offset: 1, opacity: 0 }] };
  const midway = applyChange(a, { mask: { to: b } }, 0.5).effects.mask;
  assert.equal(midway.stops.length, 3);
  assert.equal(midway.stops[1].opacity, 0.5);
  assert.equal(applyChange({}, { mask: { to: b } }, 0.5).effects.mask.stops[2].opacity, 0.5);
});

test('controller waits for clicks, chains auto steps, completes without page navigation, and cancels on destroy', () => {
  const oldNow = globalThis.performance;
  const oldRequest = globalThis.requestAnimationFrame;
  const oldCancel = globalThis.cancelAnimationFrame;
  let now = 0, sequence = 0;
  const frames = new Map();
  const cancelled = [];
  globalThis.performance = { now: () => now };
  globalThis.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => { cancelled.push(id); frames.delete(id); };
  const flush = time => { now = time; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); };
  try {
    const sequencePage = { elements: [{ id: 'a', x: 0 }], steps: [
      { trigger: 'auto', tracks: [{ target: 'a', duration: 10, easing: 'linear', change: { x: { by: 10 } } }] },
      { trigger: 'click', tracks: [{ target: 'a', duration: 10, easing: 'linear', change: { x: { by: 10 } } }] },
      { trigger: 'auto', tracks: [{ target: 'a', duration: 10, easing: 'linear', change: { x: { by: 10 } } }] }
    ] };
    let completes = 0;
    const playback = createPlayback({}, sequencePage, { onComplete: () => completes++ });
    assert.equal(playback.start(), true);
    assert.equal(playback.next(), false);
    flush(10);
    assert.equal(playback.getState().nextStep, 1);
    assert.equal(playback.isPlaying(), false);
    assert.equal(playback.start(), false);
    assert.equal(playback.next(), true);
    assert.equal(playback.next(), false);
    flush(20);
    assert.equal(playback.isPlaying(), true);
    flush(30);
    assert.equal(playback.getState().elements[0].x, 30);
    assert.equal(playback.getState().nextStep, 3);
    assert.equal(playback.next(), false);
    assert.equal(completes, 1);
    playback.reset();
    const pendingId = [...frames.keys()][0];
    playback.destroy();
    assert.ok(cancelled.includes(pendingId));
    assert.equal(playback.next(), false);
  } finally {
    globalThis.performance = oldNow;
    globalThis.requestAnimationFrame = oldRequest;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});
