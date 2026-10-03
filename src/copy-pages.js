// 把项目里的若干页复制成一个新项目：只带走这些页用到的素材和字体，源项目不会被修改。
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT_LAYOUT, initProjectDir } from './data-dir.js';
import { formatResult, validateProject, walkElements } from './validate.js';

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** 把 "1,3" 或 "1-2,3" 解析成页码数组（1 开始，保持写的顺序）。 */
export function parsePageList(str) {
  if (typeof str !== 'string' || !str.trim()) throw new Error('页码不能为空，例如 1,3 或 1-2,3');
  const out = [];
  for (const raw of str.split(',')) {
    const part = raw.trim();
    let m;
    if ((m = /^(\d+)$/.exec(part))) {
      out.push(Number(m[1]));
    } else if ((m = /^(\d+)-(\d+)$/.exec(part))) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > b) throw new Error(`页码范围写反了：${part}`);
      for (let i = a; i <= b; i++) out.push(i);
    } else {
      throw new Error(`无法识别的页码：“${part}”，请写成 1,3 或 1-2,3`);
    }
  }
  return out;
}

function isFile(abs) {
  return existsSync(abs) && statSync(abs).isFile();
}

/**
 * 复制若干页到新项目。
 * @returns {{destProjectDir: string, project: object, copiedAssets: string[], copiedFonts: string[]}}
 */
export function copyPages({ srcProjectDir, pages, destProjectDir, newId, newName, now = new Date() }) {
  const srcFile = join(srcProjectDir, PROJECT_LAYOUT.file);
  if (!existsSync(srcFile)) throw new Error(`找不到源项目文件：${srcFile}`);
  const src = JSON.parse(readFileSync(srcFile, 'utf8'));

  if (typeof newId !== 'string' || !PROJECT_ID_RE.test(newId)) {
    throw new Error(`新项目编号不合法：“${newId}”（只能用小写字母、数字、连字符，2–64 位，且不能以连字符开头）`);
  }
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('至少要选一页');
  const seen = new Set();
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > src.pages.length) {
      throw new Error(`页码越界：${p}（源项目共 ${src.pages.length} 页，页码从 1 开始）`);
    }
    if (seen.has(p)) throw new Error(`页码重复：${p}`);
    seen.add(p);
  }
  if (existsSync(destProjectDir)) throw new Error(`目标项目已存在，不会覆盖：${destProjectDir}`);

  // 深拷贝选中的页（编号保持不变）
  const selectedPages = pages.map((p) => structuredClone(src.pages[p - 1]));

  // 收集被用到的素材、字体编号（含分组子元素）
  const usedAssets = new Set();
  const usedFonts = new Set();
  for (const page of selectedPages) {
    for (const image of [...(page.outline?.images || []), ...(page.outline?.baseline?.images || [])]) usedAssets.add(image.asset);
    walkElements(page.elements, (el) => {
      if (el.type === 'image' && el.asset != null) usedAssets.add(el.asset);
      if (el.type === 'text' && el.font != null) usedFonts.add(el.font);
    });
  }

  const newAssets = (src.assets || [])
    .filter((a) => usedAssets.has(a.id))
    .map((a) => ({ ...structuredClone(a), source: { type: 'copied-from-project', from: `${src.id}/${a.id}` } }));
  const newFonts = (src.fonts || []).filter((f) => usedFonts.has(f.id)).map((f) => structuredClone(f));

  const iso = now.toISOString();
  const project = {
    format: src.format,
    formatVersion: src.formatVersion,
    id: newId,
    name: newName ?? `${src.name}（副本）`,
    ...(src.description !== undefined ? { description: src.description } : {}),
    createdAt: iso,
    updatedAt: iso,
    artboard: structuredClone(src.artboard),
    assets: newAssets,
    fonts: newFonts,
    pages: selectedPages,
  };

  mkdirSync(dirname(destProjectDir), { recursive: true });
  try {
    mkdirSync(destProjectDir);
    initProjectDir(destProjectDir);

    const copiedAssets = [];
    for (const a of newAssets) {
      const from = join(srcProjectDir, a.file);
      if (!isFile(from)) throw new Error(`源项目的素材文件不存在：${a.file}`);
      cpSync(from, join(destProjectDir, a.file));
      copiedAssets.push(a.id);
    }
    const copiedFonts = [];
    for (const f of newFonts) {
      const from = join(srcProjectDir, f.file);
      if (!isFile(from)) throw new Error(`源项目的字体文件不存在：${f.file}`);
      cpSync(from, join(destProjectDir, f.file));
      // 许可证若是 fonts/ 下的文件，一并带走
      if (typeof f.license === 'string' && /^fonts\/[^/\\]+$/.test(f.license) && isFile(join(srcProjectDir, f.license))) {
        cpSync(join(srcProjectDir, f.license), join(destProjectDir, f.license));
      }
      copiedFonts.push(f.id);
    }

    writeFileSync(join(destProjectDir, PROJECT_LAYOUT.file), JSON.stringify(project, null, 2) + '\n');

    const result = validateProject(destProjectDir);
    if (!result.ok) throw new Error(`新项目校验未通过：\n${formatResult(result)}`);

    return { destProjectDir, project, copiedAssets, copiedFonts };
  } catch (e) {
    rmSync(destProjectDir, { recursive: true, force: true });
    throw e;
  }
}
