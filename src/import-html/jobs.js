// 旧 HTML 导入任务：上传的文件先落到 <数据目录>/.import-tmp/<任务>/src/，后台分析，项目先写在 .import-tmp/<任务>/project/，
// 全部完成并通过校验后才一次改名进 projects/。取消或失败时关浏览器、删临时文件，不留半个项目。导入永远新建项目，不碰原文件。
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync, renameSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { validateProjectData } from '../validate.js';
import { unzip } from './zip.js';
import { analyzeHtml, cancelledError } from './analyze.js';
import { buildProject } from './build.js';
import { analyzeWebFiles, captureUrls, normalizeDevices, MAX_URLS } from './web.js';
import { WEB_DEFAULT_ARTBOARD } from '../../web/project-kinds.js';

export const IMPORT_PRESETS = { 'slide-16x9': [1920, 1080], 'web-desktop': [1440, 900], 'web-mobile': [390, 844], 'poster-a4': [2480, 3508], 'poster-a3': [3508, 4961], custom: [1920, 1080] };
export const IMPORT_MAX_BYTES = 380_000_000;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const fail = (status, message) => Object.assign(new Error(message), { status });
const KEEP_MS = 30 * 60 * 1000;

/** 上传路径 → 安全的相对路径（/ 分隔）；../、绝对路径、空段一律拒绝。 */
export function cleanPath(p) {
  const parts = String(p ?? '').replace(/\\/g, '/').replace(/^\.\/+/, '').split('/');
  if (!parts.length || parts.some(s => !s || s === '.' || s === '..' || s.includes('\0') || s.length > 255) || /^[a-zA-Z]:$/.test(parts[0])) throw fail(400, `文件路径不正确：${p}`);
  return parts.join('/');
}
const junk = p => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/.test(p);
/** 入口：指定的，否则层级最浅的 index.html，否则层级最浅、按名字排第一的 .html。 */
export function pickEntry(paths, wanted) {
  if (wanted && paths.includes(wanted)) return wanted;
  const html = paths.filter(p => /\.html?$/i.test(p) && !/(^|\/)__vw_slide_\d+\.html$/.test(p));
  if (!html.length) return null;
  const depth = p => p.split('/').length;
  html.sort((a, b) => depth(a) - depth(b) || (/(^|\/)index\.html?$/i.test(b) ? 1 : 0) - (/(^|\/)index\.html?$/i.test(a) ? 1 : 0) || a.localeCompare(b));
  return html[0];
}

export function createImportJobs({ dataDir, analyze = analyzeHtml, analyzeWeb = analyzeWebFiles, capture = captureUrls, pageTimeout, urlTimeout } = {}) {
  const jobs = new Map(), tmpRoot = join(dataDir, '.import-tmp');
  // 上次异常退出留下的临时文件：超过一天的清掉
  try { if (existsSync(tmpRoot) && !lstatSync(tmpRoot).isSymbolicLink()) for (const name of readdirSync(tmpRoot)) { const p = join(tmpRoot, name); if (Date.now() - statSync(p).mtimeMs > 86400000) rmSync(p, { recursive: true, force: true }); } } catch {}
  const view = job => ({ jobId: job.id, state: job.state, progress: Math.round(job.progress * 1000) / 1000, step: job.step, pages: job.pages, summary: job.summary, projectId: job.projectId, error: job.error });

  function create(b) {
    if (typeof b?.name !== 'string' || !b.name.trim()) throw fail(400, '请填写项目名称');
    const kind = b.kind === undefined || b.kind === 'deck' ? 'deck' : b.kind === 'web' ? 'web' : null;
    if (!kind) throw fail(400, '项目类型不正确（课件 deck / 网页 web）');
    let preset, width, height, devices = null;
    if (kind === 'web') {
      ({ preset, width, height } = WEB_DEFAULT_ARTBOARD);
      devices = normalizeDevices(b.devices); if (!devices.length) throw fail(400, '请至少勾选电脑端或手机端中的一个');
      // 网址抓取：不需要上传文件
      if (b.urls !== undefined && !(Array.isArray(b.files) && b.files.length)) {
        if (!Array.isArray(b.urls) || b.urls.some(u => typeof u !== 'string')) throw fail(400, '网址列表不正确');
        const urls = b.urls.map(u => u.trim()).filter(Boolean);
        if (!urls.length) throw fail(400, '请输入至少一个网址（每行一个）');
        if (urls.length > MAX_URLS) throw fail(400, `一次最多导入 ${MAX_URLS} 个网址`);
        if (existsSync(tmpRoot) && lstatSync(tmpRoot).isSymbolicLink()) throw fail(403, '数据目录中的文件夹不能是符号链接');
        const id = randomUUID().replaceAll('-', '').slice(0, 16), dir = join(tmpRoot, id);
        mkdirSync(dir, { recursive: true });
        const job = { id, dir, state: 'running', progress: 0.02, step: '正在准备', pages: null, summary: null, projectId: null, error: null, controller: new AbortController(), browser: null };
        jobs.set(id, job);
        run(job, { kind, source: 'urls', name: b.name.trim().slice(0, 200), preset, width, height, urls, devices, entry: null, files: [] });
        return { jobId: id };
      }
    } else {
      preset = b.preset || 'slide-16x9'; if (!IMPORT_PRESETS[preset]) throw fail(400, '画板类型不正确');
      width = b.width ?? IMPORT_PRESETS[preset][0]; height = b.height ?? IMPORT_PRESETS[preset][1];
      for (const v of [width, height]) if (!Number.isInteger(v) || v < 1 || v > 8000) throw fail(400, '画板宽高必须是 1–8000 的整数');
    }
    if (!Array.isArray(b.files) || !b.files.length) throw fail(400, kind === 'web' ? '请选择要导入的网页文件、文件夹或 .zip，或者输入网址' : '请选择要导入的 HTML 文件、文件夹或 .zip');
    let list = [], total = 0;
    for (const f of b.files) {
      if (typeof f?.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)) throw fail(400, `文件内容不正确：${f?.path}`);
      const path = cleanPath(f.path); if (junk(path)) continue;
      const data = Buffer.from(f.data, 'base64'); total += data.length;
      if (total > IMPORT_MAX_BYTES) throw fail(413, '文件太大（合计超过 380 MB），请去掉不需要的素材后再导入');
      list.push({ path, data });
    }
    // 只给了一个 .zip：解开
    if (list.length === 1 && /\.zip$/i.test(list[0].path)) list = unzip(list[0].data, { maxTotal: IMPORT_MAX_BYTES }).map(f => ({ path: cleanPath(f.path), data: f.data })).filter(f => !junk(f.path));
    // 所有文件都在同一个顶层文件夹里：去掉这一层
    const tops = new Set(list.map(f => f.path.split('/')[0]));
    if (tops.size === 1 && list.every(f => f.path.includes('/'))) list = list.map(f => ({ ...f, path: f.path.slice(f.path.indexOf('/') + 1) }));
    if (new Set(list.map(f => f.path.toLowerCase())).size !== list.length) throw fail(400, '有重名的文件');
    const entry = pickEntry(list.map(f => f.path), b.entry ? cleanPath(b.entry) : null);
    if (!entry) throw fail(400, '没有找到 .html 文件');
    if (existsSync(tmpRoot) && lstatSync(tmpRoot).isSymbolicLink()) throw fail(403, '数据目录中的文件夹不能是符号链接');
    const id = randomUUID().replaceAll('-', '').slice(0, 16), dir = join(tmpRoot, id), src = join(dir, 'src');
    try { for (const f of list) { const to = join(src, f.path); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, f.data); } }
    catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    const job = { id, dir, state: 'running', progress: 0.02, step: '正在准备文件', pages: null, summary: null, projectId: null, error: null, controller: new AbortController(), browser: null };
    jobs.set(id, job);
    run(job, { kind, source: 'files', name: b.name.trim().slice(0, 200), preset, width, height, devices, entry, files: list.map(f => f.path) });
    return { jobId: id };
  }

  async function run(job, opts) {
    const signal = job.controller.signal, startedAt = Date.now();
    const step = (progress, text) => { if (job.state === 'running') { job.progress = Math.max(job.progress, progress); job.step = text; } };
    const check = () => { if (signal.aborted) throw cancelledError(); };
    try {
      step(0.05, '正在启动后台浏览器');
      const hooks = { signal, pageTimeout,
        onBrowser: b => { job.browser = b; if (signal.aborted) b.close().catch(() => {}); },
        onPages: n => { job.pages = n; step(0.1, opts.kind === 'web' ? `共 ${n} 页要抓取` : `识别出 ${n} 页`); },
        onPage: (i, n) => step(0.1 + 0.75 * i / n, opts.kind === 'web' ? `正在抓取第 ${i + 1} / ${n} 页` : `正在分析第 ${i + 1} / ${n} 页`) };
      const analysis = opts.source === 'urls' ? await capture({ urls: opts.urls, devices: opts.devices, ...(urlTimeout ? { timeout: urlTimeout } : {}), ...hooks })
        : opts.kind === 'web' ? await analyzeWeb({ srcDir: join(job.dir, 'src'), entry: opts.entry, devices: opts.devices, ...hooks })
        : await analyze({ srcDir: join(job.dir, 'src'), entry: opts.entry, width: opts.width, height: opts.height, ...hooks });
      check();
      // 网址全部被跳过：任务失败，并列出原因
      if (opts.kind === 'web' && !analysis.pages.length) throw new Error(`没有导入任何网页：${analysis.skipped.map(s => `${s.url}（${s.reason}）`).join('；') || '没有可用的网址'}`);
      step(0.86, '正在整理素材与字体');
      const projectsDir = join(dataDir, 'projects'); let id;
      do id = `import-${randomUUID().slice(0, 8)}`; while (existsSync(join(projectsDir, id)) || !ID.test(id));
      const tmpProject = join(job.dir, 'project');
      const { project, summary } = await buildProject({ analysis, srcDir: opts.source === 'urls' ? null : join(job.dir, 'src'), projectDir: tmpProject, id, name: opts.name, preset: opts.preset, width: opts.width, height: opts.height, entry: opts.entry, files: opts.files, startedAt, check });
      check(); step(0.96, '正在校验并写入项目');
      const result = validateProjectData(project, { projectDir: tmpProject });
      if (!result.ok) throw new Error(`导入结果没通过校验：${result.errors.slice(0, 3).map(e => `${e.path} ${e.message}`).join('；')}`);
      check();
      const dest = join(projectsDir, id); if (existsSync(dest)) throw new Error('项目编号冲突，请重试');
      renameSync(tmpProject, dest);
      summary.seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      Object.assign(job, { state: 'done', progress: 1, step: '导入完成', summary, projectId: id, pages: summary.pages });
    } catch (error) {
      if (signal.aborted || error.cancelled) Object.assign(job, { state: 'cancelled', step: '已取消' });
      else Object.assign(job, { state: 'failed', step: '导入失败', error: String(error.message || error) });
    } finally {
      job.browser = null;
      rmSync(job.dir, { recursive: true, force: true });
      const t = setTimeout(() => jobs.delete(job.id), KEEP_MS); t.unref?.();
    }
  }
  const find = id => { const job = jobs.get(id); if (!job) throw fail(404, '找不到这个导入任务'); return job; };
  return {
    create,
    get: id => view(find(id)),
    cancel(id) {
      const job = find(id);
      if (job.state === 'running') { job.controller.abort(); job.state = 'cancelled'; job.step = '已取消'; job.browser?.close().catch(() => {}); }
      return view(job);
    },
    /** 关闭工作台：取消所有进行中的任务。 */
    close() { for (const job of jobs.values()) if (job.state === 'running') { job.controller.abort(); job.state = 'cancelled'; job.browser?.close().catch(() => {}); } },
    running: () => [...jobs.values()].filter(j => j.state === 'running').length,
  };
}
