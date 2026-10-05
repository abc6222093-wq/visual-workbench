// 本地常用字体库（第 13 轮，D 组实现；这是主智能体留的桩，接口见 docs/round13-contract.md §9）。
// readFontLibrary(dataDir) → { dir, families: [] }；fontLibraryFor(dataDir, project, pagesHtml) → createPageFrame 的 fontLibrary 数组；
// fontsApi(dataDir) → GET /api/fonts 的响应体；matchFamily(name) → 字族 key 或 null。
export function readFontLibrary() { return { dir: '', families: [] }; }
export function fontLibraryFor() { return []; }
export function fontsApi(dataDir) { return { dir: `${dataDir}/library/fonts`, families: [] }; }
export function matchFamily() { return null; }
