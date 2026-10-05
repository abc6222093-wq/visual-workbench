// 「复制给 agent」（格式 v3）：用户开新的 agent 对话时粘贴。写明项目在哪、规则和格式在哪、要处理的页面文件、
// 修改单摘要（每条大白话，标出「对不上」），以及开工三步、改完三步。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_LAYOUT } from './data-dir.js';
import { SERIES_FILE } from './master.js';
import { readPageHtml } from './validate.js';
import { describeEdit, editStatus } from '../web/edits-model.js';
import { scanMarks } from '../web/page-marks.js';
import { annotationLines } from './annotations.js';
import { DRAFT_LEVELS, blocksFromDraftHtml } from '../web/draft-model.js';

export const BRIEF_INTENTS = ['edits', 'design', 'unify'];
const LEVEL_LABEL = Object.fromEntries(DRAFT_LEVELS.map((l) => [l.id, l.label]));
const DESIGN_CARD_REMINDER = '每次做完设计，都要在 project.json 写 / 更新 designCard（设计卡片：方向、概念、配色、字体、特征、at），格式见 docs/format.md §17。';

/** 设计卡片 → 文字（总览卡片「复制给 agent」和 brief 共用）；没有卡片返回 ''。 */
export function designCardText(project) {
  const card = project?.designCard;
  if (!card || typeof card !== 'object') return '';
  const name = typeof project.name === 'string' && project.name ? project.name : project.id || '';
  const list = (v, sep) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).join(sep) : '');
  const lines = [`设计风格参考（项目「${name}」的设计卡片）`];
  if (card.direction) lines.push(`方向：${card.direction}`);
  if (card.concept) lines.push(`概念：${card.concept}`);
  if (list(card.colors, ' ')) lines.push(`配色：${list(card.colors, ' ')}`);
  if (list(card.fonts, ' / ')) lines.push(`字体：${list(card.fonts, ' / ')}`);
  if (list(card.traits, ' · ')) lines.push(`特征：${list(card.traits, ' · ')}`);
  return lines.join('\n');
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** 一页修改单的状态（读页面文件算「对不上」）。 */
export function pageEditSummary(projectDir, page) {
  const edits = Array.isArray(page?.edits) ? page.edits : [];
  const html = readPageHtml(projectDir, page);
  const marks = html === null ? new Map() : scanMarks(html).marks;
  return edits.map((e) => ({ ...e, status: editStatus(e, marks, edits), text: describeEdit(e) }));
}

/**
 * 生成一段中文纯文本。
 * @param {{repoDir: string, dataDir?: string, projectDir: string, project?: object, pageIds?: string[]}} opts
 *   pageIds：只处理这些页（「当前页」）；不给 = 全部页。
 */
export function agentBrief({ repoDir, dataDir, projectDir, project, pageIds, intent = 'edits' }) {
  if (!BRIEF_INTENTS.includes(intent)) throw new Error(`不认识的 intent：${intent}`);
  if (typeof repoDir !== 'string' || !repoDir) throw new Error('缺少工作台代码文件夹路径');
  if (typeof projectDir !== 'string' || !projectDir) throw new Error('缺少项目文件夹路径');
  const projectFile = join(projectDir, PROJECT_LAYOUT.file);
  const p = project || readJson(projectFile);
  if (!p || typeof p !== 'object') throw new Error(`读不到项目文件：${projectFile}`);
  const id = typeof p.id === 'string' && p.id ? p.id : '（未知编号）';
  const name = typeof p.name === 'string' && p.name ? p.name : '（未命名）';
  const allPages = Array.isArray(p.pages) ? p.pages : [];
  const only = Array.isArray(pageIds) && pageIds.length ? new Set(pageIds) : null;
  let pages = only ? allPages.filter((page) => only.has(page.id)) : allPages;
  if (!only && intent === 'design') pages = pages.filter((page) => page.draft === true);
  if (!only && intent === 'unify') pages = pages.filter((page) => isForeign(page, id));

  const opening = { edits: '请在「视觉工作台」里继续做这个项目。', design: '请在「视觉工作台」里把这个项目的草稿页设计成正式页面。', unify: '请在「视觉工作台」里把这个项目里从别的项目拼进来的页面统一成本项目的风格。' }[intent];
  const lines = [opening, ''];
  lines.push(`工作台代码文件夹：${repoDir}`);
  if (typeof dataDir === 'string' && dataDir) lines.push(`数据目录：${dataDir}`);
  lines.push(
    `规则：${join(repoDir, 'CLAUDE.md')}（Claude Code）或 ${join(repoDir, 'AGENTS.md')}（Codex）`,
    `格式：${join(repoDir, 'docs', 'format.md')}（格式 v3：每页一个 HTML 文件，用户的修改在修改单里）`,
    '',
    '项目：',
    `- 编号：${id}`,
    `- 名称：${name}${p.kind === 'web' ? '（网页项目）' : ''}`,
    `- 文件夹：${projectDir}`,
    `- 项目文件：${projectFile}`,
  );

  const seriesFile = join(projectDir, SERIES_FILE);
  if (existsSync(seriesFile)) {
    const series = readJson(seriesFile);
    const master = series && typeof series.master === 'string' && series.master ? series.master : '（未知）';
    lines.push(`- 来自系列母版 ${master}：配色和母版各页见 ${seriesFile}，母版页面的 HTML 参考在 ${join(projectDir, 'series', 'pages')}`);
  }
  const importDir = join(projectDir, 'import');
  if (existsSync(importDir) && statSync(importDir).isDirectory()) {
    lines.push(`- 导入时的原文件在 ${importDir}（只读参考，不要改）；每页 notes 里有迁移说明`);
  }

  const card = intent === 'unify' ? '' : designCardText(p);
  if (card) lines.push('', '本项目的设计卡片（保持这个风格）：', ...card.split('\n').map((l) => `  ${l}`));

  if (intent === 'design') designSection(lines, { repoDir, projectDir, allPages, pages, id, only });
  else if (intent === 'unify') unifySection(lines, { repoDir, projectDir, p, allPages, pages, id, only });
  else editsSection(lines, { repoDir, projectDir, allPages, pages, id, only });
  lines.push('', DESIGN_CARD_REMINDER, '', '工作台开着的话，你改完文件界面会自动刷新，不用让用户手动刷新。');
  return lines.join('\n') + '\n';
}

const pageFile = (projectDir, page) => join(projectDir, page.file || `pages/${page.id}.html`);
const pageLine = (projectDir, allPages, page) => `- 第 ${allPages.indexOf(page) + 1} 页「${page.name || page.id}」（${page.id}）：${pageFile(projectDir, page)}${page.device ? `（${page.device === 'mobile' ? '手机端' : '电脑端'}）` : ''}`;
const isForeign = (page, id) => typeof page?.origin?.project === 'string' && page.origin.project && page.origin.project !== id;
function editLines(projectDir, page) {
  const summary = pageEditSummary(projectDir, page);
  if (!summary.length) return { lines: [], total: 0, stale: 0 };
  let stale = 0;
  const lines = [`  修改单（${summary.length} 条）：`];
  for (const e of summary) {
    if (e.status === 'stale') stale += 1;
    lines.push(`  · ${e.id}${e.status === 'stale' ? '【对不上】' : ''} ${e.text}`);
  }
  return { lines, total: summary.length, stale };
}
function annotationsHint(lines, pages, id, only) {
  const count = pages.reduce((n, page) => n + (Array.isArray(page.annotations) ? page.annotations.length : 0), 0);
  if (!count) return '';
  const pageArg = only && pages.length === 1 ? ` --page ${pages[0].id}` : '';
  lines.push('', `用户在页面上留了 ${count} 条批注（她自己改不了、要你改的地方），请一并处理。`);
  return `npm run annotations -- ${id} --clear${pageArg || ' [--page <页面编号>]'} [<批注编号>…]`;
}
function startSteps(lines, id, pageArg, repoDir) {
  lines.push(
    '',
    '开工前：',
    `1. 读 ${join(repoDir, 'docs', 'format.md')} 和规则文件（不要凭记忆）`,
    `2. 读最新的 project.json 和要改的页面文件，看修改单：npm run edits -- ${id}${pageArg}`,
    `3. 存一版：npm run save-version -- ${id} -m "本轮说明"`,
  );
}

function editsSection(lines, { repoDir, projectDir, allPages, pages, id, only }) {
  lines.push('', only ? `这次只处理下面 ${pages.length} 页（其他页不要动）：` : `全部 ${pages.length} 页：`);
  let total = 0, stale = 0;
  for (const page of pages) {
    lines.push(pageLine(projectDir, allPages, page));
    const e = editLines(projectDir, page);
    total += e.total; stale += e.stale;
    if (!e.total) lines.push('  修改单：无'); else lines.push(...e.lines);
    lines.push(...annotationLines(page));
  }
  if (total) {
    lines.push('', `用户在工作台里改了 ${total} 处${stale ? `（其中 ${stale} 处对不上：页面里已没有那个编号或没给那种能力，请按意思判断）` : ''}。请把这些修改真正写进页面文件，顺手调和周围版面。`);
  }
  const clearNotes = annotationsHint(lines, pages, id, only);
  const pageArg = only && pages.length === 1 ? ` --page ${pages[0].id}` : '';
  startSteps(lines, id, pageArg, repoDir);
  lines.push(
    '',
    '改完后：',
    `1. 校验：npm run validate -- "${projectDir}"`,
    `2. 动效检查：npm run check-motion -- "${projectDir}"`,
    `3. 把已经写进页面的修改单条目清掉：npm run edits -- ${id} --clear${pageArg || ' [--page <页面编号>]'} [<条目编号>…]（不写条目编号 = 清掉整页 / 整个项目）`,
  );
  if (clearNotes) lines.push(`4. 把处理过的批注清掉：${clearNotes}`);
}

function designSection(lines, { repoDir, projectDir, allPages, pages, id, only }) {
  const drafts = pages.filter((page) => page.draft === true);
  lines.push('', drafts.length ? `下面 ${drafts.length} 页是草稿页（用户从文案分好的页，还没有设计）：` : '这次要处理的页里没有草稿页。');
  for (const page of drafts) {
    lines.push(pageLine(projectDir, allPages, page));
    let html = null;
    try { html = readFileSync(pageFile(projectDir, page), 'utf8'); } catch { /* 读不了就不列块 */ }
    const blocks = html === null ? [] : blocksFromDraftHtml(html);
    if (!blocks.length) lines.push('  内容：（空）');
    else {
      lines.push('  内容（层级只是提示，版式由你定）：');
      for (const b of blocks) {
        if (!b.text.trim()) { lines.push('  · （空行）'); continue; }
        lines.push(`  · 【${LEVEL_LABEL[b.level] || '正文'}】${b.text.replace(/\n/g, '\n    ')}`);
      }
    }
    if (typeof page.notes === 'string' && page.notes.trim()) lines.push('  备注（不上页面，给你参考）：', ...page.notes.trim().split('\n').map((l) => `    ${l}`));
    lines.push(...annotationLines(page));
  }
  const others = pages.filter((page) => page.draft !== true);
  if (only && others.length) lines.push('', `另外 ${others.length} 页不是草稿页，这次不用设计。`);
  lines.push(
    '',
    '要求：',
    '- 把每个草稿页改写成正式页面：保留页面编号和页面文件名（写回同一个 pages/<页面编号>.html），文字内容照用，层级（大标题、正文等）只是提示，版式、字体、配色、动效由你设计；',
    '- 在页面里给用户能改的地方标 data-vw-id / data-vw（见 docs/format.md §4.2）；',
    '- 设计完在 project.json 里去掉这些页的 "draft": true；备注（notes）里的【辅助信息】【动效】按需要用上；',
    '- 同一个项目的各页风格要一致。',
  );
  const clearNotes = annotationsHint(lines, drafts, id, only);
  startSteps(lines, id, '', repoDir);
  lines.push('', '改完后：', `1. 校验：npm run validate -- "${projectDir}"`, `2. 动效检查：npm run check-motion -- "${projectDir}"`);
  if (clearNotes) lines.push(`3. 把处理过的批注清掉：${clearNotes}`);
}

function unifySection(lines, { repoDir, projectDir, p, allPages, pages, id, only }) {
  const foreign = pages.filter((page) => isForeign(page, id));
  lines.push('', foreign.length ? `下面 ${foreign.length} 页是从别的项目拼进来的：` : '这次要处理的页里没有从别的项目拼进来的页。');
  const names = new Map();
  for (const page of foreign) {
    const src = page.origin.project;
    if (!names.has(src)) {
      let name = '';
      try { name = JSON.parse(readFileSync(join(projectDir, '..', src, PROJECT_LAYOUT.file), 'utf8')).name || ''; } catch { /* 来源项目可能已删除 */ }
      names.set(src, name);
    }
    const srcName = names.get(src);
    lines.push(`${pageLine(projectDir, allPages, page)}，来自项目 ${src}${srcName ? `「${srcName}」` : '（已找不到）'}${page.origin.page ? ` 的 ${page.origin.page}` : ''}`);
    const e = editLines(projectDir, page);
    if (e.total) lines.push(...e.lines);
    lines.push(...annotationLines(page));
  }
  const card = designCardText(p);
  lines.push('', '本项目的设计卡片：');
  if (card) lines.push(...card.split('\n').map((l) => `  ${l}`));
  else lines.push('  本项目还没有设计卡片，请先按本项目其他页的风格判断并写一张。');
  lines.push(
    '',
    '要求：',
    '- 把这些页改成和本项目一致的风格（配色、字体、版式、装饰、动效手法），内容（文字、图片、信息）不变；',
    '- 保留页面编号和页面文件名，保留页面里已有的 data-vw-id；有修改单的照常把修改写进页面；',
    '- 改完写 / 更新本项目的 designCard。',
  );
  const clearNotes = annotationsHint(lines, foreign, id, only);
  startSteps(lines, id, '', repoDir);
  lines.push(
    '',
    '改完后：',
    `1. 校验：npm run validate -- "${projectDir}"`,
    `2. 动效检查：npm run check-motion -- "${projectDir}"`,
    `3. 已经写进页面的修改单条目清掉：npm run edits -- ${id} --clear [--page <页面编号>] [<条目编号>…]`,
  );
  if (clearNotes) lines.push(`4. 把处理过的批注清掉：${clearNotes}`);
}

/**
 * 「请整理文件夹」的开场白。
 * @param {{repoDir: string, dataDir: string, folders: Array<{name, count}>, projects: Array<{id, name, folder, updatedAt}>, backup?: {at}|null}} o
 */
export function organizeBrief({ repoDir, dataDir, folders = [], projects = [], backup = null }) {
  const lines = ['请在「视觉工作台」里帮我整理项目文件夹。', ''];
  lines.push(`工作台代码文件夹：${repoDir}`);
  if (dataDir) lines.push(`数据目录：${dataDir}`);
  lines.push(`规则：${join(repoDir, 'CLAUDE.md')}（Claude Code）或 ${join(repoDir, 'AGENTS.md')}（Codex）`, `格式：${join(repoDir, 'docs', 'format.md')} §16`, '');
  lines.push(folders.length ? `现有文件夹（${folders.length} 个）：` : '现在还没有文件夹。');
  for (const f of folders) lines.push(`- ${f.name}（${f.count} 个项目）`);
  lines.push('', `全部项目（${projects.length} 个）：`);
  for (const p of projects) lines.push(`- ${p.id}「${p.name}」 文件夹：${p.folder || '（未分类）'} 更新于 ${p.updatedAt || '未知'}`);
  if (backup?.at) lines.push('', `注意：已经有一份整理前的备份（${backup.at}）；重新 begin 会覆盖它。`);
  lines.push(
    '',
    '怎么做：',
    '1. 先记录原状：npm run organize -- begin',
    '2. 看现状：npm run organize -- list',
    '3. 整理：npm run organize -- folder <文件夹名>（新建文件夹）、npm run organize -- move <项目编号> <文件夹名|/>（移进文件夹，/ = 移出）、npm run organize -- rename <项目编号> <新名称>（改名）',
    '',
    '要求：',
    '- 不删除任何项目，不改项目内容，只动名称和所在文件夹；',
    '- 项目名称用「日期 + 简短名」，例如「2026-10-05 水曜会话课表」（日期取项目的建立或更新时间）；',
    '- 文件夹只有一层，名字简短、不含 / 或 \\；',
    '- 整理完列出改了什么（哪些项目改了名、移到了哪个文件夹、新建了哪些文件夹）。',
    '',
    '用户可以在总览点「退回整理前」一键恢复（等同 npm run organize -- restore）。',
    '',
    DESIGN_CARD_REMINDER,
  );
  return lines.join('\n') + '\n';
}
