// 批注（第 13 轮，docs/format.md §18）：用户在页面上画框写的一句话，记在 pages[].annotations。
// agent 用 npm run annotations 列出、处理完 --clear 清掉（清除前自动存版，和 edits --clear 一样只改这一个字段）。
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { saveVersion } from './version.js';
import { LEGACY_MESSAGE, isLegacyProject } from './validate.js';

const round = (n) => (Number.isFinite(n) ? Math.round(n) : n);

/** 批注截图（npm run annotations / brief 用）：项目目录下 annotations/<页面编号>.png，可再生成，不进版本存档。 */
export const SHOTS_DIR = 'annotations';
export const shotRelPath = (pageId) => `${SHOTS_DIR}/${pageId}.png`;
export const isStrokeAnnotation = (a) => a?.kind === 'stroke';
/** 种类：框 / 划线 / 箭头 */
export const annotationKind = (a) => (isStrokeAnnotation(a) ? (a.arrow ? '箭头' : '划线') : '框');
function strokeWhere(a) {
  const pts = Array.isArray(a.points) ? a.points : [];
  if (!pts.length) return '（没有点）';
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  const [s, e] = [pts[0], pts[pts.length - 1]];
  return `从 ${round(s[0])}, ${round(s[1])} 到 ${round(e[0])}, ${round(e[1])}，范围 ${round(x)}, ${round(y)}, 宽 ${round(Math.max(...xs) - x)}, 高 ${round(Math.max(...ys) - y)}${a.color ? `，${a.color}` : ''}`;
}
/** 一条批注的一行文字：`an_xxx 「这里加一个字」（位置 x, y, 宽 w, 高 h）`；划线：`an_xxx 箭头「…」（从 … 到 …）` */
export function annotationText(a) {
  if (isStrokeAnnotation(a)) return `${a.id} ${annotationKind(a)}${a.text ? `「${a.text}」` : '（没写字）'}（${strokeWhere(a)}）`;
  return `${a.id} 「${String(a.text ?? '')}」（位置 ${round(a.x)}, ${round(a.y)}, 宽 ${round(a.width)}, 高 ${round(a.height)}）`;
}
/**
 * brief 里每页末尾的批注段（没有批注返回 []）。编号 ① 起，和批注截图上的编号一致。
 * shotPath：这一页批注截图的绝对路径（有就列「先打开看」）。
 */
export function annotationLines(page, indent = '  ', shotPath = null) {
  const list = Array.isArray(page?.annotations) ? page.annotations : [];
  if (!list.length) return [];
  const out = [`${indent}批注（${list.length} 条）：`];
  if (shotPath) out.push(`${indent}批注截图：${shotPath}（先打开看）`);
  list.forEach((a, i) => out.push(`${indent}· ${annotationText(a)} 〔截图编号 ${i + 1}，${annotationKind(a)}〕`));
  return out;
}

function readProject(dir) {
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
  if (isLegacyProject(project)) throw new Error(LEGACY_MESSAGE);
  return project;
}

/** 列出批注：[{ pageId, pageName, number, annotations: [...] }] */
export function listAnnotations(projectDir, { page = null } = {}) {
  const project = readProject(projectDir);
  const pages = project.pages.filter((p) => !page || p.id === page);
  if (page && !pages.length) throw new Error(`项目里没有这一页：${page}`);
  return pages.map((p) => ({ pageId: p.id, pageName: p.name, number: project.pages.indexOf(p) + 1, annotations: Array.isArray(p.annotations) ? p.annotations : [] }));
}

export function formatAnnotations(list) {
  const lines = [];
  let total = 0;
  for (const page of list) {
    lines.push(`第 ${page.number} 页「${page.pageName || page.pageId}」（${page.pageId}）：${page.annotations.length ? `${page.annotations.length} 条批注` : '没有批注'}`);
    for (const a of page.annotations) { total += 1; lines.push(`  ${annotationText(a)}`); }
  }
  lines.push(`共 ${total} 条批注`);
  return lines.join('\n');
}

/** 清除批注：返回 { removed: [编号], versionDir }；没有要清的不存版、不写文件。 */
export function clearAnnotations(projectDir, { page = null, ids = [] } = {}) {
  const project = readProject(projectDir);
  if (page && !project.pages.some((p) => p.id === page)) throw new Error(`项目里没有这一页：${page}`);
  const scope = project.pages.filter((p) => !page || p.id === page);
  const known = new Set(scope.flatMap((p) => (p.annotations || []).map((a) => a.id)));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`${page ? '这一页' : '项目'}里没有这些批注：${missing.join('、')}`);
  const removed = scope.flatMap((p) => (p.annotations || []).map((a) => a.id)).filter((id) => !ids.length || ids.includes(id));
  if (!removed.length) return { removed, versionDir: null };
  const { versionDir } = saveVersion({ projectDir, note: '清除批注前自动存版', by: 'agent' });
  // 存版后重新读一遍，只改 annotations
  const latest = readProject(projectDir);
  const removedSet = new Set(removed);
  const scopeIds = new Set(scope.map((p) => p.id));
  for (const p of latest.pages) {
    if (!scopeIds.has(p.id) || !Array.isArray(p.annotations)) continue;
    p.annotations = p.annotations.filter((a) => !removedSet.has(a.id));
    if (!p.annotations.length) delete p.annotations;
  }
  latest.updatedAt = new Date().toISOString();
  const file = join(projectDir, 'project.json');
  const tmp = join(projectDir, `.project-${randomUUID()}.tmp`);
  try { writeFileSync(tmp, JSON.stringify(latest, null, 2) + '\n', { flag: 'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
  // 批注截图跟着失效：清过的页一律删掉旧图（还剩批注的页下次复制给 agent 时重新截）
  for (const p of latest.pages) {
    if (!scopeIds.has(p.id)) continue;
    const shot = join(projectDir, shotRelPath(p.id));
    if (existsSync(shot)) rmSync(shot, { force: true });
  }
  return { removed, versionDir };
}
