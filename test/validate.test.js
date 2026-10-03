import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateProject,
  validateProjectData,
  ERROR_CODES,
  formatResult,
  walkElements,
} from '../src/validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_DIR = join(ROOT, 'examples', 'sample-deck');
const NOT_JSON = join(ROOT, 'test', 'fixtures', 'not-json.json');

const loadSample = () => JSON.parse(readFileSync(join(SAMPLE_DIR, 'project.json'), 'utf8'));
const check = (data) => validateProjectData(data, { projectDir: SAMPLE_DIR });
const codesOf = (result) => result.errors.map((e) => e.code);

/** 在示例里按编号找元素 */
function findElement(data, id) {
  let found = null;
  for (const page of data.pages) walkElements(page.elements, (el) => { if (el.id === id) found = el; });
  assert.ok(found, `示例里应有元素 ${id}`);
  return found;
}

/** 断言改坏后的数据校验失败且含指定错误码 */
function assertFails(bad, code) {
  const result = check(bad);
  assert.equal(result.ok, false, `应当校验失败（${code}）`);
  assert.ok(codesOf(result).includes(code), `应含 ${code}，实际：${JSON.stringify(codesOf(result))}`);
}

test('示例 sample-deck 通过校验，并列出待排版素材 asset_newpic1', () => {
  const result = validateProject(SAMPLE_DIR);
  assert.equal(result.ok, true, formatResult(result));
  assert.deepEqual(result.errors, []);
  assert.ok(result.info.pendingAssets.includes('asset_newpic1'));
});

test('formatResult：通过的结果以 ✓ 开头，未通过的以 ✗ 开头并带错误码', () => {
  assert.match(formatResult(validateProject(SAMPLE_DIR)), /^✓ 通过/);
  const text = formatResult(validateProject(NOT_JSON));
  assert.match(text, /^✗ 未通过/);
  assert.match(text, /\[INVALID_JSON\]/);
});

test('格式校验的错误码', () => {
  assert.deepEqual(Object.keys(ERROR_CODES).sort(), [
    'DUPLICATE_ID', 'INVALID_JSON', 'MISSING_ASSET_FILE', 'MISSING_FONT_FILE',
    'SCHEMA', 'TINT_NEEDS_ALPHA', 'UNKNOWN_ASSET_REF', 'UNKNOWN_FONT_REF',
  ]);
});

test('INVALID_JSON：文件内容不是合法 JSON', () => {
  const result = validateProject(NOT_JSON);
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR_CODES.INVALID_JSON));
});

test('INVALID_JSON：找不到项目文件也算失败', () => {
  const result = validateProject(join(ROOT, 'test', 'fixtures', 'no-such-folder'));
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes(ERROR_CODES.INVALID_JSON));
});

test('SCHEMA：缺少必填字段 / 画板宽度为负数', () => {
  const noName = loadSample();
  delete noName.name;
  assertFails(noName, ERROR_CODES.SCHEMA);

  const badWidth = loadSample();
  badWidth.artboard.width = -1;
  assertFails(badWidth, ERROR_CODES.SCHEMA);
});

test('DUPLICATE_ID：两个页面用了同一个编号', () => {
  const bad = loadSample();
  bad.pages[1].id = bad.pages[0].id;
  assertFails(bad, ERROR_CODES.DUPLICATE_ID);
});

test('DUPLICATE_ID：不同页面的元素用了同一个编号', () => {
  const bad = loadSample();
  findElement(bad, 'el_marker2').id = 'el_title1';
  assertFails(bad, ERROR_CODES.DUPLICATE_ID);
});

test('MISSING_ASSET_FILE：素材文件在磁盘上不存在', () => {
  const bad = loadSample();
  bad.assets[0].file = 'assets/does-not-exist.png';
  assertFails(bad, ERROR_CODES.MISSING_ASSET_FILE);
});

test('MISSING_FONT_FILE：字体文件在磁盘上不存在', () => {
  const bad = loadSample();
  bad.fonts[0].file = 'fonts/does-not-exist.ttf';
  assertFails(bad, ERROR_CODES.MISSING_FONT_FILE);
});

test('UNKNOWN_ASSET_REF：图片元素引用了不存在的素材', () => {
  const bad = loadSample();
  findElement(bad, 'el_logo1').asset = 'asset_nope';
  assertFails(bad, ERROR_CODES.UNKNOWN_ASSET_REF);
});

test('UNKNOWN_FONT_REF：文字元素引用了不存在的字体', () => {
  const bad = loadSample();
  findElement(bad, 'el_title1').font = 'font_nope';
  assertFails(bad, ERROR_CODES.UNKNOWN_FONT_REF);
});

test('新动效格式允许每页内嵌任意模块代码，不限制效果种类', () => {
  const data = loadSample();
  data.pages[0].motion = {
    steps: 2,
    source: 'export default async function(ctx) { return { async step(index) { if (index === 0) await ctx.timer(1); } }; }',
  };
  assert.equal(check(data).ok, true, formatResult(check(data)));
});

test('旧 page.steps 和固定轨道写法不再接受', () => {
  const bad = loadSample();
  delete bad.pages[0].motion;
  bad.pages[0].steps = [{ id: 'step_old1', trigger: 'click', tracks: [] }];
  assertFails(bad, ERROR_CODES.SCHEMA);
});

test('动效 steps 必须是非负整数且 source 不能为空', () => {
  for (const value of [-1, 1.5, '2']) {
    const bad = loadSample();
    bad.pages[0].motion = { steps: value, source: 'export default () => ({})' };
    assertFails(bad, ERROR_CODES.SCHEMA);
  }
  const empty = loadSample();
  empty.pages[0].motion = { steps: 0, source: '' };
  assertFails(empty, ERROR_CODES.SCHEMA);
});

test('位置和外观修改后，内嵌动效源码保持原样', () => {
  const original = loadSample();
  const edited = structuredClone(original);
  const marker = findElement(edited, 'el_marker2');
  marker.x = 300;
  marker.y = 300;
  marker.width += 30;
  findElement(edited, 'el_title1').color = '#ef4444';
  const result = check(edited);
  assert.equal(result.ok, true, formatResult(result));
  assert.deepEqual(edited.pages.map((p) => p.motion), original.pages.map((p) => p.motion));
});

test('命令行：无参数校验 examples/，退出码 0 且输出含 ✓', () => {
  const r = spawnSync(process.execPath, ['src/cli/validate.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓/);
  assert.match(r.stdout, /共 1 个项目，通过 1，未通过 0/);
});

test('命令行：传入文件夹或 project.json 路径都能校验', () => {
  for (const target of ['examples/sample-deck', 'examples/sample-deck/project.json']) {
    const r = spawnSync(process.execPath, ['src/cli/validate.js', target], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /✓/);
  }
});

test('命令行：传入坏 JSON 时退出码 1 且输出含 ✗', () => {
  const r = spawnSync(process.execPath, ['src/cli/validate.js', 'test/fixtures/not-json.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗/);
  assert.match(r.stdout, /共 1 个项目，通过 0，未通过 1/);
});
