// 旧 HTML 导入（第 12 轮）· 后台浏览器：本地临时 http 服务挂上传的文件，Chromium 打开入口（视口 = 画板尺寸）识别分页，
// 再按页切开：每页取原文（未执行脚本的原 HTML）里属于这一页的那一块，保留原来的样式、脚本和动画，标出可改的文字和图片，
// 资源复制进项目。网络请求只许访问本地服务，CDN 和网络字体不下载（保留原地址并写进迁移说明）。
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { createStore, mapRefs, newLog } from './resources.js';
import { resolve, sep, extname, join, dirname, posix } from 'node:path';
import { launchBrowser } from '../browser.js';
import { install } from './inpage.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8' };
export const cancelledError = () => Object.assign(new Error('已取消'), { cancelled: true });

/** 本地临时服务：只读 root 里的文件。onRequest(method, path) 每个请求先回调一次（测试用来记录访问）；不是 GET / HEAD 的一律 405。 */
export function startStatic(root, { onRequest } = {}) {
  root = resolve(root);
  const server = http.createServer((req, res) => {
    try { onRequest?.(req.method, req.url); } catch {}
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + path);
      if (file !== root && !file.startsWith(root + sep)) throw new Error('bad path');
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      const bytes = readFileSync(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((ok, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })); });
}

/** 课件 JSON 格式：<script type="application/json">（优先 id="deck-data"）里 slides[].html 是完整 HTML 文档，assets 是占位符表。 */
export function deckData(html) {
  const scripts = [...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => /type\s*=\s*["']?application\/json/i.test(m[1]));
  scripts.sort((a, b) => (/id\s*=\s*["']?deck-data/i.test(b[1]) ? 1 : 0) - (/id\s*=\s*["']?deck-data/i.test(a[1]) ? 1 : 0));
  for (const m of scripts) {
    let data; try { data = JSON.parse(m[2]); } catch { continue; }
    const slides = Array.isArray(data?.slides) ? data.slides.map(s => (typeof s === 'string' ? s : s?.html)) : null;
    if (!slides?.length || !slides.every(s => typeof s === 'string' && /<(html|body|div|section|h1|p)\b/i.test(s))) continue;
    const pairs = [], value = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? [v.data, v.src, v.url, v.dataUrl].find(x => typeof x === 'string') : undefined);
    if (Array.isArray(data.assets) && data.assets.every(a => typeof a === 'string')) {
      // 纯字符串数组：占位符形如 __XXX_ASSET_n__，n 是数组下标；前缀从页面里找
      const keys = new Set(); for (const h of slides) for (const m of h.matchAll(/__[A-Z0-9]+(?:_[A-Z0-9]+)*?_(\d+)__/g)) keys.add(m[0]);
      for (const k of keys) { const v = data.assets[Number(/_(\d+)__$/.exec(k)[1])]; if (typeof v === 'string') pairs.push([k, v]); }
    } else if (Array.isArray(data.assets)) for (const a of data.assets) { const k = [a?.key, a?.id, a?.placeholder, a?.name].find(x => typeof x === 'string'), v = value(a); if (k && v) pairs.push([k, v]); }
    else if (data.assets && typeof data.assets === 'object') for (const [k, v] of Object.entries(data.assets)) if (value(v)) pairs.push([k, value(v)]);
    pairs.sort((a, b) => b[0].length - a[0].length);
    return { slides: slides.map(h => pairs.reduce((s, [k, v]) => s.split(k).join(v), h)), assets: pairs.length, names: data.slides.map(s => (typeof s?.title === 'string' ? s.title : typeof s?.name === 'string' ? s.name : '')) };
  }
  return null;
}

/** 只读访问：所有不是 GET 的请求（表单提交、POST 打点、sendBeacon 等）一律放弃。 */
export const onlyGet = route => (route.request().method() === 'GET' ? null : route.abort('blockedbyclient'));
export const withTimeout = (promise, ms, message) => { let t; return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(t)); };

/**
 * 在已经注入 install 的页面里生成一页 HTML：prepare（取原文、标记、只留这一页、资源换绝对地址）→ 复制资源 → finish（改写引用、序列化）。
 * 返回 { html, heading, title, stats, notes, log }。
 */
export async function renderPage(page, { source = null, sourceUrl = null, spec, width, height, snapshot = false, store }) {
  const log = newLog();
  const prep = await page.evaluate(o => window.__vwImport.prepare(o), { source, sourceUrl, spec, width, height, snapshot });
  const map = await mapRefs(store, prep.refs, log);
  const css = [];
  for (const text of prep.css) css.push(await store.rewriteCss(text, prep.base, log));
  const html = await page.evaluate(o => window.__vwImport.finish(o), { map, css });
  return { html, heading: prep.heading, title: prep.title, stats: prep.stats, notes: prep.notes, log };
}
export const failedHtml = message => `<!DOCTYPE html>\n<html><head><meta charset="utf-8"></head><body><p style="font:24px/1.5 sans-serif;padding:40px">这一页导入失败：${String(message).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p></body></html>\n`;

const DECK_LABEL = '课件 JSON（application/json 脚本里的 slides[].html，每页一份完整文档）';
const FRAMEWORKS = new Set(['reveal', 'impress', 'swiper']);

/**
 * 分析入口 HTML 并生成每页。返回 { kind, label, pages: [{ html, heading, title, stats, notes, log, clue, index, error? }], names, store }。
 * projectDir：临时项目文件夹（资源直接复制进去）。onPages(n) 识别完页数时回调；onPage(i, n) 每页开始时回调；onBrowser(browser) 交出浏览器以便取消时立即关闭。
 */
export async function analyzeHtml({ srcDir, entry, width, height, projectDir, signal, onPages = () => {}, onPage = () => {}, onBrowser = () => {}, pageTimeout = 90000 }) {
  const check = () => { if (signal?.aborted) throw cancelledError(); };
  const entryFile = join(srcDir, entry), entryText = readFileSync(entryFile, 'utf8');
  const deck = deckData(entryText);
  const slides = [];
  if (deck) deck.slides.forEach((html, i) => { const name = `__vw_slide_${i + 1}.html`; writeFileSync(join(dirname(entryFile), name), html); slides.push({ path: posix.join(posix.dirname(entry), name), html }); });
  const { server, origin } = await startStatic(srcDir);
  const store = createStore({ projectDir, srcDir, origin });
  let browser;
  try {
    check();
    browser = await launchBrowser(); onBrowser(browser); check();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.route('**/*', route => onlyGet(route) || (route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient')));
    const href = path => origin + '/' + path.split('/').map(encodeURIComponent).join('/');
    const open = async path => {
      const page = await context.newPage();
      page.on('dialog', d => d.dismiss().catch(() => {}));
      await page.goto(href(path), { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      await page.evaluate(`(${install})()`);
      return page;
    };
    const pages = [];
    const one = async (i, count, page, make) => {
      check(); onPage(i, count);
      try { const work = make(); work.catch(() => {}); pages.push({ index: i, ...(await withTimeout(work, pageTimeout, `第 ${i + 1} 页导入超时`)) }); }
      catch (error) { if (signal?.aborted || error.cancelled) throw cancelledError(); pages.push({ index: i, html: failedHtml(error.message || error), heading: '', title: '', stats: { text: 0, image: 0 }, notes: null, log: newLog(), clue: null, error: String(error.message || error) }); }
    };
    if (deck) {
      onPages(slides.length);
      for (const [i, slide] of slides.entries()) {
        const page = await open(slide.path);
        try { await one(i, slides.length, page, async () => ({ clue: await page.evaluate(() => window.__vwImport.clues()), ...(await renderPage(page, { source: slide.html, sourceUrl: href(slide.path), spec: { mode: 'whole' }, width, height, store })) })); }
        finally { await page.close().catch(() => {}); }
      }
      return { kind: 'deck', label: DECK_LABEL, pages, names: deck.names, store, origin };
    }
    const page = await open(entry);
    try {
      const { kind, label, count } = await page.evaluate(() => window.__vwImport.detect());
      check(); onPages(count);
      const list = kind === 'fallback' ? [] : await page.evaluate(k => window.__vwImport.pages(k), kind);
      for (let i = 0; i < count; i++) {
        const slide = list[i];
        const spec = kind === 'fallback' ? { mode: count > 1 ? 'fallback' : 'whole', index: i }
          : { mode: 'section', path: slide.path, framework: FRAMEWORKS.has(kind) ? kind : null, zoom: slide.width > 0 ? width / slide.width : 1 };
        await one(i, count, page, async () => ({ clue: await page.evaluate(p => window.__vwImport.clues(p), slide?.path || null), zoom: spec.zoom, ...(await renderPage(page, { source: entryText, sourceUrl: href(entry), spec, width, height, store })) }));
      }
      return { kind, label, pages, names: [], store, origin };
    } finally { await page.close().catch(() => {}); }
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(ok => server.close(ok));
  }
}
