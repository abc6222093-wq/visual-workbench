// 复制页面成新项目：npm run copy-pages -- <源项目编号或路径> <页码,如 1,3> --to <新项目编号> [--name "..."] [--data-dir x]
import { loadConfig, stripDataDirArg } from '../config.js';
import { projectDir, resolveProject } from '../data-dir.js';
import { copyPages, parsePageList } from '../copy-pages.js';

const USAGE = '用法：npm run copy-pages -- <源项目编号或路径> <页码，如 1,3 或 1-2,3> --to <新项目编号> [--name "新名字"] [--data-dir <数据目录>]';

function parse(args) {
  const out = { positional: [], to: undefined, name: undefined };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--to') out.to = args[++i];
    else if (a === '--name') out.name = args[++i];
    else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  return out;
}

try {
  const args = parse(stripDataDirArg(process.argv.slice(2)));
  if (args.positional.length !== 2 || !args.to) {
    console.error(USAGE);
    process.exit(2);
  }
  const { dataDir } = loadConfig();
  const srcDir = resolveProject(args.positional[0], dataDir);
  const pages = parsePageList(args.positional[1]);
  const dest = projectDir(dataDir, args.to);
  const r = copyPages({ srcProjectDir: srcDir, pages, destProjectDir: dest, newId: args.to, newName: args.name });
  console.log(`已创建新项目：${r.destProjectDir}`);
  console.log(`名称：${r.project.name}`);
  console.log(`页数：${r.project.pages.length}`);
  console.log(`复制的素材：${r.copiedAssets.join(', ') || '（无）'}`);
  console.log(`复制的字体：${r.copiedFonts.join(', ') || '（无）'}`);
} catch (e) {
  console.error(`出错：${e.message}`);
  if (e.usage) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(1);
}
