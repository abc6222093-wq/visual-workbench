// 第 13 轮：npm run organize（list / begin / folder / move / rename / restore）与 npm run annotations（列出 / 清除，清除前自动存版）。
// 只用临时数据目录（VW_DATA_DIR）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs as parseOrganize } from '../src/cli/organize.js';
import { parseArgs as parseAnnotations } from '../src/cli/annotations.js';
import { listAnnotations, clearAnnotations } from '../src/annotations.js';
import { listVersions } from '../src/version.js';
import { validateProject, formatResult } from '../src/validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args, dataDir) => spawnSync(process.execPath, [join(ROOT, 'src/cli', script), ...args], { encoding: 'utf8', env: { ...process.env, VW_DATA_DIR: dataDir, HOME: join(dataDir, 'home'), USERPROFILE: join(dataDir, 'home') } });
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function makeProject(dataDir, id, extra = {}) {
  const dir = join(dataDir, 'projects', id);
  mkdirSync(join(dir, 'pages'), { recursive: true });
  for (const sub of ['assets', 'fonts', 'versions']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'pages/page_one.html'), '<!doctype html><html><body><p data-vw-id="t" data-vw="text">一</p></body></html>\n');
  writeFileSync(join(dir, 'pages/page_two.html'), '<!doctype html><html><body></body></html>\n');
  const now = '2026-10-01T12:00:00.000Z';
  const project = { format: 'visual-workbench/project', formatVersion: 3, id, name: `项目 ${id}`, createdAt: now, updatedAt: now,
    artboard: { preset: 'slide-16x9', width: 1920, height: 1080 }, assets: [], fonts: [],
    pages: [{ id: 'page_one', name: '一', file: 'pages/page_one.html', edits: [] }, { id: 'page_two', name: '二', file: 'pages/page_two.html', edits: [] }], ...extra };
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return dir;
}
function withData(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-r13c-'));
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test('organize：参数检查', () => {
  assert.deepEqual(parseOrganize(['move', 'aa', '/']), { command: 'move', args: ['aa', '/'] });
  for (const bad of [[], ['bogus'], ['move', 'aa'], ['rename', 'aa'], ['folder'], ['list', 'x']]) assert.throws(() => parseOrganize(bad), bad.join(' '));
  withData((dataDir) => {
    const r = run('organize.js', ['bogus'], dataDir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /用法/);
  });
});

test('organize：第一次整理自动 begin，move / rename / folder 改 project.json，restore 恢复并删掉备份', () => {
  withData((dataDir) => {
    makeProject(dataDir, 'aa'); makeProject(dataDir, 'bb', { folder: '旧的' });
    writeFileSync(join(dataDir, 'workbench-state.json'), JSON.stringify({ masters: ['aa'], folders: ['旧的'] }));
    const list = run('organize.js', ['list'], dataDir);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /旧的（1 个项目）/);
    assert.match(list.stdout, /aa {2}「项目 aa」/);
    assert.match(list.stdout, /还没有记录整理前的原状/);

    const mv = run('organize.js', ['move', 'aa', '2026 课件'], dataDir);
    assert.equal(mv.status, 0, mv.stderr);
    assert.match(mv.stdout, /先记录了整理前的原状/);
    assert.match(mv.stdout, /移进文件夹「2026 课件」/);
    assert.ok(existsSync(join(dataDir, 'organize-backup.json')));
    const aa = readJson(join(dataDir, 'projects/aa/project.json'));
    assert.equal(aa.folder, '2026 课件');
    assert.notEqual(aa.updatedAt, '2026-10-01T12:00:00.000Z');
    const state = readJson(join(dataDir, 'workbench-state.json'));
    assert.deepEqual(state.folders, ['旧的', '2026 课件']);
    assert.deepEqual(state.masters, ['aa'], '其他字段保留');

    const rn = run('organize.js', ['rename', 'bb', '2026-10-05 课表'], dataDir);
    assert.equal(rn.status, 0, rn.stderr);
    assert.doesNotMatch(rn.stdout, /先记录了/, '已有备份时不再自动 begin');
    assert.equal(readJson(join(dataDir, 'projects/bb/project.json')).name, '2026-10-05 课表');
    assert.match(run('organize.js', ['move', 'bb', '/'], dataDir).stdout, /移出文件夹/);
    assert.equal('folder' in readJson(join(dataDir, 'projects/bb/project.json')), false);
    assert.match(run('organize.js', ['folder', '空文件夹'], dataDir).stdout, /已新建文件夹「空文件夹」/);
    assert.match(run('organize.js', ['folder', '空文件夹'], dataDir).stdout, /已经有了/);
    assert.equal(run('organize.js', ['folder', 'a/b'], dataDir).status, 1);
    assert.equal(run('organize.js', ['move', 'nope', 'x'], dataDir).status, 1);
    assert.equal(validateProject(join(dataDir, 'projects/aa')).ok, true);
    assert.match(run('organize.js', ['list'], dataDir).stdout, /已记录整理前的原状/);

    const back = run('organize.js', ['restore'], dataDir);
    assert.equal(back.status, 0, back.stderr);
    assert.match(back.stdout, /恢复了 2 个项目/);
    assert.equal('folder' in readJson(join(dataDir, 'projects/aa/project.json')), false);
    const bb = readJson(join(dataDir, 'projects/bb/project.json'));
    assert.equal(bb.name, '项目 bb'); assert.equal(bb.folder, '旧的');
    assert.deepEqual(readJson(join(dataDir, 'workbench-state.json')).folders, ['旧的']);
    assert.equal(existsSync(join(dataDir, 'organize-backup.json')), false);
    const again = run('organize.js', ['restore'], dataDir);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /没有整理前的备份/);

    // begin 覆盖旧备份
    assert.match(run('organize.js', ['begin'], dataDir).stdout, /已记录整理前的原状：2 个项目、1 个文件夹/);
  });
});

const ann = (id, text) => ({ id, x: 1, y: 2, width: 30, height: 40, text, at: '2026-10-06T00:00:00.000Z' });

test('annotations：列出（按页、--json）、--clear 先存版、只删指定 / 整页 / 全项目、只改 annotations', () => {
  withData((dataDir) => {
    const dir = makeProject(dataDir, 'cc');
    const p = readJson(join(dir, 'project.json'));
    p.pages[0].annotations = [ann('an_aaaa0001', '这里加一个字'), ann('an_aaaa0002', '这段太挤')];
    p.pages[1].annotations = [ann('an_bbbb0001', '换张图')];
    p.pages[0].edits = [{ id: 'ed_text0001', target: 't', kind: 'text', before: { html: '一', text: '一' }, after: { html: '二', text: '二' } }];
    writeFileSync(join(dir, 'project.json'), JSON.stringify(p, null, 2));
    { const r = validateProject(dir); assert.equal(r.ok, true, formatResult(r)); }

    assert.deepEqual(parseAnnotations(['cc', '--page', 'page_one', '--clear', 'an_1']), { positional: ['cc', 'an_1'], page: 'page_one', json: false, clear: true });
    assert.throws(() => parseAnnotations(['cc', 'x']));
    assert.throws(() => parseAnnotations([]));
    assert.equal(run('annotations.js', ['cc', '--bogus'], dataDir).status, 2);

    const out = run('annotations.js', ['cc'], dataDir);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /第 1 页「一」（page_one）：2 条批注/);
    assert.match(out.stdout, /an_aaaa0001 「这里加一个字」（位置 1, 2, 宽 30, 高 40）/);
    assert.match(out.stdout, /共 3 条批注/);
    const json = JSON.parse(run('annotations.js', ['cc', '--json', '--page', 'page_two'], dataDir).stdout);
    assert.deepEqual(json[0].annotations.map((a) => a.id), ['an_bbbb0001']);
    assert.equal(listAnnotations(dir, { page: 'page_one' })[0].annotations.length, 2);
    assert.throws(() => listAnnotations(dir, { page: 'page_none' }));

    const one = run('annotations.js', ['cc', '--clear', 'an_aaaa0002'], dataDir);
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /已存版本/);
    assert.match(one.stdout, /已清除 1 条批注：an_aaaa0002/);
    assert.equal(listVersions(dir).length, 1);
    let now = readJson(join(dir, 'project.json'));
    assert.deepEqual(now.pages[0].annotations.map((a) => a.id), ['an_aaaa0001']);
    assert.equal(now.pages[0].edits.length, 1, '修改单不动');
    assert.equal(run('annotations.js', ['cc', '--clear', '--page', 'page_two', 'an_aaaa0001'], dataDir).status, 1);

    const page = run('annotations.js', ['cc', '--clear', '--page', 'page_two'], dataDir);
    assert.match(page.stdout, /已清除 1 条批注：an_bbbb0001/);
    now = readJson(join(dir, 'project.json'));
    assert.equal(now.pages[1].annotations, undefined);
    assert.equal(now.pages[0].annotations.length, 1);
    assert.match(run('annotations.js', ['cc', '--clear'], dataDir).stdout, /已清除 1 条批注/);
    assert.match(run('annotations.js', ['cc', '--clear'], dataDir).stdout, /没有要清除的批注/);
    assert.equal(listVersions(dir).length, 3);
    assert.deepEqual(clearAnnotations(dir), { removed: [], versionDir: null });
    { const r = validateProject(dir); assert.equal(r.ok, true, formatResult(r)); }
  });
});
