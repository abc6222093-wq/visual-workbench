// 第 13–16 轮：旧项目（没有 marksRule 的 v3）第一次打开时按第 2 版规则补 data-vw 标记（src/upgrade-marks.js，server 的 GET 项目调用）。
// 先自动存版（说明含「补标记」）；只改 / 插 data-vw、data-vw-id 属性，其他源码逐字不变；写 marksRule: 2，再打开不再升级；草稿页不动。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';
import { listVersions } from '../src/version.js';

const NOW = '2026-10-05T12:00:00.000Z';
const PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body { margin: 0; background: #ffffff; font-family: sans-serif; }
  .full { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; background: #fdf2e9; }
  h1 { position: absolute; left: 120px; top: 100px; margin: 0; font-size: 80px; color: #222222; }
  img { position: absolute; left: 900px; top: 300px; width: 400px; height: 300px; }
  .dot { position: absolute; left: 120px; top: 500px; width: 60px; height: 60px; background: #e5484d; }
  .bar { position: absolute; left: 120px; top: 700px; width: 600px; height: 12px; background: #2f6bff; }
</style></head>
<body>
  <div class="full" data-vw-id="pagebg" data-vw="background"></div>
  <h1 data-vw-id="title" data-vw="text move color">旧项目标题</h1>
  <img data-vw-id="pic" data-vw="crop" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
  <div class="dot" data-vw-id="dot" data-vw="background"></div>
  <div class="bar"></div>
</body></html>
`;
const DRAFT = `<!doctype html><html><head><meta charset="utf-8"><style>.box{position:absolute;left:10px;top:10px;width:300px;height:100px;background:#eeeeee}</style></head><body><h1 data-vw-id="d1" data-vw="text move color" data-vw-level="title">草稿标题</h1><div class="box"></div></body></html>
`;
const strip = s => s.replace(/\s+data-vw(?:-id)?="[^"]*"/g, '');
const caps = (html, id) => new RegExp(`data-vw-id="${id}" data-vw="([^"]*)"`).exec(html)?.[1];

test('round16 旧项目补标记：自动存版、按第 2 版规则补能力、补色块编号、写 marksRule、只升级一次、草稿页不动', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-round16-marks-'));
  let server;
  t.after(async () => { if (server?.listening) await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const root = join(dir, 'projects', 'old');
  mkdirSync(join(root, 'pages'), { recursive: true }); mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'pages/page_a.html'), PAGE);
  writeFileSync(join(root, 'pages/page_d.html'), DRAFT);
  writeFileSync(join(root, 'project.json'), JSON.stringify({
    format: 'visual-workbench/project', formatVersion: 3, id: 'old', name: '旧项目', createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'slide-16x9', width: 1920, height: 1080 }, assets: [], fonts: [],
    pages: [{ id: 'page_a', name: '第1页', file: 'pages/page_a.html', edits: [] }, { id: 'page_d', name: '草稿', file: 'pages/page_d.html', draft: true, edits: [] }],
  }, null, 2));
  server = createServer({ dataDir: dir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/api/projects/old`;

  const res = await fetch(url); assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.project.marksRule, 2);
  const versions = listVersions(root);
  assert.equal(versions.length, 1, '先自动存了一版');
  const meta = JSON.parse(readFileSync(join(versions[0], 'meta.json'), 'utf8'));
  assert.match(meta.note, /补标记/);

  const html = readFileSync(join(root, 'pages/page_a.html'), 'utf8');
  assert.equal(caps(html, 'title'), 'text move resize color');
  assert.equal(caps(html, 'pic'), 'move resize crop');
  assert.equal(caps(html, 'dot'), 'move resize background');
  assert.equal(caps(html, 'pagebg'), 'background', '整页背景仍只有 background');
  assert.match(html, /<div class="bar" data-vw-id="b\d+" data-vw="move resize background">/, '没标的纯色块补了 b<n>');
  assert.equal(strip(html), strip(PAGE), '去掉标记属性后和原文件逐字相同');
  assert.equal(readFileSync(join(root, 'pages/page_d.html'), 'utf8'), DRAFT, '草稿页不动');
  assert.equal(JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).marksRule, 2);

  // 再打开：不再升级，不再存版，页面不变
  const again = await (await fetch(url)).json();
  assert.equal(again.project.marksRule, 2);
  assert.equal(listVersions(root).length, 1);
  assert.equal(readFileSync(join(root, 'pages/page_a.html'), 'utf8'), html);
});
