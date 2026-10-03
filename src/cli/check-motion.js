import { readFileSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { launchBrowserServer } from '../browser.js';
import { validateProjectData } from '../validate.js';

function positive(value, flag) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${flag} 必须是正整数`);
  return Number(value);
}
function parse(argv) {
  let path, timeout = 5000, totalTimeout;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout-ms' || arg === '--total-timeout-ms') {
      const value = positive(argv[++i], arg);
      if (arg === '--timeout-ms') timeout = value; else totalTimeout = value;
    } else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else if (path) throw new Error('只能指定一个项目路径');
    else path = arg;
  }
  return { input: resolve(path || 'examples/sample-deck'), timeout, totalTimeout };
}
let opts;
try { opts = parse(process.argv.slice(2)); }
catch (error) { console.error(error.message); console.error('用法：check-motion <项目目录、project.json 或导出的放映 .html> [--timeout-ms 正整数] [--total-timeout-ms 正整数]'); process.exit(1); }
// 导出的放映版单文件：用 file:// 打开，跑文件里内嵌的同一套检查
if (/\.html?$/i.test(opts.input)) {
  const { checkExportedHtml } = await import('./check-motion-html.js');
  await checkExportedHtml(opts);
  process.exit(process.exitCode ?? 0);
}
const projectDir = opts.input.endsWith('.json') ? dirname(opts.input) : opts.input;
const projectFile = opts.input.endsWith('.json') ? opts.input : join(opts.input, 'project.json');
let project;
try { project = JSON.parse(readFileSync(projectFile, 'utf8')); }
catch (error) { console.error(`无法读取项目：${error.message}`); process.exit(1); }
const validation = validateProjectData(project, { projectDir });
if (!validation.ok) { for (const error of validation.errors) console.error(`${error.path}: ${error.message}`); process.exit(1); }
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const isProject = path.startsWith('/project/');
    const root = isProject ? projectDir : webRoot;
    const target = resolve(root, '.' + (isProject ? path.slice('/project'.length) : path));
    if (!target.startsWith(root + sep) && target !== root) throw new Error('Invalid path');
    const bytes = readFileSync(target);
    response.writeHead(200, { 'Content-Type': mime[target.slice(target.lastIndexOf('.'))] || 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
let failures = 0, successes = 0, announced = false, noBrowser = null;
try {
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const item of project.pages) {
    const pageId = item.id;
    const total = opts.totalTimeout || Math.max(10000, 2 * ((item.motion?.steps || 0) + 4) * opts.timeout);
    let browser, browserServer, timer, timedOut = false;
    const errors = [];
    try {
      ({ server: browserServer, browser } = await launchBrowserServer());
      if (!announced) { console.log(`用 ${browser.vwName} 检查`); announced = true; }
      const page = await browser.newPage();
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort('blockedbyclient'));
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const result = await Promise.race([
        (async () => {
          await page.goto(`${origin}/motion-check.html`);
          return page.evaluate(async ({ project, pageId, timeout }) => {
          const { checkMotion } = await import('/motion-check.js');
          return checkMotion(project, { pageId, assetBase: '/project', timeout });
          }, { project, pageId, timeout: opts.timeout });
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`总时限 ${total} ms 已到`)); }, total); })
      ]).finally(() => clearTimeout(timer));
      for (const row of result.results) { console.log(`${row.ok ? '✓' : '✗'} ${row.page} [${row.variant}]${row.ok ? '' : `: ${row.error}`}`); if (row.ok) successes++; else failures++; }
      for (const error of errors) { console.error(`✗ ${pageId} 浏览器错误: ${error}`); failures++; }
    } catch (error) {
      if (error.code === 'NO_BROWSER') { noBrowser = error; break; }
      console.error(`✗ ${pageId}: ${error.message}`); failures++;
    }
    finally {
      clearTimeout(timer);
      if (browser) {
        if (!timedOut) await Promise.race([browser.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
      }
      if (browserServer) {
        if (timedOut) await browserServer.kill().catch(() => {});
        await Promise.race([browserServer.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
      }
    }
  }
  if (noBrowser) { console.error(noBrowser.message); process.exitCode = 1; }
  else if (failures) process.exitCode = 1;
  else console.log(`动效检查通过：${successes} 项`);
} catch (error) { console.error(`动效检查失败：${error.message}`); process.exitCode = 1; }
finally { await new Promise(resolve => server.close(resolve)); }
