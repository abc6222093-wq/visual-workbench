// 交接包（第 12 轮）：改动清单 = 修改单。用户在工作台里对页面做的修改（pages[].edits）整理成
// 改动清单.md（大白话 + 精确数值表）、changes.json（机器可读）、compare/ 每页改前 / 改后 / 对比三张图、复制给agent.txt。
// 改前 = 页面源码本身（修改单清空），改后 = 页面 + 修改单。不再依赖 import/baseline.json；课件项目也能导。
// buildChanges 是纯函数（输入项目和每页 HTML）；exportHandoff 负责读文件、截图、写文件。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pageSize } from '../../web/project-kinds.js';
import { scanMarks } from '../../web/page-marks.js';
import { annotateEdits, describeEdit, isUserImage } from '../../web/edits-model.js';
import { captureProject } from './images.js';

const DEVICE_LABEL = { desktop: '电脑端', mobile: '手机端' };
const KIND_LABEL = { text: '文字', fontSize: '字号', move: '位置', resize: '尺寸', color: '文字颜色', background: '底色', crop: '裁切', addImage: '新增图片', remove: '删除' };
const KIND_ORDER = ['addImage', 'text', 'fontSize', 'color', 'background', 'move', 'resize', 'crop', 'remove'];
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const pad2 = n => String(n).padStart(2, '0');

/** 一条修改的精确数值行：[{ label, before, after }] */
export function editRows(edit) {
  const { kind, before, after } = edit;
  const pct = v => (v === null || v === undefined ? '—' : `${r2(v * 100)}%`);
  switch (kind) {
    case 'text': return [
      { label: '文字', before: before?.text ?? '', after: after?.text ?? '' },
      ...(before?.html !== after?.html && (before?.html !== before?.text || after?.html !== after?.text) ? [{ label: 'HTML', before: before?.html ?? '', after: after?.html ?? '' }] : []),
    ];
    case 'fontSize': return [{ label: '字号', before: `${r2(before?.fontSize)}px`, after: `${r2(after?.fontSize)}px` }];
    case 'move': return [
      { label: '水平偏移 dx', before: '0px', after: `${r2(after?.dx)}px` },
      { label: '垂直偏移 dy', before: '0px', after: `${r2(after?.dy)}px` },
      { label: '位置 x, y', before: `${r2(before?.x)}, ${r2(before?.y)}`, after: `${r2((before?.x || 0) + (after?.dx || 0))}, ${r2((before?.y || 0) + (after?.dy || 0))}` },
    ];
    case 'resize': return [
      { label: '宽', before: `${r2(before?.width)}px`, after: `${r2(after?.width)}px` },
      { label: '高', before: `${r2(before?.height)}px`, after: `${r2(after?.height)}px` },
    ];
    case 'color': return [{ label: '文字颜色', before: before?.color ?? '（未设）', after: after?.color ?? '（未设）' }];
    case 'background': return [{ label: '底色', before: before?.background ?? '（未设）', after: after?.background ?? '（未设）' }];
    case 'crop': {
      const b = before?.crop, a = after?.crop;
      const show = c => (c ? `x ${pct(c.x)}，y ${pct(c.y)}，宽 ${pct(c.width)}，高 ${pct(c.height)}` : '不裁');
      return [{ label: '裁切（源图比例）', before: show(b), after: show(a) }];
    }
    case 'addImage': return [
      { label: '素材', before: '—', after: after?.asset ?? '' },
      { label: '位置 x, y', before: '—', after: `${r2(after?.x)}, ${r2(after?.y)}` },
      { label: '尺寸', before: '—', after: `${r2(after?.width)}×${r2(after?.height)}` },
    ];
    case 'remove': return [{ label: '删除', before: '在', after: '删掉了' }];
    default: return [{ label: kind, before: JSON.stringify(before ?? null), after: JSON.stringify(after ?? null) }];
  }
}

function pageTitle(project, page, index) {
  const device = page.device ? `${DEVICE_LABEL[page.device] || page.device} · ` : '';
  return `第 ${index + 1} 页 · ${device}${page.name || page.id}`;
}

/**
 * 改动清单数据（纯函数）。htmlOf(page) → 页面 HTML 文本（读不到时返回 null）。
 * 返回 { summary, pages: [...] }。
 */
export function buildChanges(project, htmlOf) {
  const assets = new Map((project.assets || []).map(asset => [asset.id, asset]));
  const pages = project.pages.map((page, index) => {
    const html = htmlOf(page);
    const scan = scanMarks(html || '');
    const byId = new Map(scan.items.map(item => [item.id, item]));
    const annotated = annotateEdits(page.edits || [], scan.marks);
    const targets = new Map();
    const stale = [];
    for (const edit of annotated) {
      const entry = {
        id: edit.id, kind: edit.kind, label: KIND_LABEL[edit.kind] || edit.kind, at: edit.at || null,
        description: describeEdit(edit), before: edit.before ?? null, after: edit.after ?? null, rows: editRows(edit),
      };
      if (edit.status === 'stale') {
        const mark = byId.get(edit.target);
        stale.push({ ...entry, target: edit.target, reason: mark ? `页面里的「${edit.target}」没有给「${KIND_LABEL[edit.kind] || edit.kind}」这种能力（现有：${mark.caps.join(' ') || '无'}）` : `页面里找不到「${edit.target}」（可能被 agent 改掉或改了编号）` });
        continue;
      }
      if (!targets.has(edit.target)) {
        const mark = byId.get(edit.target);
        const user = isUserImage(edit.target);
        const add = user ? annotated.find(e => e.target === edit.target && e.kind === 'addImage') : null;
        const asset = add ? assets.get(add.after?.asset) : null;
        targets.set(edit.target, {
          target: edit.target,
          userImage: user,
          origin: mark?.origin ?? null,
          tag: user ? 'img' : mark?.tag ?? null,
          caps: user ? ['move', 'resize', 'crop'] : mark?.caps ?? [],
          asset: asset ? { id: asset.id, file: asset.file, name: asset.name || '' } : null,
          edits: [],
        });
      }
      targets.get(edit.target).edits.push(entry);
    }
    for (const t of targets.values()) t.edits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const list = [...targets.values()].sort((a, b) => Number(a.userImage) - Number(b.userImage));
    const count = list.reduce((n, t) => n + t.edits.length, 0);
    return {
      number: index + 1, pageId: page.id, name: page.name || '', title: pageTitle(project, page, index), file: page.file,
      device: page.device || null, size: pageSize(project, page), origin: page.origin || null,
      missingFile: html === null,
      status: count || stale.length ? 'changed' : 'unchanged',
      count, targets: list, stale,
    };
  });
  const changed = pages.filter(p => p.count > 0);
  const editCount = pages.reduce((n, p) => n + p.count, 0);
  const staleCount = pages.reduce((n, p) => n + p.stale.length, 0);
  const targetCount = pages.reduce((n, p) => n + p.targets.length, 0);
  const text = editCount || staleCount
    ? `共 ${pages.length} 页，${changed.length} 页有改动：${targetCount} 个元素、${editCount} 条修改${staleCount ? `；另有 ${staleCount} 条对不上（页面里找不到目标或不再允许这种修改），单独列出` : ''}。`
    : `共 ${pages.length} 页，修改单是空的：没有需要改的地方。`;
  return { summary: { pages: pages.length, changedPages: changed.length, targets: targetCount, edits: editCount, stale: staleCount, text }, pages };
}

// ---------- 改动清单.md ----------
const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '↵');

function locate(t) {
  if (t.userImage) return `用户贴进来的图片（编号 ${t.target}${t.asset ? `，素材 ${t.asset.file}` : ''}），原网页没有，加在 <body> 末尾、绝对定位`;
  const bits = [`data-vw-id="${t.target}"`];
  if (t.origin) bits.push(`data-vw-origin="${t.origin}"`);
  if (t.tag) bits.push(`<${t.tag}>`);
  return bits.map(b => `\`${b}\``).join('，');
}

export function renderMarkdown(changes, { projectName = '', generatedAt = '', compare = null } = {}) {
  const lines = [`# 改动清单${projectName ? `：${projectName}` : ''}`, ''];
  if (generatedAt) lines.push(`生成时间：${generatedAt}`, '');
  lines.push(
    '改前 = 页面源码本身；改后 = 用户在工作台里改过之后（修改单）。坐标、尺寸都是页面 CSS 像素。',
    '元素用 `data-vw-origin`（原网页里的定位，没有就看 `data-vw-id`）找到；只改下面列出的元素和属性，其他不动。',
    '',
    '## 总览', '', changes.summary.text, '',
  );
  for (const p of changes.pages) lines.push(`- ${p.title}：${p.status === 'changed' ? `${p.targets.length} 个元素、${p.count} 条修改${p.stale.length ? `，${p.stale.length} 条对不上` : ''}` : '本页无改动'}`);
  lines.push('');
  for (const p of changes.pages) {
    if (p.status !== 'changed') continue;
    lines.push(`## ${p.title}`, '');
    const meta = [`页面编号 ${p.pageId}`, `文件 ${p.file}`, `尺寸 ${p.size.width}×${p.size.height}`];
    if (p.origin?.url) meta.push(`来源网址 ${p.origin.url}`);
    if (p.origin?.file) meta.push(`来源文件 ${p.origin.file}`);
    lines.push(meta.join(' · '), '');
    const shots = compare?.[p.pageId];
    if (shots) lines.push(`对比图：${shots.join('、')}`, '');
    p.targets.forEach((t, i) => {
      lines.push(`### ${i + 1}. ${t.userImage ? '新增图片' : `元素「${t.target}」`}`, '');
      lines.push(`- 定位：${locate(t)}`);
      for (const e of t.edits) lines.push(`- **${e.description}**`);
      lines.push('', '| 项目 | 改前 | 改后 |', '|---|---|---|');
      for (const e of t.edits) for (const row of e.rows) lines.push(`| ${cell(row.label)} | ${cell(row.before)} | ${cell(row.after)} |`);
      lines.push('');
    });
    if (p.stale.length) {
      lines.push('### 对不上的条目', '', '页面已经变了，这些修改找不到对应的元素或不再允许，请对照截图自行判断要不要做：', '');
      for (const s of p.stale) lines.push(`- ${s.description}（${s.reason}；条目 ${s.id}）`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

// ---------- 对比图 ----------
export function stamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

/** 左改前右改后，中间 24px 间隔，顶部 40px 色条（灰 = 改前，蓝 = 改后），高度取两者最大。 */
async function sideBySide(left, right, outFile) {
  const { default: sharp } = await import('sharp');
  const [l, r] = await Promise.all([sharp(left).metadata(), sharp(right).metadata()]);
  const GAP = 24, BAR = 40;
  const width = l.width + GAP + r.width, height = Math.max(l.height, r.height) + BAR;
  const bar = (w, color) => ({ input: { create: { width: w, height: BAR, channels: 3, background: color } } });
  await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([
      { ...bar(l.width, '#9ca3af'), left: 0, top: 0 },
      { ...bar(r.width, '#2563eb'), left: l.width + GAP, top: 0 },
      { input: left, left: 0, top: BAR },
      { input: right, left: l.width + GAP, top: BAR },
    ])
    .png().toFile(outFile);
}

/** 默认截图：同一套 export-render，每页截「改前（修改单清空）」「改后」两张。返回 { [pageId]: { before, after } }（PNG Buffer）。 */
async function defaultShooter({ projectDir, pageIds }) {
  const shots = {};
  await captureProject({
    projectDir, type: 'png', pageIds,
    variants: [project => { for (const page of project.pages) page.edits = []; return project; }, null],
    onShot(index, page, buffer, count, { variant }) { (shots[page.id] ||= {})[variant === 0 ? 'before' : 'after'] = buffer; },
  });
  return shots;
}

/**
 * 生成交接包。返回 { outDir, files: [相对 outDir 的路径], agentText, summary }。
 * shooter：({ projectDir, project, pageIds }) → { [pageId]: { before, after } }，默认真实浏览器截图。
 */
export async function exportHandoff({ projectDir, outDir, images = true, shooter = defaultShooter, now = () => new Date() } = {}) {
  if (!projectDir || !outDir) throw new Error('exportHandoff 需要 projectDir 和 outDir');
  projectDir = resolve(projectDir); outDir = resolve(outDir);
  let project;
  try { project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8')); } catch (error) { throw new Error(`读不到项目文件：${error.message}`); }
  const changes = buildChanges(project, page => { try { return readFileSync(join(projectDir, page.file), 'utf8'); } catch { return null; } });
  const date = now();
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const write = (rel, content) => { writeFileSync(join(outDir, rel), content); files.push(rel.replace(/\\/g, '/')); };

  const compare = {};
  const pageIds = changes.pages.filter(p => p.count > 0).map(p => p.pageId);
  if (images && pageIds.length) {
    const compareDir = join(outDir, 'compare');
    mkdirSync(compareDir, { recursive: true });
    const shots = await shooter({ projectDir, project, pageIds });
    for (const p of changes.pages) {
      const shot = shots[p.pageId];
      if (!shot?.before || !shot?.after) continue;
      const base = `${pad2(p.number)}-${p.device || 'page'}`;
      const names = [`compare/${base}-改前.png`, `compare/${base}-改后.png`, `compare/${base}-对比.png`];
      write(names[0], shot.before);
      write(names[1], shot.after);
      await sideBySide(shot.before, shot.after, join(outDir, names[2]));
      files.push(names[2]);
      compare[p.pageId] = names;
      p.compare = { before: names[0], after: names[1], sideBySide: names[2] };
    }
  }

  const listFile = join(outDir, '改动清单.md');
  const sepChar = process.platform === 'win32' ? '\\' : '/';
  const agentText = `请按改动清单修改网站代码：清单在 ${listFile}（机器可读版 ${join(outDir, 'changes.json')}）`
    + (Object.keys(compare).length ? `，改前改后对比图在 ${join(outDir, 'compare')}${sepChar}` : '')
    + '。改动按页、按元素列出，用 data-vw-origin / data-vw-id 定位元素；只改清单列出的元素和属性，颜色、字号、位置和尺寸按清单里的精确值，其他地方保持不动。'
    + (changes.summary.stale ? '「对不上的条目」是页面已经变了的修改，请对照截图判断。' : '')
    + (Object.keys(compare).length ? '改完请对照对比图检查。' : '');
  const generatedAt = date.toISOString();
  write('改动清单.md', renderMarkdown(changes, { projectName: project.name, generatedAt, compare }));
  write('changes.json', JSON.stringify({ format: 'visual-workbench/changes', version: 2, projectId: project.id, projectName: project.name, kind: project.kind || 'deck', generatedAt, ...changes }, null, 2));
  write('复制给agent.txt', agentText);
  return { outDir, files, agentText, summary: changes.summary };
}

/** 默认交接包目录：<数据目录>/exports/<项目编号>/handoff-<yyyyMMdd-HHmmss>/ */
export function defaultHandoffDir(dataDir, projectId, date = new Date()) {
  return join(dataDir, 'exports', projectId, `handoff-${stamp(date)}`);
}
