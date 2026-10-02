import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeProjects, summarizeConflicts, createSyncController, deepEqual } from '../web/sync.js';
import { findElement } from '../web/editor.js';

const SAMPLE = JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(SAMPLE);
const pageOf = (project, id) => project.pages.find(page => page.id === id);
const el = (project, pageId, id) => findElement(pageOf(project, pageId), id)?.element;
// 三份独立副本：base / エイ / agent
const trio = () => [fresh(), fresh(), fresh()];

test('エイ 改元素 A 的位置、agent 改元素 B 的文字：两边都保留，无冲突', () => {
  const [base, local, remote] = trio();
  el(local, 'page_cover1', 'el_title1').x = 222;
  el(remote, 'page_cover1', 'el_subtitle1').text = 'agent 改的副标题';
  remote.updatedAt = '2026-10-02T00:00:00.000Z';
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.equal(el(merged, 'page_cover1', 'el_title1').x, 222);
  assert.equal(el(merged, 'page_cover1', 'el_subtitle1').text, 'agent 改的副标题');
  assert.equal(merged.updatedAt, '2026-10-02T00:00:00.000Z');
  assert.deepEqual(conflicts, []);
});

test('エイ 改 A 的 x、agent 改同一个 A 的颜色：属性级合并，无冲突', () => {
  const [base, local, remote] = trio();
  el(local, 'page_cover1', 'el_title1').x = 10;
  el(remote, 'page_cover1', 'el_title1').color = '#ff0000';
  const { merged, conflicts } = mergeProjects(base, local, remote);
  const title = el(merged, 'page_cover1', 'el_title1');
  assert.equal(title.x, 10);
  assert.equal(title.color, '#ff0000');
  assert.equal(conflicts.length, 0);
});

test('双方改同一元素同一属性：默认保留 エイ 的并记一条冲突；prefer remote 时取 agent 的', () => {
  const [base, local, remote] = trio();
  el(local, 'page_cover1', 'el_title1').text = 'エイ 的标题';
  el(remote, 'page_cover1', 'el_title1').text = 'agent 的标题';
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.equal(el(merged, 'page_cover1', 'el_title1').text, 'エイ 的标题');
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], {
    path: ['pages', 'page_cover1', 'elements', 'el_title1', 'text'],
    label: '第 1 页 · 标题 · 文字',
    local: 'エイ 的标题',
    remote: 'agent 的标题',
  });
  const other = mergeProjects(base, local, remote, { prefer: 'remote' });
  assert.equal(el(other.merged, 'page_cover1', 'el_title1').text, 'agent 的标题');
  assert.equal(other.conflicts.length, 1);
});

test('冲突标签：分组子元素、x/y 合并成「位置」、项目级名称、summarizeConflicts 去重', () => {
  const [base, local, remote] = trio();
  Object.assign(el(local, 'page_clip3', 'el_gtri3'), { x: 1, y: 2 });
  Object.assign(el(remote, 'page_clip3', 'el_gtri3'), { x: 3, y: 4 });
  local.name = 'エイ 的名字';
  remote.name = 'agent 的名字';
  pageOf(local, 'page_scene2').background = '#000000';
  pageOf(remote, 'page_scene2').background = '#ffffff';
  const { conflicts } = mergeProjects(base, local, remote);
  assert.deepEqual(conflicts.map(c => c.label), [
    '项目 · 名称',
    '第 2 页 · 背景',
    '第 3 页 · 右侧说明组 · 三角形 · 位置',
    '第 3 页 · 右侧说明组 · 三角形 · 位置',
  ]);
  assert.deepEqual(conflicts.find(c => c.label.includes('三角形')).path, ['pages', 'page_clip3', 'elements', 'el_group3', 'children', 'el_gtri3', 'x']);
  assert.deepEqual(summarizeConflicts(conflicts), ['项目 · 名称', '第 2 页 · 背景', '第 3 页 · 右侧说明组 · 三角形 · 位置']);
});

test('冲突标签里的页码按合并后的页序', () => {
  const [base, local, remote] = trio();
  local.pages.reverse();
  el(local, 'page_cover1', 'el_title1').fontSize = 100;
  el(remote, 'page_cover1', 'el_title1').fontSize = 90;
  const { conflicts } = mergeProjects(base, local, remote);
  assert.equal(conflicts[0].label, '第 3 页 · 标题 · 字号');
});

test('agent 新增页面、元素、素材登记，エイ 同时改别的：都在，顺序合理', () => {
  const [base, local, remote] = trio();
  el(local, 'page_scene2', 'el_card2a').y = 999;
  remote.pages.push({ id: 'page_new4', name: '4 新页', background: '#ffffff', elements: [], steps: [] });
  const cover = pageOf(remote, 'page_cover1');
  cover.elements.splice(2, 0, { id: 'el_agent1', type: 'text', name: 'agent 新增', x: 0, y: 0, width: 10, height: 10, zIndex: 1, text: '新' });
  remote.assets.push({ id: 'asset_agent1', kind: 'image', file: 'assets/a.png', name: 'agent 素材', width: 1, height: 1 });
  // エイ 也新增了一个元素，放在副标题后面
  pageOf(local, 'page_cover1').elements.splice(2, 0, { id: 'el_ei1', type: 'shape', name: 'エイ 新增', x: 5, y: 5, width: 5, height: 5, zIndex: 1 });
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged.pages.map(p => p.id), ['page_cover1', 'page_scene2', 'page_clip3', 'page_new4']);
  assert.deepEqual(merged.assets.map(a => a.id), ['asset_city01', 'asset_logo01', 'asset_newpic1', 'asset_agent1']);
  // エイ 没调顺序 → 用 agent 的顺序；エイ 新增的项插在它在本地的前一个兄弟「标题」之后
  assert.deepEqual(pageOf(merged, 'page_cover1').elements.map(e => e.id), [
    'el_bgphoto', 'el_title1', 'el_ei1', 'el_agent1', 'el_subtitle1', 'el_bullet1', 'el_bullet2', 'el_bullet3', 'el_logo1',
  ]);
  assert.equal(el(merged, 'page_scene2', 'el_card2a').y, 999);
});

test('agent 删除元素、エイ 没动它：删除', () => {
  const [base, local, remote] = trio();
  const page = pageOf(remote, 'page_cover1');
  page.elements = page.elements.filter(e => e.id !== 'el_logo1');
  el(local, 'page_cover1', 'el_title1').x = 1;
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.equal(el(merged, 'page_cover1', 'el_logo1'), undefined);
  assert.equal(el(merged, 'page_cover1', 'el_title1').x, 1);
  assert.deepEqual(conflicts, []);
});

test('agent 删除元素、エイ 改了它：保留 エイ 的并记冲突', () => {
  const [base, local, remote] = trio();
  const page = pageOf(remote, 'page_cover1');
  page.elements = page.elements.filter(e => e.id !== 'el_logo1');
  el(local, 'page_cover1', 'el_logo1').x = 1500;
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.equal(el(merged, 'page_cover1', 'el_logo1').x, 1500);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].label, '第 1 页 · 标志（一方删除）');
  assert.deepEqual(conflicts[0].path, ['pages', 'page_cover1', 'elements', 'el_logo1']);
  assert.equal(conflicts[0].remote, undefined);
  // prefer remote 时按 agent 的删掉
  const other = mergeProjects(base, local, remote, { prefer: 'remote' });
  assert.equal(el(other.merged, 'page_cover1', 'el_logo1'), undefined);
});

test('エイ 删除元素、agent 改了它：默认按 エイ 删掉并记冲突', () => {
  const [base, local, remote] = trio();
  const page = pageOf(local, 'page_cover1');
  page.elements = page.elements.filter(e => e.id !== 'el_logo1');
  el(remote, 'page_cover1', 'el_logo1').width = 300;
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.equal(el(merged, 'page_cover1', 'el_logo1'), undefined);
  assert.equal(conflicts[0].label, '第 1 页 · 标志（一方删除）');
});

test('エイ 拖动页面顺序、agent 改某页内容：顺序按 エイ 的，内容按 agent 的', () => {
  const [base, local, remote] = trio();
  local.pages = [local.pages[2], local.pages[0], local.pages[1]];
  el(remote, 'page_scene2', 'el_caption2').text = 'agent 新说明';
  pageOf(remote, 'page_cover1').background = '#123456';
  const { merged, conflicts } = mergeProjects(base, local, remote);
  assert.deepEqual(merged.pages.map(p => p.id), ['page_clip3', 'page_cover1', 'page_scene2']);
  assert.equal(el(merged, 'page_scene2', 'el_caption2').text, 'agent 新说明');
  assert.equal(pageOf(merged, 'page_cover1').background, '#123456');
  assert.deepEqual(conflicts, []);
});

test('agent 改动效代码、エイ 改同页元素位置：都在', () => {
  const [base, local, remote] = trio();
  const motion = pageOf(remote, 'page_scene2').motion;
  motion.source = motion.source + '\n// agent 新加的一行';
  motion.steps += 1;
  Object.assign(el(local, 'page_scene2', 'el_photo2'), { x: 300, y: 260 });
  const { merged, conflicts } = mergeProjects(base, local, remote);
  const page = pageOf(merged, 'page_scene2');
  assert.equal(page.motion.source, motion.source);
  assert.equal(page.motion.steps, motion.steps);
  assert.equal(el(merged, 'page_scene2', 'el_photo2').x, 300);
  assert.equal(el(merged, 'page_scene2', 'el_photo2').y, 260);
  assert.deepEqual(conflicts, []);
});

test('只有 agent 变：结果等于磁盘版本；只有 エイ 变：结果等于本地（updatedAt 取磁盘的）', () => {
  {
    const [base, local, remote] = trio();
    el(remote, 'page_cover1', 'el_title1').text = '新';
    remote.pages.pop();
    remote.updatedAt = '2026-10-02T01:00:00.000Z';
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(merged, remote);
    assert.deepEqual(conflicts, []);
  }
  {
    const [base, local, remote] = trio();
    el(local, 'page_cover1', 'el_title1').text = '新';
    local.pages.reverse();
    local.updatedAt = '2026-10-02T02:00:00.000Z';
    remote.updatedAt = '2026-10-02T03:00:00.000Z';
    const { merged, conflicts } = mergeProjects(base, local, remote);
    assert.deepEqual(merged, { ...local, updatedAt: '2026-10-02T03:00:00.000Z' });
    assert.deepEqual(conflicts, []);
  }
});

test('入参不被修改，merged 不与入参共享引用', () => {
  const [base, local, remote] = trio();
  el(local, 'page_cover1', 'el_title1').text = 'L';
  el(remote, 'page_cover1', 'el_title1').text = 'R';
  remote.pages.push({ id: 'page_x', elements: [], steps: [] });
  const copies = [base, local, remote].map(v => structuredClone(v));
  const { merged } = mergeProjects(base, local, remote);
  assert.deepEqual([base, local, remote], copies);
  el(merged, 'page_scene2', 'el_photo2').x = -1;
  pageOf(merged, 'page_x').elements.push({ id: 'el_q' });
  assert.deepEqual([base, local, remote], copies);
});

test('deepEqual 与对象键顺序无关', () => {
  assert.ok(deepEqual({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!deepEqual([1, 2], [2, 1]));
  assert.ok(!deepEqual(null, {}));
});

// ---------- 同步控制器 ----------

// 可手动推进的假定时器
function fakeTimers() {
  let seq = 0;
  const queue = new Map();
  return {
    set(fn, ms) { const id = ++seq; queue.set(id, { fn, ms }); return id; },
    clear(id) { queue.delete(id); },
    get size() { return queue.size; },
    run() { const items = [...queue.values()]; queue.clear(); items.forEach(item => item.fn()); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

// 搭一个测试场景：local 是 エイ 界面的状态，disk 是磁盘
function setup({ fetchImpl } = {}) {
  const base = fresh();
  const env = {
    busy: false,
    local: { project: fresh(), base, revision: 'r1' },
    disk: { project: fresh(), revision: 'r1' },
    fetches: 0,
    applied: [],
    errors: [],
    timers: fakeTimers(),
  };
  env.ctl = createSyncController({
    isBusy: () => env.busy,
    getLocal: () => env.local,
    fetchRemote: fetchImpl ? () => { env.fetches++; return fetchImpl(env); } : async () => { env.fetches++; return structuredClone(env.disk); },
    apply: args => env.applied.push(args),
    onError: e => env.errors.push(e),
    timers: env.timers,
  });
  return env;
}
const agentEdits = env => {
  el(env.disk.project, 'page_cover1', 'el_subtitle1').text = 'agent 改的';
  env.disk.project.updatedAt = '2026-10-02T09:00:00.000Z';
  env.disk.revision = 'r2';
};

test('エイ 编辑中收到外部改动时不丢她的输入', async () => {
  const env = setup();
  agentEdits(env);
  env.busy = true;
  env.ctl.notify();
  await tick();
  assert.equal(env.fetches, 0);
  assert.equal(env.applied.length, 0);
  assert.equal(env.ctl.pending, true);
  env.timers.run(); // 还在忙：继续等
  await tick();
  assert.equal(env.fetches, 0);
  assert.equal(env.applied.length, 0);
  // 拖动结束，エイ 的 x 已经写进本地项目
  el(env.local.project, 'page_cover1', 'el_title1').x = 444;
  env.busy = false;
  env.timers.run();
  await env.ctl.settle();
  assert.equal(env.applied.length, 1);
  const [args] = env.applied;
  assert.equal(el(args.project, 'page_cover1', 'el_title1').x, 444);
  assert.equal(el(args.project, 'page_cover1', 'el_subtitle1').text, 'agent 改的');
  assert.equal(args.needsSave, true);
  assert.equal(args.remoteChanged, true);
  assert.equal(args.revision, 'r2');
  assert.deepEqual(args.base, env.disk.project);
  assert.deepEqual(args.conflicts, []);
  assert.equal(env.ctl.pending, false);
});

test('取数据期间 エイ 变忙：不应用，稍后重试成功', async () => {
  const gates = [];
  const env = setup({ fetchImpl: () => { const d = deferred(); gates.push(d); return d.promise; } });
  agentEdits(env);
  env.ctl.notify();
  await tick();
  assert.equal(env.fetches, 1);
  env.busy = true; // 等待网络期间开始拖动
  gates[0].resolve(structuredClone(env.disk));
  await tick();
  assert.equal(env.applied.length, 0);
  assert.equal(env.ctl.pending, true);
  assert.equal(env.timers.size, 1);
  env.busy = false;
  env.timers.run();
  await tick();
  assert.equal(env.fetches, 2);
  gates[1].resolve(structuredClone(env.disk));
  await env.ctl.settle();
  assert.equal(env.applied.length, 1);
});

test('revision 没变：不调用 apply', async () => {
  const env = setup();
  env.ctl.notify();
  await env.ctl.settle();
  assert.equal(env.fetches, 1);
  assert.equal(env.applied.length, 0);
  assert.equal(env.ctl.pending, false);
});

test('只有 agent 改动、エイ 没有未保存修改：remoteChanged 为真，needsSave 为假', async () => {
  const env = setup();
  agentEdits(env);
  env.ctl.notify();
  await env.ctl.settle();
  assert.equal(env.applied.length, 1);
  assert.equal(env.applied[0].remoteChanged, true);
  assert.equal(env.applied[0].needsSave, false);
  assert.deepEqual(env.applied[0].project, env.disk.project);
});

test('连续多次 notify 合并成一次；尝试中途再 notify 会再跑一次', async () => {
  {
    const env = setup();
    agentEdits(env);
    env.ctl.notify(); env.ctl.notify(); env.ctl.notify();
    await env.ctl.settle();
    assert.equal(env.fetches, 1);
    assert.equal(env.applied.length, 1);
  }
  {
    const gates = [];
    const env = setup({ fetchImpl: () => { const d = deferred(); gates.push(d); return d.promise; } });
    agentEdits(env);
    env.ctl.notify();
    await tick();
    assert.equal(env.fetches, 1);
    env.ctl.notify(); // 取数据途中 agent 又改了
    env.ctl.notify();
    gates[0].resolve(structuredClone(env.disk));
    await tick();
    assert.equal(env.ctl.pending, true);
    assert.equal(env.fetches, 2);
    // 界面已应用第一次的结果
    env.local = { project: env.applied[0].project, base: env.applied[0].base, revision: env.applied[0].revision };
    env.disk.revision = 'r3';
    el(env.disk.project, 'page_cover1', 'el_bullet1').text = '第二次';
    gates[1].resolve(structuredClone(env.disk));
    await env.ctl.settle();
    assert.equal(env.fetches, 2);
    assert.equal(env.applied.length, 2);
    assert.equal(el(env.applied[1].project, 'page_cover1', 'el_bullet1').text, '第二次');
    assert.equal(el(env.applied[1].project, 'page_cover1', 'el_subtitle1').text, 'agent 改的');
  }
});

test('取数据失败会重试，连续失败超过 5 次后放弃；新的 notify 重新开始', async () => {
  let fail = true;
  const env = setup({ fetchImpl: async e => { if (fail) throw new Error('网络断了'); return structuredClone(e.disk); } });
  agentEdits(env);
  env.ctl.notify();
  await tick();
  assert.equal(env.fetches, 1);
  for (let i = 0; i < 5; i++) {
    assert.equal(env.timers.size, 1);
    env.timers.run();
    await tick();
  }
  assert.equal(env.fetches, 6);
  assert.equal(env.errors.length, 6);
  assert.equal(env.timers.size, 0);
  assert.equal(env.ctl.pending, false);
  await env.ctl.settle();
  // 恢复后新的通知重新开始，一次成功
  fail = false;
  env.ctl.notify();
  await env.ctl.settle();
  assert.equal(env.fetches, 7);
  assert.equal(env.applied.length, 1);
});

test('失败一次后重试成功', async () => {
  let calls = 0;
  const env = setup({ fetchImpl: async e => { if (++calls === 1) throw new Error('偶发错误'); return structuredClone(e.disk); } });
  agentEdits(env);
  env.ctl.notify();
  await tick();
  assert.equal(env.errors.length, 1);
  assert.equal(env.applied.length, 0);
  env.timers.run();
  await env.ctl.settle();
  assert.equal(env.applied.length, 1);
});

test('dispose 之后 notify 无效', async () => {
  const env = setup();
  agentEdits(env);
  env.busy = true;
  env.ctl.notify();
  env.ctl.dispose();
  assert.equal(env.timers.size, 0);
  env.busy = false;
  env.ctl.notify();
  await tick();
  assert.equal(env.fetches, 0);
  await env.ctl.settle();
});

// 浏览器里 setTimeout / clearTimeout 不能挂在别的对象上调用（Illegal invocation）。
// 这里把全局定时器换成和浏览器一样挑剔的版本，确认默认定时器在 エイ 忙的时候也能正常重试。
test('默认定时器在浏览器里也能用：エイ 忙时不报错，忙完后照常合并', async () => {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const strict = (real) => function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return real(...args);
  };
  globalThis.setTimeout = strict(realSet);
  globalThis.clearTimeout = strict(realClear);
  try {
    const base = { id: 'demo', updatedAt: 't0', pages: [{ id: 'page_a', elements: [{ id: 'el_a', x: 0, text: '旧' }] }] };
    const local = structuredClone(base);
    const remote = structuredClone(base);
    remote.pages[0].elements[0].text = 'agent 改的';
    let busy = true;
    const applied = [];
    const controller = createSyncController({
      isBusy: () => busy,
      getLocal: () => ({ project: local, base, revision: 'r0' }),
      fetchRemote: async () => ({ project: remote, revision: 'r1' }),
      apply: (result) => applied.push(result),
      retryMs: 5,
    });
    controller.notify();
    await new Promise((done) => realSet(done, 30));
    assert.equal(applied.length, 0);
    local.pages[0].elements[0].x = 99; // エイ 这时拖完了
    busy = false;
    await controller.settle();
    assert.equal(applied.length, 1);
    assert.equal(applied[0].project.pages[0].elements[0].x, 99);
    assert.equal(applied[0].project.pages[0].elements[0].text, 'agent 改的');
    controller.dispose();
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
});
