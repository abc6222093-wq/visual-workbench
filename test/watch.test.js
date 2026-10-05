import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectWatcher } from '../src/watch.js';

/** 等到第一个满足 predicate 的事件；超时则失败 */
function nextEvent(watcher, projectId, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error(`等待事件超时（${timeoutMs}ms）`)); }, timeoutMs);
    off = watcher.subscribe(projectId, ev => {
      if (!predicate(ev)) return;
      clearTimeout(timer);
      off();
      resolve(ev);
    });
  });
}

/** 在 ms 内收集满足 predicate 的事件（用来确认「没有发事件」） */
function collectFor(watcher, projectId, predicate = () => true, ms = 400) {
  return new Promise(resolve => {
    const got = [];
    const off = watcher.subscribe(projectId, ev => { if (predicate(ev)) got.push(ev); });
    setTimeout(() => { off(); resolve(got); }, ms);
  });
}

const isChanged = ev => ev.type === 'changed';
const isAgent = state => ev => ev.type === 'agent' && (!state || ev.state === state);

/** 建临时 projectsDir 和 demo 项目，创建监听器并常驻一个订阅者（保持项目基线） */
function setup(t, opts = {}) {
  const projectsDir = mkdtempSync(join(tmpdir(), 'vw-watch-'));
  mkdirSync(join(projectsDir, 'demo', 'assets'), { recursive: true });
  writeFileSync(join(projectsDir, 'demo', 'project.json'), '{"v":1}\n');
  writeFileSync(join(projectsDir, 'demo', 'assets', 'logo.png'), 'logo-1');
  const w = createProjectWatcher({ projectsDir, ...opts });
  const log = [];
  w.subscribe('demo', ev => log.push(ev));
  t.after(() => {
    w.close();
    rmSync(projectsDir, { recursive: true, force: true });
  });
  const file = (...parts) => join(projectsDir, 'demo', ...parts);
  return { projectsDir, w, log, file };
}

test('外部改 project.json：收到 external 的 changed，随后 agent 变为 working', async t => {
  const { w, file } = setup(t);
  const changed = nextEvent(w, 'demo', isChanged);
  const working = nextEvent(w, 'demo', isAgent('working'));
  writeFileSync(file('project.json'), '{"v":2}\n');
  const ev = await changed;
  assert.equal(ev.projectId, 'demo');
  assert.equal(ev.external, true);
  assert.ok(ev.files.includes('project.json'));
  assert.ok(!Number.isNaN(Date.parse(ev.at)));
  const ag = await working;
  assert.equal(ag.state, 'working');
  assert.equal(w.agentState('demo'), 'working');
});

test('先 noteSelfWrite 再写同样内容：external 为 false，agent 保持 idle', async t => {
  const { w, file } = setup(t);
  const bytes = Buffer.from('{"v":"self"}\n');
  w.noteSelfWrite('demo', 'project.json', bytes);
  const changed = nextEvent(w, 'demo', isChanged);
  const agentEvents = collectFor(w, 'demo', isAgent(), 600);
  writeFileSync(file('project.json'), bytes);
  const ev = await changed;
  assert.equal(ev.external, false);
  assert.deepEqual(ev.files, ['project.json']);
  assert.deepEqual(await agentEvents, []);
  assert.equal(w.agentState('demo'), 'idle');
});

test('写之后再调用 noteSelfWrite、以及自己删除文件，也算自己写的', async t => {
  const { w, file } = setup(t);
  const bytes = '{"v":"after"}\n';
  let changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), bytes);
  w.noteSelfWrite('demo', 'project.json', bytes);
  assert.equal((await changed).external, false);

  changed = nextEvent(w, 'demo', isChanged);
  w.noteSelfWrite('demo', 'assets/logo.png', null);
  unlinkSync(file('assets', 'logo.png'));
  const ev = await changed;
  assert.deepEqual(ev.files, ['assets/logo.png']);
  assert.equal(ev.external, false);
  assert.equal(w.agentState('demo'), 'idle');
});

test('自己写之后 agent 又改成别的内容：external 为 true', async t => {
  const { w, file } = setup(t);
  const bytes = '{"v":"mine"}\n';
  w.noteSelfWrite('demo', 'project.json', bytes);
  let changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), bytes);
  assert.equal((await changed).external, false);

  changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), '{"v":"agent"}\n');
  const ev = await changed;
  assert.equal(ev.external, true);
  assert.deepEqual(ev.files, ['project.json']);
});

test('新增素材和新建子目录里的动效代码：files 含对应路径', async t => {
  const { w, file } = setup(t);
  let changed = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('assets/new.png'));
  writeFileSync(file('assets', 'new.png'), 'png-bytes');
  assert.equal((await changed).external, true);

  changed = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('code/intro.js'));
  mkdirSync(file('code'));
  writeFileSync(file('code', 'intro.js'), 'export default () => {};\n');
  const ev = await changed;
  assert.equal(ev.external, true);
  assert.ok(!ev.files.includes('code'), '目录本身不应出现在 files 里');
});

test('删除文件：收到 changed', async t => {
  const { w, file } = setup(t);
  const changed = nextEvent(w, 'demo', isChanged);
  unlinkSync(file('assets', 'logo.png'));
  const ev = await changed;
  assert.deepEqual(ev.files, ['assets/logo.png']);
  assert.equal(ev.external, true);
});

test('写入同样的字节：不发事件', async t => {
  const { w, file } = setup(t);
  const events = collectFor(w, 'demo', () => true, 600);
  writeFileSync(file('project.json'), '{"v":1}\n');
  writeFileSync(file('assets', 'logo.png'), 'logo-1');
  await w.scanNow('demo');
  assert.deepEqual(await events, []);
  assert.equal(w.agentState('demo'), 'idle');
});

test('versions/、点开头的文件和临时文件的变化：不发事件', async t => {
  const { w, file } = setup(t);
  const events = collectFor(w, 'demo', () => true, 600);
  mkdirSync(file('versions', 'v1'), { recursive: true });
  writeFileSync(file('versions', 'v1', 'project.json'), '{"v":"old"}\n');
  writeFileSync(file('.project-x.tmp'), 'tmp');
  writeFileSync(file('.DS_Store'), 'ds');
  writeFileSync(file('assets', '.DS_Store'), 'ds');
  mkdirSync(file('.objects'));
  writeFileSync(file('.objects', 'abc'), 'obj');
  writeFileSync(file('project.json~'), 'backup');
  writeFileSync(file('assets', 'a.tmp'), 'tmp');
  writeFileSync(file('assets', 'b.swp'), 'swp');
  await w.scanNow('demo');
  assert.deepEqual(await events, []);

  // 监听仍在工作，且被忽略的文件不会混进后续事件
  const changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), '{"v":3}\n');
  assert.deepEqual((await changed).files, ['project.json']);
});

test('短时间连写 3 个文件：合并为 1 个 changed 事件', async t => {
  // 不用固定收集窗口：等到第 1 个事件后，再等「2×去抖 + 1 个轮询间隔」确认没有第 2 个事件，
  // 最后 scanNow 把还没处理的变化（如果有）立刻冲出来；窗口由监听器的实际参数推算
  const debounceMs = 120, pollMs = 1000;
  const { w, file } = setup(t, { debounceMs, pollMs });
  const all = [];
  const off = w.subscribe('demo', ev => { if (isChanged(ev)) all.push(ev); });
  t.after(off);
  const changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), '{"v":"batch"}\n');
  writeFileSync(file('assets', 'a.png'), 'a');
  writeFileSync(file('assets', 'b.png'), 'b');
  const ev = await changed;
  assert.deepEqual(ev.files, ['assets/a.png', 'assets/b.png', 'project.json']);
  assert.equal(ev.external, true);
  await new Promise(r => setTimeout(r, 2 * debounceMs + pollMs));
  await w.scanNow('demo');
  assert.equal(all.length, 1, `应只有 1 个 changed 事件，实际 ${all.length} 个`);
});

test('agent 状态：外部改动后 working，空闲 agentIdleMs 后 idle；期间再改会推迟 idle', async t => {
  const { w, file, log } = setup(t, { agentIdleMs: 150, debounceMs: 20 });
  assert.equal(w.agentState('demo'), 'idle');

  // 第一轮：改动 → working → 约 150ms 后 idle
  let working = nextEvent(w, 'demo', isAgent('working'));
  let idle = nextEvent(w, 'demo', isAgent('idle'));
  writeFileSync(file('project.json'), '{"v":"a1"}\n');
  await working;
  const t0 = Date.now();
  assert.equal(w.agentState('demo'), 'working');
  await idle;
  assert.ok(Date.now() - t0 >= 130, 'idle 不应早于 agentIdleMs');
  assert.equal(w.agentState('demo'), 'idle');

  // 第二轮：working 之后立刻再改一次，idle 应从第二次改动被处理时重新计时
  log.length = 0;
  working = nextEvent(w, 'demo', isAgent('working'));
  idle = nextEvent(w, 'demo', isAgent('idle'));
  writeFileSync(file('project.json'), '{"v":"b1"}\n');
  await working;
  writeFileSync(file('project.json'), '{"v":"b2"}\n');
  await w.scanNow('demo'); // 立即处理第二次改动，不依赖 fs 事件的到达时间
  const t1 = Date.now();
  assert.equal(w.agentState('demo'), 'working');
  await idle;
  assert.ok(Date.now() - t1 >= 130, `idle 应被推迟（实际 ${Date.now() - t1}ms）`);
  assert.equal(w.agentState('demo'), 'idle');
  assert.deepEqual(log.filter(isAgent()).map(ev => ev.state), ['working', 'idle']);
  assert.ok(log.filter(isChanged).length >= 2);
});

test('noteSelfSnapshot：外部写了几个文件后立即调用，这些变化算自己写的', async t => {
  const { w, file } = setup(t, { pollMs: 0 });
  writeFileSync(file('project.json'), '{"v":"restored"}\n');
  writeFileSync(file('assets', 'restored.png'), 'restored');
  unlinkSync(file('assets', 'logo.png'));
  // 同步调用，监听回调此时还没机会跑
  w.noteSelfSnapshot('demo');
  const changed = nextEvent(w, 'demo', isChanged);
  const agentEvents = collectFor(w, 'demo', isAgent(), 500);
  await w.scanNow('demo');
  const ev = await changed;
  assert.deepEqual(ev.files, ['assets/logo.png', 'assets/restored.png', 'project.json']);
  assert.equal(ev.external, false);
  assert.deepEqual(await agentEvents, []);
  assert.equal(w.agentState('demo'), 'idle');
});

test('只靠轮询（关闭 fs.watch）也能发现变化', async t => {
  const { w, file } = setup(t, { fsWatch: false, pollMs: 50 });
  const changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('assets', 'polled.png'), 'polled');
  const ev = await changed;
  assert.deepEqual(ev.files, ['assets/polled.png']);
  assert.equal(ev.external, true);
});

test('取消订阅后不再收到事件；重复取消无副作用', async t => {
  const { w, file } = setup(t);
  const got = [];
  const off = w.subscribe('demo', ev => got.push(ev));
  off();
  off();
  const changed = nextEvent(w, 'demo', isChanged);
  writeFileSync(file('project.json'), '{"v":"unsub"}\n');
  await changed;
  await w.scanNow('demo');
  assert.deepEqual(got, []);
});

test('close 后不再发事件，可重复调用 close', async t => {
  const { w, file, log } = setup(t, { pollMs: 50 });
  w.close();
  writeFileSync(file('project.json'), '{"v":"closed"}\n');
  writeFileSync(file('assets', 'after-close.png'), 'x');
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(log, []);
  assert.doesNotThrow(() => w.close());
  assert.equal(w.agentState('demo'), 'idle');
  await w.scanNow('demo');
  assert.throws(() => w.subscribe('demo', () => {}), /已关闭/);
});

test('订阅时项目文件夹还不存在，之后创建并写入 project.json：收到 changed', async t => {
  const { w, projectsDir } = setup(t);
  const changed = nextEvent(w, 'fresh', isChanged);
  mkdirSync(join(projectsDir, 'fresh', 'assets'), { recursive: true });
  writeFileSync(join(projectsDir, 'fresh', 'project.json'), '{"v":1}\n');
  const ev = await changed;
  assert.equal(ev.projectId, 'fresh');
  assert.ok(ev.files.includes('project.json'));
  assert.equal(ev.external, true);
});

test('projectsDir 本身不存在时不崩溃，创建后靠轮询也能发现', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vw-watch-'));
  const projectsDir = join(root, 'projects');
  const w = createProjectWatcher({ projectsDir, pollMs: 50 });
  t.after(() => { w.close(); rmSync(root, { recursive: true, force: true }); });
  const changed = nextEvent(w, 'late', isChanged);
  mkdirSync(join(projectsDir, 'late'), { recursive: true });
  writeFileSync(join(projectsDir, 'late', 'project.json'), '{}\n');
  assert.deepEqual((await changed).files, ['project.json']);
});

test('项目编号不合法时 subscribe 抛错', t => {
  const { w } = setup(t);
  for (const id of ['../x', 'A', 'a', '-ab', 'a/b', '', 'x'.repeat(65)]) {
    assert.throws(() => w.subscribe(id, () => {}), /项目编号不合法/, id);
  }
  assert.throws(() => w.noteSelfWrite('demo', '../x', 'a'), /文件路径不合法/);
});

test('格式 v3：agent 改 pages/<页面>.html（含新建、删除）进 changed 的 files；工作台自己写的页面文件不算外部', async t => {
  const { w, file } = setup(t);
  mkdirSync(file('pages'), { recursive: true });
  const created = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('pages/page_a.html'));
  writeFileSync(file('pages', 'page_a.html'), '<p>1</p>');
  assert.equal((await created).external, true);
  const edited = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('pages/page_a.html'));
  writeFileSync(file('pages', 'page_a.html'), '<p>2</p>');
  assert.equal((await edited).external, true);
  const mine = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('pages/page_b.html'));
  w.noteSelfWrite('demo', 'pages/page_b.html', '<p>工作台新建</p>');
  writeFileSync(file('pages', 'page_b.html'), '<p>工作台新建</p>');
  assert.equal((await mine).external, false);
  const removed = nextEvent(w, 'demo', ev => isChanged(ev) && ev.files.includes('pages/page_a.html'));
  unlinkSync(file('pages', 'page_a.html'));
  assert.ok(await removed);
});
