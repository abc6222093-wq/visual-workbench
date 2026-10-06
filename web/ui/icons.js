/*
 * 统一线性图标（来自 Lucide，ISC 许可，见 web/vendor/LICENSE-lucide.txt）。
 * 用法：icon("play")、icon("plus", 16)。线宽统一 1.75，颜色跟随文字颜色（currentColor）。
 */
const PATHS = {
  undo: "<path d=\"M9 14 4 9l5-5\" /> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />",
  redo: "<path d=\"m15 14 5-5-5-5\" /> <path d=\"M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13\" />",
  bookmark: "<path d=\"M12 7v6\" /> <path d=\"M15 10H9\" /> <path d=\"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z\" />",
  history: "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /> <path d=\"M3 3v5h5\" /> <path d=\"M12 7v5l4 2\" />",
  play: "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  plus: "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
  pen: "<path d=\"M12 20h9\" /> <path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" />",
  // 对齐（第 15 轮，Lucide align-*：和 PowerPoint / Keynote 的对齐图标同样的画法）
  alignLeft: "<rect width=\"9\" height=\"6\" x=\"6\" y=\"14\" rx=\"2\" /> <rect width=\"16\" height=\"6\" x=\"6\" y=\"4\" rx=\"2\" /> <path d=\"M2 2v20\" />",
  alignCenterX: "<path d=\"M12 2v20\" /> <path d=\"M8 10H4a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h4\" /> <path d=\"M16 10h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4\" /> <path d=\"M8 20H7a2 2 0 0 1-2-2v-2c0-1.1.9-2 2-2h1\" /> <path d=\"M16 14h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1\" />",
  alignRight: "<rect width=\"16\" height=\"6\" x=\"2\" y=\"4\" rx=\"2\" /> <rect width=\"9\" height=\"6\" x=\"9\" y=\"14\" rx=\"2\" /> <path d=\"M22 22V2\" />",
  alignTop: "<rect width=\"6\" height=\"16\" x=\"4\" y=\"6\" rx=\"2\" /> <rect width=\"6\" height=\"9\" x=\"14\" y=\"6\" rx=\"2\" /> <path d=\"M22 2H2\" />",
  alignCenterY: "<path d=\"M2 12h20\" /> <path d=\"M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4\" /> <path d=\"M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4\" /> <path d=\"M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1\" /> <path d=\"M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1\" />",
  alignBottom: "<rect width=\"6\" height=\"16\" x=\"4\" y=\"2\" rx=\"2\" /> <rect width=\"6\" height=\"9\" x=\"14\" y=\"9\" rx=\"2\" /> <path d=\"M22 22H2\" />",
  copyPlus: "<line x1=\"15\" x2=\"15\" y1=\"12\" y2=\"18\" /> <line x1=\"12\" x2=\"18\" y1=\"15\" y2=\"15\" /> <rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
  link: "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /> <path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />",
  type: "<path d=\"M12 4v16\" /> <path d=\"M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2\" /> <path d=\"M9 20h6\" />",
  circle: "<circle cx=\"12\" cy=\"12\" r=\"10\" />",
  imagePlus: "<path d=\"M16 5h6\" /> <path d=\"M19 2v6\" /> <path d=\"M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" />",
  layers: "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\" /> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\" /> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\" />",
  images: "<path d=\"m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16\" /> <path d=\"M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2\" /> <circle cx=\"13\" cy=\"7\" r=\"1\" fill=\"currentColor\" /> <rect x=\"8\" y=\"2\" width=\"14\" height=\"14\" rx=\"2\" />",
  grid: "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" /> <rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />",
  library: "<rect width=\"8\" height=\"18\" x=\"3\" y=\"3\" rx=\"1\" /> <path d=\"M7 3v18\" /> <path d=\"M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z\" />",
  copy: "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />",
  trash: "<path d=\"M10 11v6\" /> <path d=\"M14 11v6\" /> <path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\" /> <path d=\"M3 6h18\" /> <path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\" />",
  lock: "<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />",
  x: "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  check: "<path d=\"M20 6 9 17l-5-5\" />",
  chevronLeft: "<path d=\"m15 18-6-6 6-6\" />",
  chevronRight: "<path d=\"m9 18 6-6-6-6\" />",
  arrowLeft: "<path d=\"m12 19-7-7 7-7\" /> <path d=\"M19 12H5\" />",
  image: "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\" /> <circle cx=\"9\" cy=\"9\" r=\"2\" /> <path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\" />",
  shapes: "<path d=\"M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z\" /> <rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\" /> <circle cx=\"17.5\" cy=\"17.5\" r=\"3.5\" />",
  group: "<path d=\"M3 7V5c0-1.1.9-2 2-2h2\" /> <path d=\"M17 3h2c1.1 0 2 .9 2 2v2\" /> <path d=\"M21 17v2c0 1.1-.9 2-2 2h-2\" /> <path d=\"M7 21H5c-1.1 0-2-.9-2-2v-2\" /> <rect width=\"7\" height=\"5\" x=\"7\" y=\"7\" rx=\"1\" /> <rect width=\"7\" height=\"5\" x=\"10\" y=\"12\" rx=\"1\" />",
  chevronDown: "<path d=\"m6 9 6 6 6-6\" />",
  alert: "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <line x1=\"12\" x2=\"12\" y1=\"8\" y2=\"12\" /> <line x1=\"12\" x2=\"12.01\" y1=\"16\" y2=\"16\" />",
  loader: "<path d=\"M21 12a9 9 0 1 1-6.219-8.56\" />",
  maximize: "<path d=\"M8 3H5a2 2 0 0 0-2 2v3\" /> <path d=\"M21 8V5a2 2 0 0 0-2-2h-3\" /> <path d=\"M3 16v3a2 2 0 0 0 2 2h3\" /> <path d=\"M16 21h3a2 2 0 0 0 2-2v-3\" />",
  minimize: "<path d=\"M8 3v3a2 2 0 0 1-2 2H3\" /> <path d=\"M21 8h-3a2 2 0 0 1-2-2V3\" /> <path d=\"M3 16h3a2 2 0 0 1 2 2v3\" /> <path d=\"M16 21v-3a2 2 0 0 1 2-2h3\" />",
  upload: "<path d=\"M12 3v12\" /> <path d=\"m17 8-5-5-5 5\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" />",
};

export function icon(name, size = 18) {
  const body = PATHS[name];
  if (!body) return "";
  return `<svg class="g-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICONS = Object.keys(PATHS);
