// 导出图片 / PDF 的页面端（第 12 轮）：把一页以 play 模式 + fast 跑完全部步骤（停在最后一步的画面），等画面静止后告诉 Node 端可以截图。
//
// Node 端（src/export/…）在后台浏览器打开 /export-render.html，然后调用：
//   await window.vwExportPage(project, pageId, { assetBase = '/project', timeout = 5000, html? })
//   → 成功 { ok: true, width, height }；出错 { ok: false, error, width?, height? }（不抛出，方便 Node 端拼中文提示）
//   - 页面 iframe 贴在左上角 (0,0)，不缩放：课件页 width×height = 画板；网页页 width = 设备窗口宽，height = 整页内容高度。
//   - Node 端把视口设成（或截图区域裁成）返回的 width×height 再截图。
//   - html：可选，页面文件文本；不给时按 assetBase + page.file 取（assetBase 是项目根目录的 URL）。
//   - 页面脚本的错误会让结果为 ok:false（与动效检查一致）。
import { createPageFrame, frameSize } from './page-frame.js';

function bounded(promise, label, timeout) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超过 ${timeout} ms 仍未完成`)), timeout); })]).finally(() => clearTimeout(timer));
}
const frameTick = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
let currentFrame = null;

window.vwExportPage = async function vwExportPage(project, pageId, { assetBase = '/project', timeout = 5000, html } = {}) {
  const page = (project.pages || []).find(item => item.id === pageId);
  if (!page) return { ok: false, error: `找不到页面：${pageId}` };
  const stage = document.getElementById('stage');
  currentFrame?.destroy();
  stage.replaceChildren();
  const size = frameSize(project, page);
  const errors = [];
  const frame = currentFrame = createPageFrame({ project, page, mode: 'play', container: stage, html, edits: page.edits || [], fast: true, assetBase, timeout, onError: msg => errors.push(msg) });
  const setHeight = h => { frame.iframe.style.height = `${h}px`; };
  if (size.kind === 'web') setHeight(size.contentHeight);
  try {
    const ready = await bounded(frame.ready, '页面加载与动效快进', timeout * 2);
    if (ready?.failed) throw new Error(ready.error);
    let height = size.kind === 'web' ? Math.max(1, Math.ceil(ready.height || size.contentHeight)) : size.height;
    if (size.kind === 'web') { setHeight(height); await frameTick(); }
    const settled = await bounded(frame.settle(timeout), '等待画面静止', timeout + 1000);
    if (settled && !settled.ok) throw new Error(settled.error);
    if (size.kind === 'web' && settled?.height && Math.ceil(settled.height) !== height) {
      height = Math.ceil(settled.height); setHeight(height);
      await bounded(frame.settle(timeout), '等待画面静止', timeout + 1000);
    }
    await frameTick(); await frameTick();
    if (errors.length) throw new Error(`${errors[0].phase ? `[${errors[0].phase}] ` : ''}${errors[0].message}`);
    return { ok: true, width: size.width, height };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), width: size.width, height: size.kind === 'web' ? size.contentHeight : size.height };
  }
};
window.vwExportReady = true;
