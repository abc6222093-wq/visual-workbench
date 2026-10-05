// 草稿页（第 13 轮，docs/format.md §15、docs/round13-contract.md §3 §5）：服务端写草稿页文件。
// 纯逻辑（分页、HTML、块）在 web/draft-model.js；这里负责项目里的页面条目、页面文件读写和出错时的回滚。
// 草稿页是工作台生成的，所以工作台可以直接改写它的页面文件（「工作台不碰页面文件」的唯一例外）。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDraftText, draftPageHtml, blocksFromDraftHtml, normalizeBlocks } from '../web/draft-model.js';
import { blankPageEntry, newPageId } from './copy-pages.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const DRAFT_TEXT_MAX = 2_000_000;
export const DRAFT_OPS = new Set(['draft', 'draft-update', 'draft-split', 'draft-merge']);
const PAGE_FILE = /^pages\/[^/\\]+\.html$/;

/** 解析文案；空文案或分不出页时抛 400。 */
export function parseDraft(text) {
  if (typeof text !== 'string') throw fail(400, '文案要写成文字');
  if (text.length > DRAFT_TEXT_MAX) throw fail(413, '文案太长了');
  const parsed = parseDraftText(text);
  if (!parsed.pages.length) throw fail(400, '文案里没有可以放上页面的内容');
  return parsed;
}
const draftInfo = (parsed) => ({ method: parsed.method, pages: parsed.pages.length, note: parsed.note });

/** 记录写过的页面文件，出错时可以撤回：新文件删掉，改写过的恢复原内容。 */
export function createFileWriter(dir, selfWrite) {
  const log = [];
  const abs = (rel) => join(dir, rel);
  return {
    write(rel, text) {
      if (!PAGE_FILE.test(rel)) throw fail(400, '草稿页的页面文件只能在 pages/ 下');
      const file = abs(rel);
      const prev = existsSync(file) ? readFileSync(file) : null;
      const bytes = Buffer.from(text, 'utf8');
      mkdirSync(dirname(file), { recursive: true });
      selfWrite?.(rel, bytes);
      const tmp = join(dirname(file), `.draft-${randomUUID()}.tmp`);
      try { writeFileSync(tmp, bytes, { flag: 'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); }
      log.push({ rel, prev });
    },
    rollback() {
      for (const { rel, prev } of log.reverse()) {
        selfWrite?.(rel, prev);
        if (prev === null) rmSync(abs(rel), { force: true });
        else writeFileSync(abs(rel), prev);
      }
      log.length = 0;
    },
  };
}

function draftPageEntries(parsed, project, taken) {
  return parsed.pages.map((p, i) => {
    const id = newPageId(taken); taken.add(id);
    const page = blankPageEntry({ id, name: p.name || `第 ${i + 1} 页`, project });
    page.draft = true;
    if (p.notes) page.notes = p.notes;
    return { page, html: draftPageHtml({ name: page.name, blocks: p.blocks, artboard: project.artboard }) };
  });
}

/**
 * 从文案新建项目时用：返回 { name, description, pages: [{ page, html }], draft }。
 * 名称取文案里的 `#` 标题，没有就用 fallbackName，再没有抛 400。
 */
export function draftProjectPages({ text, fallbackName, project }) {
  const parsed = parseDraft(text);
  const name = (parsed.name || '').trim() || (typeof fallbackName === 'string' ? fallbackName.trim() : '');
  if (!name) throw fail(400, '文案里没有 # 标题，请给项目起个名字');
  const entries = draftPageEntries(parsed, project, new Set());
  return { name: name.slice(0, 200), description: parsed.description || '', pages: entries, draft: draftInfo(parsed) };
}

function readDraftBlocks(dir, page) {
  try { return blocksFromDraftHtml(readFileSync(join(dir, page.file), 'utf8')); } catch { return []; }
}
function draftPage(project, pageId) {
  if (typeof pageId !== 'string') throw fail(400, '缺少页面编号');
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) throw fail(400, '找不到这一页');
  if (page.draft !== true) throw fail(400, '这一页不是草稿页');
  if (!PAGE_FILE.test(page.file || '')) throw fail(400, '草稿页的页面文件只能在 pages/ 下');
  return page;
}
function blocksOf(value) {
  try { return normalizeBlocks(value); } catch (e) { throw fail(400, e.message); }
}

/**
 * 草稿相关的页面操作（改 project，写页面文件；不写 project.json）。
 * @returns {{ project, pageIds: string[], removedFiles: string[], draft?: object }}
 */
export function draftOperation({ dir, project, body: b, after, writer }) {
  if (b.op === 'draft') {
    const parsed = parseDraft(b.text);
    const entries = draftPageEntries(parsed, project, new Set(project.pages.map((p) => p.id)));
    for (const { page, html } of entries) writer.write(page.file, html);
    const index = after ? project.pages.findIndex((p) => p.id === after) + 1 : project.pages.length;
    project.pages.splice(index, 0, ...entries.map((e) => e.page));
    return { project, pageIds: entries.map((e) => e.page.id), removedFiles: [], draft: draftInfo(parsed) };
  }
  if (b.op === 'draft-update') {
    const page = draftPage(project, b.pageId);
    writer.write(page.file, draftPageHtml({ name: page.name, blocks: blocksOf(b.blocks), artboard: project.artboard }));
    return { project, pageIds: [], removedFiles: [] };
  }
  if (b.op === 'draft-split') {
    const page = draftPage(project, b.pageId);
    const before = blocksOf(b.blocksBefore), rest = blocksOf(b.blocksAfter);
    const id = newPageId(new Set(project.pages.map((p) => p.id)));
    const next = blankPageEntry({ id, name: `${page.name || '草稿'}（续）`, project });
    if (page.device) { next.device = page.device; if (page.size) next.size = structuredClone(page.size); }
    next.draft = true;
    writer.write(page.file, draftPageHtml({ name: page.name, blocks: before, artboard: project.artboard }));
    writer.write(next.file, draftPageHtml({ name: next.name, blocks: rest, artboard: project.artboard }));
    project.pages.splice(project.pages.indexOf(page) + 1, 0, next);
    return { project, pageIds: [id], removedFiles: [] };
  }
  if (b.op === 'draft-merge') {
    const page = draftPage(project, b.pageId);
    const next = project.pages[project.pages.indexOf(page) + 1];
    if (!next) throw fail(400, '这是最后一页，没有下一页可以合并');
    if (next.draft !== true) throw fail(400, '下一页不是草稿页，不能合并');
    const blocks = [...readDraftBlocks(dir, page), ...readDraftBlocks(dir, next)];
    writer.write(page.file, draftPageHtml({ name: page.name, blocks, artboard: project.artboard }));
    const notes = [page.notes, next.notes].filter((n) => typeof n === 'string' && n.trim()).join('\n\n');
    if (notes) page.notes = notes; else delete page.notes;
    if (Array.isArray(next.annotations) && next.annotations.length) page.annotations = [...(page.annotations || []), ...next.annotations];
    project.pages = project.pages.filter((p) => p !== next);
    return { project, pageIds: [], removedFiles: PAGE_FILE.test(next.file || '') ? [next.file] : [] };
  }
  throw fail(400, '未知的草稿操作');
}
