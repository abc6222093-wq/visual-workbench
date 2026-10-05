// 第 13 轮：从文案新建（草稿分页）、草稿页操作（draft / draft-update / draft-split / draft-merge）、
// 「复制给 agent」三种 intent（批注、草稿块、拼进来的页、设计卡片）、跨项目复制写 origin。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';
import { validateProject } from '../src/validate.js';
import { blocksFromDraftHtml, isDraftHtml } from '../web/draft-model.js';
import { designCardText, agentBrief } from '../src/brief.js';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-r13d-'));
  const server = createServer({ dataDir: dir, port: 4173, watchPollMs: 100 });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise((done) => server.close(done)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { dir, request };
}
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pageOp = (request, id, revision, body) => request(`/api/projects/${id}/pages`, 'POST', { revision, ...body });

const DRAFT = `# 2026-10-05 水曜会话课表
这份文案是给老师看的说明。

## Page 1 ｜ 封面
【核心信息】
大标题：水曜会话
副标题：秋季课程
【辅助信息】
封面放一张教室照片
## Page 2 ｜ 今天的流程
【核心信息】
① 自我介绍
　② 分组练习
> 引用一句话
【动效】
逐条出现
`;

test('从文案新建：名称取 # 标题，说明进 description，每页 draft:true + notes + 草稿页文件；响应带 draft', async (t) => {
  const { dir, request } = await fixture(t);
  const r = await request('/api/projects', 'POST', { id: 'kebiao', draft: DRAFT, name: '备用名' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body.project;
  assert.equal(p.name, '2026-10-05 水曜会话课表');
  assert.match(p.description, /给老师看的说明/);
  assert.deepEqual(p.pages.map((x) => [x.name, x.draft]), [['封面', true], ['今天的流程', true]]);
  assert.match(p.pages[0].notes, /教室照片/);
  assert.match(p.pages[1].notes, /逐条出现/);
  assert.equal(r.body.draft.method, 'marked');
  assert.equal(r.body.draft.pages, 2);
  assert.equal(typeof r.body.draft.note, 'string');
  const html = readFileSync(join(dir, 'projects/kebiao', p.pages[0].file), 'utf8');
  assert.ok(isDraftHtml(html));
  assert.deepEqual(blocksFromDraftHtml(html), [{ level: 'title', text: '水曜会话' }, { level: 'subtitle', text: '秋季课程' }]);
  assert.deepEqual(blocksFromDraftHtml(readFileSync(join(dir, 'projects/kebiao', p.pages[1].file), 'utf8')).map((b) => b.text), ['① 自我介绍', '　② 分组练习', '引用一句话']);
  assert.equal(validateProject(join(dir, 'projects/kebiao')).ok, true);

  // 没有 # 标题用 name；都没有 400；空文案 400；不建文件夹
  const plain = await request('/api/projects', 'POST', { id: 'plain', draft: '第一段文字。\n\n第二段文字。', name: '普通文字' });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.draft.method, 'plain');
  const noName = await request('/api/projects', 'POST', { id: 'noname', draft: '## Page 1\n内容' });
  assert.equal(noName.status, 400);
  assert.equal(existsSync(join(dir, 'projects/noname')), false);
  assert.equal((await request('/api/projects', 'POST', { id: 'empty', draft: '   ', name: 'x' })).status, 400);
  assert.equal((await request('/api/projects', 'POST', { id: 'bad', draft: 3, name: 'x' })).status, 400);
  assert.equal(existsSync(join(dir, 'projects/empty')), false);
});

test('草稿页操作：插入文案、改写块、光标处分页、和下一页合并；不是草稿页 400', async (t) => {
  const { dir, request } = await fixture(t);
  const made = await request('/api/projects', 'POST', { id: 'dp', name: '草稿项目' });
  let rev = made.body.revision;
  const first = made.body.project.pages[0].id;
  const pdir = join(dir, 'projects/dp');

  const ins = await pageOp(request, 'dp', rev, { op: 'draft', text: '## Page 1 ｜ 甲\n甲的内容\n## Page 2 ｜ 乙\n乙的内容', after: first });
  assert.equal(ins.status, 200, JSON.stringify(ins.body));
  assert.equal(ins.body.draft.pages, 2);
  assert.equal(ins.body.pageIds.length, 2);
  assert.deepEqual(ins.body.project.pages.map((p) => p.name), ['第 1 页', '甲', '乙']);
  rev = ins.body.revision;
  const [a, b] = ins.body.pageIds;

  // 不是草稿页一律 400
  for (const op of ['draft-update', 'draft-split', 'draft-merge']) {
    const r = await pageOp(request, 'dp', rev, { op, pageId: first, blocks: [], blocksBefore: [], blocksAfter: [] });
    assert.equal(r.status, 400, op);
  }
  assert.equal((await pageOp(request, 'dp', rev, { op: 'draft-update', pageId: 'page_none', blocks: [] })).status, 400);
  assert.equal((await pageOp(request, 'dp', rev, { op: 'draft-update', pageId: a, blocks: 'x' })).status, 400);

  const up = await pageOp(request, 'dp', rev, { op: 'draft-update', pageId: a, blocks: [{ level: 'title', text: '新标题' }, { level: 'weird', text: '第一行\n第二行' }] });
  assert.equal(up.status, 200);
  rev = up.body.revision;
  assert.deepEqual(blocksFromDraftHtml(readFileSync(join(pdir, `pages/${a}.html`), 'utf8')), [{ level: 'title', text: '新标题' }, { level: 'body', text: '第一行\n第二行' }]);

  const split = await pageOp(request, 'dp', rev, { op: 'draft-split', pageId: a, blocksBefore: [{ level: 'title', text: '新标题' }], blocksAfter: [{ level: 'body', text: '第一行\n第二行' }] });
  assert.equal(split.status, 200);
  rev = split.body.revision;
  const c = split.body.pageIds[0];
  const pages = split.body.project.pages;
  assert.deepEqual(pages.map((p) => p.id), [first, a, c, b]);
  assert.equal(pages[2].name, '甲（续）');
  assert.equal(pages[2].draft, true);
  assert.equal(pages[2].notes, undefined);
  assert.deepEqual(blocksFromDraftHtml(readFileSync(join(pdir, `pages/${c}.html`), 'utf8')), [{ level: 'body', text: '第一行\n第二行' }]);

  // 合并：c 和下一页 b 合并（块接在后面、notes 拼接、删 b 的文件）；最后一页 / 下一页不是草稿 400
  const p0 = readJson(join(pdir, 'project.json'));
  p0.pages.find((p) => p.id === c).notes = '备注一';
  p0.pages.find((p) => p.id === b).notes = '备注二';
  writeFileSync(join(pdir, 'project.json'), JSON.stringify(p0, null, 2));
  rev = (await request('/api/projects/dp')).body.revision;
  const merge = await pageOp(request, 'dp', rev, { op: 'draft-merge', pageId: c });
  assert.equal(merge.status, 200, JSON.stringify(merge.body));
  rev = merge.body.revision;
  assert.deepEqual(merge.body.project.pages.map((p) => p.id), [first, a, c]);
  assert.equal(merge.body.project.pages[2].notes, '备注一\n\n备注二');
  assert.deepEqual(blocksFromDraftHtml(readFileSync(join(pdir, `pages/${c}.html`), 'utf8')).map((x) => x.text), ['第一行\n第二行', '乙的内容']);
  assert.equal(existsSync(join(pdir, `pages/${b}.html`)), false);
  assert.equal((await pageOp(request, 'dp', rev, { op: 'draft-merge', pageId: c })).status, 400);
  // 把 c 挪到 first 前面：下一页 first 不是草稿
  const p1 = readJson(join(pdir, 'project.json'));
  p1.pages = [p1.pages[2], p1.pages[0], p1.pages[1]];
  writeFileSync(join(pdir, 'project.json'), JSON.stringify(p1, null, 2));
  rev = (await request('/api/projects/dp')).body.revision;
  const notDraft = await pageOp(request, 'dp', rev, { op: 'draft-merge', pageId: c });
  assert.equal(notDraft.status, 400);
  assert.match(notDraft.body.error, /不是草稿页/);
  assert.equal(validateProject(pdir).ok, true);
  assert.equal((await pageOp(request, 'dp', 'stale', { op: 'draft-update', pageId: c, blocks: [] })).status, 409);
});

test('复制给 agent：design 列草稿块与 notes；unify 列拼进来的页和设计卡片；三种都列批注、提醒写 designCard；copy-from 跨项目写 origin', async (t) => {
  const { dir, request } = await fixture(t);
  const src = await request('/api/projects', 'POST', { id: 'yuan', name: '来源项目' });
  const dest = await request('/api/projects', 'POST', { id: 'mubiao', draft: DRAFT });
  const srcPage = src.body.project.pages[0].id;
  // 同项目复制不写 origin
  const dup = await pageOp(request, 'mubiao', dest.body.revision, { op: 'duplicate', pageIds: [dest.body.project.pages[0].id] });
  assert.equal(dup.body.project.pages[1].origin, undefined);
  const copy = await pageOp(request, 'mubiao', dup.body.revision, { op: 'copy-from', fromProject: 'yuan', pageIds: [srcPage] });
  assert.equal(copy.status, 200);
  const copied = copy.body.project.pages.find((p) => p.id === copy.body.pageIds[0]);
  assert.equal(copied.origin.project, 'yuan');
  assert.equal(copied.origin.page, srcPage);
  assert.ok(Date.parse(copied.origin.copiedAt));
  assert.equal(validateProject(join(dir, 'projects/mubiao')).ok, true);

  // 加批注 + 设计卡片
  const file = join(dir, 'projects/mubiao/project.json');
  const p = readJson(file);
  p.pages[0].annotations = [{ id: 'an_12345678', x: 10.4, y: 20, width: 300, height: 80, text: '这里加一个字', at: '2026-10-06T00:00:00.000Z' }];
  writeFileSync(file, JSON.stringify(p, null, 2));
  assert.equal(validateProject(join(dir, 'projects/mubiao')).ok, true);

  const edits = (await request('/api/projects/mubiao/brief')).body.text;
  assert.ok(edits.includes('批注（1 条）：'));
  assert.ok(edits.includes('· an_12345678 「这里加一个字」（位置 10, 20, 宽 300, 高 80）'), edits);
  assert.ok(edits.includes('npm run annotations -- mubiao --clear'));
  assert.match(edits, /designCard/);

  const design = (await request('/api/projects/mubiao/brief?intent=design')).body.text;
  for (const piece of ['草稿页', '【大标题】水曜会话', '【副标题】秋季课程', '教室照片', '逐条出现', '保留页面编号', '"draft": true', 'an_12345678', 'designCard'])
    assert.ok(design.includes(piece), `design 应包含：${piece}\n${design}`);
  assert.ok(!design.includes('来源项目'), 'design 不列非草稿页');

  const noCard = (await request('/api/projects/mubiao/brief?intent=unify')).body.text;
  for (const piece of ['拼进来', '来自项目 yuan「来源项目」', srcPage, '本项目还没有设计卡片', '内容（文字、图片、信息）不变', '保留页面编号', 'designCard'])
    assert.ok(noCard.includes(piece), `unify 应包含：${piece}\n${noCard}`);
  assert.ok(!noCard.includes('「封面」'), 'unify 不列本项目自己的页');

  const p2 = readJson(file);
  p2.designCard = { direction: '方向 3｜稿纸与印章', concept: '像一张稿纸', colors: ['#FFFFFF', '#88DAD1'], fonts: ['站酷小薇 84px', '思源宋体 26px'], traits: ['方格底纹', '竖排标题'] };
  writeFileSync(file, JSON.stringify(p2, null, 2));
  const unify = (await request('/api/projects/mubiao/brief?intent=unify')).body.text;
  assert.ok(unify.includes('方向：方向 3｜稿纸与印章'));
  assert.ok(unify.includes('配色：#FFFFFF #88DAD1'));
  assert.ok(unify.includes('特征：方格底纹 · 竖排标题'));
  assert.equal((await request('/api/projects/mubiao/brief?intent=bogus')).status, 400);
  assert.equal(designCardText(p2), ['设计风格参考（项目「2026-10-05 水曜会话课表」的设计卡片）', '方向：方向 3｜稿纸与印章', '概念：像一张稿纸', '配色：#FFFFFF #88DAD1', '字体：站酷小薇 84px / 思源宋体 26px', '特征：方格底纹 · 竖排标题'].join('\n'));
  assert.equal(designCardText({ name: 'x' }), '');
  assert.throws(() => agentBrief({ repoDir: dir, projectDir: join(dir, 'projects/mubiao'), intent: 'nope' }));
});
