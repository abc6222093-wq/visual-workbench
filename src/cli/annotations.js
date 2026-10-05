#!/usr/bin/env node
// 批注：npm run annotations -- <项目编号或路径> [--page <页面编号>] [--json]
//       npm run annotations -- <项目编号或路径> [--page <页面编号>] --clear [<批注编号>…]
// 清除前自动存版「清除批注前自动存版」，只改 pages[].annotations；不给编号 = 清整页（给了 --page）或整个项目。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { listAnnotations, formatAnnotations, clearAnnotations } from '../annotations.js';

const USAGE = '用法：npm run annotations -- <项目编号或路径> [--page <页面编号>] [--json]\n      npm run annotations -- <项目编号或路径> [--page <页面编号>] --clear [<批注编号>…]';

export function parseArgs(argv) {
  const out = { positional: [], page: null, json: false, clear: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page') { out.page = argv[++i]; if (!out.page) throw Object.assign(new Error('--page 后面要写页面编号'), { usage: true }); }
    else if (a === '--json') out.json = true;
    else if (a === '--clear') out.clear = true;
    else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  if (!out.positional.length) throw Object.assign(new Error('缺少项目编号或路径'), { usage: true });
  if (!out.clear && out.positional.length > 1) throw Object.assign(new Error('列出批注时只写一个项目；要清除指定批注请加 --clear'), { usage: true });
  return out;
}

function main() {
  let args;
  try { args = parseArgs(stripDataDirArg(process.argv.slice(2))); }
  catch (e) { console.error(`出错：${e.message}`); console.error(USAGE); process.exit(2); }
  try {
    const { dataDir } = loadConfig();
    const dir = resolveProject(args.positional[0], dataDir);
    if (args.clear) {
      const { removed, versionDir } = clearAnnotations(dir, { page: args.page, ids: args.positional.slice(1) });
      if (!removed.length) { console.log('没有要清除的批注。'); return; }
      console.log(`已存版本：${versionDir}`);
      console.log(`已清除 ${removed.length} 条批注：${removed.join('、')}`);
      return;
    }
    const list = listAnnotations(dir, { page: args.page });
    console.log(args.json ? JSON.stringify(list, null, 2) : formatAnnotations(list));
  } catch (e) {
    console.error(`出错：${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
