// 交接包：npm run export-changes -- <项目目录或编号> [--out <目录>] [--no-images] [--data-dir x]
// 生成改动清单（改动清单.md + changes.json）、改前改后对比图（compare/）和「复制给 agent」的文字。
// 不给 --out 时放到 <数据目录>/exports/<项目编号>/handoff-<yyyyMMdd-HHmmss>/。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { exportHandoff, defaultHandoffDir } from '../export/changes.js';

const USAGE = '用法：npm run export-changes -- <项目目录或编号> [--out <目录>] [--no-images] [--data-dir <数据目录>]';

function parse(args) {
  const out = { positional: [], outDir: null, images: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-images') out.images = false;
    else if (a === '--out' || a === '-o') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Object.assign(new Error('--out 后面需要跟一个目录'), { usage: true });
      out.outDir = value;
    } else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  if (out.positional.length !== 1) throw Object.assign(new Error('需要指定一个项目'), { usage: true });
  return out;
}

try {
  const args = parse(stripDataDirArg(process.argv.slice(2)));
  let dataDir;
  const needDataDir = () => (dataDir ??= loadConfig().dataDir);
  const asPath = resolve(args.positional[0]);
  const projectDir = existsSync(asPath) && statSync(asPath).isDirectory() ? resolveProject(asPath) : resolveProject(args.positional[0], needDataDir());
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const outDir = args.outDir ? resolve(args.outDir) : defaultHandoffDir(needDataDir(), project.id);
  console.log(`正在生成交接包：${project.name}`);
  const result = await exportHandoff({ projectDir, outDir, images: args.images });
  console.log(result.summary.text);
  console.log(`改动清单：${join(result.outDir, '改动清单.md')}`);
  console.log(`交接包文件夹：${result.outDir}（${result.files.length} 个文件）`);
  console.log('');
  console.log('复制给 agent：');
  console.log(result.agentText);
} catch (e) {
  console.error(`出错：${e.message}`);
  if (e.usage) { console.error(USAGE); process.exit(2); }
  process.exit(1);
}
