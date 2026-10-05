// 第 13 轮 · 草稿分页的纯逻辑（web/draft-model.js）：带记号的文案、普通文字、HTML 往返。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftText, draftPageHtml, blocksFromDraftHtml, isDraftHtml, DRAFT_LEVELS, pageNameFromHeading, normalizeBlocks } from '../web/draft-model.js';

const SAMPLE = `# 小论文写作（二）大纲与思维导图 ｜ PPT 文案

共 15 页。每页标注「核心信息」「辅助信息」，需要做动效的页面另标【动效】。

---

## Page 1 ｜ 封面

【核心信息】
页眉：千美艺术指导学院　　2026.10
大标题：小论文
副标题：小论文写作（二）　大纲与思维导图
说明：动笔之前，先把要写的内容整理好，避免跑题
页脚：SENBI ART

---

## Page 2 ｜ 今天的流程

【核心信息】
上次学的固定段和例子库，是提前为「所有题目」准备的。
……

STEP 1　拆题　　　　看清题目在问什么
STEP 2　思维导图　　把能想到的全部写出来
> 引用一句话

【动效】
六步做成流程图，依次出现；时间分配在流程图下方，分三段对应出现

【辅助信息】
时间分配是建议值，可以按学生情况调整。
`;

test('带记号的文案：项目名、说明、按 --- / ## Page 分页，前缀变层级，【辅助信息】【动效】进备注', () => {
  const r = parseDraftText(SAMPLE);
  assert.equal(r.method, 'marked');
  assert.equal(r.name, '小论文写作（二）大纲与思维导图 ｜ PPT 文案');
  assert.match(r.description, /共 15 页/);
  assert.equal(r.pages.length, 2);
  const [p1, p2] = r.pages;
  assert.equal(p1.name, '封面');
  assert.deepEqual(p1.blocks, [
    { level: 'header', text: '千美艺术指导学院　　2026.10' },
    { level: 'title', text: '小论文' },
    { level: 'subtitle', text: '小论文写作（二）　大纲与思维导图' },
    { level: 'note', text: '动笔之前，先把要写的内容整理好，避免跑题' },
    { level: 'footer', text: 'SENBI ART' },
  ]);
  assert.equal(p1.notes, '');
  assert.equal(p2.name, '今天的流程');
  assert.deepEqual(p2.blocks.map(b => b.level), ['body', 'body', 'body', 'body', 'body', 'quote']);
  assert.equal(p2.blocks[0].text, '上次学的固定段和例子库，是提前为「所有题目」准备的。');
  assert.equal(p2.blocks[2].text, '', '空行原样保留');
  assert.equal(p2.blocks[3].text, 'STEP 1　拆题　　　　看清题目在问什么', '全角空格对齐原样保留');
  assert.equal(p2.blocks[5].text, '引用一句话');
  assert.equal(p2.notes, '【动效】\n六步做成流程图，依次出现；时间分配在流程图下方，分三段对应出现\n\n【辅助信息】\n时间分配是建议值，可以按学生情况调整。');
  assert.match(r.note, /分成 2 页/);
});

test('页名：Page N ｜ 名、只有名、只有 Page N', () => {
  assert.equal(pageNameFromHeading('Page 1 ｜ 封面', 0), '封面');
  assert.equal(pageNameFromHeading('封面', 0), '封面');
  assert.equal(pageNameFromHeading('Page 3', 2), '第 3 页');
  assert.equal(pageNameFromHeading('第2页：流程', 1), '流程');
  assert.equal(pageNameFromHeading('', 4), '第 5 页');
});

test('没有【核心信息】记号的页：全部行上页面；只有 ## 没有 --- 也能分页；没有 # 时项目名为空', () => {
  const r = parseDraftText('## 一\n甲\n乙\n## 二\n丙');
  assert.equal(r.name, '');
  assert.deepEqual(r.pages.map(p => [p.name, p.blocks.map(b => b.text)]), [['一', ['甲', '乙']], ['二', ['丙']]]);
});

test('普通文字：按空行分段、按字数保底分页，并说明怎么分的', () => {
  const para = (ch, n) => ch.repeat(n);
  const text = `${para('甲', 100)}\n\n${para('乙', 100)}\n\n${para('丙', 100)}\n\n${para('丁', 30)}`;
  const r = parseDraftText(text, { charsPerPage: 240 });
  assert.equal(r.method, 'plain');
  assert.equal(r.pages.length, 2, '100+100 在第 1 页，第 3 段超过 240 换页，第 4 段跟着');
  assert.deepEqual(r.pages[0].blocks.map(b => b.text.length), [100, 0, 100], '段落之间留一个空块');
  assert.equal(r.pages[0].name, '第 1 页');
  assert.equal(r.name, para('甲', 40));
  assert.match(r.note, /按空行分段，每页约 240 字，共分成 2 页/);
  assert.equal(parseDraftText('   ').pages.length, 0);
});

test('草稿页 HTML：白底朴素、每块 <p data-vw-level>、换行成 <br>、meta 标记；解析回块与原来一致；块清理', () => {
  const blocks = [{ level: 'title', text: '小论文' }, { level: 'body', text: '第一行\n第二行 <b>不是标签</b>' }, { level: 'body', text: '' }, { level: 'quote', text: '　全角缩进 & 符号' }];
  const html = draftPageHtml({ name: '封面', blocks, artboard: { width: 1920, height: 1080 } });
  assert.ok(isDraftHtml(html));
  assert.match(html, /<main data-vw-draft>/);
  assert.match(html, /<p data-vw-level="title">小论文<\/p>/);
  assert.match(html, /第一行<br>第二行 &lt;b&gt;不是标签&lt;\/b&gt;<\/p>/);
  assert.match(html, /white-space:pre-wrap/);
  assert.doesNotMatch(html, /data-vw=/, '草稿页不标修改单能力');
  assert.deepEqual(blocksFromDraftHtml(html), blocks);
  assert.equal(isDraftHtml('<!doctype html><html><body>x</body></html>'), false);
  // 画板高度不同字号跟着缩放
  const small = draftPageHtml({ blocks, artboard: { width: 960, height: 540 } });
  assert.match(small, /font-size:36px;font-weight:700/, '大标题 72px 在 540 高的画板上是 36px');
  assert.deepEqual(normalizeBlocks([{ level: 'nope', text: 1 }, { level: 'note', text: 'a\r\nb' }]), [{ level: 'body', text: '1' }, { level: 'note', text: 'a\nb' }]);
  assert.throws(() => normalizeBlocks('x'), /数组/);
  assert.equal(DRAFT_LEVELS.length, 8);
});
