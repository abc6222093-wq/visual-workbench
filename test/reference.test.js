import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { referenceText } from '../web/editor.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));

// 规格里的例子：autumn-deck 第 3 页 page_intro 选中 el_title
const autumn = () => ({
  id: 'autumn-deck',
  pages: [
    { id: 'page_cover', elements: [], steps: [] },
    { id: 'page_story', elements: [], steps: [] },
    { id: 'page_intro', elements: [{ id: 'el_title', type: 'text' }, { id: 'el_body', type: 'text' }], steps: [] },
  ],
});

test('例子格式逐字符一致', () => {
  assert.equal(
    referenceText(autumn(), { currentPageId: 'page_intro', selectedIds: ['el_title'] }),
    '项目 autumn-deck · 第 3 页（page_intro） · el_title',
  );
  assert.equal(
    referenceText(autumn(), { currentPageId: 'page_intro', selectedIds: ['el_title', 'el_body'] }),
    '项目 autumn-deck · 第 3 页（page_intro） · el_title、el_body',
  );
});

test('多页勾选按项目页序排列，每页一行', () => {
  assert.equal(
    referenceText(SAMPLE, { checkedPageIds: ['page_clip3', 'page_cover1'], currentPageId: 'page_scene2' }),
    '项目 sample-deck · 第 1 页（page_cover1）\n项目 sample-deck · 第 3 页（page_clip3）',
  );
});

test('选中元素并入当前页那一行；当前页未勾选时单独一行并按页序插入', () => {
  assert.equal(
    referenceText(SAMPLE, { checkedPageIds: ['page_scene2', 'page_cover1'], currentPageId: 'page_scene2', selectedIds: ['el_photo2', 'el_card2a'] }),
    '项目 sample-deck · 第 1 页（page_cover1）\n项目 sample-deck · 第 2 页（page_scene2） · el_photo2、el_card2a',
  );
  assert.equal(
    referenceText(SAMPLE, { checkedPageIds: ['page_cover1', 'page_clip3'], currentPageId: 'page_scene2', selectedIds: ['el_marker2'] }),
    '项目 sample-deck · 第 1 页（page_cover1）\n项目 sample-deck · 第 2 页（page_scene2） · el_marker2\n项目 sample-deck · 第 3 页（page_clip3）',
  );
});

test('分组里的子元素能找到', () => {
  assert.equal(
    referenceText(SAMPLE, { currentPageId: 'page_clip3', selectedIds: ['el_gtri3', 'el_group3'] }),
    '项目 sample-deck · 第 3 页（page_clip3） · el_gtri3、el_group3',
  );
});

test('不存在的元素（含别的页的元素）被忽略', () => {
  assert.equal(
    referenceText(SAMPLE, { currentPageId: 'page_clip3', selectedIds: ['el_nope', 'el_title1', 'el_pending3'] }),
    '项目 sample-deck · 第 3 页（page_clip3） · el_pending3',
  );
  // 全部无效：只剩当前页一行，不带元素
  assert.equal(
    referenceText(SAMPLE, { currentPageId: 'page_clip3', selectedIds: ['el_nope'] }),
    '项目 sample-deck · 第 3 页（page_clip3）',
  );
  // 勾选了页面但选中的元素都无效：不额外加当前页
  assert.equal(
    referenceText(SAMPLE, { checkedPageIds: ['page_cover1'], currentPageId: 'page_clip3', selectedIds: ['el_nope'] }),
    '项目 sample-deck · 第 1 页（page_cover1）',
  );
});

test('什么都没选只输出当前页；当前页无效时用第 1 页', () => {
  assert.equal(referenceText(SAMPLE, { currentPageId: 'page_scene2' }), '项目 sample-deck · 第 2 页（page_scene2）');
  assert.equal(referenceText(SAMPLE, { currentPageId: 'page_missing' }), '项目 sample-deck · 第 1 页（page_cover1）');
  assert.equal(referenceText(SAMPLE), '项目 sample-deck · 第 1 页（page_cover1）');
});
