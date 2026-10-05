// 独立放映页（第 12 轮）：读项目 → createPlayback → 按窗口缩放。Esc 关闭（是弹出的窗口就关掉，否则回到上一页）；F 键切换全屏。
import { createPlayback } from './playback.js';

const params = new URLSearchParams(location.search);
const projectId = params.get('project');
const startPage = params.get('page');
const stage = document.getElementById('stage');
const viewport = document.getElementById('viewport');
const message = document.getElementById('message');
const hint = document.getElementById('hint');
const errorBox = document.getElementById('error');
let playback = null, size = null, hintTimer = 0, errorTimer = 0;

function fit() {
  if (!size) return;
  const scale = Math.min(window.innerWidth / size.width, window.innerHeight / size.height);
  const left = (window.innerWidth - size.width * scale) / 2, top = (window.innerHeight - size.height * scale) / 2;
  stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
}
function showHint(text) {
  hint.textContent = text;
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), 1400);
}
function showError(text) {
  errorBox.textContent = text;
  errorBox.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { errorBox.hidden = true; }, 6000);
}
function exit() {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  if (window.opener) window.close();
  else if (history.length > 1) history.back();
  else location.href = `/#project=${encodeURIComponent(projectId || '')}`;
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

async function start() {
  if (!projectId) { message.textContent = '缺少项目编号：请从工作台点「放映」打开。'; return; }
  let project;
  try {
    // 走 /api/projects/<id>：返回 { project, revision, syncConflicts }，旧格式（v2）项目服务会先自动转换。
    // （数据目录的 /data/projects/ 只提供 pages/assets/fonts 等子文件夹，读不到 project.json。）
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: 'no-cache' });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json())?.error || ''; } catch { /* 不是 JSON */ }
      throw new Error(response.status === 423 ? '另一台电脑上的工作台还开着，请先在工作台里确认' : `读不到项目（${response.status}${detail ? `：${detail}` : ''}）`);
    }
    const body = await response.json();
    project = body && body.project ? body.project : body;
  } catch (error) { message.textContent = `无法放映：${error.message}`; return; }
  document.title = `放映 · ${project.name || project.id}`;
  if (!Array.isArray(project.pages) || !project.pages.length) { message.textContent = '这个项目还没有页面。'; return; }
  playback = createPlayback({
    project, container: stage, pageId: startPage,
    onChange(state) {
      size = state.size; fit();
      showHint(`${state.index + 1} / ${state.count}${state.total ? ` · 第 ${Math.min(state.nextStep + 1, state.total + 1)} 屏` : ''}`);
    },
    onError(error) { showError(`第 ${project.pages.findIndex(p => p.id === error.pageId) + 1} 页动效出错：${error.message}`); },
    onEnd() { showHint('已经是最后一页'); },
    onExit: exit
  });
  window.__vwPlayback = playback; // 测试用
  await playback.ready;
  message.hidden = true;
}

window.addEventListener('resize', fit);
window.addEventListener('keydown', event => {
  if (!playback) { if (event.key === 'Escape') exit(); return; }
  if (event.key === 'f' || event.key === 'F') { toggleFullscreen(); return; }
  if (playback.handleKey(event.key)) event.preventDefault();
});
// 点在画面外（黑边）也推进；画面内的点击由页面运行时转过来
viewport.addEventListener('click', event => { if (event.target === viewport || event.target === stage) playback?.next(); });
viewport.addEventListener('contextmenu', event => { event.preventDefault(); if (event.target === viewport || event.target === stage) playback?.next(); });
start();
