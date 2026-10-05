// 导出：npm run export -- <项目目录或编号> [--html|--images|--pdf|--all] [--out <目录>] [--data-dir x]
// 不给 --out 时放到 <数据目录>/exports/<项目编号>/（数据目录不进 git）。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { exportProject, EXPORT_KINDS } from '../export/index.js';
import { describeBreakdown, formatBytes } from '../export/html.js';

const USAGE = '用法：npm run export -- <项目目录或编号> [--html|--images|--pdf|--all] [--out <目录>] [--data-dir <数据目录>]';

function parse(args) {
  const out = { positional: [], kinds: new Set(), outDir: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--html' || a === '--images' || a === '--pdf') out.kinds.add(a.slice(2));
    else if (a === '--all') EXPORT_KINDS.forEach(kind => out.kinds.add(kind));
    else if (a === '--out' || a === '-o') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Object.assign(new Error('--out 后面需要跟一个目录'), { usage: true });
      out.outDir = value;
    } else if (a.startsWith('-')) throw Object.assign(new Error(`未知参数：${a}`), { usage: true });
    else out.positional.push(a);
  }
  if (out.positional.length !== 1) throw Object.assign(new Error('需要指定一个项目'), { usage: true });
  if (!out.kinds.size) out.kinds.add('html');
  return out;
}

const KIND_LABEL = { html: '放映版（单个 HTML 文件）', images: '每页图片', pdf: 'PDF' };
const shown = path => { const rel = relative(process.cwd(), path); return rel && !rel.startsWith('..') ? rel : path; };

try {
  const args = parse(stripDataDirArg(process.argv.slice(2)));
  let dataDir;
  const needDataDir = () => (dataDir ??= loadConfig().dataDir);
  const asPath = resolve(args.positional[0]);
  const projectDir = existsSync(asPath) && statSync(asPath).isDirectory() ? resolveProject(asPath) : resolveProject(args.positional[0], needDataDir());
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  const outDir = args.outDir ? resolve(args.outDir) : join(needDataDir(), 'exports', project.id);
  let failed = false;
  for (const kind of EXPORT_KINDS.filter(k => args.kinds.has(k))) {
    console.log(`正在导出${KIND_LABEL[kind]}：${project.name}`);
    try {
      const result = await exportProject({ projectDir, kind, outDir });
      for (const file of result.files) console.log(`  ${shown(file.path)}  ${formatBytes(file.bytes)}`);
      if (result.breakdown) console.log(`  组成：${describeBreakdown(result.breakdown)}`);
      for (const item of result.items || []) {
        if (item.kind === 'library') continue;
        console.log(`    ${{ font: '字体', image: '图片', file: '文件' }[item.kind] || item.kind} ${item.name}：${formatBytes(item.original)} → ${formatBytes(item.bytes)}（${item.note}）`);
      }
      if (result.skipped?.length) console.log(`  没有用到、未打包的素材：${result.skipped.join('、')}`);
      for (const warning of result.warnings || []) console.warn(`  ⚠ ${warning}`);
    } catch (error) {
      failed = true;
      console.error(`  ✗ 导出${KIND_LABEL[kind]}失败：${error.message}`);
    }
  }
  console.log(`导出文件夹：${outDir}`);
  if (failed) process.exitCode = 1;
} catch (e) {
  console.error(`出错：${e.message}`);
  if (e.usage) { console.error(USAGE); process.exit(2); }
  process.exit(1);
}
