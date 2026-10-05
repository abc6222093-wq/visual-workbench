// 导入网页（第 11 轮起；第 12 轮改为保留原网页）：网页项目不分页，每个网页按电脑端（1440×900 窗口）、手机端（390×844 窗口）各取一页，
// 整页高度 = 滚动到底触发懒加载后的 scrollHeight（上限 20000）。来源有两种：
//   ① 本地网页文件 / 文件夹 / 压缩包（只打开入口文件，页面文件取原文，脚本保留）；
//   ② 网址（每行一个，页面文件取打开后的当前 DOM，读得到的样式表内联进 <style>，脚本不保留，资源只用 GET 下载）。
// 只读保证：所有不是 GET 的请求一律放弃（表单提交、POST 打点、sendBeacon），不点击、不登录、不提交；
// 需要登录才能看的页面（跳到登录地址、HTTP 401/403、页面主体只有密码框）跳过；网址不对、超时、DNS 失败也跳过，全部跳过才算失败。
import { launchBrowser } from '../browser.js';
import { install } from './inpage.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startStatic, renderPage, failedHtml, onlyGet, cancelledError, withTimeout } from './analyze.js';
import { createStore, newLog } from './resources.js';
import { WEB_DEVICES } from '../../web/project-kinds.js';

export const MAX_PAGE_HEIGHT = 20000;
export const MAX_URLS = 30;
export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const LOGIN_URL = /login|signin|auth|passport|sso/i;
const LOCAL_LABEL = '网页（本地文件，整页一页）', URL_LABEL = '网页（网址抓取，整页一页）';

/** 用户输入的网址：去空白、去重；不是 http / https 的记为跳过。 */
export function normalizeUrls(list) {
  const ok = [], bad = [], seen = new Set();
  for (const raw of (Array.isArray(list) ? list : String(list ?? '').split(/\r?\n/))) {
    const text = String(raw ?? '').trim(); if (!text) continue;
    let url; try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { bad.push({ url: text, reason: '网址格式不正确' }); continue; }
    if (!/^https?:$/.test(url.protocol)) { bad.push({ url: text, reason: '只支持 http / https 网址' }); continue; }
    if (seen.has(url.href)) continue; seen.add(url.href); ok.push(url.href);
  }
  return { ok, bad };
}
/** 设备列表：只认 desktop / mobile，没给就两个都抓。 */
export function normalizeDevices(list) {
  const out = (Array.isArray(list) ? list : ['desktop', 'mobile']).filter((d, i, a) => WEB_DEVICES[d] && a.indexOf(d) === i);
  return out.length ? ['desktop', 'mobile'].filter(d => out.includes(d)) : [];
}

// 只读的浏览器环境：拦住 Service Worker、下载；sendBeacon、表单 submit 改成什么都不做（路由里也会再拦一次非 GET）
const READ_ONLY_INIT = `(() => { try { navigator.sendBeacon = () => false; } catch {} try { HTMLFormElement.prototype.submit = function () {}; HTMLFormElement.prototype.requestSubmit = function () {}; } catch {} })();`;
async function deviceContext(browser, device) {
  const d = WEB_DEVICES[device];
  const context = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false, ...(device === 'mobile' ? { userAgent: MOBILE_UA, hasTouch: true } : {}) });
  await context.addInitScript(READ_ONLY_INIT);
  return context;
}
const openPage = async context => { const page = await context.newPage(); page.on('dialog', d => d.dismiss().catch(() => {})); return page; };

/** 慢慢滚到底触发懒加载，再回到页顶；返回整页高度（不截断）。 */
async function lazyScroll(page) {
  const full = await page.evaluate(async max => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let y = 0, n = 0; y < Math.min(document.documentElement.scrollHeight, max) && n < 60; y += innerHeight, n++) { scrollTo(0, y); await wait(120); }
    scrollTo(0, document.documentElement.scrollHeight); await wait(150); scrollTo(0, 0); await wait(100);
    return Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight);
  }, MAX_PAGE_HEIGHT);
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  return full;
}

/** 取一个已打开的网页：整页一页。返回 renderPage 结果 + device、height、truncated、clue。 */
async function webPage(page, { device, check, store, source, sourceUrl }) {
  const d = WEB_DEVICES[device];
  const full = await lazyScroll(page); check();
  await page.evaluate(`(${install})()`);
  const clue = await page.evaluate(() => window.__vwImport.clues());
  const res = await renderPage(page, { source, sourceUrl, snapshot: source === null, spec: { mode: 'whole', web: true }, width: d.width, height: d.height, store });
  return { ...res, clue, device, height: Math.max(d.height, Math.min(MAX_PAGE_HEIGHT, Math.round(full))), truncated: full > MAX_PAGE_HEIGHT ? full : 0 };
}
const failedPage = (device, error) => ({ device, height: WEB_DEVICES[device].height, truncated: 0, html: failedHtml(error?.message || error), heading: '', title: '', stats: { text: 0, image: 0 }, notes: null, log: newLog(), clue: null, error: String(error?.message || error) });

/** ① 本地文件：只打开入口文件，每个设备一页。 */
export async function analyzeWebFiles({ srcDir, entry, devices = ['desktop', 'mobile'], projectDir, signal, onPages = () => {}, onPage = () => {}, onBrowser = () => {}, pageTimeout = 90000 }) {
  const check = () => { if (signal?.aborted) throw cancelledError(); };
  const { server, origin } = await startStatic(srcDir);
  const store = createStore({ projectDir, srcDir, origin }), source = readFileSync(join(srcDir, entry), 'utf8');
  const sourceUrl = origin + '/' + entry.split('/').map(encodeURIComponent).join('/');
  let browser;
  try {
    check();
    browser = await launchBrowser(); onBrowser(browser); check();
    onPages(devices.length);
    const pages = [], capturedAt = new Date().toISOString();
    for (const [i, device] of devices.entries()) {
      check(); onPage(i, devices.length);
      const context = await deviceContext(browser, device);
      await context.route('**/*', route => onlyGet(route) || (route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient')));
      const page = await openPage(context);
      try {
        await page.goto(sourceUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
        const work = webPage(page, { device, check, store, source, sourceUrl }); work.catch(() => {});
        pages.push({ ...(await withTimeout(work, pageTimeout, `${WEB_DEVICES[device].label}导入超时`)), file: entry, capturedAt });
      } catch (error) {
        if (signal?.aborted || error.cancelled) throw cancelledError();
        pages.push({ ...failedPage(device, error), file: entry, capturedAt });
      } finally { await context.close().catch(() => {}); }
    }
    return { kind: 'web', source: 'files', label: LOCAL_LABEL, pages, origin, skipped: [], devices, store };
  } finally {
    await browser?.close().catch(() => {});
    await new Promise(ok => server.close(ok));
  }
}

function loadError(error, timeout) {
  const m = String(error?.message || error);
  if (/Timeout|timed out/i.test(m)) return `打开超时（超过 ${Math.round(timeout / 1000)} 秒）`;
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(m)) return '找不到这个网址（域名解析失败）';
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(m)) return '连接不上这个网站';
  if (/ERR_CERT|SSL/i.test(m)) return '网站的安全证书有问题';
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK/i.test(m)) return '网络不通';
  return `打不开：${m.split('\n')[0].slice(0, 120)}`;
}
// 页面主体只有密码框：有看得见的密码输入框，表单以外几乎没有内容
const passwordOnly = () => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  if (![...document.querySelectorAll('input[type="password" i]')].some(vis)) return false;
  const body = document.body.cloneNode(true);
  for (const n of body.querySelectorAll('form, script, style, noscript, template, header, nav, footer')) n.remove();
  return (body.textContent || '').replace(/\s+/g, '').length < 200;
};
const sameUrl = (a, b) => { try { const x = new URL(a), y = new URL(b); x.hash = y.hash = ''; return x.href.replace(/\/$/, '') === y.href.replace(/\/$/, ''); } catch { return a === b; } };

/** 网址来源的资源：先用页面加载时收到的响应，没有再发一次 GET（不带 cookie，不跟随到别的方法）。 */
async function getBytes(url, cache) {
  if (cache.has(url)) return cache.get(url);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const data = Buffer.from(await r.arrayBuffer());
    return { data, mime: (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
  } catch { return null; }
}

/** ② 网址：每个网址 × 每个设备一页；跳过的列进 skipped。 */
export async function captureUrls({ urls, devices = ['desktop', 'mobile'], projectDir, signal, onPages = () => {}, onPage = () => {}, onBrowser = () => {}, timeout = 45000, pageTimeout = 90000 }) {
  const check = () => { if (signal?.aborted) throw cancelledError(); };
  const { ok, bad } = normalizeUrls(urls);
  const skipped = bad.map(b => ({ ...b, devices: [...devices] })), pages = [], resources = new Map();
  const store = createStore({ projectDir, remote: url => getBytes(url, resources) });
  const skip = (url, device, reason) => { const old = skipped.find(s => s.url === url && s.reason === reason); if (old) old.devices.push(device); else skipped.push({ url, devices: [device], reason }); };
  const total = ok.length * devices.length; onPages(total);
  let browser;
  try {
    if (ok.length) { browser = await launchBrowser(); onBrowser(browser); check(); }
    let n = 0;
    for (const url of ok) for (const device of devices) {
      check(); onPage(n++, total);
      const context = await deviceContext(browser, device);
      await context.route('**/*', route => onlyGet(route) || route.continue());
      const page = await openPage(context), pending = [];
      page.on('response', resp => {
        const type = resp.request().resourceType();
        if (['image', 'font', 'stylesheet', 'script', 'media'].includes(type) && resp.status() < 300 && Number(resp.headers()['content-length'] || 0) < 40_000_000) pending.push(resp.body().then(b => { if (b.length < 40_000_000) resources.set(resp.url(), { data: b, mime: (resp.headers()['content-type'] || '').split(';')[0].trim().toLowerCase() }); }).catch(() => {}));
      });
      try {
        let response = null, failed = null;
        try { response = await page.goto(url, { waitUntil: 'networkidle', timeout }); }
        catch (error) {
          // 页面自己跳转（meta refresh、location.replace）会打断第一次导航：等跳转后的页面加载完再判断
          if (/interrupted|ERR_ABORTED|frame was detached/i.test(String(error.message))) await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) }).catch(() => {});
          else failed = loadError(error, timeout);
        }
        check();
        if (failed) { skip(url, device, failed); continue; }
        // 页面加载后才跳转的：再等一下
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
        const finalUrl = page.url(), status = response?.status?.() ?? 0;
        let finalTarget = ''; try { const u = new URL(finalUrl); finalTarget = u.hostname + u.pathname + u.search; } catch {}
        if (!sameUrl(finalUrl, url) && LOGIN_URL.test(finalTarget)) { skip(url, device, `需要登录（跳转到了登录页 ${finalUrl}）`); continue; }
        if (status === 401 || status === 403) { skip(url, device, `需要登录（HTTP ${status}）`); continue; }
        if (await page.evaluate(passwordOnly).catch(() => false)) { skip(url, device, '需要登录（页面只有密码输入框）'); continue; }
        if (status >= 400) { skip(url, device, `网页返回错误（HTTP ${status}）`); continue; }
        const snapshot = await page.content().catch(() => '');
        const capturedAt = new Date().toISOString();
        let res;
        await Promise.all(pending);
        try { const work = webPage(page, { device, check, store, source: null }); work.catch(() => {}); res = await withTimeout(work, pageTimeout, `${WEB_DEVICES[device].label}导入超时`); }
        catch (error) { if (signal?.aborted || error.cancelled) throw cancelledError(); res = failedPage(device, error); }
        pages.push({ ...res, url, finalUrl, snapshot, capturedAt });
      } finally { await context.close().catch(() => {}); }
    }
    return { kind: 'web', source: 'urls', label: URL_LABEL, pages, origin: null, skipped, devices, urls: ok, store };
  } finally { await browser?.close().catch(() => {}); }
}
