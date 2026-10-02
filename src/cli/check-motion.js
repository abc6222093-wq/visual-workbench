import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';
import { validateProjectData } from '../validate.js';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
const input = resolve(process.argv[2] || 'examples/sample-deck');
const projectDir = input.endsWith('.json') ? dirname(input) : input;
const projectFile = input.endsWith('.json') ? input : join(input, 'project.json');
let project;
try { project = JSON.parse(readFileSync(projectFile, 'utf8')); }
catch (error) { console.error(`无法读取项目：${error.message}`); process.exit(1); }
const validation = validateProjectData(project, { projectDir });
if (!validation.ok) { for (const error of validation.errors) console.error(`${error.path}: ${error.message}`); process.exit(1); }
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const target = path.startsWith('/project/') ? resolve(projectDir, '.' + path.slice('/project'.length)) : resolve(webRoot, '.' + path);
    const root = path.startsWith('/project/') ? projectDir : webRoot;
    if (!target.startsWith(root + '/') && target !== root) throw new Error('Invalid path');
    const bytes = readFileSync(target);
    response.writeHead(200, { 'Content-Type': mime[target.slice(target.lastIndexOf('.'))] || 'application/octet-stream' }); response.end(bytes);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => { const url = route.request().url(); if (url.startsWith(localOrigin + '/')) route.continue(); else route.abort('blockedbyclient'); });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/motion-check.html`);
  let watchdog;
  const result = await Promise.race([page.evaluate(async project => {
    const { checkMotion } = await import('/motion-check.js');
    return checkMotion(project, { assetBase: '/project', timeout: 5000 });
  }, project), new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('浏览器检查总时限 120 秒已到')), 120000); })]).finally(() => clearTimeout(watchdog));
  for (const item of result.results) console.log(`${item.ok ? '✓' : '✗'} ${item.page} [${item.variant}]${item.ok ? '' : `: ${item.error}`}`);
  for (const error of errors) console.error(`浏览器错误: ${error}`);
  if (!result.ok || errors.length) process.exitCode = 1;
  else console.log(`动效检查通过：${result.results.length} 项`);
} catch (error) { console.error(`动效检查失败：${error.message}`); process.exitCode = 1; }
finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
