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

/** 被取消的导出抛出的错误：error.cancelled = true */
export function cancelledError() { return Object.assign(new Error('已取消导出'), { cancelled: true }); }
export function throwIfCancelled(signal) { if (signal?.aborted) throw cancelledError(); }

/**
 * 导出项目。kind：'html' | 'images' | 'pdf'。
 * onProgress({ current, total, label })：html 每内联完一页报一次，再报「正在打包资源」「正在写入文件」；images / pdf 每截完一页报一次。
 * signal（AbortSignal）：取消时尽快停下（截图循环、浏览器会被关掉），抛出 error.cancelled = true 的错误；半成品文件由调用方清理。
 * 返回 { kind, outDir, files: [{ path, bytes }] }；html 另带 breakdown / items / skipped / warnings。
 */
export async function exportProject({ projectDir, kind, outDir, name, onProgress, signal }) {
  if (!EXPORT_KINDS.includes(kind)) throw new Error(`不支持的导出类型：${kind}（只能是 ${EXPORT_KINDS.join(' / ')}）`);
  if (!projectDir || !outDir) throw new Error('导出需要 projectDir 和 outDir');
  throwIfCancelled(signal);
  projectDir = resolve(projectDir);
  outDir = resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const base = fileBaseName(name || project.name, project.id);
  // 进度回调出错不能中断导出
  const progress = typeof onProgress === 'function' ? info => { try { onProgress(info); } catch { /* 忽略 */ } } : () => {};
  if (kind === 'html') {
    const result = await exportHtml({ projectDir, outFile: join(outDir, `${base}.html`), onProgress: progress, signal });
    return { kind, outDir, files: [{ path: result.file, bytes: result.bytes }], breakdown: result.breakdown, items: result.items, skipped: result.skipped, warnings: result.warnings };
  }
  let images;
  try { images = await import('./images.js'); }
  catch (error) { throw new Error(`导出图片 / PDF 的功能还没准备好：${error.message}`); }
  if (kind === 'images') {
    const result = await images.exportImages({ projectDir, outDir, onProgress: progress, signal });
    return { kind, outDir, files: result.files };
  }
  const result = await images.exportPdf({ projectDir, outFile: join(outDir, `${base}.pdf`), onProgress: progress, signal });
  return { kind, outDir, files: [{ path: result.file, bytes: result.bytes }] };
}
