// 项目文件校验：格式（JSON Schema）+ 语义（编号重复、素材与字体引用存在）。动效代码的执行另由 check-motion 检查。
// 用法见 docs/format.md「校验」一章；命令行入口是 src/cli/validate.js。
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(HERE, '..', 'schema', 'project.schema.json');

export const ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON', // 文件不是合法 JSON
  SCHEMA: 'SCHEMA', // 不符合 schema/project.schema.json
  DUPLICATE_ID: 'DUPLICATE_ID', // 页面/元素/素材/字体编号重复
  MISSING_ASSET_FILE: 'MISSING_ASSET_FILE', // assets[].file 在磁盘上不存在
  MISSING_FONT_FILE: 'MISSING_FONT_FILE', // fonts[].file 在磁盘上不存在
  UNKNOWN_ASSET_REF: 'UNKNOWN_ASSET_REF', // 图片元素引用了不存在的素材编号
  UNKNOWN_FONT_REF: 'UNKNOWN_FONT_REF', // 文字元素引用了不存在的字体编号
  TINT_NEEDS_ALPHA: 'TINT_NEEDS_ALPHA', // 图片元素设了 tint（重新着色），但素材是没有透明度的 JPEG
});

/** 素材是不是 JPEG：先看扩展名，给了项目文件夹时再看文件开头（FF D8 FF）。JPEG 没有透明度，不能重新着色。 */
function isJpegAsset(asset, projectDir) {
  if (!asset || typeof asset.file !== 'string') return false;
  if (/\.jpe?g$/i.test(asset.file)) return true;
  if (!projectDir) return false;
  const abs = join(projectDir, asset.file);
  let fd;
  try {
    if (!statSync(abs).isFile()) return false;
    fd = openSync(abs, 'r');
    const head = Buffer.alloc(3);
    return readSync(fd, head, 0, 3, 0) === 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}

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

  // 1. 编号唯一：素材、字体、页面各自一组；元素跨全部页面一组
  checkDuplicates(assets.map((a, i) => ({ id: a && a.id, path: `/assets/${i}` })), '素材', '/assets', errors);
  checkDuplicates(fonts.map((f, i) => ({ id: f && f.id, path: `/fonts/${i}` })), '字体', '/fonts', errors);
  checkDuplicates(pages.map((p, i) => ({ id: p && p.id, path: `/pages/${i}` })), '页面', '/pages', errors);
  const allElements = [];
  pages.forEach((page, pi) => {
    if (!page || typeof page !== 'object') return;
    walkElements(page.elements, (el, path) => allElements.push({ id: el.id, path: `/pages/${pi}${path}`, el }));
  });
  checkDuplicates(allElements, '元素', '', errors);

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

  // 3. 元素引用的素材 / 字体存在；重新着色的图片必须有透明度
  const assetById = new Map(assets.filter((a) => a && typeof a.id === 'string').map((a) => [a.id, a]));
  for (const { el, path } of allElements) {
    if (el.type === 'image' && typeof el.tint === 'string' && isJpegAsset(assetById.get(el.asset), opts.projectDir)) {
      errors.push({ code: ERROR_CODES.TINT_NEEDS_ALPHA, path: `${path}/tint`, message: `图片元素 ${el.id} 设了重新着色（tint），但素材 ${assetById.get(el.asset).file} 是 JPEG，没有透明部分，整块会变成纯色。请换成单色的 SVG 或透明底 PNG，或去掉 tint` });
    }
    if (el.type === 'image' && !assetIds.has(el.asset)) {
      errors.push({ code: ERROR_CODES.UNKNOWN_ASSET_REF, path: `${path}/asset`, message: `图片元素 ${el.id} 引用了不存在的素材：${el.asset}` });
    }
    if (el.type === 'text' && el.font != null && !fontIds.has(el.font)) {
      errors.push({ code: ERROR_CODES.UNKNOWN_FONT_REF, path: `${path}/font`, message: `文字元素 ${el.id} 引用了不存在的字体：${el.font}` });
    }
  }

  pages.forEach((page, pi) => {
    const outline = page?.outline;
    if (!outline) return;
    const checkItems = (items, screens, base) => {
      if (!Array.isArray(items)) return;
      checkDuplicates(items.map((r,i)=>({id:r?.id,path:`${base}/${i}`})), '大纲', base, errors);
      items.forEach((r,i)=>{
        if (!r) return;
        const path=`${base}/${i}`;
        const range = value => { if (value && (value.from > screens || (value.until != null && (value.until <= value.from || value.until > screens + 1)) || value.visibleOn?.some(n=>n>screens) || (value.visibleOn && new Set(value.visibleOn).size!==value.visibleOn.length))) errors.push({code:'OUTLINE_RANGE',path,message:'大纲画面范围无效'}); };
        range(r); range(r.baseline);
        for(const value of [r,r.baseline]) if(value?.emphasis?.some(e=>e.start>=e.end||e.end>value.text.length)) errors.push({code:'OUTLINE_EMPHASIS',path,message:'强调范围超出文字'});
        for(const value of [r,r.baseline]) if(value?.asset && !assetIds.has(value.asset)) errors.push({code:ERROR_CODES.UNKNOWN_ASSET_REF,path,message:`大纲素材不存在：${value.asset}`});
      });
    };
    const mapped=[...(outline.rows||[]),...(outline.images||[])].filter(r=>r?.elementId);
    checkDuplicates(mapped.map(r=>({id:r.elementId,path:`/pages/${pi}/outline`})), '大纲映射', '', errors);
    checkItems(outline.rows,outline.screens,`/pages/${pi}/outline/rows`);
    checkItems(outline.images,outline.screens,`/pages/${pi}/outline/images`);
    if(outline.baseline){checkItems(outline.baseline.rows,outline.baseline.screens,`/pages/${pi}/outline/baseline/rows`);checkItems(outline.baseline.images,outline.baseline.screens,`/pages/${pi}/outline/baseline/images`);}
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
