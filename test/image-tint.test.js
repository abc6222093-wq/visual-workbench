// SVG 上传安全检查（第 12 轮起图片着色 tint 随 v2 格式取消，只留上传部分；贴图、素材库仍走这条上传）。
// 只用临时目录，不碰真实数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';

const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000000"/></svg>';
const b64 = text => Buffer.from(text).toString('base64');

// ---------- SVG 上传 ----------
async function serverFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-tint-server-'));
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => {
    const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { dir, base, request };
}

test('SVG 上传：干净的 SVG 可以上传，尺寸取自 viewBox / width、height，服务时带 CSP', async t => {
  const { base, request } = await serverFixture(t);
  assert.equal((await request('/api/projects', 'POST', { id: 'svg-up', name: 'SVG', preset: 'custom', width: 800, height: 450 })).status, 201);
  const up = await request('/api/projects/svg-up/assets', 'POST', { name: 'logo.svg', data: `data:image/svg+xml;base64,${b64(LOGO_SVG)}` });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.match(up.body.asset.file, /^assets\/[0-9a-f-]+\.svg$/);
  assert.equal(up.body.asset.width, 100);
  assert.equal(up.body.asset.height, 100);
  const served = await fetch(`${base}/data/projects/svg-up/${up.body.asset.file}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /^image\/svg\+xml/);
  assert.equal(served.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(await served.text(), LOGO_SVG);
  // PNG 不带 SVG 的 CSP
  const sized = '<svg xmlns="http://www.w3.org/2000/svg" width="240px" height="80" viewBox="0 0 30 10"><rect width="30" height="10"/></svg>';
  const second = await request('/api/projects/svg-up/assets', 'POST', { name: 'wide.svg', data: `data:image/svg+xml;base64,${b64(sized)}`, revision: up.body.revision });
  assert.equal(second.status, 201);
  assert.deepEqual([second.body.asset.width, second.body.asset.height], [240, 80]);
  // 公共素材库也收 SVG，不传尺寸时自己读
  const lib = await request('/api/library', 'POST', { name: 'logo.svg', data: `data:image/svg+xml;base64,${b64(LOGO_SVG)}` });
  assert.equal(lib.status, 201, JSON.stringify(lib.body));
  assert.deepEqual([lib.body.width, lib.body.height], [100, 100]);
  const libServed = await fetch(base + lib.body.url);
  assert.equal(libServed.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
});

test('SVG 上传：带脚本、事件属性、javascript:、foreignObject、外部链接的一律拒绝（中文提示）', async t => {
  const { request } = await serverFixture(t);
  assert.equal((await request('/api/projects', 'POST', { id: 'svg-bad', name: 'SVG', preset: 'custom', width: 800, height: 450 })).status, 201);
  const bad = {
    script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    onload: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    onclick: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" onClick = "x()"/></svg>',
    javascript: '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
    foreignObject: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
    external: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.com/a.png"/></svg>',
    notSvg: '<html><body>hi</body></html>',
  };
  for (const [name, svg] of Object.entries(bad)) {
    const response = await request('/api/projects/svg-bad/assets', 'POST', { name: `${name}.svg`, data: `data:image/svg+xml;base64,${b64(svg)}` });
    assert.equal(response.status, 400, name);
    assert.match(response.body.error, /[一-鿿]/, `${name}: ${response.body.error}`);
  }
  const project = (await request('/api/projects/svg-bad')).body.project;
  assert.deepEqual(project.assets, []);
  const lib = await request('/api/library', 'POST', { name: 'x.svg', data: `data:image/svg+xml;base64,${b64(bad.onload)}`, width: 1, height: 1 });
  assert.equal(lib.status, 400);
});
