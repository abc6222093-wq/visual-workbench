// 存版本：npm run save-version -- <项目编号或路径> [-m "备注"] [--by claude] [--data-dir x]
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { saveVersion } from '../version.js';

const USAGE = '用法：npm run save-version -- <项目编号或路径> [-m "备注"] [--by claude] [--data-dir <数据目录>]';

function parse(args) {
  const out = { positional: [], note: '', by: 'agent' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') out.note = args[++i] ?? '';
    else if (a === '--by') out.by = args[++i] ?? 'agent';
    else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  return out;
}

try {
  const args = parse(stripDataDirArg(process.argv.slice(2)));
  if (args.positional.length !== 1) {
    console.error(USAGE);
    process.exit(2);
  }
  const { dataDir } = loadConfig();
  const dir = resolveProject(args.positional[0], dataDir);
  const { versionDir, meta } = saveVersion({ projectDir: dir, note: args.note, by: args.by });
  console.log(`已存版本：${versionDir}`);
  console.log(`备注：${meta.note || '（无）'}`);
  console.log(`存档人：${meta.by}，共 ${meta.files.length} 个文件`);
} catch (e) {
  console.error(`出错：${e.message}`);
  if (e.usage) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(1);
}
