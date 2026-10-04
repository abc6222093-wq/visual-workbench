// 合并 round3 两条分支后的动效代码（格式 v2，page.motion.source + 项目里的附属代码文件）集成检查：
// 实时刷新、版本存档/退回、从母版新建、三方合并。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './helpers/isolated-server.js';
import { saveVersion, restoreVersion } from '../src/version.js';
import { createFromMaster } from '../src/master.js';
import { agentBrief } from '../src/brief.js';
import { validateProject } from '../src/validate.js';
import { mergeProjects } from '../web/sync.js';
import { findElement } from '../web/editor.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'examples', 'sample-deck');
const SAMPLE_PROJECT = JSON.parse(readFileSync(join(SAMPLE, 'project.json'), 'utf8'));

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const pageOf = (project, id) => project.pages.find((p) => p.id === id);
const el = (project, pageId, id) => findElement(pageOf(project, pageId), id)?.element;

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-motion-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 把示例项目复制成 dataDir/projects/<id> */
function installSample(dataDir, id) {
  const target = join(dataDir, 'projects', id);
  cpSync(SAMPLE, target, { recursive: true });
  const file = join(target, 'project.json');
  writeJson(file, { ...readJson(file), id });
  mkdirSync(join(target, 'versions'), { recursive: true });
  return target;
}

const SOURCE_A = "export default async function(ctx) { const {node} = ctx.element('el_title1'); return { async step() { await ctx.animate(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' }); } }; }";
const SOURCE_B = "export default async function(ctx) { const {node} = ctx.element('el_subtitle1'); /* agent 重写 */ return { async step(i) { await ctx.animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(' + (1 + i * 0.1) + ')' }], { duration: 400, fill: 'forwards' }); } }; }";

// ---------- 1. 实时刷新 ----------

async function startServer(t, dataDir) {
  const server = createServer({ dataDir, port: 4173, watchPollMs: 100 });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const streams = [];
  t.after(async () => {
    for (const s of streams) s.abort();
    await new Promise((done) => server.close(done));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => (await fetch(base + path)).json();
  // 和 test/server-round3.test.js 一样：像 EventSource 一样读推送
  const listen = async (id) => {
    const control = new AbortController();
    streams.push(control);
    const response = await fetch(`${base}/api/projects/${id}/events`, { signal: control.signal });
    assert.equal(response.status, 200);
    const events = [];
    const waiters = [];
    (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            const name = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!name || !data) continue;
            const event = { event: name, ...JSON.parse(data) };
            const w = waiters.find((x) => x.match(event));
            if (w) { waiters.splice(waiters.indexOf(w), 1); w.done(event); } else events.push(event);
          }
        }
      } catch {}
    })();
    const next = (match, timeoutMs = 5000) => {
      const seen = events.find(match);
      if (seen) { events.splice(events.indexOf(seen), 1); return Promise.resolve(seen); }
      return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error('等待推送事件超时')), timeoutMs);
        waiters.push({ match, done: (e) => { clearTimeout(timer); done(e); } });
      });
    };
    const hello = await next((e) => e.event === 'hello');
    return { next, hello };
  };
  return { get, listen };
}

test('实时刷新：agent 改 motion.source、改附属动效文件，开着的界面都收到 changed 和对应版本号', async (t) => {
  const dataDir = tmp(t);
  const target = installSample(dataDir, 'live-motion');
  const { get, listen } = await startServer(t, dataDir);
  const stream = await listen('live-motion');
  const before = await get('/api/projects/live-motion');
  assert.equal(stream.hello.revision, before.revision);

  // a) 改 project.json 里某页的 motion.source
  const file = join(target, 'project.json');
  const project = readJson(file);
  pageOf(project, 'page_cover1').motion.source = SOURCE_B;
  writeJson(file, project);
  const first = await stream.next((e) => e.event === 'changed' && e.files.includes('project.json'));
  assert.equal(first.external, true);
  assert.notEqual(first.revision, before.revision);
  const loaded = await get('/api/projects/live-motion');
  assert.equal(first.revision, loaded.revision);
  assert.equal(pageOf(loaded.project, 'page_cover1').motion.source, SOURCE_B);

  // b) 新增、再修改附属代码文件 motion/lib.js（project.json 不变，所以版本号不变，但事件里列出了这个文件）
  mkdirSync(join(target, 'motion'), { recursive: true });
  writeFileSync(join(target, 'motion/lib.js'), 'export const ease = 1;\n');
  const added = await stream.next((e) => e.event === 'changed' && e.files.includes('motion/lib.js'));
  assert.equal(added.external, true);
  assert.equal(added.revision, loaded.revision);
  writeFileSync(join(target, 'motion/lib.js'), 'export const ease = 2;\n');
  const edited = await stream.next((e) => e.event === 'changed' && e.files.includes('motion/lib.js'));
  assert.equal(edited.external, true);
  assert.equal(edited.revision, loaded.revision);
});

// ---------- 2. 版本 ----------

test('版本：存版后改 motion.source/steps 和附属动效文件，退回后逐字恢复；退回前自动存档里是新动效', (t) => {
  const dataDir = tmp(t);
  const projectDir = installSample(dataDir, 'ver-motion');
  const file = join(projectDir, 'project.json');
  mkdirSync(join(projectDir, 'motion'), { recursive: true });
  writeFileSync(join(projectDir, 'motion/lib.js'), 'export const v = "old";\n');
  const oldMotion = structuredClone(pageOf(readJson(file), 'page_cover1').motion);
  const oldBytes = readFileSync(file);

  const saved = saveVersion({ projectDir, note: '旧动效' });
  const versionId = saved.versionDir.split(/[\\/]/).pop();

  const project = readJson(file);
  pageOf(project, 'page_cover1').motion = { steps: 1, source: SOURCE_B };
  writeJson(file, project);
  writeFileSync(join(projectDir, 'motion/lib.js'), 'export const v = "new";\n');
  writeFileSync(join(projectDir, 'motion/extra.js'), 'export const extra = true;\n');
  assert.equal(validateProject(projectDir).ok, true);

  const out = restoreVersion({ projectDir, versionId });
  assert.deepEqual(readFileSync(file), oldBytes);
  assert.deepEqual(pageOf(readJson(file), 'page_cover1').motion, oldMotion);
  assert.equal(readFileSync(join(projectDir, 'motion/lib.js'), 'utf8'), 'export const v = "old";\n');
  assert.equal(existsSync(join(projectDir, 'motion/extra.js')), false); // 存版后才加的文件被移除
  assert.equal(validateProject(projectDir).ok, true);

  const backup = out.backup.versionDir;
  assert.deepEqual(pageOf(readJson(join(backup, 'project.json')), 'page_cover1').motion, { steps: 1, source: SOURCE_B });
  assert.equal(readFileSync(join(backup, 'motion/lib.js'), 'utf8'), 'export const v = "new";\n');
  assert.equal(readFileSync(join(backup, 'motion/extra.js'), 'utf8'), 'export const extra = true;\n');
});

// ---------- 3. 母版 ----------

test('母版：从母版新建带上动效代码（series.json 的 motions 原样记录，附属文件照常复制，开场白提示）', (t) => {
  const dir = tmp(t);
  const masterDir = join(dir, 'projects', 'brand-master');
  cpSync(SAMPLE, masterDir, { recursive: true });
  mkdirSync(join(masterDir, 'motion'), { recursive: true });
  writeFileSync(join(masterDir, 'motion/lib.js'), 'export const shared = 1;\n');
  const master = readJson(join(masterDir, 'project.json'));

  const destProjectDir = join(dir, 'projects', 'lesson-2');
  const r = createFromMaster({ masterDir, destProjectDir, newId: 'lesson-2', newName: '第二讲' });
  assert.equal(validateProject(destProjectDir).ok, true);
  // 新项目仍然只有一张空白页，不带页面动效
  assert.equal(r.project.pages.length, 1);
  assert.equal(r.project.pages[0].motion, undefined);
  assert.deepEqual(r.project.pages[0].elements, []);

  const series = readJson(join(destProjectDir, 'series.json'));
  const expected = master.pages.filter((p) => p.motion).map((p) => ({
    pageId: p.id, pageName: p.name, steps: p.motion.steps, source: p.motion.source,
  }));
  assert.ok(expected.length > 0);
  assert.deepEqual(series.motions, expected);
  assert.equal(readFileSync(join(destProjectDir, 'motion/lib.js'), 'utf8'), 'export const shared = 1;\n');
  assert.ok(r.copiedExtra.includes('motion/lib.js'));

  const brief = agentBrief({ repoDir: ROOT, projectDir: destProjectDir });
  assert.ok(brief.includes('motions'), brief);
  assert.equal(brief.includes('undefined'), false);

  // 母版没有任何动效：motions 为空数组，开场白不提
  const plainDir = join(dir, 'projects', 'plain-master');
  cpSync(SAMPLE, plainDir, { recursive: true });
  const plain = readJson(join(plainDir, 'project.json'));
  for (const p of plain.pages) delete p.motion;
  writeJson(join(plainDir, 'project.json'), plain);
  const dest2 = join(dir, 'projects', 'lesson-3');
  createFromMaster({ masterDir: plainDir, destProjectDir: dest2, newId: 'lesson-3', newName: '第三讲' });
  assert.deepEqual(readJson(join(dest2, 'series.json')).motions, []);
  assert.equal(agentBrief({ repoDir: ROOT, projectDir: dest2 }).includes('motions'), false);
});

// ---------- 4. 三方合并 ----------

test('三方合并：动效代码整体保留、不被逐字合并或截断', () => {
  const trio = () => [structuredClone(SAMPLE_PROJECT), structuredClone(SAMPLE_PROJECT), structuredClone(SAMPLE_PROJECT)];

  // (a) agent 重写第 1 页 source；用户挪第 1 页元素、改第 2 页文字
  {
    const [base, local, remote] = trio();
    pageOf(remote, 'page_cover1').motion.source = SOURCE_B;
    el(local, 'page_cover1', 'el_title1').x = 321;
    el(local, 'page_scene2', 'el_caption2').text = '用户改的说明';
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(conflicts, []);
    assert.equal(pageOf(merged, 'page_cover1').motion.source, SOURCE_B);
    assert.equal(el(merged, 'page_cover1', 'el_title1').x, 321);
    assert.equal(el(merged, 'page_scene2', 'el_caption2').text, '用户改的说明');
  }

  // (b) agent 给原来没有动效的页加动效；用户同时改这一页
  {
    const [base, local, remote] = trio();
    for (const p of [base, local, remote]) delete pageOf(p, 'page_clip3').motion;
    pageOf(remote, 'page_clip3').motion = { steps: 1, source: SOURCE_A };
    pageOf(local, 'page_clip3').background = '#123456';
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(conflicts, []);
    assert.deepEqual(pageOf(merged, 'page_clip3').motion, { steps: 1, source: SOURCE_A });
    assert.equal(pageOf(merged, 'page_clip3').background, '#123456');
  }

  // (c) agent 删除某页动效 → 合并结果里也没有
  {
    const [base, local, remote] = trio();
    delete pageOf(remote, 'page_scene2').motion;
    el(local, 'page_scene2', 'el_card2a').y = 77;
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(conflicts, []);
    assert.equal('motion' in pageOf(merged, 'page_scene2'), false);
    assert.equal(el(merged, 'page_scene2', 'el_card2a').y, 77);
  }

  // (d) 用户删除了 agent 新 source 引用的元素 → 元素按原规则删掉，source 原样保留
  {
    const [base, local, remote] = trio();
    const newSource = SOURCE_A.replace('el_title1', 'el_logo1');
    pageOf(remote, 'page_cover1').motion = { steps: 1, source: newSource };
    const page = pageOf(local, 'page_cover1');
    page.elements = page.elements.filter((e) => e.id !== 'el_logo1');
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(conflicts, []);
    assert.equal(el(merged, 'page_cover1', 'el_logo1'), undefined);
    const src = pageOf(merged, 'page_cover1').motion.source;
    assert.equal(typeof src, 'string');
    assert.equal(src, newSource);
  }

  // (e) 三方 source 各不相同 → 整体取 agent 的（不论 prefer），并记一条冲突
  for (const prefer of ['local', 'remote']) {
    const [base, local, remote] = trio();
    const localSource = SOURCE_A + '\n// local';
    pageOf(local, 'page_cover1').motion = { steps: 3, source: localSource };
    pageOf(remote, 'page_cover1').motion = { steps: 1, source: SOURCE_B };
    const { merged, conflicts } = mergeProjects(base, local, remote, { prefer });
    const motion = pageOf(merged, 'page_cover1').motion;
    assert.deepEqual(motion, { steps: 1, source: SOURCE_B }); // steps 与 source 配套，不混搭
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].path, ['pages', 'page_cover1', 'motion']);
    assert.equal(conflicts[0].label, '第 1 页 · 动效代码');
    assert.equal(conflicts[0].remote.source, SOURCE_B);
    assert.equal(conflicts[0].local.source, localSource);
  }
});
