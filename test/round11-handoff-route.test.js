import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';
import { agentBrief } from '../src/brief.js';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-handoff-route-'));
  const server = createServer({ dataDir: dir, port: 4173 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', payload) => { const r = await fetch(base + path, { method, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined }); return { status: r.status, body: await r.json() }; };
  return { dir, request };
}

test('交接包路由：有基准时生成清单；没有基准时 409', async (t) => {
  const { dir, request } = await fixture(t);
  const made = await request('/api/projects', 'POST', { id: 'site', name: '网站', preset: 'web-desktop', width: 1440, height: 900 });
  assert.equal(made.status, 201);
  const file = join(dir, 'projects/site/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  project.kind = 'web';
  project.pages = [{ id: 'page_home_desk', name: '首页 · 电脑端', background: '#ffffff', device: 'desktop', size: { width: 1440, height: 2000 }, elements: [
    { id: 'el_btn_main', type: 'shape', shape: 'rect', fill: '#2563eb', x: 100, y: 100, width: 200, height: 60, zIndex: 1, name: '按钮', origin: { selector: 'main > a.btn', tag: 'a', text: '了解更多' } },
  ] }];
  writeFileSync(file, JSON.stringify(project));
  // 没有基准：409，中文提示
  const none = await request('/api/projects/site/handoff', 'POST', { images: false });
  assert.equal(none.status, 409); assert.match(none.body.error, /导入基准/);
  // 写基准后改颜色：生成清单
  mkdirSync(join(dir, 'projects/site/import'), { recursive: true });
  writeFileSync(join(dir, 'projects/site/import/baseline.json'), JSON.stringify(project));
  project.pages[0].elements[0].fill = '#dc2626';
  writeFileSync(file, JSON.stringify(project));
  const made2 = await request('/api/projects/site/handoff', 'POST', { images: false });
  assert.equal(made2.status, 200, JSON.stringify(made2.body));
  assert.ok(made2.body.outDir.replaceAll('\\', '/').includes('/exports/site/handoff-'));
  assert.ok(made2.body.files.includes('改动清单.md'));
  assert.match(readFileSync(join(made2.body.outDir, '改动清单.md'), 'utf8'), /#2563eb[\s\S]*#dc2626/);
  assert.match(made2.body.agentText, /改动清单/);
  assert.ok(!existsSync(join(made2.body.outDir, 'compare')) || made2.body.files.every((f) => !f.endsWith('.png')));
  // 复制给 agent 的开场白对网页项目说明基准与清单
  const text = agentBrief({ repoDir: process.cwd(), dataDir: dir, projectDir: join(dir, 'projects/site') });
  assert.match(text, /导入的网页项目/); assert.match(text, /baseline\.json/); assert.doesNotMatch(text, /重写每页 motion/);
});
