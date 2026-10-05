// 旧 HTML / 网页导入（第 12 轮）· 写项目：每页一个 pages/<页面编号>.html（保留原来的 HTML、CSS、脚本和动画，已标出可改的文字和图片），
// 资源已经由 resources.js 复制进 assets/、fonts/；这里写 project.json（格式 v3）、每页「迁移说明」notes、import/ 里的原文件和 README.md。
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { WEB_DEVICES, WEB_DEFAULT_ARTBOARD } from '../../web/project-kinds.js';

const rid = (prefix, n = 12) => `${prefix}${randomUUID().replaceAll('-', '').slice(0, n)}`;
const deviceLabel = d => WEB_DEVICES[d]?.label || d;
const short = (s, n) => Array.from(String(s || '').replace(/\s+/g, ' ').trim()).slice(0, n).join('');
export const skippedLines = skipped => (skipped || []).map(s => `${s.url}（${(s.devices || []).map(deviceLabel).join('、') || '全部'}）：${s.reason}`);
const list = (set, n = 12) => { const a = [...set]; return a.length > n ? `${a.slice(0, n).join('、')} 等 ${a.length} 个` : a.join('、'); };

/** 一页的迁移说明。 */
function pageNotes({ res, index, analysis, web, entry, now, skipped }) {
  const lines = [];
  if (web) {
    lines.push(`迁移说明（网页导入，${now.slice(0, 10)}）`,
      `- 来源：${res.url ? `网址 ${res.url}${res.finalUrl && res.finalUrl !== res.url ? `（实际打开 ${res.finalUrl}）` : ''}` : `本地文件 import/${res.file || entry}`}`,
      `- 设备：${deviceLabel(res.device)}，窗口 ${WEB_DEVICES[res.device].width} × ${WEB_DEVICES[res.device].height}；整页高 ${res.height}`);
    if (res.truncated) lines.push(`- 原网页整页高 ${res.truncated}，超过 20000，工作台只滚到 20000`);
    lines.push(res.url ? '- 页面文件是打开网址后的当前画面（DOM），读得到的样式表已内联进 <style>' : '- 页面文件是原网页文件本身（未执行脚本时的原文）');
  } else {
    lines.push(`迁移说明（旧 HTML 导入，${now.slice(0, 10)}）`, `- 分页方式：${analysis.label}；这是原文件的第 ${index + 1} 页`);
    if (analysis.kind === 'fallback' && analysis.pages.length > 1) lines.push(`- 保底切分：页面文件是整份原文档，用 body 的负上边距露出第 ${index + 1} 屏；分页位置可能切断内容，需要时请按内容重新整理这一页`);
    else if (analysis.kind !== 'deck' && analysis.kind !== 'fallback') lines.push('- 页面文件只保留了这一页的那一块（祖先容器的标签和 class 还在，原样式的选择器能对上），其他页去掉了');
    if (res.zoom && Math.abs(res.zoom - 1) > 0.02) lines.push(`- 原页面宽度和画板不同，已用 zoom ${Math.round(res.zoom * 100) / 100} 放大到画板宽（style[data-vw-import]）`);
  }
  if (res.error) lines.push(`- 这一页导入失败：${res.error}；请参照原文件重做这一页`);
  const st = res.stats || { text: 0, image: 0 };
  lines.push(`- 自动标记：可改的文字 ${st.text} 处（data-vw-id t1、t2…，能力 text move color），可裁切的图片 ${st.image} 张（i1、i2…，能力 move resize crop），纯色色块 ${st.block || 0} 个（b1、b2…，能力 move resize background），整页背景 ${st.background || 0} 处（bg1、bg2…，能力 background，只改颜色）；data-vw-origin 是原网页里的定位`);
  const n = res.notes;
  if (n) {
    const kept = [];
    if (n.styles) kept.push(`<style> ${n.styles} 段`);
    if (res.log?.css.size) kept.push(`外部样式表 ${res.log.css.size} 个（复制进 assets/）`);
    if (n.scripts.inline) kept.push(`内联脚本 ${n.scripts.inline} 段`);
    if (res.log?.scripts.size) kept.push(`外部脚本 ${res.log.scripts.size} 个（复制进 assets/：${list(res.log.scripts, 6)}）`);
    if (kept.length) lines.push(`- 保留了：${kept.join('；')}`);
    if (!web && n.scripts.inline && !['deck', 'fallback'].includes(analysis.kind)) lines.push('- 原脚本是整份文档共用的：其他页的元素已去掉，脚本里找不到元素时可能报错，请检查后按这一页改');
    if (n.removedScripts?.length) lines.push(`- 网址抓取的页面已经是脚本运行后的样子，脚本没有保留（避免重复执行）：${list(new Set(n.removedScripts), 8)}`);
    if (n.fragments) lines.push(`- reveal.js 的 .fragment（分步出现）${n.fragments} 处已加 visible，页面显示的是最后一步；要逐步出现请用 vw.motion 写并设置 motion.steps`);
    if (n.canvas) lines.push(`- 页面里有 ${n.canvas} 个 <canvas>：内容靠脚本画${res.url ? '，网址抓取时脚本没有保留，画布会是空的' : '，脚本保留了就会照样画'}`);
    if (n.iframes?.length) lines.push(`- 内嵌框架（iframe）没有复制：${list(new Set(n.iframes), 6)}`);
  }
  const c = res.clue;
  if (c) {
    const anim = [...(c.running || []).map(r => `${r.name}（${r.count} 个元素）`)];
    if (anim.length) lines.push(`- 原来在跑的动画（保留在页面里，会照常播放）：${anim.join('、')}`);
    if (c.keyframes?.length) lines.push(`- 样式表里的关键帧（@keyframes，已保留）：${c.keyframes.join('、')}`);
    if (c.libs?.length) lines.push(`- 原页面用到的动画 / 脚本库：${c.libs.join('、')}`);
    if (c.attrs?.length) lines.push(`- 分步线索：${c.attrs.map(a => `${a.name} ×${a.count}`).join('、')}`);
  }
  if (res.log?.remote.size) lines.push(`- 没下载到的网络地址（保留原样；导出的文件不能依赖网络，请换成本地文件或删掉）：${list(res.log.remote, 10)}`);
  if (res.log?.missing.size) lines.push(`- 原文件里引用了但找不到的文件（引用已去掉）：${list(res.log.missing, 10)}`);
  if (res.log?.missingFonts.size) lines.push(`- 缺失字体（没有拿到字体文件）：${list(res.log.missingFonts)}`);
  if (res.log?.fonts.size) lines.push(`- 复制进 fonts/ 的字体：${list(res.log.fonts)}`);
  lines.push('- 本轮导入不截图：能保留的都按原样保留了；原来的 CSS / JS 动画在页面里自己跑。需要点击推进的动效请用 vw.motion 写（见 docs/format.md §6）');
  if (index === 0 && skipped?.length) lines.push('- 跳过的网址：', ...skippedLines(skipped).map(l => `  - ${l}`));
  lines.push(web && res.url ? `- 导入时的网页快照：import/pages/${String(index + 1).padStart(2, '0')}-${res.device}.html` : `- 原文件：import/${res.file || entry}`);
  return lines.join('\n');
}

export async function buildProject({ analysis, srcDir, projectDir, id, name, preset, width, height, entry, files = [], startedAt = Date.now(), check = () => {} }) {
  const web = analysis.kind === 'web', now = new Date().toISOString();
  mkdirSync(join(projectDir, 'pages'), { recursive: true });
  const { store } = analysis;
  const pages = analysis.pages.map((res, index) => {
    check();
    const pageId = rid('page_'), file = `pages/${pageId}.html`;
    writeFileSync(join(projectDir, file), res.html);
    const title = short(res.title || res.clue?.title || name, 40);
    const pageName = web ? `${title || name} · ${deviceLabel(res.device)}` : short(res.heading, 20) || short(analysis.names?.[index], 20) || `第 ${index + 1} 页`;
    const page = { id: pageId, name: pageName, file, notes: pageNotes({ res, index, analysis, web, entry, now, skipped: analysis.skipped }), edits: [] };
    if (web) Object.assign(page, { device: res.device, size: { width: WEB_DEVICES[res.device].width, height: res.height } });
    page.origin = res.url ? { url: res.url, capturedAt: res.capturedAt } : { file: res.file || entry, capturedAt: res.capturedAt || now };
    return page;
  });
  const skipped = analysis.skipped || [];
  const project = {
    format: 'visual-workbench/project', formatVersion: 3, id, name,
    ...(skipped.length ? { description: `网页导入时跳过的网址：\n${skippedLines(skipped).join('\n')}` } : {}),
    kind: web ? 'web' : 'deck', createdAt: now, updatedAt: now,
    artboard: web ? { ...WEB_DEFAULT_ARTBOARD } : { preset, width, height },
    assets: store.assets, fonts: store.fonts, pages,
  };
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2) + '\n');

  // ---------- 原文件 ----------
  // 原文件逐字节复制；和工作台自己写的说明文件重名时，原文件改名（README.md 见下；source.json → 「-原文件」）
  const importDir = join(projectDir, 'import'), RESERVED = { 'source.json': 'source-原文件.json' };
  mkdirSync(importDir, { recursive: true });
  for (const rel of files) { const to = join(importDir, RESERVED[rel] || rel); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(srcDir, rel), to); }
  if (analysis.source === 'urls') {
    const out = [];
    analysis.pages.forEach((res, i) => {
      const file = `pages/${String(i + 1).padStart(2, '0')}-${res.device}.html`;
      mkdirSync(join(importDir, 'pages'), { recursive: true }); writeFileSync(join(importDir, file), res.snapshot || '');
      out.push({ url: res.url, finalUrl: res.finalUrl, device: res.device, capturedAt: res.capturedAt, file: `import/${file}`, pageId: pages[i].id, height: res.height, ...(res.truncated ? { fullHeight: res.truncated } : {}) });
    });
    writeFileSync(join(importDir, 'source.json'), JSON.stringify({ source: 'urls', importedAt: now, urls: analysis.urls || [], devices: analysis.devices || [], pages: out, skipped }, null, 2) + '\n');
  }

  // ---------- 摘要 ----------
  const sum = (f) => analysis.pages.reduce((n, p) => n + f(p), 0);
  const union = key => new Set(analysis.pages.flatMap(p => [...(p.log?.[key] || [])]));
  const message = analysis.kind === 'fallback' ? (pages.length > 1 ? `没有识别出分页结构，按画板高度把整页切成了 ${pages.length} 页（保底办法），分页位置可能切断内容。` : '没有识别出分页结构（不是常见的幻灯片框架，也不是按屏滚动的页面），整份页面作为 1 页导入。') : '';
  const summary = {
    method: analysis.kind, methodLabel: analysis.label, pages: pages.length,
    texts: sum(p => p.stats?.text || 0), images: sum(p => p.stats?.image || 0), blocks: sum(p => p.stats?.block || 0), backgrounds: sum(p => p.stats?.background || 0),
    assets: store.assets.length, fonts: store.fonts.length,
    styles: union('css').size, scripts: union('scripts').size + sum(p => p.notes?.scripts?.inline || 0),
    animations: [...new Set(analysis.pages.flatMap(p => p.clue?.keyframes || []))],
    missingFonts: [...union('missingFonts')], remote: [...union('remote')], missing: [...union('missing')],
    failed: analysis.pages.filter(p => p.error).length, message,
  };
  if (web) Object.assign(summary, { kind: 'web', source: analysis.source, devices: { desktop: pages.filter(p => p.device === 'desktop').length, mobile: pages.filter(p => p.device === 'mobile').length }, skipped, truncated: analysis.pages.filter(p => p.truncated).map(p => ({ url: p.url || p.file, device: p.device, height: p.truncated })) });

  const readme = [
    web ? '# 网页导入' : '# 旧 HTML 导入', '',
    analysis.source === 'urls' ? `- 网址：${(analysis.urls || []).join('、') || '无'}` : `- 入口文件：${entry}`,
    `- 导入时间：${now}`,
    web ? `- 设备：${(analysis.devices || []).map(deviceLabel).join('、')}` : `- 分页方式：${analysis.label}`,
    `- 页数：${pages.length}；可改的文字：${summary.texts}；可裁切的图片：${summary.images}；纯色色块：${summary.blocks}；整页背景：${summary.backgrounds}`,
    ...(summary.missingFonts.length ? [`- 缺失字体：${summary.missingFonts.join('、')}`] : []), ...(message ? [`- 说明：${message}`] : []),
    ...(skipped.length ? ['- 跳过的网址：', ...skippedLines(skipped).map(l => `  - ${l}`)] : []), '',
    analysis.source === 'urls' ? '这个文件夹里 pages/ 是导入时的网页快照（只读参考），source.json 记录网址、设备、时间和跳过的网址。抓取全程只读：只发 GET 请求，不提交表单、不登录、不点击，原网站不受影响。' : '这个文件夹是导入时复制的原文件（文件名不变，逐字节相同），原来的文件没有被修改。',
    '每页的页面文件保留了原来的 HTML、CSS、脚本和动画，自动标出了可改的文字、图片和纯色色块；每页 notes 是给 agent 的迁移说明。用户在工作台里的修改记在每页的修改单（edits）里。', '',
  ].join('\n');
  writeFileSync(join(importDir, files.includes('README.md') ? 'README-导入说明.md' : 'README.md'), readme);
  return { project, summary };
}
