import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleElements, scaleElement, scaleStyle, resizeGroup } from '../web/editor.js';
import { wordRange, paragraphRange } from '../web/text-edit.js';

// 第 11 轮 A5 / 0e：整体等比缩放的纯函数
const text = { id: 'a', type: 'text', x: 100, y: 50, width: 200, height: 40, fontSize: 20, letterSpacing: 2, stroke: { color: '#000000', width: 3 }, shadow: { color: '#00000066', x: 2, y: 4, blur: 8 }, text: 'hi' };
const shape = { id: 'b', type: 'shape', shape: 'rect', x: 300, y: 150, width: 100, height: 50, cornerRadius: 10, fill: '#ffffff' };

test('scaleElements 以基准点等比缩放位置、尺寸和全部外观数值，不改传入的元素', () => {
  const frozen = structuredClone([text, shape]);
  const [t, s] = scaleElements([text, shape], 1.5, { x: 100, y: 50 });
  assert.deepEqual([text, shape], frozen);
  assert.deepEqual([t.x, t.y, t.width, t.height], [100, 50, 300, 60]);
  assert.equal(t.fontSize, 30); assert.equal(t.letterSpacing, 3);
  assert.deepEqual(t.stroke, { color: '#000000', width: 4.5 });
  assert.deepEqual(t.shadow, { color: '#00000066', x: 3, y: 6, blur: 12 });
  assert.deepEqual([s.x, s.y, s.width, s.height, s.cornerRadius], [400, 200, 150, 75, 15]);
  assert.equal(s.fill, '#ffffff');
});

test('scaleElements 以中心为基准时选区中心不动；缩小同样成比例，字号不小于 1', () => {
  const origin = { x: 250, y: 125 };
  const [t] = scaleElements([text], 0.5, origin);
  // 原中心 (200,70) → 250 + (200-250)*0.5 = 225, 125 + (70-125)*0.5 = 97.5
  assert.equal(t.x + t.width / 2, 225); assert.ok(Math.abs(t.y + t.height / 2 - 97.5) <= 0.5);
  assert.equal(t.fontSize, 10); assert.equal(t.stroke.width, 1.5);
  const [tiny] = scaleElements([{ ...text, fontSize: 1.5 }], 0.1, origin);
  assert.equal(tiny.fontSize, 1);
});

test('分组等比缩放：组内间距、子元素尺寸与字号、描边、投影、圆角一起变；拖边（无 factor）保持旧的单方向缩放', () => {
  const group = { id: 'g', type: 'group', x: 0, y: 0, width: 400, height: 200, children: [{ ...text, x: 0, y: 0 }, { ...shape, x: 300, y: 150 }] };
  const next = structuredClone(group);
  resizeGroup(next, group, 800, 400, 2);
  assert.deepEqual([next.width, next.height], [800, 400]);
  assert.deepEqual([next.children[1].x, next.children[1].y, next.children[1].width, next.children[1].cornerRadius], [600, 300, 200, 20]);
  assert.equal(next.children[0].fontSize, 40); assert.equal(next.children[0].shadow.blur, 16); assert.equal(next.children[0].stroke.width, 6);
  const edge = structuredClone(group);
  resizeGroup(edge, group, 800, 200);
  assert.deepEqual([edge.children[1].x, edge.children[1].y, edge.children[1].width, edge.children[1].height], [600, 150, 200, 50]);
});

test('scaleElement / scaleStyle 只缩放存在的外观属性，没有描边、投影时不凭空加上', () => {
  const plain = { type: 'text', x: 5, y: 6, width: 10, height: 10, fontSize: 10, stroke: null, shadow: null };
  const next = structuredClone(plain);
  scaleElement(next, plain, 2);
  assert.equal(next.stroke, null); assert.equal(next.shadow, null); assert.equal(next.x, 5); assert.equal(next.fontSize, 20);
  const img = { type: 'image', width: 10, height: 10 }, out = {};
  scaleStyle(out, img, 3); assert.deepEqual(out, {});
});

test('双击选词、三击选段的范围计算', () => {
  assert.deepEqual(wordRange('hello brave world', 7), [6, 11]);
  assert.deepEqual(wordRange('hello brave world', 11), [6, 11]); // 落在词尾
  assert.deepEqual(paragraphRange('第一段\n第二段文字\n三', 6), [4, 9]);
  assert.deepEqual(paragraphRange('only', 2), [0, 4]);
  const [s, e] = wordRange('今天天气很好', 1);
  assert.ok(s <= 1 && e > 1 && e - s < 6, '中文按词分，不会整句选中');
});
