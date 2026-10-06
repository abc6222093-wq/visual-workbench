// 第 13 轮字体库注入（docs/round13-contract.md §4.4）。
// 1) 纯函数 fontLibraryStyle(html, fontLibrary)：按页面写到的字体名（大小写、空格、引号不敏感，别名也算）生成 @font-face；buildSrcdoc 把它放在
//    <style data-vw-base> 之后、页面自己的样式之前。
// 2) 真浏览器验证 Chromium 的分段字体回退：页面自带只含 "ABC" 的子集（同名字族、后声明），字体库是完整文件（先声明）；
//    渲染子集里没有的 "Z"，字形宽度和完整字体一致，且和不注入字体库时不同。
// 只用临时数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';
import { fontLibraryStyle, fontNamesInHtml, buildSrcdoc } from '../web/page-frame.js';
import { launchBrowser } from '../src/browser.js';
import { writeProject, startServer, until } from './round12-runtime-fixture.js';

const INTER = new URL('../examples/sample-deck/fonts/Inter-Variable.ttf', import.meta.url);
const LIB = [
  { family: 'Source Han Serif SC', aliases: ['思源宋体', 'Noto Serif CJK SC', 'SourceHanSerifSC'], faces: [{ url: '/data/library/fonts/shs/SourceHanSerifSC-VF.otf', weight: 'variable', style: 'normal', format: 'opentype' }] },
  { family: 'ZCOOL XiaoWei', aliases: ['站酷小薇'], faces: [{ url: '/data/library/fonts/zcool/ZCOOLXiaoWei-Regular.ttf', weight: 400, style: 'normal', format: 'truetype' }, { url: '/x/italic.woff2', weight: 700, style: 'italic' }] }
];

test('fontNamesInHtml：font-family 声明、font 简写、@font-face、行内样式里的字体名', () => {
  const html = `<style>@font-face{font-family:'My Face';src:url(a.ttf)} h1{font: italic 700 40px/1.2 "Noto Serif CJK SC", serif} p{ font-family :  站酷小薇 , sans-serif !important }</style><b style="font-family:&quot;Foo Bar&quot;, cursive">x</b>`;
  assert.deepEqual(fontNamesInHtml(html), ['My Face', '站酷小薇', 'sans-serif', 'Foo Bar', 'cursive', 'Noto Serif CJK SC', 'serif']);
});

test('fontLibraryStyle：命中别名（大小写、空格、引号不敏感），用页面里写的名字；weight 数字或 100 900；没命中返回空', () => {
  const html = `<style>h1{font-family:"noto serif cjk sc",serif} .a{font-family:sourcehanserifsc} p{font:16px 站酷小薇}</style>`;
  const css = fontLibraryStyle(html, LIB);
  assert.match(css, /^<style data-vw-fontlib>[\s\S]*<\/style>$/);
  assert.match(css, /@font-face\{font-family:"noto serif cjk sc";src:url\("\/data\/library\/fonts\/shs\/SourceHanSerifSC-VF\.otf"\) format\("opentype"\);font-weight:100 900;font-style:normal;font-display:block\}/);
  assert.match(css, /font-family:"sourcehanserifsc";src:url\("\/data\/library\/fonts\/shs\/SourceHanSerifSC-VF\.otf"\)/);
  assert.match(css, /font-family:"站酷小薇";src:url\("\/data\/library\/fonts\/zcool\/ZCOOLXiaoWei-Regular\.ttf"\) format\("truetype"\);font-weight:400;font-style:normal;font-display:block/);
  assert.match(css, /font-family:"站酷小薇";src:url\("\/x\/italic\.woff2"\) format\("woff2"\);font-weight:700;font-style:italic/);
  assert.equal((css.match(/@font-face/g) || []).length, 4);
  assert.equal(fontLibraryStyle('<style>h1{font-family:Helvetica}</style>', LIB), '', '认不出的字族不注入');
  assert.equal(fontLibraryStyle(html, []), '');
  assert.equal(fontLibraryStyle(html, undefined), '');
});

test('buildSrcdoc：字体库样式在 data-vw-base 之后、页面自己的样式之前', () => {
  const html = '<!doctype html><html><head><style id="own">h1{font-family:"ZCOOL XiaoWei"}</style></head><body><h1>字</h1></body></html>';
  const project = { id: 'p', kind: 'deck', artboard: { width: 960, height: 540 } }, page = { id: 'page_a', file: 'pages/page_a.html', edits: [] };
  const out = buildSrcdoc({ html, project, page, runtimeText: '/*rt*/', fontLibrary: LIB });
  const base = out.indexOf('<style data-vw-base>'), lib = out.indexOf('<style data-vw-fontlib>'), own = out.indexOf('<style id="own">');
  assert.ok(base >= 0 && lib > base && own > lib, `顺序：base ${base} < fontlib ${lib} < 页面 ${own}`);
  assert.equal(buildSrcdoc({ html, project, page, runtimeText: '/*rt*/' }).includes('data-vw-fontlib'), false, '不给字体库不注入');
});

let browser, server, fixture;
test.before(async () => {
  const full = readFileSync(INTER);
  const subset = await subsetFont(full, 'ABC', { targetFormat: 'truetype' });
  const face = url => `@font-face{font-family:"Inter";src:url(${url}) format("truetype");font-weight:100 900;font-display:block}`;
  const body = '<span id="z">Z</span> <span id="abc">ABC</span>';
  const css = 'span{font:400 100px "Inter", monospace}';
  fixture = writeProject({
    id: 'rt-fontlib', prefix: '我的云端硬盘 字体库-',
    pages: [
      { id: 'page_subset', html: `<!doctype html><html><head><style>${face('../fonts/Inter-ABC.ttf')}${css}</style></head><body>${body}</body></html>` },
      { id: 'page_full', html: `<!doctype html><html><head><style>${face('../../../library/fonts/inter/Inter-Variable.ttf')}${css}</style></head><body>${body}</body></html>` }
    ],
    files: { 'fonts/Inter-ABC.ttf': subset }
  });
  mkdirSync(join(fixture.dataDir, 'library', 'fonts', 'inter'), { recursive: true });
  writeFileSync(join(fixture.dataDir, 'library', 'fonts', 'inter', 'Inter-Variable.ttf'), full);
  server = await startServer(fixture.dataDir);
  browser = await launchBrowser();
});
test.after(async () => { await browser?.close(); await server?.close(); fixture?.cleanup(); });

test('Chromium 分段字体回退：页面子集里没有的字由字体库的完整 face 补上（宽度和完整字体一致，和不注入时不同）', async t => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(`${server.origin}/harness.html`);
  const fontLibrary = [{ family: 'Inter', aliases: ['Inter Variable'], faces: [{ url: '/data/library/fonts/inter/Inter-Variable.ttf', weight: 'variable', style: 'normal', format: 'truetype' }] }];
  const measure = async (pageId, lib) => {
    await page.evaluate(async ({ project, pageId, lib }) => {
      const { createPageFrame } = await import('/page-frame.js');
      const stage = document.getElementById('stage'); stage.textContent = '';
      window.__f?.destroy();
      window.__f = createPageFrame({ project, page: project.pages.find(p => p.id === pageId), mode: 'edit', container: stage, ...(lib ? { fontLibrary: lib } : {}) });
      await window.__f.ready;
    }, { project: fixture.project, pageId, lib });
    const frame = await (await page.$('#stage iframe')).contentFrame();
    return frame.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { z: document.getElementById('z').getBoundingClientRect().width, abc: document.getElementById('abc').getBoundingClientRect().width, lib: !!document.querySelector('style[data-vw-fontlib]') };
    });
  };
  const withLib = await measure('page_subset', fontLibrary);
  const without = await measure('page_subset', null);
  const reference = await measure('page_full', null);
  t.diagnostic(`Z 宽：注入字体库 ${withLib.z}，完整字体 ${reference.z}，不注入 ${without.z}`);
  assert.equal(withLib.lib, true, '注入了字体库样式');
  assert.equal(without.lib, false);
  assert.ok(Math.abs(withLib.z - reference.z) < 0.01, `注入字体库后 Z 宽 ${withLib.z}，完整字体 ${reference.z}`);
  assert.ok(Math.abs(without.z - reference.z) > 0.5, `不注入时 Z 回退到别的字体：${without.z} vs ${reference.z}`);
  assert.ok(Math.abs(withLib.abc - reference.abc) < 0.01, '子集里有的字照常用页面自带的 face（字形相同）');
});
