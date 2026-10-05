// 第 12 轮导出 / 交接包测试用的 v3 夹具（自己写：project.json formatVersion 3 + pages/*.html + 小图片）。
// 其他 round12-export*、round12-handoff* 测试 import 这里的 makeDeck / makeWeb；本文件自身只检查夹具结构。
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { scanMarks, scanResources } from '../web/page-marks.js';

export const tmp = prefix => mkdtempSync(join(tmpdir(), prefix));
const INTER = fileURLToPath(new URL('../examples/sample-deck/fonts/Inter-Variable.ttf', import.meta.url));
const NOW = '2026-10-05T12:00:00.000Z';

const solid = (width, height, color) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
/** 左半红、右半蓝的图（裁切测试用） */
async function halves(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
    .composite([{ input: { create: { width: width / 2, height, channels: 3, background: '#0000ff' } }, left: width / 2, top: 0 }])
    .png().toBuffer();
}

export const DECK_COVER = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<link rel="stylesheet" href="../assets/style.css">
<style>
  body { background: #ffffff; font-family: 'Fixture Sans', sans-serif; position: relative; }
  #title { position: absolute; left: 40px; top: 24px; margin: 0; font-size: 40px; color: #111111; }
  #card { position: absolute; left: 40px; top: 120px; width: 120px; height: 80px; background: #3366ff; }
  #hero { position: absolute; left: 400px; top: 120px; width: 200px; height: 150px; }
  .b { position: absolute; left: 200px; width: 160px; height: 40px; background: #00aa00; }
  .b1 { top: 120px; } .b2 { top: 180px; }
</style></head>
<body>
  <h1 id="title" data-vw-id="title" data-vw="text move color" data-vw-origin="header h1">你好<b>世界</b></h1>
  <div id="card" data-vw-id="card" data-vw="move resize background" data-vw-origin="main .card"></div>
  <img id="hero" data-vw-id="hero" data-vw="move resize crop" data-vw-origin="main img.hero" src="../assets/halves.png" alt="">
  <div class="b b1" data-vw-id="b1"></div><div class="b b2" data-vw-id="b2"></div>
  <script type="module">
    import { opacityOf } from '../assets/lib.js';
    window.vw?.motion({
      init(ctx) { for (const el of ctx.root.querySelectorAll('.b')) el.style.opacity = '0'; },
      async step(index, ctx) {
        const el = ctx.root.querySelector('.b' + (index + 1));
        await ctx.animate(el, [{ opacity: 0 }, { opacity: opacityOf('show') }], { duration: 200, fill: 'forwards' });
        el.style.opacity = String(opacityOf('show'));
      },
    });
  </script>
</body></html>
`;

export const DECK_SECOND = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Fixture Inter'; src: url(../fonts/Inter.ttf); }
  body { background: #222222; color: #ffffff; font-family: 'Fixture Inter'; }
  #t2 { position: absolute; left: 40px; top: 40px; margin: 0; font-size: 32px; }
  #dot { position: absolute; left: 40px; top: 200px; width: 50px; height: 50px; background: url('../assets/dot.png'); }
</style></head>
<body>
  <p id="t2" data-vw-id="t2" data-vw="text color">Second page</p>
  <div id="dot" data-vw-id="dot" data-vw="move"></div>
  <script type="module">
    window.vw?.motion({
      async init(ctx) {
        const mod = await ctx.importModule('/vendor/anime.esm.min.js');
        if (!mod || typeof mod.animate !== 'function') throw new Error('anime 没加载到');
      },
    });
  </script>
</body></html>
`;

/** 课件夹具：两页（第 1 页 2 步动效 + 修改单可写），返回 { dir, project, write(project) } */
export async function makeDeck({ edits = [], cover = DECK_COVER, second = DECK_SECOND, motionSteps = 2, change } = {}) {
  const dir = tmp('vw-r12-deck-');
  mkdirSync(join(dir, 'pages'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  writeFileSync(join(dir, 'assets/halves.png'), await halves(400, 300));
  writeFileSync(join(dir, 'assets/dot.png'), await solid(10, 10, '#ff8800'));
  writeFileSync(join(dir, 'assets/unused.png'), await solid(10, 10, '#123456'));
  writeFileSync(join(dir, 'assets/paste.png'), await solid(60, 40, '#00ff00'));
  writeFileSync(join(dir, 'assets/lib.js'), "import { SHOW } from './lib-const.js';\nexport const opacityOf = name => (name === 'show' ? SHOW : 0);\n");
  writeFileSync(join(dir, 'assets/lib-const.js'), 'export const SHOW = 1;\n');
  writeFileSync(join(dir, 'assets/style.css'), '.unused-rule { background: url(dot.png); }\n');
  copyFileSync(INTER, join(dir, 'fonts/Inter.ttf'));
  writeFileSync(join(dir, 'pages/page_cover.html'), cover);
  writeFileSync(join(dir, 'pages/page_second.html'), second);
  const image = (id, file, width, height) => ({ id, kind: 'image', file, name: id, width, height, addedAt: NOW });
  const project = {
    format: 'visual-workbench/project', formatVersion: 3, id: 'r12-deck', name: '第十二轮课件', kind: 'deck',
    createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'custom', width: 640, height: 360 },
    assets: [
      image('asset_halves', 'assets/halves.png', 400, 300), image('asset_dot', 'assets/dot.png', 10, 10),
      image('asset_unused', 'assets/unused.png', 10, 10), image('asset_paste', 'assets/paste.png', 60, 40),
      { id: 'asset_lib', kind: 'file', file: 'assets/lib.js', name: 'lib.js', addedAt: NOW },
      { id: 'asset_libconst', kind: 'file', file: 'assets/lib-const.js', name: 'lib-const.js', addedAt: NOW },
      { id: 'asset_style', kind: 'file', file: 'assets/style.css', name: 'style.css', addedAt: NOW },
    ],
    fonts: [{ id: 'font_inter', family: 'Fixture Inter', file: 'fonts/Inter.ttf', weight: 400, style: 'normal' }],
    pages: [
      { id: 'page_cover', name: '封面', file: 'pages/page_cover.html', ...(motionSteps ? { motion: { steps: motionSteps } } : {}), edits },
      { id: 'page_second', name: '第二页', file: 'pages/page_second.html', edits: [] },
    ],
  };
  change?.(project, dir);
  const write = p => writeFileSync(join(dir, 'project.json'), JSON.stringify(p, null, 2));
  write(project);
  return { dir, project, write };
}

export const WEB_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { background: #ffffff; font-family: sans-serif; }
  section { height: 600px; }
  #s1 { background: #ffeecc; } #s2 { background: #ccddff; }
  #headline { margin: 0; padding: 24px; font-size: 28px; color: #222222; }
</style></head>
<body>
  <section id="s1" data-vw-id="s1" data-vw="background" data-vw-origin="section.hero"><h1 id="headline" data-vw-id="headline" data-vw="text move color" data-vw-origin="section.hero h1">网页标题</h1></section>
  <section id="s2" data-vw-id="s2" data-vw="background" data-vw-origin="section.features"></section>
</body></html>
`;

/** 网页夹具：一页手机端 390×1200 */
export async function makeWeb({ edits = [] } = {}) {
  const dir = tmp('vw-r12-web-');
  mkdirSync(join(dir, 'pages'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'pages/page_home.html'), WEB_PAGE);
  writeFileSync(join(dir, 'assets/paste.png'), await solid(60, 40, '#00ff00'));
  const project = {
    format: 'visual-workbench/project', formatVersion: 3, id: 'r12-web', name: '第十二轮网页', kind: 'web',
    createdAt: NOW, updatedAt: NOW,
    artboard: { preset: 'web-mobile', width: 390, height: 844 },
    assets: [{ id: 'asset_paste', kind: 'image', file: 'assets/paste.png', name: 'paste', width: 60, height: 40, addedAt: NOW }],
    fonts: [],
    pages: [{ id: 'page_home', name: '首页', file: 'pages/page_home.html', device: 'mobile', size: { width: 390, height: 1200 }, origin: { url: 'https://example.test/' }, edits }],
  };
  const write = p => writeFileSync(join(dir, 'project.json'), JSON.stringify(p, null, 2));
  write(project);
  return { dir, project, write };
}

export const cleanup = (...dirs) => { for (const dir of dirs) if (dir) rmSync(dir, { recursive: true, force: true }); };

test('第 12 轮导出夹具：v3 结构、页面标记与资源引用齐全', async () => {
  const deck = await makeDeck();
  const web = await makeWeb();
  try {
    assert.equal(deck.project.formatVersion, 3);
    const cover = readFileSync(join(deck.dir, 'pages/page_cover.html'), 'utf8');
    assert.deepEqual([...scanMarks(cover).marks.keys()], ['title', 'card', 'hero', 'b1', 'b2']);
    assert.ok(scanResources(cover).includes('../assets/halves.png'));
    for (const asset of deck.project.assets) assert.ok(existsSync(join(deck.dir, asset.file)), asset.file);
    assert.equal(web.project.kind, 'web');
  } finally { cleanup(deck.dir, web.dir); }
});
