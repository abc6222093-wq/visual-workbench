// 字体库（第 13 轮）：浏览器侧取 GET /api/fonts 里的 fontLibrary（装好的五套常用字体，含别名和每个 face 的地址），
// 交给 createPageFrame 的 fontLibrary 选项；页面没用到的字族由 page-frame.js 的 fontLibraryStyle 自己过滤。取不到就当没有字体库。
let cached = null;
export function loadFontLibrary(fetchImpl = (...args) => fetch(...args)) {
  if (!cached) {
    cached = fetchImpl('/api/fonts', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => (Array.isArray(body?.fontLibrary) ? body.fontLibrary : []))
      .catch(() => []);
  }
  return cached;
}
/** 测试或重新安装字体后清缓存 */
export function resetFontLibrary() { cached = null; }
