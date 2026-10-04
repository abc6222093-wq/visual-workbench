import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerAngle, normalizeAngle, rotateFromPointer } from '../web/rotate-tool.js';
import { createHistory } from '../web/editor.js';

test('rotation handle math: up is 0°, clockwise positive, normalized', () => {
  const c = { x: 100, y: 100 };
  assert.equal(pointerAngle(c, { x: 100, y: 0 }), 0);
  assert.equal(pointerAngle(c, { x: 200, y: 100 }), 90);
  assert.equal(Math.abs(pointerAngle(c, { x: 100, y: 200 })), 180);
  assert.equal(pointerAngle(c, { x: 0, y: 100 }), -90);
  assert.equal(normalizeAngle(270), -90);
  assert.equal(normalizeAngle(-180), 180);
  assert.equal(normalizeAngle(720), 0);
});

test('rotation snaps near multiples of 45° unless disabled', () => {
  const center = { x: 0, y: 0 }, from = { x: 0, y: -100 };
  const at = deg => ({ x: Math.sin(deg * Math.PI / 180) * 100, y: -Math.cos(deg * Math.PI / 180) * 100 });
  assert.deepEqual(rotateFromPointer({ start: 0, center, from, to: at(43) }), { rotation: 45, snapped: true });
  assert.deepEqual(rotateFromPointer({ start: 0, center, from, to: at(30) }), { rotation: 30, snapped: false });
  assert.deepEqual(rotateFromPointer({ start: 10, center, from, to: at(78) }), { rotation: 90, snapped: true });
  assert.equal(rotateFromPointer({ start: 0, center, from, to: at(43), disabled: true }).snapped, false);
  assert.equal(rotateFromPointer({ start: 170, center, from, to: at(20) }).rotation, -170);
});

test('history amend merges continuous typing into the latest undo step', () => {
  const h = createHistory({ text: '' });
  h.commit({ text: 'a' }); h.amend({ text: 'ab' }); h.amend({ text: 'abc' });
  assert.deepEqual(h.value, { text: 'abc' });
  assert.deepEqual(h.undo(), { text: '' });
  assert.equal(h.canUndo, false);
  assert.deepEqual(h.redo(), { text: 'abc' });
});
