// 交接包（第 11 轮）：网页导入后用户在工作台里改了什么 → 改动清单 + 改前改后对比图，交给写前端的 agent 去改真正的网站。
// 改前 = <项目>/import/baseline.json（导入那一刻的 project.json 完整复制），改后 = 当前 project.json。
// diffProjects 是纯函数；exportHandoff 负责写 改动清单.md、changes.json、复制给agent.txt 和 compare/ 对比图。
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pageSize } from '../../web/project-kinds.js';
import { exportImages } from './images.js';

export const BASELINE_FILE = join('import', 'baseline.json');
export const NO_BASELINE_MESSAGE = '这个项目没有导入基准（import/baseline.json），无法生成改动清单';

const TYPE_LABEL = { text: '文字', image: '图片', shape: '形状', group: '分组' };
const DEVICE_LABEL = { desktop: '电脑端', mobile: '手机端' };
const px = v => Math.round(Number(v) || 0);
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const near = (a, b, tol) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

// 有默认值的属性：没写等于默认
const DEFAULTS = { rotation: 0, opacity: 1, flipX: false, flipY: false, stroke: null, shadow: null, tint: null, crop: null, effects: null, font: null };
const val = (el, key) => (el[key] === undefined ? (key in DEFAULTS ? DEFAULTS[key] : undefined) : el[key]);

// 外观类属性：[键, 中文名, 适用类型（空 = 全部）]
const PROPS = [
  ['text', '文字内容', ['text']],
  ['fontSize', '字号', ['text']],
  ['lineHeight', '行高', ['text']],
  ['letterSpacing', '字距', ['text']],
  ['fontWeight', '字重', ['text']],
  ['font', '字体', ['text']],
  ['color', '文字颜色', ['text']],
  ['align', '对齐', ['text']],
  ['stroke', '描边', null],
  ['shadow', '投影', ['text']],
  ['fill', '填充', ['shape']],
  ['shape', '形状种类', ['shape']],
  ['points', '多边形顶点', ['shape']],
  ['cornerRadius', '圆角', null],
  ['asset', '素材（替换图片）', ['image']],
  ['fit', '图片显示方式', ['image']],
  ['tint', '图片着色', ['image']],
  ['crop', '裁切', ['image']],
  ['opacity', '透明度', null],
  ['flipX', '左右翻转', null],
  ['flipY', '上下翻转', null],
  ['rotation', '旋转（度）', null],
  ['zIndex', '层级', null],
  ['effects', '视觉效果', null],
];
// 分组整体缩放时，子元素里「跟着按比例变」的项
const SCALE_FOLLOW = { fontSize: '字号', letterSpacing: '字距', cornerRadius: '圆角' };

function showValue(v) {
  if (v === undefined || v === null) return '无';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return String(r2(v));
  if (typeof v === 'string') return v;
  if (v.type === 'linear' || v.type === 'radial') return `${v.type === 'linear' ? '线性' : '径向'}渐变 ${v.angle ?? 0}°：${(v.stops || []).map(s => `${s.color}@${r2(s.offset)}`).join(' → ')}`;
  if ('color' in v && 'width' in v && Object.keys(v).length === 2) return `${v.color} ${r2(v.width)}px`;
  if ('blur' in v) return `${v.color} 偏移 ${r2(v.x)},${r2(v.y)} 模糊 ${r2(v.blur)}`;
  return JSON.stringify(v);
}
const quote = (s, n = 40) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const elName = el => el.name || (el.origin?.text ? quote(el.origin.text, 16) : '') || (el.type === 'text' ? quote(el.text, 16) : '') || el.id;

/** 把一页的元素展开成 Map(id → { el, path: [分组名…], parentId })，含分组子元素。 */
function flatten(elements, path = [], parentId = null, out = new Map()) {
  for (const el of elements || []) {
    out.set(el.id, { el, path, parentId });
    if (el.type === 'group') flatten(el.children, [...path, elName(el)], el.id, out);
  }
  return out;
}

function locate(el) {
  if (!el.origin) return null;
  return { selector: el.origin.selector, tag: el.origin.tag ?? null, text: el.origin.text ?? null };
}
function describeAdded(el) {
  const parts = [`${TYPE_LABEL[el.type] || el.type}`, `位置 (${px(el.x)}, ${px(el.y)})`, `尺寸 ${px(el.width)}×${px(el.height)}`];
  if (el.type === 'text') parts.push(`文字「${quote(el.text, 60)}」`, `字号 ${r2(el.fontSize)}`, `颜色 ${el.color ?? '无'}`);
  if (el.type === 'shape') parts.push(`形状 ${el.shape}`, `填充 ${showValue(el.fill)}`, ...(el.stroke ? [`描边 ${showValue(el.stroke)}`] : []), ...(el.cornerRadius ? [`圆角 ${r2(el.cornerRadius)}`] : []));
  if (el.type === 'image') parts.push(`素材 ${el.asset}`);
  if (el.type === 'group') parts.push(`含 ${(el.children || []).length} 个子元素`);
  return parts.join('，');
}

/**
 * 比较一个元素改前改后。scale：外层分组整体缩放的倍数（子元素位置尺寸按此比例跟着变时不重复列出）。
 * 返回 { item, follow }：item 为空表示没有要单独列出的改动；follow 是「跟着整体缩放变了」的项（交给外层分组汇总）。
 */
function diffElement(before, after, ctx) {
  const { pageWidth, scale } = ctx;
  const changes = [];
  const follow = [];
  const name = elName(after);
  const phrases = [];
  let move = null, resize = null, groupScale = null;

  // 位置
  const fx = scale ? before.x * scale : before.x, fy = scale ? before.y * scale : before.y;
  const followsPos = scale && near(after.x, fx, 1.5) && near(after.y, fy, 1.5);
  if (!followsPos && (!near(after.x, before.x, 0.5) || !near(after.y, before.y, 0.5))) {
    const dx = px(after.x - before.x), dy = px(after.y - before.y);
    move = { dx, dy, dxPct: r2((dx / pageWidth) * 100), dyPct: r2((dy / pageWidth) * 100) };
    if (dx) changes.push({ prop: 'x', label: '位置 x', before: px(before.x), after: px(after.x), note: `${dx > 0 ? '右' : '左'}移 ${Math.abs(dx)}px（页宽的 ${Math.abs(move.dxPct)}%）` });
    if (dy) changes.push({ prop: 'y', label: '位置 y', before: px(before.y), after: px(after.y), note: `${dy > 0 ? '下' : '上'}移 ${Math.abs(dy)}px（页宽的 ${Math.abs(move.dyPct)}%）` });
    const words = [];
    if (dx) words.push(`${dx > 0 ? '右' : '左'}移 ${Math.abs(dx)}px`);
    if (dy) words.push(`${dy > 0 ? '下' : '上'}移 ${Math.abs(dy)}px`);
    if (words.length) phrases.push(words.join('、'));
  } else if (followsPos && (px(after.x) !== px(before.x) || px(after.y) !== px(before.y))) follow.push({ what: '位置', before: `${px(before.x)},${px(before.y)}`, after: `${px(after.x)},${px(after.y)}` });

  // 尺寸
  const sx = before.width ? after.width / before.width : 1, sy = before.height ? after.height / before.height : 1;
  const followsSize = scale && near(after.width, before.width * scale, 1.5) && near(after.height, before.height * scale, 1.5);
  if (!followsSize && (!near(after.width, before.width, 0.5) || !near(after.height, before.height, 0.5))) {
    resize = { width: [px(before.width), px(after.width)], height: [px(before.height), px(after.height)], ratioX: r2(sx), ratioY: r2(sy) };
    const uniform = after.type === 'group' && Math.abs(sx - sy) < 0.01 && Math.abs(sx - 1) > 0.005;
    if (uniform) {
      groupScale = Math.round(sx * 100);
      phrases.push(`${sx > 1 ? '放大' : '缩小'}到 ${groupScale}%`);
      changes.push({ prop: 'scale', label: '整体缩放', before: '100%', after: `${groupScale}%`, note: `宽 ${px(before.width)}→${px(after.width)}，高 ${px(before.height)}→${px(after.height)}` });
    } else {
      phrases.push(`尺寸改为 ${px(after.width)}×${px(after.height)}`);
      changes.push({ prop: 'width', label: '宽', before: px(before.width), after: px(after.width), note: `× ${r2(sx)}` });
      changes.push({ prop: 'height', label: '高', before: px(before.height), after: px(after.height), note: `× ${r2(sy)}` });
    }
  } else if (followsSize && (px(after.width) !== px(before.width) || px(after.height) !== px(before.height))) follow.push({ what: '尺寸', before: `${px(before.width)}×${px(before.height)}`, after: `${px(after.width)}×${px(after.height)}` });

  // 外观
  for (const [key, label, types] of PROPS) {
    if (types && !types.includes(after.type) && !types.includes(before.type)) continue;
    let b = val(before, key), a = val(after, key);
    if (key === 'stroke' && scale && b && a && b.color === a.color && near(a.width, b.width * scale, 0.6)) {
      if (!near(a.width, b.width, 0.01)) follow.push({ what: '描边粗细', before: r2(b.width), after: r2(a.width) });
      continue;
    }
    if (same(b, a)) continue;
    if (scale && SCALE_FOLLOW[key] && typeof b === 'number' && typeof a === 'number' && near(a, b * scale, 0.6)) {
      follow.push({ what: SCALE_FOLLOW[key], before: r2(b), after: r2(a) });
      continue;
    }
    const entry = { prop: key, label, before: typeof b === 'number' ? r2(b) : b ?? null, after: typeof a === 'number' ? r2(a) : a ?? null };
    if (typeof b === 'number' && typeof a === 'number' && b) entry.note = `× ${r2(a / b)}`;
    changes.push(entry);
    if (key === 'text') phrases.push(`文字从「${quote(b, 30)}」改成「${quote(a, 30)}」`);
    else if (key === 'color' || key === 'fill') phrases.push(`${label}从 ${showValue(b)} 改成 ${showValue(a)}`);
    else if (key === 'asset') phrases.push(`换一张图片（${b} → ${a}）`);
    else phrases.push(`${label}从 ${showValue(b)} 改成 ${showValue(a)}`);
  }
  if (!changes.length) return { item: null, follow };
  const verb = groupScale || after.type === 'group' ? `把「${name}」整体` : `把「${name}」`;
  return {
    item: { id: after.id, name, type: after.type, status: 'changed', origin: locate(after) || locate(before), move, resize, scale: groupScale ? groupScale / 100 : null, changes, summary: `${verb}${phrases.join('，并')}` },
    follow,
  };
}

/** 比较一页（before 可为 null = 新增页；after 可为 null = 删除页）。 */
function diffPage(before, after, ctx) {
  const pageWidth = pageSize(ctx.project, after || before).width;
  const result = { pageChanges: [], elements: [] };
  if (!before || !after) return result;
  if (!same(before.background, after.background)) result.pageChanges.push({ prop: 'background', label: '页面背景', before: before.background, after: after.background, summary: `把页面背景从 ${showValue(before.background)} 改成 ${showValue(after.background)}` });
  const bs = pageSize(ctx.baseProject, before), as = pageSize(ctx.project, after);
  if (bs.height !== as.height || bs.width !== as.width) {
    const dh = as.height - bs.height;
    result.pageChanges.push({ prop: 'height', label: '整页高度', before: bs.height, after: as.height, note: `${dh >= 0 ? '+' : ''}${dh}px`, summary: `把整页高度从 ${bs.height}px 改成 ${as.height}px（${dh >= 0 ? '加长' : '缩短'} ${Math.abs(dh)}px）` });
  }

  const B = flatten(before.elements), A = flatten(after.elements);
  // 变体元素：新 id 但 variantOf 指向改前的元素，当作同一个元素比较
  const matchOf = new Map();
  for (const [id, rec] of A) {
    if (B.has(id)) matchOf.set(id, id);
    else if (rec.el.variantOf && B.has(rec.el.variantOf)) matchOf.set(id, rec.el.variantOf);
  }
  const usedBefore = new Set(matchOf.values());
  const groupFollow = new Map(); // 分组 id → [{ child, what, before, after }]
  // 先算每个元素所处的整体缩放（祖先分组里最近的那个均匀缩放）
  const scaleOf = id => {
    let rec = A.get(id);
    while (rec?.parentId) {
      const g = A.get(rec.parentId), gb = matchOf.has(rec.parentId) ? B.get(matchOf.get(rec.parentId)) : null;
      if (g && gb && gb.el.width && gb.el.height) {
        const sx = g.el.width / gb.el.width, sy = g.el.height / gb.el.height;
        if (Math.abs(sx - sy) < 0.01 && Math.abs(sx - 1) > 0.005) return { scale: sx, groupId: rec.parentId };
      }
      rec = g;
    }
    return null;
  };
  const pending = [];
  for (const [id, rec] of A) {
    const where = rec.path.length ? rec.path.join(' > ') : null;
    if (!matchOf.has(id)) {
      // 新增：分组里的新元素只要分组本身也是新增的，就不重复列
      if (rec.parentId && !matchOf.has(rec.parentId)) continue;
      pending.push({ id, name: elName(rec.el), type: rec.el.type, status: 'added', group: where, origin: null, element: rec.el, summary: `新增${TYPE_LABEL[rec.el.type] || '元素'}「${elName(rec.el)}」：${describeAdded(rec.el)}`, description: describeAdded(rec.el) });
      continue;
    }
    const s = scaleOf(id);
    const { item, follow } = diffElement(B.get(matchOf.get(id)).el, rec.el, { pageWidth, scale: s?.scale || null });
    if (s && follow.length) {
      const list = groupFollow.get(s.groupId) || [];
      for (const f of follow) list.push({ child: elName(rec.el), ...f });
      groupFollow.set(s.groupId, list);
    }
    if (item) {
      item.group = where;
      if (matchOf.get(id) !== id) item.variantOf = matchOf.get(id);
      pending.push(item);
    }
  }
  for (const [id, rec] of B) {
    if (usedBefore.has(id)) continue;
    if (rec.parentId && !usedBefore.has(rec.parentId)) continue; // 整个分组都删了，只列分组
    const where = rec.path.length ? rec.path.join(' > ') : null;
    const origin = locate(rec.el);
    pending.push({ id, name: elName(rec.el), type: rec.el.type, status: 'removed', group: where, origin, summary: `删除${TYPE_LABEL[rec.el.type] || '元素'}「${elName(rec.el)}」${origin ? `（${origin.selector}）` : ''}` });
  }
  for (const item of pending) {
    const f = groupFollow.get(item.id);
    if (f) item.followsScale = f;
  }
  // 整体缩放的分组：即使分组本身只有缩放也一定出现在 pending 里（缩放算改动）
  result.elements = pending;
  return result;
}

function pageTitle(project, page, index) {
  const kindWeb = project?.kind === 'web';
  const head = `第 ${index + 1} 页`;
  if (!kindWeb) return page.name ? `${head} · ${page.name}` : head;
  const dev = DEVICE_LABEL[page.device] || '';
  return [head, page.name, dev && !String(page.name || '').includes(dev) ? dev : null].filter(Boolean).join(' · ');
}

/**
 * 比较导入基准与当前项目。返回 { pages: [...], summary }。纯函数，不读写文件。
 * 页面按当前顺序列出（变体页 variant: true，与它的来源页比较），删除的页附在最后。
 */
export function diffProjects(baseline, current) {
  if (!baseline || !current) throw new Error('diffProjects 需要 baseline 和 current 两个项目');
  const baseById = new Map((baseline.pages || []).map((p, i) => [p.id, { page: p, index: i }]));
  const ctx = { project: current, baseProject: baseline };
  const pages = [];
  const seen = new Set();
  (current.pages || []).forEach((page, index) => {
    let base = baseById.get(page.id);
    let variant = false;
    if (!base && page.variantOf && baseById.has(page.variantOf)) { base = baseById.get(page.variantOf); variant = true; }
    else if (base) seen.add(page.id);
    if (page.variantOf && !variant && !base) variant = true;
    const { width, height } = pageSize(current, page);
    const entry = {
      number: pages.length + 1, index, pageId: page.id, name: page.name || '', title: pageTitle(current, page, index),
      device: page.device || null, size: { width, height }, origin: page.origin || null,
      variant, variantOf: page.variantOf || null,
      status: !base ? 'added' : 'changed', pageChanges: [], elements: [],
    };
    if (base) {
      Object.assign(entry, diffPage(base.page, page, ctx));
      entry.baselineIndex = base.index;
      if (!entry.pageChanges.length && !entry.elements.length) entry.status = 'unchanged';
    } else {
      entry.elements = flattenTop(page).map(el => ({ id: el.id, name: elName(el), type: el.type, status: 'added', group: null, origin: locate(el), element: el, summary: `新增${TYPE_LABEL[el.type] || '元素'}「${elName(el)}」：${describeAdded(el)}`, description: describeAdded(el) }));
    }
    pages.push(entry);
  });
  (baseline.pages || []).forEach((page, index) => {
    if (seen.has(page.id) || (current.pages || []).some(p => p.id === page.id)) return;
    const { width, height } = pageSize(baseline, page);
    pages.push({ number: pages.length + 1, index: null, baselineIndex: index, pageId: page.id, name: page.name || '', title: `${pageTitle(baseline, page, index)}（原第 ${index + 1} 页）`, device: page.device || null, size: { width, height }, origin: page.origin || null, variant: false, variantOf: null, status: 'removed', pageChanges: [], elements: [] });
  });
  const count = { changed: 0, added: 0, removed: 0 };
  for (const p of pages) if (p.status === 'changed') for (const e of p.elements) count[e.status]++;
  const summary = {
    pages: pages.length,
    changedPages: pages.filter(p => p.status === 'changed').length,
    addedPages: pages.filter(p => p.status === 'added').length,
    removedPages: pages.filter(p => p.status === 'removed').length,
    variantPages: pages.filter(p => p.variant).length,
    elements: count,
  };
  summary.text = summaryText(summary);
  return { pages, summary };
}
const flattenTop = page => page.elements || [];

function summaryText(s) {
  const parts = [`共 ${s.pages} 页，其中 ${s.changedPages} 页有改动`];
  if (s.addedPages) parts.push(`新增 ${s.addedPages} 页`);
  if (s.removedPages) parts.push(`删除 ${s.removedPages} 页`);
  if (s.variantPages) parts.push(`其中 ${s.variantPages} 页是变体`);
  const e = s.elements;
  return `${parts.join('，')}；元素：改了 ${e.changed} 个、新增 ${e.added} 个、删除 ${e.removed} 个。`;
}

// ---------- 改动清单.md ----------
const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '↵');

function locateLine(origin) {
  if (!origin) return '工作台新增（原网页没有这个元素）';
  const bits = [`\`${origin.selector}\``];
  if (origin.tag) bits.push(`<${origin.tag}>`);
  if (origin.text) bits.push(`原文「${quote(origin.text, 40)}」`);
  return bits.join('，');
}

function renderElement(lines, item, n) {
  const tag = { changed: '修改', added: '新增', removed: '删除' }[item.status];
  lines.push(`#### ${n}. ${tag} · 「${item.name}」（${TYPE_LABEL[item.type] || item.type}，${item.id}）`, '');
  lines.push(`**${item.summary}**`, '');
  lines.push(`- 原网页定位：${item.status === 'added' ? '工作台新增' : locateLine(item.origin)}`);
  if (item.group) lines.push(`- 所在分组：${item.group}（子元素坐标相对分组左上角）`);
  if (item.variantOf) lines.push(`- 这是元素 ${item.variantOf} 的变体`);
  if (item.status === 'added') lines.push(`- 完整描述：${item.description}`);
  if (item.changes?.length) {
    lines.push('', '| 项目 | 改前 | 改后 | 说明 |', '|---|---|---|---|');
    for (const c of item.changes) lines.push(`| ${cell(c.label)} | ${cell(c.prop === 'text' ? c.before : showValue(c.before))} | ${cell(c.prop === 'text' ? c.after : showValue(c.after))} | ${cell(c.note || '')} |`);
  }
  if (item.followsScale?.length) {
    lines.push('', `整体缩放后，组内这些项跟着同比例变了（不用逐个改位置，按比例缩放整组即可）：`, '', '| 子元素 | 项目 | 改前 | 改后 |', '|---|---|---|---|');
    for (const f of item.followsScale) lines.push(`| ${cell(f.child)} | ${cell(f.what)} | ${cell(f.before)} | ${cell(f.after)} |`);
  }
  lines.push('');
}

export function renderMarkdown(diff, { projectName = '', generatedAt = '' } = {}) {
  const lines = [`# 改动清单${projectName ? `：${projectName}` : ''}`, ''];
  if (generatedAt) lines.push(`生成时间：${generatedAt}`, '');
  lines.push('改前 = 导入时的样子（import/baseline.json），改后 = 用户在工作台里调整后的样子。', '坐标、尺寸都是画板像素；百分比 = 相对页宽。元素用原网页的 CSS 选择器定位。', '');
  lines.push('## 总览', '', diff.summary.text, '');
  for (const p of diff.pages) {
    const status = { changed: '有改动', unchanged: '本页无改动', added: '新增页', removed: '删除页' }[p.status];
    lines.push(`- ${p.title}：${status}${p.status === 'changed' ? `（${p.pageChanges.length + p.elements.length} 项）` : ''}`);
  }
  lines.push('');
  const normal = diff.pages.filter(p => !p.variant), variants = diff.pages.filter(p => p.variant);
  const renderPage = p => {
    lines.push(`## ${p.title}`, '');
    const meta = [`页面编号 ${p.pageId}`, `尺寸 ${p.size.width}×${p.size.height}`];
    if (p.device) meta.push(`设备 ${p.device}`);
    if (p.origin?.url) meta.push(`来源网址 ${p.origin.url}`);
    if (p.origin?.file) meta.push(`来源文件 ${p.origin.file}`);
    if (p.variant && p.variantOf) meta.push(`变体来源页 ${p.variantOf}`);
    lines.push(meta.join(' · '), '');
    if (p.status === 'unchanged') { lines.push('本页无改动', ''); return; }
    if (p.status === 'removed') { lines.push('**这一页在工作台里被删掉了。**', ''); return; }
    if (p.status === 'added') lines.push('**这是工作台里新增的一页**，原网站没有，下面是它的全部元素：', '');
    if (p.pageChanges.length) {
      lines.push('### 页面', '');
      for (const c of p.pageChanges) lines.push(`- **${c.summary}**（${c.label}：${showValue(c.before)} → ${showValue(c.after)}${c.note ? `，${c.note}` : ''}）`);
      lines.push('');
    }
    if (p.elements.length) {
      lines.push('### 元素', '');
      p.elements.forEach((item, i) => renderElement(lines, item, i + 1));
    }
  };
  normal.forEach(renderPage);
  if (variants.length) {
    lines.push('## 变体', '', '下面这些页是用户「多试几版」复制出的变体，跟它的来源页（导入时的样子）比较：', '');
    variants.forEach(renderPage);
  }
  return lines.join('\n');
}

// ---------- 对比图 ----------
const pad2 = n => String(n).padStart(2, '0');
export function stamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

/** 左改前右改后，中间 24px 间隔，顶部 40px 色条（灰 = 改前，蓝 = 改后），高度取两者最大。 */
async function sideBySide(leftFile, rightFile, outFile) {
  const { default: sharp } = await import('sharp');
  const [l, r] = await Promise.all([sharp(leftFile).metadata(), sharp(rightFile).metadata()]);
  const GAP = 24, BAR = 40;
  const width = l.width + GAP + r.width, height = Math.max(l.height, r.height) + BAR;
  const bar = (w, color) => ({ input: { create: { width: w, height: BAR, channels: 3, background: color } } });
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([
      { ...bar(l.width, '#9ca3af'), left: 0, top: 0 },
      { ...bar(r.width, '#2563eb'), left: l.width + GAP, top: 0 },
      { input: leftFile, left: 0, top: BAR },
      { input: rightFile, left: l.width + GAP, top: BAR },
    ])
    .png().toFile(outFile);
}

function copyIfExists(from, to) { if (existsSync(from)) cpSync(from, to, { recursive: true }); }

/**
 * 生成交接包。返回 { outDir, files: [相对 outDir 的路径], agentText, summary }。
 * exporter：({ projectDir, outDir }) → { files: [{ path }] }，按页顺序；默认真实 exportImages。
 */
export async function exportHandoff({ projectDir, outDir, images = true, exporter = exportImages, now = () => new Date() } = {}) {
  if (!projectDir || !outDir) throw new Error('exportHandoff 需要 projectDir 和 outDir');
  projectDir = resolve(projectDir); outDir = resolve(outDir);
  const baselineFile = join(projectDir, BASELINE_FILE);
  if (!existsSync(baselineFile)) throw Object.assign(new Error(NO_BASELINE_MESSAGE), { code: 'NO_BASELINE' });
  let baseline, current;
  try { baseline = JSON.parse(readFileSync(baselineFile, 'utf8')); } catch (error) { throw new Error(`导入基准读不出来（${baselineFile}）：${error.message}`); }
  try { current = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')); } catch (error) { throw new Error(`读不到项目文件：${error.message}`); }

  const diff = diffProjects(baseline, current);
  const date = now();
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const write = (rel, content) => { writeFileSync(join(outDir, rel), content); files.push(rel.replace(/\\/g, '/')); };

  if (images) {
    const compareDir = join(outDir, 'compare');
    mkdirSync(compareDir, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), 'vw-handoff-'));
    try {
      // 改前：把 baseline 写成一个临时项目（素材、字体拷贝过去），导出每页
      const baseDir = join(work, 'baseline');
      mkdirSync(baseDir, { recursive: true });
      copyIfExists(join(projectDir, 'assets'), join(baseDir, 'assets'));
      copyIfExists(join(projectDir, 'fonts'), join(baseDir, 'fonts'));
      writeFileSync(join(baseDir, 'project.json'), JSON.stringify(baseline, null, 2));
      const beforeShots = (await exporter({ projectDir: baseDir, outDir: join(work, 'before') })).files.map(f => f.path);
      const afterShots = (await exporter({ projectDir, outDir: join(work, 'after') })).files.map(f => f.path);
      for (const p of diff.pages) {
        const label = p.device || 'page';
        const base = `${pad2(p.number)}-${label}`;
        const before = p.baselineIndex != null ? beforeShots[p.baselineIndex] : null;
        const after = p.index != null ? afterShots[p.index] : null;
        if (before) { copyFileSync(before, join(compareDir, `${base}-改前.png`)); files.push(`compare/${base}-改前.png`); }
        if (after) { copyFileSync(after, join(compareDir, `${base}-改后.png`)); files.push(`compare/${base}-改后.png`); }
        if (before && after) { await sideBySide(before, after, join(compareDir, `${base}-对比.png`)); files.push(`compare/${base}-对比.png`); }
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const listFile = join(outDir, '改动清单.md');
  const agentText = `请按改动清单修改网站代码：清单在 ${listFile}（机器可读版 ${join(outDir, 'changes.json')}）`
    + (images ? `，改前改后对比图在 ${join(outDir, 'compare')}${process.platform === 'win32' ? '\\' : '/'}` : '')
    + '。改动按页、按元素列出，元素用原网页的 CSS 选择器定位；只改清单里列出的属性，位置和尺寸按百分比换算到实际布局，颜色与字号按清单精确值。'
    + (images ? '改完请对照对比图检查。' : '');
  const generatedAt = date.toISOString();
  write('改动清单.md', renderMarkdown(diff, { projectName: current.name, generatedAt }));
  write('changes.json', JSON.stringify({ format: 'visual-workbench/changes', version: 1, projectId: current.id, projectName: current.name, kind: current.kind || 'deck', generatedAt, ...diff }, null, 2));
  write('复制给agent.txt', agentText);
  return { outDir, files, agentText, summary: diff.summary };
}

/** 默认交接包目录：<数据目录>/exports/<项目编号>/handoff-<yyyyMMdd-HHmmss>/ */
export function defaultHandoffDir(dataDir, projectId, date = new Date()) {
  return join(dataDir, 'exports', projectId, `handoff-${stamp(date)}`);
}
