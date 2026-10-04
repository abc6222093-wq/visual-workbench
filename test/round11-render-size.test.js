// 第 11 轮：render.js 按页面尺寸渲染根节点（真实浏览器里 import render.js，读根节点的宽高）。只用本地临时服务，不碰数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/browser.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const read = name => JSON.parse(readFileSync(new URL(`../examples/${name}/project.json`, import.meta.url), 'utf8'));
const MIME = { '.js': 'text/javascript', '.html': 'text/html' };

function serve() {
  const server = http.createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><meta charset="utf-8"><body></body>'); return; }
    const target = resolve(WEB, '.' + path);
    try {
      if (!target.startsWith(resolve(WEB) + sep)) throw new Error('bad');
      const bytes = readFileSync(target);
      response.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

test('renderPage / patchPage：网页页面按自己的 size，课件页面照旧按画板', async t => {
  let browser;
  try { browser = await launchBrowser(); }
  catch (error) { if (error.code === 'NO_BROWSER') return t.skip('本机没有可用浏览器'); throw error; }
  const { server, origin } = await serve();
  try {
    const page = await browser.newPage();
    await page.goto(origin + '/');
    const result = await page.evaluate(async ({ web, deck }) => {
      const { renderPage, patchPage } = await import('/render.js');
      const size = root => [root.style.width, root.style.height];
      const desk = renderPage(web, web.pages[0], { assetBase: '' });
      const mob = renderPage(web, web.pages[1], { assetBase: '' });
      const slide = renderPage(deck, deck.pages[0], { assetBase: '' });
      const deckCss = slide.style.cssText;
      // patchPage 在同一个根节点上从电脑端换到手机端，再换回课件尺寸
      const reused = renderPage(web, web.pages[0], { assetBase: '' });
      patchPage(reused, web, web.pages[1], { assetBase: '' });
      const patched = size(reused);
      patchPage(reused, deck, deck.pages[0], { assetBase: '' });
      return { desk: size(desk), mob: size(mob), slide: size(slide), deckCss, patched, back: size(reused) };
    }, { web: read('sample-web'), deck: read('sample-deck') });
    assert.deepEqual(result.desk, ['1440px', '2400px']);
    assert.deepEqual(result.mob, ['390px', '3000px']);
    assert.deepEqual(result.slide, ['1920px', '1080px']);
    // 课件根节点的样式与第 10 轮完全一致
    assert.match(result.deckCss, /^position: relative; width: 1920px; height: 1080px; overflow: hidden; isolation: isolate;/);
    assert.deepEqual(result.patched, ['390px', '3000px']);
    assert.deepEqual(result.back, ['1920px', '1080px']);
  } finally {
    await browser.close();
    await new Promise(ok => server.close(ok));
  }
});
