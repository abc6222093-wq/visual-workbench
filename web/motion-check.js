// 动效检查（第 12 轮）：在真浏览器里按 play 模式逐页跑页面里的 vw.motion。
// 每页三轮：① 正常放映：init → 每一步 → leave(前进)；② 快进进入（后退到这页时的样子）：fast 启动 → leave(后退)；③ 有步骤时：init 后直接 toEnd 快进。
// 收集页面运行时回报的 error 消息（页面脚本报错、未处理的 Promise 拒绝、console.error、步骤出错、steps 与 step 不符）。
//
// checkMotion(project, { assetBase = '/data/projects/<id>', timeout = 5000, mount = document.body, pageId, loadHtml, frameOptions })
//   → { ok, results: [{ page, phase, ok, error? }] }
//   loadHtml(page)：可选，自己提供页面文件文本（导出的单文件用）；frameOptions 原样传给 createPageFrame（runtimeText、assetUrls、baseHref…）。
import { createPageFrame } from './page-frame.js';

function bounded(promise, label, timeout) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超过 ${timeout} ms 仍未完成`)), timeout); })]).finally(() => clearTimeout(timer));
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const describe = msg => `${msg.phase ? `[${msg.phase}] ` : ''}${msg.message}${msg.stack && !String(msg.stack).includes(msg.message) ? `\n${msg.stack}` : ''}`;

async function scenario(project, page, kind, { assetBase, timeout, mount, loadHtml, frameOptions }) {
  const errors = [];
  const html = loadHtml ? await loadHtml(page) : undefined;
  const frame = createPageFrame({ ...frameOptions, project, page, mode: 'play', container: mount, html, edits: page.edits || [], fast: kind === 'fast', assetBase, timeout, onError: msg => errors.push(msg) });
  // iframe 必须在视口里可见：Chromium 对视口外 / 隐藏的跨源 iframe 会暂停 rAF 和动画，按真实时长跑的步骤会卡住
  frame.iframe.style.position = 'fixed'; frame.iframe.style.left = '0'; frame.iframe.style.top = '0'; frame.iframe.style.zIndex = '1';
  const check = () => { if (errors.length) throw new Error(describe(errors[0])); };
  try {
    const ready = await bounded(frame.ready, '初始化', timeout + 2000);
    if (ready?.failed) throw new Error(ready.error);
    await pause(0); check();
    const total = ready.steps;
    if (kind === 'play') {
      for (let index = 0; index < total; index++) {
        const done = await bounded(frame.step(), `第 ${index + 1} 步`, timeout);
        await pause(0); check();
        if (!done || done.nextStep !== index + 1) throw new Error(`第 ${index + 1} 步没有完成`);
      }
      await bounded(frame.leave(1), '离开本页（前进）', timeout); await pause(0); check();
    } else if (kind === 'fast') {
      if (ready.nextStep !== total) throw new Error(`快进后停在第 ${ready.nextStep} 步，应为 ${total}`);
      await bounded(frame.leave(-1), '离开本页（后退）', timeout); await pause(0); check();
    } else {
      const done = await bounded(frame.toEnd(), '快进到最后一步', timeout);
      await pause(0); check();
      if (!done || done.nextStep !== total) throw new Error('快进没有走完全部步骤');
    }
  } finally { frame.destroy(); }
}

export async function checkMotion(project, { assetBase = `/data/projects/${encodeURIComponent(project.id)}`, timeout = 5000, mount = document.body, pageId, loadHtml, frameOptions = {} } = {}) {
  const results = [];
  for (const page of project.pages || []) {
    if (pageId && page.id !== pageId) continue;
    const kinds = [['play', '放映'], ['fast', '快进后退']];
    if ((page.motion?.steps || 0) > 0) kinds.push(['toEnd', '中途快进']);
    for (const [kind, phase] of kinds) {
      try { await scenario(project, page, kind, { assetBase, timeout, mount, loadHtml, frameOptions }); results.push({ page: page.id, phase, ok: true }); }
      catch (error) { results.push({ page: page.id, phase, ok: false, error: String(error?.message || error) }); }
    }
  }
  return { ok: results.every(result => result.ok), results };
}
