// 旧 HTML 导入 · 后台浏览器分析：本地临时 http 服务挂上传的文件，Chromium 逐页打开（视口 = 画板尺寸），
// 每页单独渲染、播完动画后取元素，转不了的块截图。网络请求只许访问本地服务，网络字体和 CDN 一律不下载。
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * 在已经注入分析代码的页面里取一页：isolate → analyze → 逐个截图块截图。kind 'web' 时整页一页。
 * 返回 inpage.js analyze 的结果，截图块带 png。
 */
export async function analyzeOpenedPage(page, { kind, index = 0, width, deck = false, check = () => {}, isolate = {}, limit }) {
  // 每页一份文档的课件常用 End 键跳到最后一步（取「最后一步的画面」）
  if (deck) { await page.keyboard.press('End').catch(() => {}); await page.waitForTimeout(100); }
  await page.evaluate(([k, n, o]) => window.__vwImport.isolate(k, n, o), [kind, index, isolate]);
  const res = await page.evaluate(o => window.__vwImport.analyze(o), { width, ...(limit ? { limit } : {}) });
  for (const item of res.items) {
    if (item.kind !== 'shot') continue; check();
    const c = item.clip, x = Math.max(0, Math.floor(c.x)), y = Math.max(0, Math.floor(c.y));
    const w = Math.min(res.doc.width, Math.ceil(c.x + c.width)) - x, h = Math.min(res.doc.height, Math.ceil(c.y + c.height)) - y;
    if (w < 1 || h < 1) continue;
    // canvas / video 等和背景层：底色取页面背景；叠在别的内容上的块：透明底，混合模式另写进 effects.blend
    const opaque = item.opaque || item.role === 'background';
    await page.evaluate(o => window.__vwImport.shotOn(o), { marks: item.marks || [item.mark], own: item.own, background: opaque ? res.background : null });
    item.png = await page.screenshot({ clip: { x, y, width: w, height: h }, fullPage: true, caret: 'hide', omitBackground: !opaque });
    await page.evaluate(() => window.__vwImport.shotOff());
  }
  return res;
}

const DECK_LABEL = '课件 JSON（application/json 脚本里的 slides[].html，每页一份完整文档）';
export const withTimeout = (promise, ms, message) => { let t; return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(t)); };

/**
 * 分析入口 HTML。返回 { kind, label, pages: [分析结果] }；每页结果见 inpage.js analyze，截图块带 png。
 * onPages(n) 识别完页数时回调；onPage(i, n) 每页开始时回调；onBrowser(browser) 交出浏览器以便取消时立即关闭。
 */
export async function analyzeHtml({ srcDir, entry, width, height, signal, onPages = () => {}, onPage = () => {}, onBrowser = () => {}, pageTimeout = 90000 }) {
  const check = () => { if (signal?.aborted) throw cancelledError(); };
  const entryFile = join(srcDir, entry);
  const deck = deckData(readFileSync(entryFile, 'utf8'));
  const urls = [];
  if (deck) deck.slides.forEach((html, i) => { const name = `__vw_slide_${i + 1}.html`; writeFileSync(join(dirname(entryFile), name), html); urls.push(posix.join(posix.dirname(entry), name)); });
  const { server, origin } = await startStatic(srcDir);
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
    let kind = 'deck', label = DECK_LABEL, count = urls.length;
    if (!deck) { const page = await open(entry); try { ({ kind, label, count } = await page.evaluate(() => window.__vwImport.detect())); } finally { await page.close(); } }
    check(); onPages(count);
    const pages = [];
    for (let i = 0; i < count; i++) {
      check(); onPage(i, count);
      const page = await open(deck ? urls[i] : entry);
      try {
        const work = analyzeOpenedPage(page, { kind, index: deck ? 0 : i, width, deck: !!deck, check });
        work.catch(() => {});
        pages.push(await withTimeout(work, pageTimeout, `第 ${i + 1} 页分析超时`));
      } catch (error) {
        if (signal?.aborted) throw cancelledError();
        // 这一页分析失败：整页截一张图兜底，迁移说明里写原因
        let png = null; try { png = await page.screenshot({ clip: { x: 0, y: 0, width, height } }); } catch {}
        pages.push({ items: png ? [{ kind: 'shot', x: 0, y: 0, width, height, png, reason: '整页分析失败', name: '[截图] 整页' }] : [], background: null, clue: null, error: String(error.message || error), scale: 1, fonts: { faces: [], remote: [] } });
      } finally { await page.close().catch(() => {}); }
    }
    return { kind, label, pages, names: deck?.names || [], origin, generated: urls };
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(ok => server.close(ok));
  }
}
