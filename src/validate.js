// 项目文件校验（格式 v3）：结构（JSON Schema）+ 语义（编号重复、页面文件、页面标记、修改单、资源引用）。
// 动效的执行另由 check-motion 检查。规则见 docs/format.md §10；命令行入口是 src/cli/validate.js。
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { WEB_DEVICES, projectKind } from '../web/project-kinds.js';
import { editStatus, describeEdit } from '../web/edits-model.js';
import { scanMarks, scanResources, resolvePageRef } from '../web/page-marks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(HERE, '..', 'schema', 'project.schema.json');
export const FORMAT_VERSION = 3;

export const ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON', // 文件不是合法 JSON
  LEGACY_FORMAT: 'LEGACY_FORMAT', // 旧格式（v2 及更早），要先转换
  SCHEMA: 'SCHEMA', // 不符合 schema/project.schema.json
  DUPLICATE_ID: 'DUPLICATE_ID', // 页面 / 素材 / 字体编号重复
  DUPLICATE_EDIT_ID: 'DUPLICATE_EDIT_ID', // 修改单条目编号重复（全项目）
  PAGE_FILE_NAME: 'PAGE_FILE_NAME', // pages[].file 不是 pages/<页面编号>.html
  MISSING_PAGE_FILE: 'MISSING_PAGE_FILE', // 页面文件不存在
  DUPLICATE_MARK_ID: 'DUPLICATE_MARK_ID', // 页面里 data-vw-id 重复
  INVALID_MARK_ID: 'INVALID_MARK_ID', // data-vw-id 格式不对
  INVALID_CAP: 'INVALID_CAP', // data-vw 里有不认识的能力
  STALE_EDIT: 'STALE_EDIT', // 修改单「对不上」：目标编号不存在，或页面没给这种能力
  UNKNOWN_ASSET_REF: 'UNKNOWN_ASSET_REF', // 修改单贴图引用了不存在的素材
  MISSING_PAGE_RESOURCE: 'MISSING_PAGE_RESOURCE', // 页面引用的相对文件不存在（或越出项目文件夹）
  UNREGISTERED_RESOURCE: 'UNREGISTERED_RESOURCE', // assets/ fonts/ 下被页面引用但没登记
  MISSING_ASSET_FILE: 'MISSING_ASSET_FILE', // assets[].file 不存在
  MISSING_FONT_FILE: 'MISSING_FONT_FILE', // fonts[].file 不存在
  UNSAFE_PATH: 'UNSAFE_PATH', // 登记的文件路径含 .. 段
  WEB_PAGE_FIELDS: 'WEB_PAGE_FIELDS', // 网页项目页面缺 device / size，或宽度不对；课件页面不该有
});

/**
 * 页面内容类问题：agent 改页面文件时可能暂时出现，工作台保存修改单 / 整理页面时不因它们拒绝保存
 * （validateProjectData 的 structural 选项跳过这些检查）。
 */
export const CONTENT_CODES = Object.freeze(new Set([
  'MISSING_PAGE_FILE', 'DUPLICATE_MARK_ID', 'INVALID_MARK_ID', 'INVALID_CAP', 'STALE_EDIT',
  'MISSING_PAGE_RESOURCE', 'UNREGISTERED_RESOURCE', 'MISSING_ASSET_FILE', 'MISSING_FONT_FILE',
]));

export const LEGACY_MESSAGE = '旧格式，请先运行 npm run convert 转换';

let compiled = null;
function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, useDefaults: false });
    compiled = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  }
  return compiled;
}

function checkDuplicates(list, kind, code, errors) {
  const seen = new Map();
  for (const { id, path } of list) {
    if (typeof id !== 'string') continue;
    if (seen.has(id)) errors.push({ code, path, message: `${kind}编号重复：${id}（首次出现在 ${seen.get(id)}）` });
    else seen.set(id, path);
  }
}

const isFileAt = abs => { try { return statSync(abs).isFile(); } catch { return false; } };
const hasDotDot = rel => typeof rel === 'string' && rel.split('/').some(s => s === '..' || s === '.');
const decodeRef = rel => { try { return decodeURIComponent(rel); } catch { return rel; } };

/** 读页面文件文本；读不到返回 null。 */
export function readPageHtml(projectDir, page) {
  if (!projectDir || !page || typeof page.file !== 'string' || hasDotDot(page.file)) return null;
  const abs = join(projectDir, page.file);
  if (!isFileAt(abs)) return null;
  try { return readFileSync(abs, 'utf8'); } catch { return null; }
}

/** 是不是旧格式（formatVersion 小于 3 的对象）。 */
export function isLegacyProject(data) {
  return !!data && typeof data === 'object' && typeof data.formatVersion === 'number' && data.formatVersion < FORMAT_VERSION;
}

/**
 * 校验已解析的项目数据。
 * @param {object} data project.json 的内容
 * @param {{projectDir?: string, structural?: boolean}} [opts]
 *   projectDir：给出时检查页面文件、页面标记、修改单、资源引用和登记文件；
 *   structural：只查结构（跳过 CONTENT_CODES 里的页面内容类问题），工作台保存时用。
 * @returns {{ok: boolean, errors: Array<{code: string, path: string, message: string}>, info: object}}
 */
export function validateProjectData(data, opts = {}) {
  const errors = [];
  const info = { staleEdits: [], pages: {} };
  if (isLegacyProject(data)) {
    errors.push({ code: ERROR_CODES.LEGACY_FORMAT, path: '/formatVersion', message: LEGACY_MESSAGE });
    return { ok: false, errors, info };
  }
  const validate = schemaValidator();
  if (!validate(data)) {
    for (const e of validate.errors) {
      if (e.keyword === 'if') continue; // 「if 不成立」是 then 分支错误的重复说明
      errors.push({ code: ERROR_CODES.SCHEMA, path: e.instancePath || '/', message: `${e.message}${e.params && e.params.additionalProperty ? `：${e.params.additionalProperty}` : ''}` });
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors, info };

  const list = v => (Array.isArray(v) ? v : []);
  const assets = list(data.assets), fonts = list(data.fonts), pages = list(data.pages);
  const { projectDir } = opts;
  const content = !!projectDir && !opts.structural;

  // 1. 编号唯一
  checkDuplicates(assets.map((a, i) => ({ id: a?.id, path: `/assets/${i}` })), '素材', ERROR_CODES.DUPLICATE_ID, errors);
  checkDuplicates(fonts.map((f, i) => ({ id: f?.id, path: `/fonts/${i}` })), '字体', ERROR_CODES.DUPLICATE_ID, errors);
  checkDuplicates(pages.map((p, i) => ({ id: p?.id, path: `/pages/${i}` })), '页面', ERROR_CODES.DUPLICATE_ID, errors);
  const allEdits = [];
  pages.forEach((p, pi) => list(p?.edits).forEach((e, ei) => allEdits.push({ id: e?.id, path: `/pages/${pi}/edits/${ei}` })));
  checkDuplicates(allEdits, '修改单条目', ERROR_CODES.DUPLICATE_EDIT_ID, errors);

  // 2. 登记的文件
  assets.forEach((a, i) => { if (hasDotDot(a?.file)) errors.push({ code: ERROR_CODES.UNSAFE_PATH, path: `/assets/${i}/file`, message: `素材路径不能含 . 或 .. 段：${a.file}` }); });
  fonts.forEach((f, i) => { if (hasDotDot(f?.file)) errors.push({ code: ERROR_CODES.UNSAFE_PATH, path: `/fonts/${i}/file`, message: `字体路径不能含 . 或 .. 段：${f.file}` }); });
  if (content) {
    assets.forEach((a, i) => { if (a && typeof a.file === 'string' && !hasDotDot(a.file) && !isFileAt(join(projectDir, a.file))) errors.push({ code: ERROR_CODES.MISSING_ASSET_FILE, path: `/assets/${i}/file`, message: `素材文件不存在：${a.file}` }); });
    fonts.forEach((f, i) => { if (f && typeof f.file === 'string' && !hasDotDot(f.file) && !isFileAt(join(projectDir, f.file))) errors.push({ code: ERROR_CODES.MISSING_FONT_FILE, path: `/fonts/${i}/file`, message: `字体文件不存在：${f.file}` }); });
  }
  const assetIds = new Set(assets.map(a => a?.id));
  const registered = new Set([...assets.map(a => a?.file), ...fonts.map(f => f?.file), ...fonts.map(f => f?.license)].filter(v => typeof v === 'string'));

  // 3. 页面
  const kind = projectKind(data);
  pages.forEach((page, pi) => {
    if (!page || typeof page !== 'object') return;
    const base = `/pages/${pi}`;
    if (typeof page.id === 'string' && typeof page.file === 'string' && page.file !== `pages/${page.id}.html`) {
      errors.push({ code: ERROR_CODES.PAGE_FILE_NAME, path: `${base}/file`, message: `页面文件应为 pages/${page.id}.html，现在是 ${page.file}` });
    }
    // 网页项目字段
    if (kind === 'web') {
      const device = WEB_DEVICES[page.device];
      if (!device || !page.size) errors.push({ code: ERROR_CODES.WEB_PAGE_FIELDS, path: base, message: `网页项目的每一页都要写 device（desktop / mobile）和 size：${page.id}` });
      else if (page.size.width !== device.width) errors.push({ code: ERROR_CODES.WEB_PAGE_FIELDS, path: `${base}/size/width`, message: `${page.id} 的宽度应等于${device.label}宽度 ${device.width}，现在是 ${page.size.width}` });
    } else if (page.device !== undefined || page.size !== undefined) {
      errors.push({ code: ERROR_CODES.WEB_PAGE_FIELDS, path: base, message: `只有网页项目（kind: "web"）的页面才有 device / size：${page.id}` });
    }
    const edits = list(page.edits);
    edits.forEach((e, ei) => {
      if (e?.kind === 'addImage' && e.after && typeof e.after.asset === 'string' && !assetIds.has(e.after.asset)) {
        errors.push({ code: ERROR_CODES.UNKNOWN_ASSET_REF, path: `${base}/edits/${ei}/after/asset`, message: `贴进来的图片「${e.target}」引用了不存在的素材：${e.after.asset}` });
      }
    });
    if (!content) return;
    const html = readPageHtml(projectDir, page);
    if (html === null) {
      if (typeof page.file === 'string') errors.push({ code: ERROR_CODES.MISSING_PAGE_FILE, path: `${base}/file`, message: `页面文件不存在：${page.file}` });
      return;
    }
    // 标记
    const scan = scanMarks(html);
    for (const id of new Set(scan.duplicates)) errors.push({ code: ERROR_CODES.DUPLICATE_MARK_ID, path: `${base}/file`, message: `${page.file} 里 data-vw-id="${id}" 重复（一页内要唯一）` });
    for (const id of scan.invalidIds) errors.push({ code: ERROR_CODES.INVALID_MARK_ID, path: `${base}/file`, message: `${page.file} 里 data-vw-id="${id}" 不合法（字母开头，只含字母、数字、-、_）` });
    for (const { id, cap } of scan.invalidCaps) errors.push({ code: ERROR_CODES.INVALID_CAP, path: `${base}/file`, message: `${page.file} 里「${id}」的 data-vw 有不认识的能力：${cap}（可用 text move resize color background crop）` });
    info.pages[page.id] = { marks: scan.items.length };
    // 修改单对得上
    edits.forEach((e, ei) => {
      if (!e || typeof e !== 'object') return;
      if (editStatus(e, scan.marks, edits) === 'stale') {
        info.staleEdits.push({ pageId: page.id, id: e.id });
        errors.push({ code: ERROR_CODES.STALE_EDIT, path: `${base}/edits/${ei}`, message: `修改单对不上（页面里没有这个编号，或没给这种能力）：${e.id} ${describeEdit(e)}` });
      }
    });
    // 资源引用
    const seen = new Set();
    for (const ref of scanResources(html)) {
      const rel = resolvePageRef(page.file, ref);
      if (rel === null) { errors.push({ code: ERROR_CODES.MISSING_PAGE_RESOURCE, path: `${base}/file`, message: `${page.file} 引用的「${ref}」越出了项目文件夹` }); continue; }
      if (seen.has(rel)) continue;
      seen.add(rel);
      const decoded = decodeRef(rel);
      const exists = isFileAt(join(projectDir, rel)) || isFileAt(join(projectDir, decoded));
      if (!exists) { errors.push({ code: ERROR_CODES.MISSING_PAGE_RESOURCE, path: `${base}/file`, message: `${page.file} 引用的文件不存在：${ref}（${decoded}）` }); continue; }
      if (/^(assets|fonts)\//.test(decoded) && !registered.has(decoded) && !registered.has(rel)) {
        errors.push({ code: ERROR_CODES.UNREGISTERED_RESOURCE, path: `${base}/file`, message: `${page.file} 引用的 ${decoded} 没有登记在 project.json 的 ${decoded.startsWith('fonts/') ? 'fonts' : 'assets'} 里` });
      }
    }
  });

  return { ok: errors.length === 0, errors, info };
}

/** 校验磁盘上的项目：参数可以是项目文件夹，也可以是 project.json 的路径。 */
export function validateProject(target, opts = {}) {
  const abs = resolve(target);
  const isDir = existsSync(abs) && statSync(abs).isDirectory();
  const file = isDir ? join(abs, 'project.json') : abs;
  const projectDir = dirname(file);
  const empty = { staleEdits: [], pages: {} };
  if (!existsSync(file)) return { ok: false, file, projectDir, errors: [{ code: ERROR_CODES.INVALID_JSON, path: '/', message: `找不到项目文件：${file}` }], info: empty };
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, file, projectDir, errors: [{ code: ERROR_CODES.INVALID_JSON, path: '/', message: `不是合法 JSON：${e.message}` }], info: empty }; }
  return { file, projectDir, ...validateProjectData(data, { ...opts, projectDir }) };
}

/** 把校验结果整理成给人看的多行文字。 */
export function formatResult(result) {
  const lines = [];
  const name = result.file || '(内存数据)';
  if (result.ok) lines.push(`✓ 通过  ${name}`);
  else {
    lines.push(`✗ 未通过  ${name}（${result.errors.length} 个问题）`);
    for (const e of result.errors) lines.push(`  [${e.code}] ${e.path}  ${e.message}`);
  }
  return lines.join('\n');
}
