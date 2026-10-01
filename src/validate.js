// 项目文件校验：格式（JSON Schema）+ 语义（编号重复、引用存在、动效目标存在、动效只用相对变化）。
// 用法见 docs/format.md「校验」一章；命令行入口是 src/cli/validate.js。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(HERE, '..', 'schema', 'project.schema.json');

export const ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON', // 文件不是合法 JSON
  SCHEMA: 'SCHEMA', // 不符合 schema/project.schema.json
  DUPLICATE_ID: 'DUPLICATE_ID', // 页面/元素/素材/字体/步骤编号重复
  MISSING_ASSET_FILE: 'MISSING_ASSET_FILE', // assets[].file 在磁盘上不存在
  MISSING_FONT_FILE: 'MISSING_FONT_FILE', // fonts[].file 在磁盘上不存在
  UNKNOWN_ASSET_REF: 'UNKNOWN_ASSET_REF', // 图片元素引用了不存在的素材编号
  UNKNOWN_FONT_REF: 'UNKNOWN_FONT_REF', // 文字元素引用了不存在的字体编号
  UNKNOWN_ANIMATION_TARGET: 'UNKNOWN_ANIMATION_TARGET', // 动效指向的元素不在本页
  RELATIVE_ONLY: 'RELATIVE_ONLY', // 动效用了绝对值（to / 直接数字）描述位置、大小、旋转、透明度或缩放
});

// 这些属性在动效里只能写相对变化：几何类只能 by，scale 只能 times，滤镜只能 by。
const BY_ONLY = ['x', 'y', 'width', 'height', 'rotation', 'opacity'];
const FILTER_KEYS = ['grayscale', 'sepia', 'blur', 'brightness', 'contrast', 'saturate'];

let compiled = null;
function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: false });
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/** 遍历页面里所有元素（含分组里的子元素），回调拿到 (element, jsonPath)。 */
export function walkElements(elements, visit, basePath = '', key = 'elements') {
  if (!Array.isArray(elements)) return;
  elements.forEach((el, i) => {
    if (!el || typeof el !== 'object') return;
    const path = `${basePath}/${key}/${i}`;
    visit(el, path);
    if (Array.isArray(el.children)) walkElements(el.children, visit, path, 'children');
  });
}

function checkDuplicates(list, kind, basePath, errors) {
  const seen = new Map();
  list.forEach(({ id, path }) => {
    if (typeof id !== 'string') return;
    if (seen.has(id)) {
      errors.push({
        code: ERROR_CODES.DUPLICATE_ID,
        path,
        message: `${kind}编号重复：${id}（首次出现在 ${seen.get(id)}）`,
      });
    } else seen.set(id, path);
  });
}

function checkRelativeOnly(change, path, errors) {
  if (!change || typeof change !== 'object') return;
  const bad = [];
  for (const key of BY_ONLY) {
    if (!(key in change)) continue;
    const v = change[key];
    if (typeof v !== 'object' || v === null || !('by' in v) || Object.keys(v).length !== 1) bad.push(key);
  }
  if ('scale' in change) {
    const v = change.scale;
    if (typeof v !== 'object' || v === null || !('times' in v) || Object.keys(v).length !== 1) bad.push('scale');
  }
  if ('filters' in change && change.filters && typeof change.filters === 'object') {
    for (const key of FILTER_KEYS) {
      if (!(key in change.filters)) continue;
      const v = change.filters[key];
      if (typeof v !== 'object' || v === null || !('by' in v) || Object.keys(v).length !== 1) bad.push(`filters.${key}`);
    }
  }
  if (bad.length) {
    errors.push({
      code: ERROR_CODES.RELATIVE_ONLY,
      path: `${path}/change`,
      message: `动效只能写相对变化（几何用 {"by": n}，scale 用 {"times": n}，滤镜用 {"by": n}），这些属性写成了绝对值：${bad.join(', ')}`,
    });
  }
}

/**
 * 校验已解析的项目数据。
 * @param {object} data project.json 的内容
 * @param {{projectDir?: string}} [opts] 给出 projectDir 时会检查素材、字体文件是否存在
 * @returns {{ok: boolean, errors: Array<{code: string, path: string, message: string}>, info: {pendingAssets: string[]}}}
 */
export function validateProjectData(data, opts = {}) {
  const errors = [];
  const info = { pendingAssets: [] };

  const validate = schemaValidator();
  if (!validate(data)) {
    for (const e of validate.errors) {
      errors.push({
        code: ERROR_CODES.SCHEMA,
        path: e.instancePath || '/',
        message: `${e.message}${e.params && e.params.additionalProperty ? `：${e.params.additionalProperty}` : ''}`,
      });
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, errors, info };

  const assets = Array.isArray(data.assets) ? data.assets : [];
  const fonts = Array.isArray(data.fonts) ? data.fonts : [];
  const pages = Array.isArray(data.pages) ? data.pages : [];

  // 1. 编号唯一：素材、字体、页面各自一组；元素、步骤跨全部页面一组
  checkDuplicates(assets.map((a, i) => ({ id: a && a.id, path: `/assets/${i}` })), '素材', '/assets', errors);
  checkDuplicates(fonts.map((f, i) => ({ id: f && f.id, path: `/fonts/${i}` })), '字体', '/fonts', errors);
  checkDuplicates(pages.map((p, i) => ({ id: p && p.id, path: `/pages/${i}` })), '页面', '/pages', errors);
  const allElements = [];
  const allSteps = [];
  pages.forEach((page, pi) => {
    if (!page || typeof page !== 'object') return;
    walkElements(page.elements, (el, path) => allElements.push({ id: el.id, path: `/pages/${pi}${path}`, el }));
    (Array.isArray(page.steps) ? page.steps : []).forEach((s, si) => allSteps.push({ id: s && s.id, path: `/pages/${pi}/steps/${si}` }));
  });
  checkDuplicates(allElements, '元素', '', errors);
  checkDuplicates(allSteps, '步骤', '', errors);

  // 2. 素材 / 字体文件存在
  const assetIds = new Set(assets.map((a) => a && a.id));
  const fontIds = new Set(fonts.map((f) => f && f.id));
  if (opts.projectDir) {
    const fileMissing = (rel) => {
      if (typeof rel !== 'string') return true;
      const abs = join(opts.projectDir, rel);
      return !existsSync(abs) || !statSync(abs).isFile();
    };
    assets.forEach((a, i) => {
      if (a && fileMissing(a.file)) errors.push({ code: ERROR_CODES.MISSING_ASSET_FILE, path: `/assets/${i}/file`, message: `素材文件不存在：${a.file}` });
    });
    fonts.forEach((f, i) => {
      if (f && fileMissing(f.file)) errors.push({ code: ERROR_CODES.MISSING_FONT_FILE, path: `/fonts/${i}/file`, message: `字体文件不存在：${f.file}` });
    });
  }
  assets.forEach((a) => { if (a && a.pendingLayout === true) info.pendingAssets.push(a.id); });

  // 3. 元素引用的素材 / 字体存在
  for (const { el, path } of allElements) {
    if (el.type === 'image' && !assetIds.has(el.asset)) {
      errors.push({ code: ERROR_CODES.UNKNOWN_ASSET_REF, path: `${path}/asset`, message: `图片元素 ${el.id} 引用了不存在的素材：${el.asset}` });
    }
    if (el.type === 'text' && el.font != null && !fontIds.has(el.font)) {
      errors.push({ code: ERROR_CODES.UNKNOWN_FONT_REF, path: `${path}/font`, message: `文字元素 ${el.id} 引用了不存在的字体：${el.font}` });
    }
  }

  // 4. 动效：目标元素在本页存在；只用相对变化
  pages.forEach((page, pi) => {
    if (!page || typeof page !== 'object') return;
    const pageElementIds = new Set();
    walkElements(page.elements, (el) => pageElementIds.add(el.id));
    (Array.isArray(page.steps) ? page.steps : []).forEach((step, si) => {
      (step && Array.isArray(step.tracks) ? step.tracks : []).forEach((track, ti) => {
        const path = `/pages/${pi}/steps/${si}/tracks/${ti}`;
        if (!track || typeof track !== 'object') return;
        if (!pageElementIds.has(track.target)) {
          errors.push({ code: ERROR_CODES.UNKNOWN_ANIMATION_TARGET, path: `${path}/target`, message: `动效指向的元素不在本页：${track.target}` });
        }
        checkRelativeOnly(track.change, path, errors);
      });
    });
  });

  return { ok: errors.length === 0, errors, info };
}

/**
 * 校验磁盘上的项目：参数可以是项目文件夹，也可以是 project.json 的路径。
 */
export function validateProject(target) {
  const abs = resolve(target);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  const file = isDir ? join(abs, 'project.json') : abs;
  const projectDir = dirname(file);
  if (!existsSync(file)) {
    return { ok: false, file, projectDir, errors: [{ code: ERROR_CODES.INVALID_JSON, path: '/', message: `找不到项目文件：${file}` }], info: { pendingAssets: [] } };
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, file, projectDir, errors: [{ code: ERROR_CODES.INVALID_JSON, path: '/', message: `不是合法 JSON：${e.message}` }], info: { pendingAssets: [] } };
  }
  const result = validateProjectData(data, { projectDir });
  return { file, projectDir, ...result };
}

/** 把校验结果整理成给人看的多行文字。 */
export function formatResult(result) {
  const lines = [];
  const name = result.file || '(内存数据)';
  if (result.ok) {
    lines.push(`✓ 通过  ${name}`);
  } else {
    lines.push(`✗ 未通过  ${name}（${result.errors.length} 个问题）`);
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.path}  ${e.message}`);
  }
  if (result.info && result.info.pendingAssets.length) {
    lines.push(`  待排版素材：${result.info.pendingAssets.join(', ')}`);
  }
  return lines.join('\n');
}
