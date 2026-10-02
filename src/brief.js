// 给 agent 的开场白：エイ 开新的 agent 对话时粘贴，说明代码在哪、规则在哪、要改哪个项目、动手前后要做什么。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_LAYOUT } from './data-dir.js';
import { SERIES_FILE } from './master.js';

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 生成一段中文纯文本开场白。
 * @param {{repoDir: string, dataDir?: string, projectDir: string, project?: object}} opts
 *   project 不给时从 projectDir/project.json 读。
 */
export function agentBrief({ repoDir, dataDir, projectDir, project }) {
  if (typeof repoDir !== 'string' || !repoDir) throw new Error('缺少工作台代码文件夹路径');
  if (typeof projectDir !== 'string' || !projectDir) throw new Error('缺少项目文件夹路径');
  const projectFile = join(projectDir, PROJECT_LAYOUT.file);
  const p = project || readJson(projectFile);
  if (!p || typeof p !== 'object') throw new Error(`读不到项目文件：${projectFile}`);
  const id = typeof p.id === 'string' && p.id ? p.id : '（未知编号）';
  const name = typeof p.name === 'string' && p.name ? p.name : '（未命名）';

  const lines = [
    '请在「视觉工作台」里继续做这个项目。',
    '',
    `工作台代码文件夹：${repoDir}`,
  ];
  if (typeof dataDir === 'string' && dataDir) lines.push(`数据目录：${dataDir}`);
  lines.push(
    '开工前先读：',
    `- ${join(repoDir, 'CLAUDE.md')}（Claude Code）或 ${join(repoDir, 'AGENTS.md')}（Codex）：agent 规则`,
    `- ${join(repoDir, 'docs', 'format.md')}：项目格式`,
    `- ${join(repoDir, 'HANDOFF.md')}：最近的交接`,
    '',
    '要改的项目：',
    `- 编号：${id}`,
    `- 名称：${name}`,
    `- 文件夹：${projectDir}`,
    `- 项目文件：${projectFile}`,
  );

  const seriesFile = join(projectDir, SERIES_FILE);
  if (existsSync(seriesFile)) {
    const series = readJson(seriesFile);
    const master = series && typeof series.master === 'string' && series.master ? series.master : '（未知）';
    lines.push(`- 这个项目来自系列母版 ${master}，配色见 ${seriesFile}`);
    if (series && Array.isArray(series.motions) && series.motions.length) {
      lines.push(`- 系列的动效代码在 ${seriesFile} 的 motions 里（按母版页面列出），排新页面时照着复用`);
    }
  }

  lines.push(
    '',
    `动手前先存一版（在代码文件夹里执行）：npm run save-version -- ${id} -m "本轮说明"`,
    `改完校验：npm run validate "${projectDir}"`,
    '工作台开着的话，你改完文件界面会自动刷新，不用让我手动刷新。',
  );
  return lines.join('\n') + '\n';
}
