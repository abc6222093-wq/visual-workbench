import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProjectData } from '../src/validate.js';
import { WEB_DEVICES, pageSize, pageViewport, projectKind, webPageDefaults } from '../web/project-kinds.js';

const sample = () => JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));
const codes = (r) => r.errors.map((e) => e.code);
function webProject() {
  const p = sample();
  p.kind = 'web'; p.artboard = { preset: 'web-desktop', width: 1440, height: 900 };
  p.pages = [
    { id: 'page_home_desk', name: '首页 · 电脑端', background: '#ffffff', elements: [], device: 'desktop', size: { width: 1440, height: 3200 }, origin: { url: 'http://127.0.0.1:1/', capturedAt: '2026-10-04T00:00:00.000Z' } },
    { id: 'page_home_mob', name: '首页 · 手机端', background: '#ffffff', elements: [{ id: 'el_btn_a', type: 'shape', shape: 'rect', fill: '#000000', x: 0, y: 0, width: 100, height: 40, zIndex: 1, origin: { selector: 'main > a.btn', tag: 'a', text: '了解更多' } }], device: 'mobile', size: { width: 390, height: 5000 } },
  ];
  return p;
}

test('课件项目不写 kind 照常通过；课件页面不能带 device / size', () => {
  assert.equal(validateProjectData(sample()).ok, true);
  const p = sample(); p.pages[0].device = 'desktop'; p.pages[0].size = { width: 1920, height: 1080 };
  assert.ok(codes(validateProjectData(p)).includes('WEB_PAGE_DEVICE'));
});
test('网页项目：每页 device + size，宽度必须等于设备宽度', () => {
  assert.deepEqual(validateProjectData(webProject()).errors, []);
  const missing = webProject(); delete missing.pages[0].size;
  assert.ok(codes(validateProjectData(missing)).includes('WEB_PAGE_DEVICE'));
  const wrong = webProject(); wrong.pages[1].size.width = 400;
  assert.ok(codes(validateProjectData(wrong)).includes('WEB_PAGE_SIZE'));
});
test('元素 origin 需要 selector；variantOf 必须指向存在的页面 / 元素', () => {
  const bad = webProject(); bad.pages[1].elements[0].origin = { tag: 'a' };
  assert.ok(codes(validateProjectData(bad)).includes('SCHEMA'));
  const v = webProject(); v.pages[1].variantOf = 'page_home_desk'; v.pages[1].elements[0].variantOf = 'el_btn_a';
  assert.ok(codes(validateProjectData(v)).includes('VARIANT_REF')); // 自己指向自己不算
  v.pages[1].elements.push({ ...v.pages[1].elements[0], id: 'el_btn_b', variantOf: 'el_btn_a' }); delete v.pages[1].elements[0].variantOf;
  assert.deepEqual(validateProjectData(v).errors, []);
  v.pages[1].variantOf = 'page_nope';
  assert.ok(codes(validateProjectData(v)).includes('VARIANT_REF'));
});
test('project-kinds：页面尺寸与窗口', () => {
  const p = webProject();
  assert.equal(projectKind(sample()), 'deck'); assert.equal(projectKind(p), 'web');
  assert.deepEqual(pageSize(p, p.pages[1]), { width: 390, height: 5000 });
  assert.deepEqual(pageViewport(p, p.pages[1]), { width: 390, height: 844 });
  assert.deepEqual(pageViewport(sample(), sample().pages[0]), { width: 1920, height: 1080 });
  assert.deepEqual(webPageDefaults('mobile', 1234.4), { device: 'mobile', size: { width: WEB_DEVICES.mobile.width, height: 1234 } });
});
