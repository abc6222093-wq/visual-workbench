// 第 13 轮 0a（docs/round13-contract.md §4.3）：数屏。
// countSteps:true 的探测 iframe 快进跑 init、逐步 step(i)，每步后比对画面快照，和上一步一样就停（最多 30 步，出错也停），ready 里带 countedSteps / hasStep；
// edit 模式的 ready 带 motion: { registered, hasStep, animations, scripts }，登记晚于 ready 时补发 { vw: 'motion', registered, hasStep }。
// 只用临时数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until, pause } from './round12-runtime-fixture.js';

const doc = body => `<!doctype html><html><head><meta charset="utf-8"><style>.x{position:absolute;width:80px;height:40px;background:#345}</style></head><body>${body}</body></html>`;
// 用 vw.motion 写了 3 步，但 project.json 里没写 steps
const THREE = doc(`<div class="x" id="a" style="left:10px;opacity:0"></div><div class="x" id="b" style="left:110px;opacity:0"></div><div class="x" id="c" style="left:210px;opacity:0"></div>
<script>vw.motion({
  init(ctx) { document.body.dataset.init = '1'; },
  async step(i, ctx) { const el = ['a', 'b', 'c'].map(id => document.getElementById(id))[i]; if (!el) return; await ctx.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 2000, fill: 'forwards' }); }
});</script>`);
const NONE = doc('<div class="x" id="a" style="left:10px"></div>');
// 第 2 步出错：数到 1 就停
const BROKEN = doc(`<div class="x" id="a" style="left:10px;opacity:0"></div>
<script>vw.motion({ step(i) { if (i === 0) { document.getElementById('a').style.opacity = '1'; return; } throw new Error('坏了'); } });</script>`);
// 只改文字（innerHTML 长度变化）也算一屏；每步都变的页面最多数到 30
const TEXT = doc(`<p id="p">一</p><script>vw.motion({ step(i) { document.getElementById('p').textContent += '加'; } });</script>`);
// 模块脚本晚登记（ready 之后）
const LATE = doc(`<div class="x" id="a" style="left:10px"></div><script type="module">await new Promise(r => setTimeout(r, 700)); vw.motion({ step() {} });</script>`);
// 页面自己的 CSS 动画和脚本（导入的旧 HTML 常见），没有 vw.motion
const OWN = doc(`<style>@keyframes spin{to{transform:rotate(360deg)}} #a{animation:spin 2s infinite linear}</style><div class="x" id="a" style="left:10px"></div><script>document.body.dataset.own = '1';</script>`);

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({
    id: 'rt-count', prefix: '我的云端硬盘 数屏-',
    pages: [{ id: 'page_three', html: THREE }, { id: 'page_none', html: NONE }, { id: 'page_broken', html: BROKEN }, { id: 'page_text', html: TEXT }, { id: 'page_late', html: LATE }, { id: 'page_own', html: OWN }]
  });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

async function harness(t) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  return page;
}
const count = (page, pageId, extra = {}) => page.evaluate(async ({ project, pageId, extra }) => {
  const { createPageFrame } = await import('/page-frame.js');
  const errors = [];
  const f = createPageFrame({ project, page: project.pages.find(p => p.id === pageId), mode: 'edit', countSteps: true, timeout: 1500, container: document.getElementById('stage'), onError: m => errors.push(m.message), ...extra });
  const started = Date.now();
  const r = await f.ready;
  f.destroy();
  return { countedSteps: r.countedSteps, hasStep: r.hasStep, mode: r.mode, ms: Date.now() - started, errors };
}, { project: fixture.project, pageId, extra });

test('countSteps：vw.motion 写了 3 步、project.json 没写 steps → 数出 3（快进，不按真实时长等）', async t => {
  const page = await harness(t);
  const r = await count(page, 'page_three');
  assert.equal(r.countedSteps, 3);
  assert.equal(r.hasStep, true);
  assert.equal(r.mode, 'play');
  assert.ok(r.ms < 4000, `快进：${r.ms}ms`);
  assert.deepEqual(r.errors, []);
});

test('countSteps：没登记动效 → 0、hasStep=false；出错就停在出错前；每步都变的最多 30', async t => {
  const page = await harness(t);
  const none = await count(page, 'page_none');
  assert.deepEqual({ n: none.countedSteps, hasStep: none.hasStep }, { n: 0, hasStep: false });
  assert.ok(none.ms < 1200, `没写 vw.motion 的页面不等登记时限：${none.ms}ms`);
  const broken = await count(page, 'page_broken');
  assert.deepEqual({ n: broken.countedSteps, hasStep: broken.hasStep }, { n: 1, hasStep: true });
  assert.ok(broken.errors.some(m => /坏了/.test(m)), JSON.stringify(broken.errors));
  const text = await count(page, 'page_text');
  assert.equal(text.countedSteps, 30);
});

test('edit 模式 ready.motion：registered / hasStep / animations / scripts；模块脚本晚登记补发 motion 消息', async t => {
  const page = await harness(t);
  const result = await page.evaluate(async ({ project }) => {
    const { createPageFrame } = await import('/page-frame.js');
    const open = async id => {
      const msgs = [];
      const f = createPageFrame({ project, page: project.pages.find(p => p.id === id), mode: 'edit', container: document.getElementById('stage'), onMessage: m => msgs.push(m) });
      const ready = await f.ready;
      return { f, msgs, ready };
    };
    const three = await open('page_three'); three.f.destroy();
    const none = await open('page_none'); none.f.destroy();
    const own = await open('page_own'); own.f.destroy();
    const late = await open('page_late');
    window.__late = late.msgs;
    return { three: three.ready.motion, none: none.ready.motion, own: own.ready.motion, late: late.ready.motion };
  }, { project: fixture.project });
  assert.deepEqual(result.three, { registered: true, hasStep: true, animations: 0, scripts: 1 });
  assert.deepEqual(result.none, { registered: false, hasStep: false, animations: 0, scripts: 0 });
  assert.equal(result.own.registered, false);
  assert.ok(result.own.animations >= 1, JSON.stringify(result.own));
  assert.equal(result.own.scripts, 1);
  assert.deepEqual({ registered: result.late.registered, hasStep: result.late.hasStep, scripts: result.late.scripts }, { registered: false, hasStep: false, scripts: 1 });
  const motion = await until(() => page.evaluate(() => window.__late.find(m => m.vw === 'motion')), { label: '晚登记补发的 motion 消息' });
  assert.deepEqual(motion, { vw: 'motion', registered: true, hasStep: true });
  await pause(200);
});
