// 「复制给 agent」（格式 v3）：用户开新的 agent 对话时粘贴。写明项目在哪、规则和格式在哪、要处理的页面文件、
// 修改单摘要（每条大白话，标出「对不上」），以及开工三步、改完三步。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_LAYOUT } from './data-dir.js';
import { SERIES_FILE } from './master.js';
import { readPageHtml } from './validate.js';
import { describeEdit, editStatus } from '../web/edits-model.js';
import { scanMarks } from '../web/page-marks.js';

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
export function agentBrief({ repoDir, dataDir, projectDir, project, pageIds }) {
  if (typeof repoDir !== 'string' || !repoDir) throw new Error('缺少工作台代码文件夹路径');
  if (typeof projectDir !== 'string' || !projectDir) throw new Error('缺少项目文件夹路径');
  const projectFile = join(projectDir, PROJECT_LAYOUT.file);
  const p = project || readJson(projectFile);
  if (!p || typeof p !== 'object') throw new Error(`读不到项目文件：${projectFile}`);
  const id = typeof p.id === 'string' && p.id ? p.id : '（未知编号）';
  const name = typeof p.name === 'string' && p.name ? p.name : '（未命名）';
  const allPages = Array.isArray(p.pages) ? p.pages : [];
  const only = Array.isArray(pageIds) && pageIds.length ? new Set(pageIds) : null;
  const pages = only ? allPages.filter((page) => only.has(page.id)) : allPages;

  const lines = ['请在「视觉工作台」里继续做这个项目。', ''];
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

  lines.push('', only ? `这次只处理下面 ${pages.length} 页（其他页不要动）：` : `全部 ${pages.length} 页：`);
  let total = 0, stale = 0;
  for (const page of pages) {
    const number = allPages.indexOf(page) + 1;
    const summary = pageEditSummary(projectDir, page);
    total += summary.length;
    lines.push(`- 第 ${number} 页「${page.name || page.id}」（${page.id}）：${join(projectDir, page.file || `pages/${page.id}.html`)}${page.device ? `（${page.device === 'mobile' ? '手机端' : '电脑端'}）` : ''}`);
    if (!summary.length) { lines.push('  修改单：无'); continue; }
    lines.push(`  修改单（${summary.length} 条）：`);
    for (const e of summary) {
      if (e.status === 'stale') stale += 1;
      lines.push(`  · ${e.id}${e.status === 'stale' ? '【对不上】' : ''} ${e.text}`);
    }
  }
  if (total) {
    lines.push('', `用户在工作台里改了 ${total} 处${stale ? `（其中 ${stale} 处对不上：页面里已没有那个编号或没给那种能力，请按意思判断）` : ''}。请把这些修改真正写进页面文件，顺手调和周围版面。`);
  }

  const pageArg = only && pages.length === 1 ? ` --page ${pages[0].id}` : '';
  lines.push(
    '',
    '开工前：',
    `1. 读 ${join(repoDir, 'docs', 'format.md')} 和规则文件（不要凭记忆）`,
    `2. 读最新的 project.json 和要改的页面文件，看修改单：npm run edits -- ${id}${pageArg}`,
    `3. 存一版：npm run save-version -- ${id} -m "本轮说明"`,
    '',
    '改完后：',
    `1. 校验：npm run validate -- "${projectDir}"`,
    `2. 动效检查：npm run check-motion -- "${projectDir}"`,
    `3. 把已经写进页面的修改单条目清掉：npm run edits -- ${id} --clear${pageArg || ' [--page <页面编号>]'} [<条目编号>…]（不写条目编号 = 清掉整页 / 整个项目）`,
    '',
    '工作台开着的话，你改完文件界面会自动刷新，不用让用户手动刷新。',
  );
  return lines.join('\n') + '\n';
}
