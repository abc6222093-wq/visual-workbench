// 批注截图（第 15 轮）：把有批注的页截一张图（动效播完的最后一帧、叠了修改单），再把批注画上去，
// 写到项目目录 annotations/<页面编号>.png，让 agent 先看图再按编号对照文字改。可再生成，不进版本存档。
// 编号 = 这一页 annotations 里的顺序（从 1 起），和 brief / npm run annotations 里的「截图编号」一致。
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { captureProject } from './export/images.js';
import { SHOTS_DIR, shotRelPath, isStrokeAnnotation } from './annotations.js';

const colorOk = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#e5484d');

// 箭头三角，和 web/annotations.js 的 arrowHead 一致（这里不引入浏览器模块）
function arrowHead(points, width) {
  if (!points || points.length < 2) return null;
  const [ex, ey] = points[points.length - 1], size = Math.max(14, width * 4);
  let k = points.length - 2;
  while (k > 0 && Math.hypot(ex - points[k][0], ey - points[k][1]) < size) k--;
  const [sx, sy] = points[k], len = Math.hypot(ex - sx, ey - sy);
  if (len < 1) return null;
  const ux = (ex - sx) / len, uy = (ey - sy) / len, bx = ex - ux * size, by = ey - uy * size, h = size * 0.55;
  return [[ex + ux * width * 0.5, ey + uy * width * 0.5], [bx - uy * h, by + ux * h], [bx + uy * h, by - ux * h]];
}
function badge(n, x, y, color, W, H) {
  const r = 13, cx = Math.min(Math.max(x, r + 2), W - r - 2), cy = Math.min(Math.max(y, r + 2), H - r - 2);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2.5"/><text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="700" fill="#fff">${n}</text>`;
}

/** 一页批注的叠加层 SVG（页面 CSS 像素 × scale）。 */
export function annotationOverlaySvg(annotations, width, height, scale = 1) {
  const parts = [];
  annotations.forEach((a, i) => {
    const n = i + 1;
    if (isStrokeAnnotation(a)) {
      const pts = (a.points || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (pts.length < 2) return;
      const c = colorOk(a.color), w = Math.max(6, Number(a.width) || 0); // 截图里线稍粗一点，缩小看也清楚
      parts.push(`<path d="${pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="${w + 4}" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path d="${pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`);
      const head = a.arrow ? arrowHead(pts, w) : null;
      if (head) parts.push(`<polygon points="${head.map((p) => p.join(',')).join(' ')}" fill="${c}" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>`);
      parts.push(badge(n, pts[0][0], pts[0][1], c, width / scale, height / scale));
    } else {
      parts.push(`<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="4" fill="rgba(255,214,10,.18)" stroke="rgba(230,170,0,.95)" stroke-width="3"/>`);
      parts.push(badge(n, a.x, a.y, '#e6a700', width / scale, height / scale));
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width / scale} ${height / scale}">${parts.join('')}</svg>`;
}

/**
 * 给有批注的页生成批注截图。
 * @param {{ projectDir: string, pageIds?: string[]|null, signal?: AbortSignal }} opts
 * @returns {Promise<Record<string, string>>} { [pageId]: 'annotations/<页面编号>.png' }（相对项目目录）
 * 没有批注的页（在 pageIds 范围内）如有旧截图就删掉；没有要截的页不启动浏览器。
 */
export async function renderAnnotationShots({ projectDir, pageIds = null, signal } = {}) {
  projectDir = resolve(projectDir);
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const pages = (project.pages || []).filter((p) => !pageIds || pageIds.includes(p.id));
  const dir = join(projectDir, SHOTS_DIR);
  const want = pages.filter((p) => Array.isArray(p.annotations) && p.annotations.length);
  for (const p of pages) if (!want.includes(p)) rmSync(join(projectDir, shotRelPath(p.id)), { force: true });
  // 已经不在项目里的页留下的旧图也清掉（只在处理全部页时）
  if (!pageIds && existsSync(dir)) {
    const ids = new Set((project.pages || []).map((p) => `${p.id}.png`));
    for (const f of readdirSync(dir)) if (f.endsWith('.png') && !ids.has(f)) rmSync(join(dir, f), { force: true });
  }
  const out = {};
  if (!want.length) return out;
  mkdirSync(dir, { recursive: true });
  const byId = new Map(want.map((p) => [p.id, p]));
  await captureProject({
    projectDir, type: 'png', scale: 1, signal, pageIds: want.map((p) => p.id),
    onShot: async (_index, page, buffer) => {
      const anns = byId.get(page.id)?.annotations || [];
      const meta = await sharp(buffer).metadata();
      const svg = annotationOverlaySvg(anns, meta.width, meta.height, 1);
      const png = await sharp(buffer).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
      writeFileSync(join(projectDir, shotRelPath(page.id)), png);
      out[page.id] = shotRelPath(page.id);
    },
  });
  return out;
}
