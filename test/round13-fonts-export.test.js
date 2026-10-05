// 第 13 轮 · 导出放映版嵌入字体库：用示例项目的 Inter 字体伪装成字体库里的一套（清单 aliases 里加 "Inter"），
// 验证导出文件里有字体库 face、已按最终文字子集化成 woff2、页面没用到的字族不嵌、没有字体库时和原来一样。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportHtml } from '../src/export/html.js';

const SAMPLE = fileURLToPath(new URL('../examples/sample-deck', import.meta.url));
const INTER = join(SAMPLE, 'fonts', 'Inter-Variable.ttf');
const embedded = html => JSON.parse(/<script type="application\/json" id="vw-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const decode = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

function makeData(t, { library = true } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-r13-fontexp-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const projectDir = join(dataDir, 'projects', 'deck');
  cpSync(SAMPLE, projectDir, { recursive: true });
  mkdirSync(join(dataDir, 'library', 'assets'), { recursive: true });
  const lib = join(dataDir, 'library', 'fonts');
  mkdirSync(lib, { recursive: true });
  if (library) {
    mkdirSync(join(lib, 'test-sans'), { recursive: true });
    mkdirSync(join(lib, 'unused-serif'), { recursive: true });
    copyFileSync(INTER, join(lib, 'test-sans', 'TestSans-VF.ttf'));
    writeFileSync(join(lib, 'test-sans', 'LICENSE.txt'), 'TEST SANS LICENSE OFL');
    copyFileSync(INTER, join(lib, 'unused-serif', 'Unused.ttf'));
    writeFileSync(join(lib, 'fonts.json'), JSON.stringify({ families: [
      { key: 'test-sans', family: 'Test Sans', aliases: ['Inter'], license: { name: 'OFL-1.1' }, files: [
        { file: 'TestSans-VF.ttf', weight: 'variable', style: 'normal', format: 'truetype', bytes: 876576 }, { file: 'LICENSE.txt', kind: 'license', bytes: 21 }] },
      { key: 'unused-serif', family: 'Unused Serif', aliases: ['Nope Serif'], files: [{ file: 'Unused.ttf', weight: 400, style: 'normal', format: 'truetype', bytes: 876576 }] },
    ] }));
  }
  return { dataDir, projectDir };
}

test('导出放映版：页面用到的字体库字族按最终文字子集化嵌入，没用到的不嵌，许可证附上', async t => {
  const { dataDir, projectDir } = makeData(t);
  // 修改单里的新字也要进子集
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  project.pages[0].edits = [...(project.pages[0].edits || []), { id: 'ed_fontlib1', target: 'nope', kind: 'text', at: '2026-10-06T00:00:00.000Z', before: { html: 'a', text: 'a' }, after: { html: 'QZXqzx', text: 'QZXqzx' } }];
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  const outFile = join(dataDir, 'exports', 'deck', 'deck.html');
  const result = await exportHtml({ projectDir, outFile });
  const html = readFileSync(outFile, 'utf8');
  const data = embedded(html);
  const key = 'libfont:test-sans/TestSans-VF.ttf';
  assert.ok(data.files[key], '字体库文件已嵌入');
  assert.match(data.files[key], /^data:font\/woff2;base64,/);
  const woff2 = decode(data.files[key]);
  assert.ok(woff2.length < 876576 / 2, `已子集化（${woff2.length} 字节）`);
  assert.ok(!Object.keys(data.files).some(k => k.startsWith('libfont:unused-serif')), '没用到的字族不嵌');
  for (const page of project.pages) {
    const text = data.pages[page.id];
    assert.match(text, /<style data-vw-fontlib>/, page.id);
    assert.ok(text.includes(`__VWFILE[${key}]__`), page.id);
    assert.ok(text.indexOf('data-vw-fontlib') < text.indexOf('font-family: "Inter"; src:'), '字体库 face 在页面自己的 @font-face 之前');
    assert.match(text, /@font-face\{font-family:"Inter";src:url\("__VWFILE\[libfont:test-sans\/TestSans-VF\.ttf\]__"\) format\("woff2"\);font-weight:100 900/);
  }
  const item = result.items.find(i => i.name === key);
  assert.equal(item.kind, 'font');
  assert.match(item.note, /字体库/);
  assert.match(html, /TEST SANS LICENSE OFL/);
  assert.match(html, /字体 Test Sans（字体库 test-sans）/);
});

test('导出放映版：没有字体库时和原来一样（没有 data-vw-fontlib、没有 libfont 文件）；显式 dataDir 也可以', async t => {
  const { dataDir, projectDir } = makeData(t, { library: false });
  const outFile = join(dataDir, 'exports', 'deck', 'deck.html');
  await exportHtml({ projectDir, outFile });
  const data = embedded(readFileSync(outFile, 'utf8'));
  assert.ok(!Object.keys(data.files).some(k => k.startsWith('libfont:')));
  assert.ok(Object.values(data.pages).every(text => !text.includes('data-vw-fontlib')));

  // 项目不在 <数据目录>/projects 下：靠 dataDir 选项找字体库
  const other = makeData(t);
  const loose = mkdtempSync(join(tmpdir(), 'vw-r13-fontexp-loose-'));
  t.after(() => rmSync(loose, { recursive: true, force: true }));
  cpSync(SAMPLE, join(loose, 'deck'), { recursive: true });
  const out2 = join(loose, 'out.html');
  await exportHtml({ projectDir: join(loose, 'deck'), outFile: out2 });
  assert.ok(!Object.keys(embedded(readFileSync(out2, 'utf8')).files).some(k => k.startsWith('libfont:')), '推断不出数据目录时不嵌');
  await exportHtml({ projectDir: join(loose, 'deck'), outFile: out2, dataDir: other.dataDir });
  assert.ok(embedded(readFileSync(out2, 'utf8')).files['libfont:test-sans/TestSans-VF.ttf']);
});
