// 第 11 轮：交接包（改动清单 + 改前改后对比图）。只用临时目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffProjects, exportHandoff, NO_BASELINE_MESSAGE, defaultHandoffDir } from '../src/export/changes.js';
import { validateProjectData } from '../src/validate.js';

const CLI = fileURLToPath(new URL('../src/cli/export-changes.js', import.meta.url));
const clone = v => JSON.parse(JSON.stringify(v));

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 导入时的网页项目：电脑端（导航栏分组、卡片、按钮、文字）+ 手机端
function webBaseline() {
  const text = (id, x, y, w, h, s, extra = {}) => ({ id, type: 'text', x, y, width: w, height: h, zIndex: 2, text: s, fontSize: 16, lineHeight: 1.5, letterSpacing: 0, align: 'left', color: '#111111', font: null, ...extra });
  return {
    format: 'visual-workbench/project', formatVersion: 2, kind: 'web', id: 'web-demo', name: '网页演示',
    createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z',
    artboard: { preset: 'web-desktop', width: 1440, height: 900 }, assets: [], fonts: [],
    pages: [
      {
        id: 'page_home_desk', name: '首页', device: 'desktop', size: { width: 1440, height: 2000 }, background: '#ffffff',
        origin: { url: 'http://127.0.0.1:5173/', capturedAt: '2026-10-04T00:00:00.000Z' },
        elements: [
          { id: 'el_navbar', type: 'group', name: '导航栏', x: 40, y: 20, width: 600, height: 60, zIndex: 5, origin: { selector: 'header > nav.top', tag: 'nav', text: '品牌 产品 价格' },
            children: [
              text('el_logo', 0, 10, 120, 40, '品牌', { fontSize: 24, fontWeight: 700, origin: { selector: 'nav.top > a.logo', tag: 'a', text: '品牌' } }),
              text('el_link', 200, 15, 100, 30, '产品', { origin: { selector: 'nav.top > a.link', tag: 'a', text: '产品' } }),
              { id: 'el_navbg', type: 'shape', shape: 'rect', x: 0, y: 0, width: 600, height: 60, zIndex: 0, fill: '#f3f4f6', stroke: null, cornerRadius: 10 },
            ] },
          { id: 'el_card', type: 'shape', shape: 'rect', name: '卡片', x: 100, y: 300, width: 400, height: 300, zIndex: 1, fill: '#ffffff', stroke: { color: '#e5e7eb', width: 1 }, cornerRadius: 16, origin: { selector: 'main .card', tag: 'div' } },
          { id: 'el_button', type: 'shape', shape: 'rect', name: '按钮', x: 120, y: 520, width: 160, height: 48, zIndex: 3, fill: '#2563eb', stroke: null, cornerRadius: 8, origin: { selector: 'main .card > a.btn', tag: 'a', text: '立即购买' } },
          text('el_para', 120, 340, 360, 48, '这是一段介绍文字，原来的说法。', { origin: { selector: 'main .card > p', tag: 'p', text: '这是一段介绍文字，原来的说法。' } }),
          { id: 'el_badge', type: 'shape', shape: 'ellipse', name: '角标', x: 460, y: 290, width: 40, height: 40, zIndex: 4, fill: '#ef4444', stroke: null, origin: { selector: 'main .card .badge', tag: 'span' } },
        ],
      },
      {
        id: 'page_home_mob', name: '首页', device: 'mobile', size: { width: 390, height: 1600 }, background: '#ffffff',
        origin: { url: 'http://127.0.0.1:5173/' },
        elements: [{ id: 'el_mtitle', type: 'text', x: 20, y: 40, width: 350, height: 36, zIndex: 1, text: '手机标题', fontSize: 24, lineHeight: 1.5, color: '#111111', origin: { selector: 'h1', tag: 'h1', text: '手机标题' } }],
      },
    ],
  };
}

// 用户在工作台里的改动
function webCurrent() {
  const p = clone(webBaseline());
  const desk = p.pages[0];
  const nav = desk.elements[0];
  // 整组右移 24、放大 120%，子元素位置 / 尺寸 / 字号 / 圆角同比
  nav.x = 64; nav.y = 20; nav.width = 720; nav.height = 72;
  for (const c of nav.children) {
    for (const k of ['x', 'y', 'width', 'height']) c[k] = c[k] * 1.2;
    if (c.fontSize) c.fontSize = c.fontSize * 1.2;
    if (c.cornerRadius) c.cornerRadius = c.cornerRadius * 1.2;
  }
  desk.elements.find(e => e.id === 'el_button').fill = '#dc2626';
  desk.elements.find(e => e.id === 'el_para').text = '这是一段改过的介绍文字。';
  desk.elements = desk.elements.filter(e => e.id !== 'el_badge');
  desk.elements.push({ id: 'el_newstar', type: 'shape', shape: 'rect', name: '新色块', x: 600, y: 300, width: 200, height: 100, zIndex: 6, fill: '#22c55e', stroke: null, cornerRadius: 12 });
  desk.size.height = 2200;
  return p;
}

const findEl = (page, id) => page.elements.find(e => e.id === id);

test('夹具本身通过校验', () => {
  assert.deepEqual(validateProjectData(webBaseline()).errors, []);
  assert.deepEqual(validateProjectData(webCurrent()).errors, []);
});

test('diffProjects：分组移动 + 整体缩放、颜色、文字、删除、新增、页高', () => {
  const { pages, summary } = diffProjects(webBaseline(), webCurrent());
  assert.equal(pages.length, 2);
  const [desk, mob] = pages;
  assert.equal(desk.status, 'changed');
  assert.equal(desk.title, '第 1 页 · 首页 · 电脑端');
  assert.equal(mob.status, 'unchanged');

  // 页高
  assert.deepEqual(desk.pageChanges.map(c => [c.prop, c.before, c.after]), [['height', 2000, 2200]]);
  assert.match(desk.pageChanges[0].summary, /整页高度从 2000px 改成 2200px/);

  // 导航栏：右移 24px（1.67% 页宽），整体 120%，子元素不单独列
  const nav = findEl(desk, 'el_navbar');
  assert.equal(nav.status, 'changed');
  assert.deepEqual(nav.move, { dx: 24, dy: 0, dxPct: 1.67, dyPct: 0 });
  assert.equal(nav.scale, 1.2);
  assert.equal(nav.summary, '把「导航栏」整体右移 24px，并放大到 120%');
  assert.equal(nav.origin.selector, 'header > nav.top');
  assert.equal(findEl(desk, 'el_logo'), undefined);
  assert.equal(findEl(desk, 'el_link'), undefined);
  const follow = nav.followsScale.map(f => `${f.child}/${f.what}/${f.before}/${f.after}`);
  assert.ok(follow.includes('品牌/字号/24/28.8'), follow.join('；'));
  assert.ok(follow.includes('产品/字号/16/19.2'));
  assert.ok(follow.some(f => f.includes('/圆角/10/12')));

  // 按钮颜色
  const btn = findEl(desk, 'el_button');
  assert.deepEqual(btn.changes.map(c => [c.prop, c.before, c.after]), [['fill', '#2563eb', '#dc2626']]);
  assert.equal(btn.summary, '把「按钮」填充从 #2563eb 改成 #dc2626');
  assert.equal(btn.origin.selector, 'main .card > a.btn');
  assert.equal(btn.move, null);

  // 文字
  const para = findEl(desk, 'el_para');
  assert.deepEqual(para.changes.map(c => [c.prop, c.before, c.after]), [['text', '这是一段介绍文字，原来的说法。', '这是一段改过的介绍文字。']]);
  assert.match(para.summary, /文字从「这是一段介绍文字，原来的说法。」改成「这是一段改过的介绍文字。」/);

  // 删除 / 新增
  const badge = findEl(desk, 'el_badge');
  assert.equal(badge.status, 'removed');
  assert.equal(badge.origin.selector, 'main .card .badge');
  const added = findEl(desk, 'el_newstar');
  assert.equal(added.status, 'added');
  assert.equal(added.origin, null);
  assert.match(added.description, /形状，位置 \(600, 300\)，尺寸 200×100/);
  assert.match(added.description, /#22c55e/);

  // 没改的元素不列
  assert.equal(findEl(desk, 'el_card'), undefined);
  assert.deepEqual(summary.elements, { changed: 3, added: 1, removed: 1 });
  assert.equal(summary.changedPages, 1);
});

test('diffProjects：分组里单独改了子元素（非整体缩放）写明分组路径；变体页另列', () => {
  const base = webBaseline();
  const cur = clone(base);
  cur.pages[0].elements[0].children[1].x += 30; // 只挪「产品」链接
  cur.pages[0].elements[0].children[1].color = '#ff0000';
  const variant = clone(cur.pages[1]);
  variant.id = 'page_home_mob_v2'; variant.variantOf = 'page_home_mob'; variant.name = '首页 v2';
  variant.elements[0] = { ...variant.elements[0], id: 'el_mtitle_v2', variantOf: 'el_mtitle', fontSize: 30 };
  cur.pages.push(variant);
  const { pages, summary } = diffProjects(base, cur);
  const link = findEl(pages[0], 'el_link');
  assert.equal(link.group, '导航栏');
  assert.deepEqual(link.move, { dx: 30, dy: 0, dxPct: 2.08, dyPct: 0 });
  assert.ok(link.changes.some(c => c.prop === 'color' && c.after === '#ff0000'));
  const v = pages[2];
  assert.equal(v.variant, true);
  assert.equal(v.status, 'changed');
  const t = findEl(v, 'el_mtitle_v2');
  assert.equal(t.variantOf, 'el_mtitle');
  assert.deepEqual(t.changes.map(c => [c.prop, c.before, c.after]), [['fontSize', 24, 30]]);
  assert.equal(summary.variantPages, 1);
});

function writeProject(t, baseline, current) {
  const dir = tempDir(t, 'vw-handoff-project-');
  mkdirSync(join(dir, 'import'), { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify(current, null, 2));
  if (baseline) writeFileSync(join(dir, 'import', 'baseline.json'), JSON.stringify(baseline, null, 2));
  return dir;
}

test('exportHandoff（不出图）：文件列表、清单大白话与数值、changes.json 结构、agentText', async t => {
  const projectDir = writeProject(t, webBaseline(), webCurrent());
  const outDir = join(tempDir(t, 'vw-handoff-out-'), 'handoff-x');
  const result = await exportHandoff({ projectDir, outDir, images: false, now: () => new Date('2026-10-04T08:00:00Z') });
  assert.deepEqual(result.files, ['改动清单.md', 'changes.json', '复制给agent.txt']);
  assert.equal(result.outDir, outDir);
  const md = readFileSync(join(outDir, '改动清单.md'), 'utf8');
  for (const s of [
    '## 总览', '共 2 页，其中 1 页有改动', '把「导航栏」整体右移 24px，并放大到 120%', '`header > nav.top`', '右移 24px（页宽的 1.67%）',
    '| 品牌 | 字号 | 24 | 28.8 |', '把「按钮」填充从 #2563eb 改成 #dc2626', '| 填充 | #2563eb | #dc2626 |',
    '这是一段改过的介绍文字。', '删除形状「角标」（main .card .badge）', '新增形状「新色块」', '原网页定位：工作台新增',
    '把整页高度从 2000px 改成 2200px', '## 第 2 页 · 首页 · 手机端', '本页无改动', '来源网址 http://127.0.0.1:5173/',
  ]) assert.ok(md.includes(s), `清单里应有：${s}`);
  const json = JSON.parse(readFileSync(join(outDir, 'changes.json'), 'utf8'));
  assert.equal(json.format, 'visual-workbench/changes');
  assert.equal(json.projectId, 'web-demo');
  assert.equal(json.kind, 'web');
  assert.equal(json.pages.length, 2);
  assert.equal(json.pages[0].elements.find(e => e.id === 'el_navbar').scale, 1.2);
  assert.deepEqual(json.summary.elements, { changed: 3, added: 1, removed: 1 });
  assert.equal(readFileSync(join(outDir, '复制给agent.txt'), 'utf8'), result.agentText);
  assert.ok(result.agentText.includes(join(outDir, '改动清单.md')));
  assert.ok(result.agentText.includes('CSS 选择器'));
});

test('没有 baseline.json：中文报错；CLI 退出码 1', async t => {
  const projectDir = writeProject(t, null, webCurrent());
  await assert.rejects(exportHandoff({ projectDir, outDir: join(projectDir, 'out'), images: false }), { message: NO_BASELINE_MESSAGE });
  const run = spawnSync(process.execPath, [CLI, projectDir, '--out', join(projectDir, 'out'), '--no-images'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /没有导入基准/);
});

test('CLI：--no-images 打印清单路径和 agentText', t => {
  const projectDir = writeProject(t, webBaseline(), webCurrent());
  const out = join(tempDir(t, 'vw-handoff-out-'), 'h');
  const run = spawnSync(process.execPath, [CLI, projectDir, '--out', out, '--no-images'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(join(out, '改动清单.md')));
  assert.match(run.stdout, /请按改动清单修改网站代码/);
  assert.ok(existsSync(join(out, 'changes.json')));
});

test('defaultHandoffDir 按 handoff-yyyyMMdd-HHmmss 命名', () => {
  assert.equal(defaultHandoffDir('/data', 'p1', new Date(2026, 9, 4, 9, 5, 7)), join('/data', 'exports', 'p1', 'handoff-20261004-090507'));
});

test('课件项目有 baseline 也能出清单（页名用页码）', async t => {
  const sample = JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));
  const cur = clone(sample);
  const el = cur.pages[0].elements.find(e => e.type === 'text');
  el.x += 100;
  const projectDir = writeProject(t, sample, cur);
  const outDir = join(projectDir, 'out');
  const result = await exportHandoff({ projectDir, outDir, images: false });
  const md = readFileSync(join(outDir, '改动清单.md'), 'utf8');
  assert.ok(md.includes(`## 第 1 页 · ${sample.pages[0].name}`));
  assert.ok(md.includes('## 第 2 页'));
  assert.ok(md.includes('右移 100px'));
  assert.ok(md.includes('原网页定位：工作台新增') || md.includes('工作台新增'));
  assert.equal(result.summary.changedPages, 1);
});

test('真实浏览器出对比图：compare 下改前 / 改后 / 并排 PNG，并排宽 = 左 + 右 + 24', { timeout: 240000 }, async t => {
  const projectDir = writeProject(t, webBaseline(), webCurrent());
  const outDir = join(tempDir(t, 'vw-handoff-out-'), 'h');
  const result = await exportHandoff({ projectDir, outDir });
  const names = readdirSync(join(outDir, 'compare')).sort();
  assert.deepEqual(names, ['01-desktop-对比.png', '01-desktop-改前.png', '01-desktop-改后.png', '02-mobile-对比.png', '02-mobile-改前.png', '02-mobile-改后.png'].sort());
  assert.ok(result.files.includes('compare/01-desktop-对比.png'));
  const size = f => { const b = readFileSync(join(outDir, 'compare', f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  const before = size('01-desktop-改前.png'), after = size('01-desktop-改后.png'), both = size('01-desktop-对比.png');
  assert.deepEqual(before, { w: 1440, h: 2000 });
  assert.deepEqual(after, { w: 1440, h: 2200 });
  assert.equal(both.w, before.w + after.w + 24);
  assert.equal(both.h, 2200 + 40);
  assert.equal(size('02-mobile-对比.png').w, 390 * 2 + 24);
});
