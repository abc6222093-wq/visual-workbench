// 给 agent 的开场白：用户开新的 agent 对话时粘贴，说明代码在哪、规则在哪、要改哪个项目、动手前后要做什么。
import { existsSync, readFileSync, statSync } from 'node:fs';
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

  const importDir = join(projectDir, 'import');
  if (existsSync(importDir) && statSync(importDir).isDirectory() && p.kind === 'web') {
    lines.push(
      '',
      '这是导入的网页项目（第 11 轮）：',
      '- 每个网页有电脑端、手机端两页（page.device / page.size，整页高度 = 内容长度）；组件是分组，元素的 origin.selector 指向原网页里的对应元素',
      `- ${join(importDir, 'baseline.json')} 是导入那一刻的项目（改动清单的「改前」基准，不要修改）；网址来源的快照在 import/pages/，来源记录在 import/source.json；跳过的网址见项目 description`,
      '- 用户改完后会用「导出 → 交接包」生成改动清单（改动清单.md / changes.json / 对比图），由写前端的 agent 照着改真正的网站；不要把改动回写进原网页文件',
    );
  } else if (existsSync(importDir) && statSync(importDir).isDirectory()) {
    lines.push(
      '',
      '这是从旧 HTML 导入的项目：',
      `- 原文件（导入时复制的，文件名不变）在 ${importDir}，导入说明见其中的 README.md`,
      '- 每页的 notes 是「迁移说明」：原来的动画线索、哪些块被截成了图片（名字带「[截图]」）、缺失字体、分页方式',
      '- 原来的动画没有搬过来：请按原 HTML 的动画意图，用新格式重写每页 motion（不要搬旧代码）；能改成可编辑元素的截图块可以重做',
    );
  }

  lines.push(
    '',
    `动手前先存一版（在代码文件夹里执行）：npm run save-version -- ${id} -m "本轮说明"`,
    `改完校验：npm run validate "${projectDir}"`,
    '工作台开着的话，你改完文件界面会自动刷新，不用让我手动刷新。',
  );
  return lines.join('\n') + '\n';
}
