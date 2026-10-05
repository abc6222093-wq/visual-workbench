import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listVersions, saveVersion } from '../src/version.js';

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

function withProject(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try {
    const dir = join(tmp, 'projects', 'demo');
    cpSync(SAMPLE, dir, { recursive: true });
    return fn(dir);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('saveVersion 后 versions/ 多出一份，且含 meta.json', () => {
  withProject((dir) => {
    assert.equal(listVersions(dir).length, 0);
    const { versionDir } = saveVersion({ projectDir: dir, note: '第一版' });
    assert.equal(listVersions(dir).length, 1);
    assert.ok(existsSync(join(versionDir, 'meta.json')));
    assert.match(basename(versionDir), /^\d{8}-\d{6}(-\d+)?$/);
  });
});

test('版本里的 project.json、assets、fonts 与存版时逐文件内容一致，且不含 versions/', () => {
  withProject((dir) => {
    const { versionDir } = saveVersion({ projectDir: dir });
    const rels = ['project.json'];
    for (const sub of ['assets', 'fonts']) for (const f of readdirSync(join(dir, sub))) rels.push(`${sub}/${f}`);
    assert.ok(rels.length > 1);
    for (const rel of rels) {
      assert.ok(readFileSync(join(dir, rel)).equals(readFileSync(join(versionDir, rel))), `${rel} 内容应一致`);
    }
    assert.equal(existsSync(join(versionDir, 'versions')), false);
  });
});

test('meta.json 记录备注、存档人、项目编号和文件列表', () => {
  withProject((dir) => {
    const { versionDir, meta } = saveVersion({ projectDir: dir, note: '试存', by: 'claude' });
    const onDisk = JSON.parse(readFileSync(join(versionDir, 'meta.json'), 'utf8'));
    assert.deepEqual(onDisk, meta);
    assert.equal(onDisk.note, '试存');
    assert.equal(onDisk.by, 'claude');
    assert.equal(onDisk.projectId, 'sample-deck');
    assert.ok(onDisk.files.includes('project.json'));
    assert.ok(onDisk.files.includes('assets/logo.png'));
    assert.ok(onDisk.files.includes('pages/page_cover.html'));
    assert.ok(!Number.isNaN(Date.parse(onDisk.savedAt)));
  });
});

test('连存两次，目录名不同', () => {
  withProject((dir) => {
    const a = saveVersion({ projectDir: dir, note: 'a' });
    const b = saveVersion({ projectDir: dir, note: 'b' });
    assert.notEqual(a.versionDir, b.versionDir);
    assert.equal(listVersions(dir).length, 2);
    // 第二份里不应嵌套第一份
    assert.equal(existsSync(join(b.versionDir, 'versions')), false);
  });
});
