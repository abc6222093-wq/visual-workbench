// 第 12 轮运行时测试的夹具：临时 v3 小项目、最简静态服务（web/ 挂在 /，数据目录挂在 /data/，GET 加 CORS）、测试宿主页。
// 不用真实的数据目录和用户主目录；结束后清理临时目录。
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');

/** 生成一张 PNG（左半红、右半蓝），供图片 / 裁切测试用。 */
export function makePng(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const left = x < width / 2;
      raw[row + 1 + x * 3] = left ? 220 : 30; raw[row + 2 + x * 3] = 40; raw[row + 3 + x * 3] = left ? 40 : 220;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** 在临时数据目录里写一个 v3 项目：pages 是 [{ id, html, steps?, edits?, device?, size? }]。返回 { dataDir, projectDir, project, cleanup }。 */
export function writeProject({ id = 'rt-test', kind = 'deck', artboard = { preset: 'custom', width: 960, height: 540 }, pages, assets = [], files = {} }) {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-r12-runtime-'));
  const projectDir = join(dataDir, 'projects', id);
  mkdirSync(join(projectDir, 'pages'), { recursive: true });
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  for (const [file, bytes] of Object.entries(files)) { mkdirSync(dirname(join(projectDir, file)), { recursive: true }); writeFileSync(join(projectDir, file), bytes); }
  const now = new Date().toISOString();
  const project = {
    format: 'visual-workbench/project', formatVersion: 3, id, name: '运行时测试', kind, createdAt: now, updatedAt: now, artboard, assets, fonts: [],
    pages: pages.map(p => {
      writeFileSync(join(projectDir, 'pages', `${p.id}.html`), p.html);
      const page = { id: p.id, name: p.name || p.id, file: `pages/${p.id}.html`, edits: p.edits || [] };
      if (p.steps !== undefined) page.motion = { steps: p.steps };
      if (p.device) page.device = p.device;
      if (p.size) page.size = p.size;
      return page;
    })
  };
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  return { dataDir, projectDir, project, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

const MIME = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export const HARNESS = '<!doctype html><html><head><meta charset="utf-8"><title>harness</title><style>html,body{margin:0;background:rgb(1, 2, 3)}#stage{position:absolute;left:0;top:0}</style><script src="/page-runtime.js"></script></head><body><div id="stage"></div><p id="probe" style="position:absolute;left:0;top:2000px">probe</p></body></html>';

/** 最简静态服务。requests 记下 /api/ 请求的方法与 Origin 头（隔离测试用）。 */
export async function startServer(dataDir) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith('/api/')) { requests.push({ method: req.method, path, origin: req.headers.origin ?? null }); res.writeHead(403, { 'Access-Control-Allow-Origin': '*' }); res.end('forbidden'); return; }
    if (path === '/harness.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(HARNESS); return; }
    const isData = path.startsWith('/data/');
    const root = isData ? dataDir : WEB;
    const target = resolve(root, '.' + (isData ? path.slice('/data'.length) : path));
    try {
      if (!target.startsWith(root + sep)) throw new Error('bad path');
      const bytes = readFileSync(target);
      res.writeHead(200, { 'Content-Type': MIME[target.slice(target.lastIndexOf('.'))] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('not found'); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, requests, close: () => new Promise(done => server.close(done)) };
}

export const pause = ms => new Promise(done => setTimeout(done, ms));
/** 等条件成立（每 20ms 查一次）。 */
export async function until(check, { timeout = 5000, label = '条件' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`等待${label}超时`);
    await pause(20);
  }
}
