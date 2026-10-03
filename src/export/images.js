// 导出：每页一张图片（画板原尺寸），或整个项目一份 PDF（每页一张画面）。
// 画面 = 这一页「动效全部播完之后」的最后一帧；没有动效的页面就是静态画面。
// 做法和动效检查一样：本地起一个只给后台浏览器用的 http 服务（web/ 目录 + 项目目录挂在 /project），
// 打开 web/export-render.html 逐页渲染、播完动效，再按画板尺寸截图。PDF 由 src/export/pdf.js 自己拼，不依赖 Chrome 的打印功能。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { launchBrowserServer } from '../browser.js';
import { validateProjectData } from '../validate.js';
import { buildPdf } from './pdf.js';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
// 1 px = 0.75 pt（96 dpi 对 72 dpi）
const PT_PER_PX = 0.75;

/** 页面名转成能当文件名的样子：去掉 / \ : * ? " < > | 和控制字符，压缩空白，限制长度。 */
export function safeFileName(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || String(fallback || 'page');
}

function readProject(projectDir) {
  const file = join(projectDir, 'project.json');
  let project;
  try { project = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`无法读取项目 ${file}：${error.message}`); }
  const result = validateProjectData(project, { projectDir });
  if (!result.ok) throw new Error(`项目没通过校验，先运行 npm run validate 修好再导出：\n${result.errors.map(e => `${e.path}: ${e.message}`).join('\n')}`);
  return project;
}

function startServer(projectDir) {
  const server = http.createServer((request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      const isProject = path.startsWith('/project/');
      const root = isProject ? projectDir : WEB_ROOT;
      const target = resolve(root, '.' + (isProject ? path.slice('/project'.length) : path));
      if (!target.startsWith(root + sep) && target !== root) throw new Error('Invalid path');
      const bytes = readFileSync(target);
      response.writeHead(200, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  return new Promise((ok, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise(ok => setTimeout(ok, ms))]);

/**
 * 逐页渲染并截图。onShot(index, page, buffer) 处理每张截图。
 * timeout：每个阶段（初始化、每一步、等动画）的上限；每页总上限按步数推算，至少 20 秒。
 */
async function captureProject({ projectDir, type, quality, timeout = 5000, onShot }) {
  projectDir = resolve(projectDir);
  const project = readProject(projectDir);
  const { width, height } = project.artboard;
  const { server, origin } = await startServer(projectDir);
  let browser, browserServer, killed = false;
  try {
    ({ server: browserServer, browser } = await launchBrowserServer());
    for (const [index, item] of project.pages.entries()) {
      const label = `第 ${index + 1} 页（${item.id}${item.name ? ` · ${item.name}` : ''}）`;
      const total = Math.max(20000, ((item.motion?.steps || 0) + 4) * timeout * 2);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      let timer;
      try {
        const page = await context.newPage();
        // 只许访问本地服务，动效代码不能偷偷连外网
        await page.route('**/*', route => (route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient')));
        const work = (async () => {
          await page.goto(`${origin}/export-render.html`);
          await page.waitForFunction(() => window.vwExportReady === true);
          const result = await page.evaluate(({ project, pageId, timeout }) => window.vwExportPage(project, pageId, { assetBase: '/project', timeout }), { project, pageId: item.id, timeout });
          if (!result.ok) throw new Error(`${label}的动效出错，无法导出：${result.error}`);
          const options = { type, clip: { x: 0, y: 0, width, height }, animations: 'disabled', caret: 'hide' };
          if (type === 'jpeg') options.quality = quality;
          return page.screenshot(options);
        })();
        work.catch(() => {});
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label}导出超时：${Math.round(total / 1000)} 秒内没能播完动效（动效可能卡住或死循环），已停止导出`), { vwTimeout: true })), total); });
        const shot = await Promise.race([work, deadline]);
        await onShot(index, item, shot, project.pages.length);
      } catch (error) {
        if (error.vwTimeout) { killed = true; browserServer.process()?.kill('SIGKILL'); }
        else if (!String(error.message).startsWith(`${label}`)) error.message = `${label}导出失败：${error.message}`;
        throw error;
      } finally {
        clearTimeout(timer);
        if (!killed) await withTimeout(context.close().catch(() => {}), 3000);
      }
    }
  } finally {
    if (browser && !killed) await withTimeout(browser.close().catch(() => {}), 3000);
    if (browserServer) await withTimeout(browserServer.close().catch(() => {}), 3000);
    await new Promise(ok => server.close(ok));
  }
  return project;
}

/**
 * 每页导出一张图片，尺寸 = 画板尺寸，文件名 `<两位序号>-<页面名>.png`。
 * format：'png'（默认）或 'jpeg'。返回 { files: [{ path, bytes }] }。
 */
export async function exportImages({ projectDir, outDir, format = 'png', timeout } = {}) {
  if (!projectDir || !outDir) throw new Error('exportImages 需要 projectDir 和 outDir');
  const type = format === 'jpg' || format === 'jpeg' ? 'jpeg' : format === 'png' ? 'png' : null;
  if (!type) throw new Error(`不支持的图片格式：${format}（只能是 png 或 jpeg）`);
  outDir = resolve(outDir);
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const ext = type === 'jpeg' ? 'jpg' : 'png';
  await captureProject({
    projectDir, type, quality: 90, timeout,
    onShot(index, page, buffer, count) {
      // 序号至少两位；超过 99 页时按页数加宽，保证文件按名字排序就是页序
      const nn = String(index + 1).padStart(Math.max(2, String(count).length), '0');
      const path = join(outDir, `${nn}-${safeFileName(page.name, page.id)}.${ext}`);
      writeFileSync(path, buffer);
      files.push({ path, bytes: buffer.length });
    },
  });
  return { files };
}

/** 整个项目导出成一份 PDF：每页一个 PDF 页面，尺寸按画板换算（1 px = 0.75 pt），画面是动效播完后的最后一帧。返回 { file, bytes }。 */
export async function exportPdf({ projectDir, outFile, timeout } = {}) {
  if (!projectDir || !outFile) throw new Error('exportPdf 需要 projectDir 和 outFile');
  outFile = resolve(outFile);
  const shots = [];
  const project = await captureProject({ projectDir, type: 'jpeg', quality: 90, timeout, onShot(index, page, buffer) { shots[index] = buffer; } });
  const { width, height } = project.artboard;
  const pdf = buildPdf(shots.map(jpeg => ({ jpeg, width: width * PT_PER_PX, height: height * PT_PER_PX })));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, pdf);
  return { file: outFile, bytes: pdf.length };
}
