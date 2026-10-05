#!/usr/bin/env node
// 旧项目转换：npm run convert -- <项目编号或路径> [--data-dir x]
// 把格式 v2 的项目转成 v3（每页一个 HTML 文件）。转换前自动存版；失败时项目保持原样。
import { loadConfig, stripDataDirArg } from '../config.js';
import { resolveProject } from '../data-dir.js';
import { convertV2Project } from '../convert-v2.js';

const USAGE = '用法：npm run convert -- <项目编号或路径> [--data-dir <数据目录>]';

try {
  const args = stripDataDirArg(process.argv.slice(2));
  const unknown = args.find(a => a.startsWith('-'));
  if (unknown) throw Object.assign(new Error(`未知参数：${unknown}`), { usage: true });
  if (args.length !== 1) {
    console.error(USAGE);
    process.exit(2);
  }
  const { dataDir } = loadConfig();
  const dir = resolveProject(args[0], dataDir);
  const result = await convertV2Project({ projectDir: dir });
  if (!result.converted) {
    console.log(`不用转换：${dir} 的格式版本是 ${result.formatVersion ?? '（未知）'}，不是 v2。`);
  } else {
    console.log(`已转换为 v3：${dir}`);
    console.log(`转换前的存版：${result.versionDir}`);
    console.log(`生成页面 ${result.pages.length} 个：${result.pages.join('、')}`);
    console.log('接着运行 npm run validate 和 npm run check-motion 检查。');
  }
} catch (e) {
  console.error(`出错：${e.message}`);
  if (e.usage) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(1);
}
