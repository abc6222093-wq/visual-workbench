// 第 12 轮收尾（桌面应用实测）：放映停在「正在准备放映…」。
// 原因：放映壳先等页面 ready 再显示 iframe，而 ready 要等 init 跑完；init 里 await 的入场动画（示例课件封面就是）
// 在 visibility:hidden 的 iframe 里不会走（Chromium 不推进隐藏 iframe 的动画）→ 死等。
// 要求：页面 loaded（文档加载完、修改单叠完）就显示当前页，再等 ready；翻到预加载的下一页同样先显示再等 ready。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until } from './round12-runtime-fixture.js';

// 入场动画在 init 里 await：标题从透明淡入 700ms
const ENTRANCE = (label) => `<!doctype html><html><head><style>h1{position:absolute;left:100px;top:100px;margin:0;font-size:40px}</style></head><body>
<h1 id="t" data-vw-id="t" data-vw="text move color">${label}</h1>
<script>
window.__phase = 'boot';
vw.motion({
  async init(ctx) { window.__phase = 'init'; await ctx.animate(document.getElementById('t'), [{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: 'forwards' }); window.__phase = 'ready'; },
  async step(i, ctx) { await ctx.animate(document.getElementById('t'), [{ transform: 'none' }, { transform: 'translateX(40px)' }], { duration: 200, fill: 'forwards' }); }
});
</script></body></html>`;

let browser, server, fixture;
test.before(async () => {
  fixture = writeProject({ id: 'reveal', pages: [
    { id: 'page_one', html: ENTRANCE('第一页'), steps: 1, edits: [{ id: 'ed_move0001', target: 't', kind: 'move', before: { x: 100, y: 100, width: 200, height: 50 }, after: { dx: 30, dy: 0 } }] },
    { id: 'page_two', html: ENTRANCE('第二页'), steps: 1 }
  ], prefix: '我的云端硬盘 放映显示-' });
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

test('放映：init 里等入场动画的页面能开始放映；iframe 在 init 跑的时候已经显示；翻到下一页同样', { timeout: 60000 }, async t => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  // 记录：每次有可见 iframe 出现时，它里面的 init 跑到哪了
  await page.addInitScript(() => {
    window.__seen = [];
    const look = () => {
      const f = document.querySelector('#stage iframe:not([aria-hidden])');
      if (f && !window.__seen.includes(f)) window.__seen.push(f);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto(`${server.origin}/player.html?project=reveal`);
  const visibleFrame = async () => (await page.$('#stage iframe:not([aria-hidden])')).contentFrame();
  // 第 1 页：可见 iframe 出现时 init 还没跑完（动画在可见状态下走）
  await until(() => page.evaluate(() => window.__seen.length >= 1), { label: '第 1 页显示出来', timeout: 10000 });
  const f1 = await visibleFrame();
  const phaseAtReveal = await f1.evaluate(() => window.__phase);
  assert.ok(phaseAtReveal === 'boot' || phaseAtReveal === 'init', `显示时 init 还没结束（实际 ${phaseAtReveal}）`);
  await until(() => page.evaluate(() => document.getElementById('message').hidden && !window.__vwPlayback.isBusy()), { label: '放映开始（不再停在「正在准备放映…」）', timeout: 10000 });
  assert.equal(await f1.evaluate(() => window.__phase), 'ready');
  assert.equal(await f1.evaluate(() => getComputedStyle(document.getElementById('t')).opacity), '1', '入场动画走完');
  assert.match(await f1.evaluate(() => getComputedStyle(document.getElementById('t')).translate), /^30px( 0px)?$/, '修改单在显示前已叠上');
  assert.deepEqual(await page.evaluate(() => { const s = window.__vwPlayback.getState(); return [s.index, s.nextStep, s.total]; }), [0, 0, 1]);
  // 走完第 1 页的一步，再翻到预加载的第 2 页：同样先显示再就绪
  await page.keyboard.press('ArrowRight');
  await until(() => page.evaluate(() => !window.__vwPlayback.isBusy() && window.__vwPlayback.getState().nextStep === 1), { label: '第 1 步' });
  await page.keyboard.press('ArrowRight');
  await until(() => page.evaluate(() => window.__vwPlayback.getState().index === 1 && !window.__vwPlayback.isBusy()), { label: '翻到第 2 页并就绪', timeout: 10000 });
  const f2 = await visibleFrame();
  assert.equal(await f2.evaluate(() => window.__phase), 'ready');
  assert.equal(await f2.evaluate(() => getComputedStyle(document.getElementById('t')).opacity), '1');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#stage iframe').length), 1, '旧页已销毁、没有下一页可预加载');
  // 回第 1 页（fast 重建）照旧
  await page.keyboard.press('ArrowLeft');
  await until(() => page.evaluate(() => window.__vwPlayback.getState().index === 0 && !window.__vwPlayback.isBusy()), { label: '回到第 1 页', timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => { const s = window.__vwPlayback.getState(); return [s.index, s.nextStep, s.total]; }), [0, 1, 1]);
});
