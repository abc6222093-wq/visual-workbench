// 第 13 轮 · 本地常用字体库：目录别名、页面字族识别、清单读取、/api/fonts 响应体、fontLibraryFor、设置弹窗文字。
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_CATALOG } from '../src/fonts/catalog.js';
import { familiesInHtml, fontLibraryFor, fontsApi, matchFamily, readFontLibrary } from '../src/fonts/library.js';
import { fontLibraryHtml } from '../web/runtime-settings.js';

const INTER = fileURLToPath(new URL('../examples/sample-deck/fonts/Inter-Variable.ttf', import.meta.url));
const tmp = t => { const dir = mkdtempSync(join(tmpdir(), 'vw-r13-fonts-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('目录：五套、官方地址、OFL、每套有许可证文件', () => {
  assert.deepEqual(FONT_CATALOG.map(e => e.key), ['zcool-xiaowei', 'source-han-serif-sc', 'source-han-serif-jp', 'source-han-sans-sc', 'source-han-sans-jp']);
  for (const entry of FONT_CATALOG) {
    assert.equal(entry.license.name, 'OFL-1.1');
    assert.ok(entry.files.some(f => f.kind === 'license'), entry.key);
    for (const file of entry.files) assert.match(file.url, /^https:\/\/raw\.githubusercontent\.com\/(google\/fonts\/main\/ofl\/zcoolxiaowei|adobe-fonts\/source-han-(serif|sans)\/release)\//);
  }
});

test('matchFamily：中文名、Noto 名、Source Han 名、去空格 / 连字符 / 大小写 / 引号都认，认不出返回 null', () => {
  const cases = {
    'ZCOOL XiaoWei': 'zcool-xiaowei', ZCOOLXiaoWei: 'zcool-xiaowei', '站酷小薇': 'zcool-xiaowei', 'zcool xiaowei regular': 'zcool-xiaowei', '"ZCOOL XiaoWei"': 'zcool-xiaowei',
    'Source Han Serif SC': 'source-han-serif-sc', SourceHanSerifSC: 'source-han-serif-sc', 'Noto Serif CJK SC': 'source-han-serif-sc', 'Noto Serif SC': 'source-han-serif-sc', '思源宋体': 'source-han-serif-sc', '思源宋体 SC': 'source-han-serif-sc',
    'Source Han Serif JP': 'source-han-serif-jp', 'Noto Serif CJK JP': 'source-han-serif-jp', 'Noto Serif JP': 'source-han-serif-jp', '思源宋体 日文': 'source-han-serif-jp', '源ノ明朝': 'source-han-serif-jp',
    'Source Han Sans SC': 'source-han-sans-sc', 'noto sans cjk sc': 'source-han-sans-sc', 'Noto Sans SC': 'source-han-sans-sc', '思源黑体': 'source-han-sans-sc',
    'Source Han Sans JP': 'source-han-sans-jp', 'Noto Sans JP': 'source-han-sans-jp', '源ノ角ゴシック': 'source-han-sans-jp',
  };
  for (const [name, key] of Object.entries(cases)) assert.equal(matchFamily(name), key, name);
  for (const name of ['Inter', 'PingFang SC', '', null, 'serif']) assert.equal(matchFamily(name), null, String(name));
});

test('familiesInHtml：font-family 声明、@font-face、font 简写、实体引号；认不出的忽略', () => {
  const html = `<style>
    @font-face { font-family: "思源宋体"; src: url(../fonts/a.woff2); }
    h1 { font-family: 'ZCOOL XiaoWei', serif; }
    p { font: 600 18px/1.5 "Noto Sans CJK JP", sans-serif; }
    .x { font-family: Inter, "PingFang SC"; }
  </style><div style="font-family: &quot;Source Han Sans SC&quot;">字</div>`;
  const hits = familiesInHtml(html);
  assert.deepEqual(hits.map(h => h.key).sort(), ['source-han-sans-jp', 'source-han-sans-sc', 'source-han-serif-sc', 'zcool-xiaowei']);
  assert.equal(hits.find(h => h.key === 'zcool-xiaowei').usedName, 'ZCOOL XiaoWei');
  assert.deepEqual(familiesInHtml('<p style="font-family: Inter">x</p>'), []);
});

test('readFontLibrary / fontLibraryFor / fontsApi：缺文件的 face 不算、只给页面用到的字族、没有清单为空', t => {
  const dataDir = tmp(t);
  assert.deepEqual(readFontLibrary(dataDir).families, []);
  assert.deepEqual(fontLibraryFor(dataDir, {}, '<p style="font-family:思源黑体">x</p>'), []);
  const api0 = fontsApi(dataDir);
  assert.equal(api0.families.length, 5);
  assert.ok(api0.families.every(f => !f.installed));

  const lib = join(dataDir, 'library', 'fonts');
  mkdirSync(join(lib, 'zcool-xiaowei'), { recursive: true });
  mkdirSync(join(lib, 'source-han-sans-sc'), { recursive: true });
  copyFileSync(INTER, join(lib, 'zcool-xiaowei', 'ZCOOLXiaoWei-Regular.ttf'));
  writeFileSync(join(lib, 'zcool-xiaowei', 'OFL.txt'), 'OFL');
  writeFileSync(join(lib, 'fonts.json'), JSON.stringify({ families: [
    { key: 'zcool-xiaowei', family: 'ZCOOL XiaoWei', aliases: ['自定义名'], license: { name: 'OFL-1.1' }, files: [
      { file: 'ZCOOLXiaoWei-Regular.ttf', weight: 400, style: 'normal', format: 'truetype', bytes: 876576 }, { file: 'OFL.txt', kind: 'license', bytes: 3 }] },
    { key: 'source-han-sans-sc', family: 'Source Han Sans SC', aliases: [], files: [{ file: 'SourceHanSansCN-VF.otf', weight: 'variable', format: 'opentype', bytes: 10 }] },
    { key: '../evil', family: 'x', files: [{ file: 'a.ttf' }] },
  ] }));
  const library = readFontLibrary(dataDir);
  assert.deepEqual(library.families.map(f => f.key), ['zcool-xiaowei'], '缺文件的那套不算');
  assert.equal(library.families[0].licenseFile, 'OFL.txt');
  assert.ok(library.families[0].aliases.includes('站酷小薇') && library.families[0].aliases.includes('自定义名'));

  const pages = ['<h1 style="font-family: 站酷小薇">标题</h1>', '<p style="font-family: 思源黑体">正文</p>'];
  const fontLibrary = fontLibraryFor(dataDir, {}, pages);
  assert.equal(fontLibrary.length, 1);
  assert.equal(fontLibrary[0].family, 'ZCOOL XiaoWei');
  assert.deepEqual(fontLibrary[0].faces, [{ url: '/data/library/fonts/zcool-xiaowei/ZCOOLXiaoWei-Regular.ttf', file: 'ZCOOLXiaoWei-Regular.ttf', weight: 400, style: 'normal', format: 'truetype' }]);
  assert.deepEqual(fontLibraryFor(dataDir, {}, '<p style="font-family: Inter">x</p>'), []);
  assert.equal(fontLibraryFor(dataDir, {}, { a: '<i style="font-family:自定义名">x</i>' }).length, 1, '清单里的别名也算');

  const api = fontsApi(dataDir);
  assert.equal(api.dir, lib);
  const zcool = api.families.find(f => f.key === 'zcool-xiaowei');
  assert.equal(zcool.installed, true);
  assert.deepEqual(zcool.missing, []);
  const sans = api.families.find(f => f.key === 'source-han-sans-sc');
  assert.equal(sans.installed, false);
  assert.deepEqual(sans.missing, ['SourceHanSansCN-VF.otf']);
});

test('设置弹窗的字体库段落：文件夹、每套状态、没装时提示让 agent 安装', () => {
  const html = fontLibraryHtml({ dir: '/数据/library/fonts', families: [{ key: 'a', family: 'ZCOOL XiaoWei', installed: true }, { key: 'b', family: 'Source Han Sans SC', installed: false }] });
  assert.match(html, /\/数据\/library\/fonts/);
  assert.match(html, /ZCOOL XiaoWei：已安装/);
  assert.match(html, /Source Han Sans SC：没装/);
  assert.match(html, /让 agent 运行 npm run fonts -- install/);
  assert.doesNotMatch(fontLibraryHtml({ dir: 'x', families: [{ key: 'a', family: 'A', installed: true }] }), /npm run fonts/);
});
