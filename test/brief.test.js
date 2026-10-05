// 「复制给 agent」（格式 v3）：路径、规则、格式、页面文件、修改单摘要（标出对不上）、开工三步、改完三步。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentBrief } from '../src/brief.js';
// 格式 v3 的示例项目（测试自己生成，不依赖 examples/）：两页 HTML、一张照片、一个 logo、一份较大的字体
import { after as afterAll } from 'node:test';
import { mkdirSync as mkdirSample, writeFileSync as writeSample, mkdtempSync as mkdtempSample, rmSync as rmSample } from 'node:fs';
import { tmpdir as tmpSample } from 'node:os';
import { join as joinSample } from 'node:path';
function writeV3Sample(dir, id = 'sample-deck') {
  for (const sub of ['pages', 'assets', 'fonts']) mkdirSample(joinSample(dir, sub), { recursive: true });
  const font = Buffer.alloc(300_000); for (let i = 0; i < font.length; i++) font[i] = (i * 2654435761) >>> 24;
  writeSample(joinSample(dir, 'fonts/Inter-Variable.ttf'), font);
  writeSample(joinSample(dir, 'assets/photo-city.png'), Buffer.from('城市照片的内容'.repeat(50)));
  writeSample(joinSample(dir, 'assets/logo.png'), Buffer.from('logo'));
  writeSample(joinSample(dir, 'pages/page_cover.html'), '<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url(../fonts/Inter-Variable.ttf)} body{background:#123456;color:#fafafa}</style></head><body><h1 data-vw-id="title" data-vw="text move color">视觉工作台</h1><img data-vw-id="hero" data-vw="move resize crop" src="../assets/photo-city.png"></body></html>\n');
  writeSample(joinSample(dir, 'pages/page_two.html'), '<!doctype html><html><body><img data-vw-id="logo" data-vw="move" src="../assets/logo.png"><p data-vw-id="body" data-vw="text">第二页</p></body></html>\n');
  const now = '2026-10-01T12:00:00.000Z';
  const project = { format: 'visual-workbench/project', formatVersion: 3, id, name: '示例课件', createdAt: now, updatedAt: now,
    artboard: { preset: 'slide-16x9', width: 1920, height: 1080 },
    assets: [{ id: 'asset_photo', kind: 'image', file: 'assets/photo-city.png', name: '城市' }, { id: 'asset_logo', kind: 'image', file: 'assets/logo.png', name: 'logo' }],
    fonts: [{ id: 'font_inter', family: 'Inter', file: 'fonts/Inter-Variable.ttf', weight: 'variable' }],
    pages: [{ id: 'page_cover', name: '封面', file: 'pages/page_cover.html', motion: { steps: 1 }, edits: [] }, { id: 'page_two', name: '第二页', file: 'pages/page_two.html', edits: [] }] };
  writeSample(joinSample(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return dir;
}
const SAMPLE_ROOT = mkdtempSample(joinSample(tmpSample(), 'vw-sample-'));
afterAll(() => rmSample(SAMPLE_ROOT, { recursive: true, force: true }));
const SAMPLE = writeV3Sample(joinSample(SAMPLE_ROOT, 'sample-deck'));
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
function setup(tmp) {
  const dataDir = join(tmp, 'data');
  const projectDir = join(dataDir, 'projects', 'sample-deck');
  cpSync(SAMPLE, projectDir, { recursive: true });
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  project.pages[0].edits = [
    { id: 'ed_text0001', target: 'title', kind: 'text', before: { html: '视觉工作台', text: '视觉工作台' }, after: { html: '新标题', text: '新标题' } },
    { id: 'ed_gone0001', target: 'gone', kind: 'move', before: { x: 1, y: 2, width: 3, height: 4 }, after: { dx: 10, dy: 0 } },
  ];
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(project, null, 2));
  return { dataDir, projectDir, project };
}

test('全部页：路径、规则、格式、每页文件、修改单摘要（对不上的标出来）、开工三步、改完三步', () => {
  withTmp((tmp) => {
    const { dataDir, projectDir, project } = setup(tmp);
    const text = agentBrief({ repoDir: REPO, dataDir, projectDir, project });
    for (const piece of [REPO, dataDir, join(REPO, 'CLAUDE.md'), join(REPO, 'docs', 'format.md'), projectDir, join(projectDir, 'project.json'),
      join(projectDir, 'pages/page_cover.html'), join(projectDir, 'pages/page_two.html'),
      'ed_text0001', '「title」文字从「视觉工作台」改成「新标题」', 'ed_gone0001【对不上】',
      'npm run edits -- sample-deck', 'npm run save-version -- sample-deck', `npm run validate -- "${projectDir}"`, `npm run check-motion -- "${projectDir}"`, 'npm run edits -- sample-deck --clear'])
      assert.ok(text.includes(piece), `应包含：${piece}\n${text}`);
    assert.match(text, /修改单：无/);
    assert.doesNotMatch(text, /undefined/);
  });
});

test('当前页：只列这一页，清除命令带 --page', () => {
  withTmp((tmp) => {
    const { dataDir, projectDir, project } = setup(tmp);
    const text = agentBrief({ repoDir: REPO, dataDir, projectDir, project, pageIds: ['page_two'] });
    assert.ok(text.includes(join(projectDir, 'pages/page_two.html')));
    assert.ok(!text.includes(join(projectDir, 'pages/page_cover.html')));
    assert.ok(text.includes('npm run edits -- sample-deck --clear --page page_two'));
    assert.match(text, /只处理下面 1 页/);
  });
});

test('有 series.json、import/ 时多一行说明；不传 project 时从文件读', () => {
  withTmp((tmp) => {
    const { projectDir } = setup(tmp);
    writeFileSync(join(projectDir, 'series.json'), JSON.stringify({ master: 'autumn-master', palette: [] }));
    mkdirSync(join(projectDir, 'import'));
    const text = agentBrief({ repoDir: REPO, projectDir });
    assert.match(text, /系列母版 autumn-master/);
    assert.ok(text.includes(join(projectDir, 'series', 'pages')));
    assert.ok(text.includes(join(projectDir, 'import')));
    writeFileSync(join(projectDir, 'series.json'), '{ 坏的');
    assert.doesNotMatch(agentBrief({ repoDir: REPO, projectDir }), /undefined/);
  });
});
