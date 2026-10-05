#!/usr/bin/env node
// 修改单：npm run edits -- <项目编号或路径> [--page <页面编号>] [--json]
//         npm run edits -- <项目编号或路径> --clear [--page <页面编号>] [<条目编号>…]
// 列出：每条的编号、目标、种类、大白话、状态（「对不上」= 页面里没有这个编号或没给这种能力）。
// 清除：先自动存版「清除修改单前自动存版」，再从 project.json 里删掉这些条目；不给条目编号就清整页（给了 --page）或整个项目。只改 edits。
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { saveVersion } from '../version.js';
import { pageEditSummary } from '../brief.js';
import { clearEdits } from '../../web/edits-model.js';
import { LEGACY_MESSAGE, isLegacyProject } from '../validate.js';

const USAGE = '用法：npm run edits -- <项目编号或路径> [--page <页面编号>] [--json]\n      npm run edits -- <项目编号或路径> --clear [--page <页面编号>] [<条目编号>…]';
const KIND_LABEL = { text: '文字', fontSize: '字号', move: '位置', resize: '大小', color: '文字颜色', background: '底色', crop: '裁切', addImage: '贴图' };

export function parseArgs(argv) {
  const out = { positional: [], page: null, json: false, clear: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') { out.page = argv[++i]; if (!out.page) throw Object.assign(new Error('--page 后面要写页面编号'), { usage: true }); }
    else if (a === '--json') out.json = true;
    else if (a === '--clear') out.clear = true;
    else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  if (!out.positional.length) throw Object.assign(new Error('缺少项目编号或路径'), { usage: true });
  if (!out.clear && out.positional.length > 1) throw Object.assign(new Error('列出修改单时只写一个项目；要清除指定条目请加 --clear'), { usage: true });
  return out;
}

function readProject(dir) {
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
  if (isLegacyProject(project)) throw new Error(LEGACY_MESSAGE);
  return project;
}

/** 列出修改单：[{ pageId, pageName, number, edits: [{ id, target, kind, at, before, after, status, text }] }] */
export function listEdits(projectDir, { page = null } = {}) {
  const project = readProject(projectDir);
  const pages = project.pages.filter((p) => !page || p.id === page);
  if (page && !pages.length) throw new Error(`项目里没有这一页：${page}`);
  return pages.map((p) => ({ pageId: p.id, pageName: p.name, number: project.pages.indexOf(p) + 1, edits: pageEditSummary(projectDir, p) }));
}

export function formatEdits(list) {
  const lines = [];
  let total = 0, stale = 0;
  for (const page of list) {
    lines.push(`第 ${page.number} 页「${page.pageName || page.pageId}」（${page.pageId}）：${page.edits.length ? `${page.edits.length} 条` : '没有修改'}`);
    for (const e of page.edits) {
      total += 1;
      if (e.status === 'stale') stale += 1;
      lines.push(`  ${e.id}  目标 ${e.target}  ${KIND_LABEL[e.kind] || e.kind}  ${e.status === 'stale' ? '【对不上】' : '对得上'}`);
      lines.push(`      ${e.text}`);
    }
  }
  lines.push(`共 ${total} 条${stale ? `，其中 ${stale} 条对不上` : ''}`);
  return lines.join('\n');
}

/** 清除修改单：返回 { removed: [条目编号], versionDir }；没有要清的条目时不存版、不写文件。 */
export function clearProjectEdits(projectDir, { page = null, ids = [] } = {}) {
  const project = readProject(projectDir);
  if (page && !project.pages.some((p) => p.id === page)) throw new Error(`项目里没有这一页：${page}`);
  const scope = project.pages.filter((p) => !page || p.id === page);
  const known = new Set(scope.flatMap((p) => (p.edits || []).map((e) => e.id)));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`${page ? '这一页' : '项目'}里没有这些修改单条目：${missing.join('、')}`);
  const removed = [];
  for (const p of scope) {
    const before = p.edits || [];
    const own = ids.length ? ids.filter((id) => before.some((e) => e.id === id)) : null;
    if (own && !own.length) continue;
    const after = clearEdits(before, own);
    for (const e of before) if (!after.includes(e)) removed.push(e.id);
    p.edits = after;
  }
  if (!removed.length) return { removed, versionDir: null };
  const { versionDir } = saveVersion({ projectDir, note: '清除修改单前自动存版', by: 'agent' });
  // 存版后重新读一遍，只改 edits，避免覆盖存版期间用户的其他修改
  const latest = readProject(projectDir);
  const removedSet = new Set(removed);
  for (const p of latest.pages) if (Array.isArray(p.edits)) p.edits = p.edits.filter((e) => !removedSet.has(e.id));
  latest.updatedAt = new Date().toISOString();
  const file = join(projectDir, 'project.json');
  const tmp = join(projectDir, `.project-${randomUUID()}.tmp`);
  try { writeFileSync(tmp, JSON.stringify(latest, null, 2) + '\n', { flag: 'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  return { removed, versionDir };
}

function main() {
  let args;
  try { args = parseArgs(stripDataDirArg(process.argv.slice(2))); }
  catch (e) { console.error(`出错：${e.message}`); console.error(USAGE); process.exit(2); }
  try {
    const { dataDir } = loadConfig();
    const dir = resolveProject(args.positional[0], dataDir);
    if (args.clear) {
      const { removed, versionDir } = clearProjectEdits(dir, { page: args.page, ids: args.positional.slice(1) });
      if (!removed.length) { console.log('没有要清除的修改单条目。'); return; }
      console.log(`已存版本：${versionDir}`);
      console.log(`已清除 ${removed.length} 条：${removed.join('、')}`);
      return;
    }
    const list = listEdits(dir, { page: args.page });
    if (args.json) console.log(JSON.stringify(list, null, 2));
    else console.log(formatEdits(list));
  } catch (e) {
    console.error(`出错：${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
