// 导出入口：放映版单文件（html）、每页图片（images）、PDF（pdf）。
// 工作台服务器和命令行都调用 exportProject；导出文件放在调用方给的 outDir 里。
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exportHtml } from './html.js';

export const EXPORT_KINDS = ['html', 'images', 'pdf'];

/** 项目名转成能当文件名的样子：去掉 / \ : * ? " < > | 和控制字符 */
export function fileBaseName(name, fallback = 'project') {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 120)
    .trim();
  const base = cleaned || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
}

/**
 * 导出项目。kind：'html' | 'images' | 'pdf'。
 * 返回 { kind, outDir, files: [{ path, bytes }] }；html 另带 breakdown / items / skipped / warnings。
 */
export async function exportProject({ projectDir, kind, outDir, name }) {
  if (!EXPORT_KINDS.includes(kind)) throw new Error(`不支持的导出类型：${kind}（只能是 ${EXPORT_KINDS.join(' / ')}）`);
  if (!projectDir || !outDir) throw new Error('导出需要 projectDir 和 outDir');
  projectDir = resolve(projectDir);
  outDir = resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const base = fileBaseName(name || project.name, project.id);
  if (kind === 'html') {
    const result = await exportHtml({ projectDir, outFile: join(outDir, `${base}.html`) });
    return { kind, outDir, files: [{ path: result.file, bytes: result.bytes }], breakdown: result.breakdown, items: result.items, skipped: result.skipped, warnings: result.warnings };
  }
  let images;
  try { images = await import('./images.js'); }
  catch (error) { throw new Error(`导出图片 / PDF 的功能还没准备好：${error.message}`); }
  if (kind === 'images') {
    const result = await images.exportImages({ projectDir, outDir });
    return { kind, outDir, files: result.files };
  }
  const result = await images.exportPdf({ projectDir, outFile: join(outDir, `${base}.pdf`) });
  return { kind, outDir, files: [{ path: result.file, bytes: result.bytes }] };
}
