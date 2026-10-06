// 草稿分页（第 13 轮）的纯逻辑：文案 → 草稿页；草稿页 → HTML 文件；HTML 文件 → 块。Node 和浏览器都 import。
// 规则见 docs/format.md §15。工作台自己分，不调用 agent；草稿页不做任何设计。
export const DRAFT_LEVELS = Object.freeze([
  { id: 'title', label: '大标题' },
  { id: 'subtitle', label: '副标题' },
  { id: 'heading', label: '小标题' },
  { id: 'body', label: '正文' },
  { id: 'note', label: '注释' },
  { id: 'quote', label: '引用' },
  { id: 'header', label: '页眉' },
  { id: 'footer', label: '页脚' },
]);
const LEVEL_IDS = new Set(DRAFT_LEVELS.map(l => l.id));
export const isDraftLevel = id => LEVEL_IDS.has(id);

// 「大标题：」这类行首提示 → 层级（显示时去掉前缀）
const PREFIX_LEVEL = { 大标题: 'title', 主标题: 'title', 副标题: 'subtitle', 小标题: 'heading', 标题: 'heading', 页眉: 'header', 页脚: 'footer', 说明: 'note', 注释: 'note', 备注: 'note', 正文: 'body', 引用: 'quote' };
const PREFIX_RE = /^([一-鿿]{2,3})[：:]\s*(.*)$/;
const CORE_MARKERS = new Set(['核心信息', '核心', '内容', '正文']);
const MARKER_RE = /^\s*[【\[]([^】\]]{1,12})[】\]]\s*(.*)$/;
const PAGE_HEADING_RE = /^##\s+(.*)$/;
const TITLE_RE = /^#\s+(.*)$/;
const RULE_RE = /^-{3,}\s*$/;

const rtrim = s => String(s).replace(/\s+$/, '');
export function levelFromPrefix(line) {
  const m = PREFIX_RE.exec(line);
  if (!m || !PREFIX_LEVEL[m[1]]) return null;
  return { level: PREFIX_LEVEL[m[1]], text: m[2] };
}
function blockOf(rawLine) {
  const line = rtrim(rawLine);
  if (!line.trim()) return { level: 'body', text: '' };
  const quote = /^\s*>\s?(.*)$/.exec(line);
  if (quote) return { level: 'quote', text: quote[1] };
  const prefixed = levelFromPrefix(line.trimStart());
  if (prefixed) return { level: prefixed.level, text: prefixed.text };
  return { level: 'body', text: line };
}
function trimBlocks(blocks) {
  let a = 0, b = blocks.length;
  while (a < b && !blocks[a].text.trim()) a++;
  while (b > a && !blocks[b - 1].text.trim()) b--;
  return blocks.slice(a, b);
}
/** `## Page 2 ｜ 今天的流程` → 「今天的流程」；`## 封面` → 「封面」；`## Page 3` → 「第 3 页」 */
export function pageNameFromHeading(heading, index) {
  let text = String(heading || '').trim();
  const m = /^(?:page|p|第)\s*(\d+)\s*(?:页)?\s*(?:[｜|：:·\-—–]\s*)?(.*)$/i.exec(text);
  if (m) text = m[2].trim() || `第 ${Number(m[1])} 页`;
  return text || `第 ${index + 1} 页`;
}
export const hasDraftMarks = text => /^#\s+\S|^##\s+\S|^-{3,}\s*$|[【\[][^】\]]{1,12}[】\]]/m.test(String(text || ''));

/**
 * 文案 → 草稿页。
 * @returns {{ name: string, description: string, method: 'marked'|'plain', note: string, pages: Array<{ name: string, blocks: Array<{ level: string, text: string }>, notes: string }> }}
 */
export function parseDraftText(input, { charsPerPage = 240 } = {}) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (!text.trim()) return { name: '', description: '', method: 'plain', note: '文案是空的', pages: [] };
  return hasDraftMarks(text) ? parseMarked(text) : parsePlain(text, charsPerPage);
}

function parseMarked(text) {
  const lines = text.split('\n');
  let name = '';
  const preamble = [];
  const pages = [];
  let current = null; // { name, blocks, notes: [{ label, lines }], section: 'core' | { label } }
  let headingCount = 0;
  let afterRule = false; // 刚遇到 ---：下一行内容直接开新页（没有 ## 也算分页）
  const finish = () => {
    if (!current) return;
    const blocks = trimBlocks(current.blocks);
    const notes = current.notes.filter(n => n.lines.some(l => l.trim())).map(n => `【${n.label}】\n${trimLines(n.lines).join('\n')}`).join('\n\n');
    if (blocks.length || notes) pages.push({ name: current.name, blocks, notes });
    current = null;
  };
  const start = nameText => { finish(); current = { name: nameText, blocks: [], notes: [], section: 'core' }; };
  for (const raw of lines) {
    const line = rtrim(raw);
    const title = TITLE_RE.exec(line);
    if (title && !name && !current) { name = title[1].trim(); continue; }
    if (RULE_RE.test(line)) { finish(); afterRule = true; continue; }
    const heading = PAGE_HEADING_RE.exec(line);
    if (heading) { start(pageNameFromHeading(heading[1], headingCount)); headingCount++; afterRule = false; continue; }
    if (!current) {
      // 第一个分页之前：说明文字（不上页面）。--- 之后或遇到【…】记号时直接开一页
      if (!line.trim()) continue;
      if (afterRule || MARKER_RE.test(line)) { start(`第 ${pages.length + 1} 页`); afterRule = false; } else { preamble.push(line.trim()); continue; }
    }
    const marker = MARKER_RE.exec(line);
    if (marker) {
      const label = marker[1].trim();
      current.section = CORE_MARKERS.has(label) ? 'core' : { label };
      if (current.section !== 'core') current.notes.push({ label, lines: [] });
      if (marker[2].trim()) (current.section === 'core' ? current.blocks : current.notes.at(-1).lines).push(current.section === 'core' ? blockOf(marker[2]) : marker[2].trim());
      continue;
    }
    if (current.section === 'core') current.blocks.push(blockOf(line));
    else current.notes.at(-1).lines.push(line);
  }
  finish();
  const description = preamble.join('\n').slice(0, 1000);
  return { name, description, method: 'marked', note: `按「---」和「## Page」分成 ${pages.length} 页；【核心信息】上页面，【辅助信息】【动效】进备注`, pages };
}
function trimLines(lines) { let a = 0, b = lines.length; while (a < b && !lines[a].trim()) a++; while (b > a && !lines[b - 1].trim()) b--; return lines.slice(a, b).map(rtrim); }

/** 没有记号的普通文字：按空行分段，按字数保底分页 */
function parsePlain(text, charsPerPage) {
  const budget = Math.max(40, Number(charsPerPage) || 240);
  const paragraphs = text.split(/\n\s*\n/).map(p => p.split('\n').map(rtrim).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1))).filter(p => p.some(l => l.trim()));
  const pages = [];
  let page = null, count = 0;
  const open = () => { page = { name: `第 ${pages.length + 1} 页`, blocks: [], notes: '' }; pages.push(page); count = 0; };
  for (const para of paragraphs) {
    const chars = para.join('').replace(/\s/g, '').length;
    if (!page || (count && count + chars > budget)) open();
    if (page.blocks.length) page.blocks.push({ level: 'body', text: '' });
    for (const line of para) page.blocks.push(blockOf(line));
    count += chars;
  }
  const first = paragraphs[0]?.find(l => l.trim()) || '';
  const name = first.trim().slice(0, 40);
  return { name, description: '', method: 'plain', note: `文案里没有分页记号：按空行分段，每页约 ${budget} 字，共分成 ${pages.length} 页`, pages };
}

// ---------- 草稿页 HTML ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }[k]));
const SIZES = { title: 72, subtitle: 40, heading: 48, body: 32, note: 24, quote: 32, header: 22, footer: 22 };
export const DRAFT_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
/** 草稿页的样式（页面文件和编辑表单共用）。按画板高度缩放：1080 高是 1 倍。 */
export function draftCss(artboard) {
  const s = Math.max(0.2, (Number(artboard?.height) || 1080) / 1080);
  const px = n => `${Math.round(n * s * 100) / 100}px`;
  return [
    `html,body{margin:0;background:#fff;color:#222}`,
    `[data-vw-draft]{box-sizing:border-box;min-height:100%;padding:${px(64)} ${px(96)};font-family:${DRAFT_FONT};font-size:${px(SIZES.body)};line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}`,
    `[data-vw-draft] p{margin:0 0 ${px(10)};min-height:1.5em}`,
    `[data-vw-draft] [data-vw-level="title"]{font-size:${px(SIZES.title)};font-weight:700;line-height:1.25;margin-bottom:${px(18)}}`,
    `[data-vw-draft] [data-vw-level="subtitle"]{font-size:${px(SIZES.subtitle)};font-weight:500;color:#444;margin-bottom:${px(14)}}`,
    `[data-vw-draft] [data-vw-level="heading"]{font-size:${px(SIZES.heading)};font-weight:700;line-height:1.3;margin-top:${px(14)}}`,
    `[data-vw-draft] [data-vw-level="body"]{font-size:${px(SIZES.body)}}`,
    `[data-vw-draft] [data-vw-level="note"]{font-size:${px(SIZES.note)};color:#666}`,
    `[data-vw-draft] [data-vw-level="quote"]{font-size:${px(SIZES.quote)};color:#444;border-left:${px(4)} solid #bbb;padding-left:${px(16)}}`,
    `[data-vw-draft] [data-vw-level="header"]{font-size:${px(SIZES.header)};color:#777}`,
    `[data-vw-draft] [data-vw-level="footer"]{font-size:${px(SIZES.footer)};color:#777}`,
  ].join('\n');
}
/** 块 → 页面文件（完整 HTML 文本）。文字原样保留（空格、全角空格、换行用 <br>）。 */
export function draftPageHtml({ name = '', blocks = [], artboard } = {}) {
  const body = blocks.map(b => `<p data-vw-level="${isDraftLevel(b?.level) ? b.level : 'body'}">${esc(b?.text ?? '').replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="vw-draft" content="1">
<title>${esc(name)}</title>
<style>
${draftCss(artboard)}
</style>
</head>
<body>
<main data-vw-draft>
${body}
</main>
</body>
</html>
`;
}
export const isDraftHtml = html => /<meta\s+name=["']vw-draft["']/i.test(String(html || ''));
/** 页面文件 → 块（只认 <main data-vw-draft> 里的 <p data-vw-level>；<br> 当换行，其他标签去掉） */
export function blocksFromDraftHtml(html) {
  const text = String(html || '');
  const main = /<main[^>]*data-vw-draft[^>]*>([\s\S]*?)<\/main>/i.exec(text);
  const scope = main ? main[1] : text;
  const blocks = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const level = /data-vw-level="([a-z]+)"/i.exec(m[1])?.[1] || 'body';
    const inner = m[2].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    blocks.push({ level: isDraftLevel(level) ? level : 'body', text: unesc(inner) });
  }
  return blocks;
}
/** 清理外部给的块列表（服务端收到 draft-update / draft-split 时用）：层级不认识的当正文，文字转成字符串并限制长度 */
export function normalizeBlocks(blocks, { max = 500, maxChars = 20000 } = {}) {
  if (!Array.isArray(blocks)) throw new Error('blocks 必须是数组');
  if (blocks.length > max) throw new Error(`一页最多 ${max} 个段落`);
  return blocks.map(b => ({ level: isDraftLevel(b?.level) ? b.level : 'body', text: String(b?.text ?? '').replace(/\r\n?/g, '\n').slice(0, maxChars) }));
}
