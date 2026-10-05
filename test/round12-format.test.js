// 第 12 轮：项目格式 v3 的结构与语义校验（schema + validate.js），命令行 validate / edits。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateProject, validateProjectData, formatResult, ERROR_CODES } from '../src/validate.js';
import { listEdits, clearProjectEdits, parseArgs } from '../src/cli/edits.js';
import { listVersions } from '../src/version.js';
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
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withProject(fn, mutate) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-r12f-'));
  try {
    const dir = join(tmp, 'projects', 'sample-deck');
    cpSync(SAMPLE, dir, { recursive: true });
    const file = join(dir, 'project.json');
    const project = JSON.parse(readFileSync(file, 'utf8'));
    if (mutate) { mutate(project, dir); writeFileSync(file, JSON.stringify(project, null, 2)); }
    return fn(dir, project, tmp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const codes = (r) => r.errors.map((e) => e.code);
const check = (mutate) => withProject((dir) => validateProject(dir), mutate);
const move = (id, target) => ({ id, target, kind: 'move', before: { x: 0, y: 0, width: 10, height: 10 }, after: { dx: 5, dy: -5 } });

test('v3 样例通过；资源 kind file、designCard、folder 都接受', () => {
  const r = check((p) => { p.folder = '秋季'; p.designCard = { direction: '纸感', concept: '一句话', colors: ['#112233'], fonts: ['Inter'], traits: ['留白'] }; });
  assert.equal(r.ok, true, formatResult(r));
  assert.equal(check((p) => { p.designCard = null; }).ok, true);
});

test('旧格式（formatVersion 2）只给一条中文错误：先运行 npm run convert', () => {
  const r = validateProjectData({ format: 'visual-workbench/project', formatVersion: 2, pages: [{ elements: [] }] });
  assert.equal(r.ok, false);
  assert.deepEqual(codes(r), [ERROR_CODES.LEGACY_FORMAT]);
  assert.match(r.errors[0].message, /旧格式，请先运行 npm run convert 转换/);
});

test('v2 字段（elements、outline、background、variantOf、motion.source）不再接受', () => {
  for (const mutate of [
    (p) => { p.pages[0].elements = []; },
    (p) => { p.pages[0].outline = { rows: [] }; },
    (p) => { p.pages[0].background = '#ffffff'; },
    (p) => { p.pages[1].variantOf = 'page_cover'; },
    (p) => { p.pages[0].motion = { steps: 1, source: 'export default async () => {}' }; },
    (p) => { p.pages[0].motion = { steps: -1 }; },
    (p) => { delete p.pages[0].file; },
  ]) assert.ok(codes(check(mutate)).includes('SCHEMA'));
});

test('页面文件：必须是 pages/<页面编号>.html，且要存在', () => {
  assert.ok(codes(check((p, dir) => rmSync(join(dir, 'pages/page_two.html')))).includes(ERROR_CODES.MISSING_PAGE_FILE));
  assert.ok(codes(check((p) => { p.pages[1].file = 'pages/page_cover.html'; })).includes(ERROR_CODES.PAGE_FILE_NAME));
});

test('页面标记：data-vw-id 重复 / 不合法、data-vw 能力不认识', () => {
  const r = check((p, dir) => writeFileSync(join(dir, 'pages/page_two.html'), '<p data-vw-id="a" data-vw="text">1</p><p data-vw-id="a" data-vw="move">2</p><p data-vw-id="1bad" data-vw="text">3</p><p data-vw-id="b" data-vw="text spin">4</p>'));
  assert.deepEqual(codes(r).sort(), [ERROR_CODES.DUPLICATE_MARK_ID, ERROR_CODES.INVALID_CAP, ERROR_CODES.INVALID_MARK_ID].sort());
});

test('修改单：目标不存在或页面没给这种能力 = 对不上（STALE_EDIT）；贴图引用不存在的素材报 UNKNOWN_ASSET_REF', () => {
  assert.equal(check((p) => { p.pages[0].edits = [move('ed_ok000001', 'title')]; }).ok, true);
  assert.deepEqual(codes(check((p) => { p.pages[0].edits = [move('ed_gone0001', 'nothing')]; })), [ERROR_CODES.STALE_EDIT]);
  assert.deepEqual(codes(check((p) => { p.pages[1].edits = [{ id: 'ed_col00001', target: 'logo', kind: 'color', before: { color: null }, after: { color: '#ff0000' } }]; })), [ERROR_CODES.STALE_EDIT]);
  const image = { id: 'ed_img00001', target: 'u_12345678', kind: 'addImage', before: null, after: { asset: 'asset_logo', x: 1, y: 2, width: 3, height: 4 } };
  assert.equal(check((p) => { p.pages[0].edits = [image, move('ed_imgmove1', 'u_12345678')]; }).ok, true);
  assert.deepEqual(codes(check((p) => { p.pages[0].edits = [move('ed_imgmove1', 'u_12345678')]; })), [ERROR_CODES.STALE_EDIT]);
  assert.deepEqual(codes(check((p) => { p.pages[0].edits = [{ ...image, after: { ...image.after, asset: 'asset_none' } }]; })), [ERROR_CODES.UNKNOWN_ASSET_REF]);
});

test('修改单编号全项目唯一；条目形状按种类检查', () => {
  assert.deepEqual(codes(check((p) => { p.pages[0].edits = [move('ed_same0001', 'title')]; p.pages[1].edits = [move('ed_same0001', 'logo')]; })), [ERROR_CODES.DUPLICATE_EDIT_ID]);
  for (const edit of [
    { id: 'ed_bad00001', target: 'title', kind: 'move', before: { x: 0, y: 0, width: 1, height: 1 }, after: { dx: 1 } },
    { id: 'ed_bad00002', target: 'title', kind: 'spin', before: null, after: null },
    { id: 'ed_bad00003', target: 'title', kind: 'color', before: { color: null }, after: { color: 'red' } },
    { id: 'ed_bad00004', target: 'title', kind: 'text', before: { html: 'a' }, after: { html: 'b', text: 'b' } },
    { id: 'ed_bad00005', target: 'hero', kind: 'crop', before: { crop: null }, after: { crop: { x: 0, y: 0, width: 2, height: 1 } } },
    { id: 'bad', target: 'title', kind: 'fontSize', before: { fontSize: 10 }, after: { fontSize: 12 } },
    { id: 'ed_bad00006', target: 'title', kind: 'addImage', before: null, after: { asset: 'asset_logo', x: 0, y: 0, width: 1, height: 1 } },
  ]) assert.ok(codes(check((p) => { p.pages[0].edits = [edit]; })).includes('SCHEMA'), JSON.stringify(edit));
});

test('资源引用：相对文件缺失报 MISSING_PAGE_RESOURCE；assets/ fonts/ 下未登记报 UNREGISTERED_RESOURCE；网络地址和 /vendor/ 不管', () => {
  const page = (html) => (p, dir) => writeFileSync(join(dir, 'pages/page_two.html'), html);
  assert.deepEqual(codes(check(page('<img src="../assets/none.png">'))), [ERROR_CODES.MISSING_PAGE_RESOURCE]);
  assert.deepEqual(codes(check(page('<img src="../../outside.png">'))), [ERROR_CODES.MISSING_PAGE_RESOURCE]);
  assert.deepEqual(codes(check((p, dir) => { writeFileSync(join(dir, 'assets/extra.js'), ''); page('<script type="module">import x from "../assets/extra.js";</script>')(p, dir); })), [ERROR_CODES.UNREGISTERED_RESOURCE]);
  assert.deepEqual(codes(check((p, dir) => { writeFileSync(join(dir, 'fonts/b.woff2'), ''); page('<style>@font-face{src:url(../fonts/b.woff2)}</style>')(p, dir); })), [ERROR_CODES.UNREGISTERED_RESOURCE]);
  assert.equal(check((p, dir) => { writeFileSync(join(dir, 'assets/my photo.png'), ''); p.assets.push({ id: 'asset_space', kind: 'image', file: 'assets/my photo.png' }); page('<img src="../assets/my%20photo.png"><script src="/vendor/anime.js"></script><img src="https://example.com/a.png"><a href="../x.html">x</a>')(p, dir); }).ok, true);
});

test('登记的素材 / 字体文件缺失；路径不能带 ..', () => {
  assert.deepEqual(codes(check((p, dir) => { rmSync(join(dir, 'assets/logo.png')); writeFileSync(join(dir, 'pages/page_two.html'), '<p data-vw-id="body" data-vw="text">x</p>'); })), [ERROR_CODES.MISSING_ASSET_FILE]);
  assert.ok(codes(check((p) => { p.fonts[0].file = 'fonts/../project.json'; })).includes(ERROR_CODES.UNSAFE_PATH));
});

test('网页项目：每页 device + size，宽度等于设备宽度；课件页面不能带 device / size（WEB_PAGE_FIELDS）', () => {
  assert.deepEqual(codes(check((p) => { p.pages[0].device = 'desktop'; p.pages[0].size = { width: 1440, height: 900 }; })), [ERROR_CODES.WEB_PAGE_FIELDS]);
  const web = (p) => { p.kind = 'web'; p.pages[0].device = 'desktop'; p.pages[0].size = { width: 1440, height: 3000 }; p.pages[1].device = 'mobile'; p.pages[1].size = { width: 390, height: 844 }; };
  assert.equal(check(web).ok, true);
  assert.deepEqual(codes(check((p) => { web(p); p.pages[1].size.width = 400; })), [ERROR_CODES.WEB_PAGE_FIELDS]);
  assert.deepEqual(codes(check((p) => { web(p); delete p.pages[1].device; })), [ERROR_CODES.WEB_PAGE_FIELDS]);
});

test('structural：只查结构，跳过页面内容类问题（工作台保存用）', () => {
  withProject((dir, project) => {
    project.pages[0].edits = [move('ed_gone0001', 'nothing')];
    rmSync(join(dir, 'pages/page_two.html'));
    assert.equal(validateProjectData(project, { projectDir: dir }).ok, false);
    assert.equal(validateProjectData(project, { projectDir: dir, structural: true }).ok, true);
    assert.equal(validateProjectData({ ...project, pages: [] }, { projectDir: dir, structural: true }).ok, false);
  });
});

const run = (script, args, env = {}) => spawnSync(process.execPath, [join(ROOT, 'src/cli', script), ...args], { encoding: 'utf8', env: { ...process.env, VW_DATA_DIR: env.dataDir || tmpdir(), ...env } });

test('命令行 validate：v3 项目通过退出码 0；旧格式退出码 1 并提示 npm run convert', () => {
  withProject((dir) => {
    const ok = run('validate.js', [dir]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /✓ 通过/);
    const file = join(dir, 'project.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), formatVersion: 2 }));
    const old = run('validate.js', [dir]);
    assert.equal(old.status, 1);
    assert.match(old.stdout, /npm run convert/);
  });
});

test('edits：列出（含对不上）、--json、按页；参数检查', () => {
  withProject((dir, project, tmp) => {
    const list = listEdits(dir);
    assert.equal(list.length, 2);
    assert.equal(list[0].edits[0].status, 'ok');
    assert.equal(list[0].edits[1].status, 'stale');
    assert.equal(listEdits(dir, { page: 'page_two' })[0].edits.length, 0);
    assert.throws(() => listEdits(dir, { page: 'page_none' }), /没有这一页/);
    const text = run('edits.js', [dir], { dataDir: tmp });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /ed_text0001\s+目标 title\s+文字\s+对得上/);
    assert.match(text.stdout, /ed_gone0001\s+目标 gone\s+位置\s+【对不上】/);
    assert.match(text.stdout, /共 2 条，其中 1 条对不上/);
    const json = JSON.parse(run('edits.js', [dir, '--json', '--page', 'page_cover'], { dataDir: tmp }).stdout);
    assert.deepEqual(json[0].edits.map((e) => e.id), ['ed_text0001', 'ed_gone0001']);
    assert.throws(() => parseArgs([]), /缺少项目/);
    assert.throws(() => parseArgs(['x', '--bogus']), /未知参数/);
    assert.equal(run('edits.js', ['x', '--bogus'], { dataDir: tmp }).status, 2);
  }, (p) => {
    p.pages[0].edits = [
      { id: 'ed_text0001', target: 'title', kind: 'text', before: { html: '视觉工作台', text: '视觉工作台' }, after: { html: '新标题', text: '新标题' } },
      move('ed_gone0001', 'gone'),
    ];
    p.pages[1].edits = [];
  });
});

test('edits --clear：先自动存版，只删指定条目 / 整页 / 全项目，只改 edits', () => {
  withProject((dir, project, tmp) => {
    const before = readFileSync(join(dir, 'project.json'), 'utf8');
    assert.throws(() => clearProjectEdits(dir, { ids: ['ed_nothere1'] }), /没有这些修改单条目/);
    assert.equal(listVersions(dir).length, 0);
    const one = clearProjectEdits(dir, { ids: ['ed_gone0001'] });
    assert.deepEqual(one.removed, ['ed_gone0001']);
    const versions = listVersions(dir);
    assert.equal(versions.length, 1);
    const meta = JSON.parse(readFileSync(join(versions[0], 'meta.json'), 'utf8'));
    assert.equal(meta.note, '清除修改单前自动存版');
    assert.equal(readFileSync(join(versions[0], 'project.json'), 'utf8'), before);
    const after = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    assert.deepEqual(after.pages[0].edits.map((e) => e.id), ['ed_text0001', 'ed_move0002']);
    assert.equal(after.name, project.name);
    const page = run('edits.js', [dir, '--clear', '--page', 'page_two'], { dataDir: tmp });
    assert.equal(page.status, 0, page.stderr);
    assert.match(page.stdout, /已清除 1 条：ed_two00001/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).pages[0].edits.length, 2);
    const all = run('edits.js', [dir, '--clear'], { dataDir: tmp });
    assert.match(all.stdout, /已清除 2 条/);
    assert.ok(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).pages.every((p) => p.edits.length === 0));
    assert.match(run('edits.js', [dir, '--clear'], { dataDir: tmp }).stdout, /没有要清除/);
    assert.equal(listVersions(dir).length, 3);
    assert.equal(validateProject(dir).ok, true);
  }, (p) => {
    p.pages[0].edits = [
      { id: 'ed_text0001', target: 'title', kind: 'text', before: { html: '视觉工作台', text: '视觉工作台' }, after: { html: '新标题', text: '新标题' } },
      move('ed_gone0001', 'gone'),
      move('ed_move0002', 'hero'),
    ];
    p.pages[1].edits = [move('ed_two00001', 'logo')];
  });
});
