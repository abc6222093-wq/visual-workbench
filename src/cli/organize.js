#!/usr/bin/env node
// 整理文件夹（docs/format.md §16）：
//   npm run organize -- list                         列出文件夹和全部项目
//   npm run organize -- begin                        记录整理前的原状（organize-backup.json，覆盖旧的）
//   npm run organize -- folder <名>                  新建文件夹（已有不报错）
//   npm run organize -- move <项目编号> <文件夹名|/>  把项目移进文件夹；/ = 移出到总览根（文件夹不存在自动新建）
//   npm run organize -- rename <项目编号> <新名>      改项目名称
//   npm run organize -- restore                      退回整理前（恢复名称、所在文件夹和文件夹列表，然后删掉备份）
// 没有备份时，第一次 folder / move / rename 会先自动 begin。不删除任何项目。
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadConfig, stripDataDirArg } from '../config.js';
import { listProjects } from '../data-dir.js';
import { listFolders, ensureFolder, moveProject, renameProject, readBackup, beginOrganize, restoreOrganize } from '../folders.js';

const USAGE = [
  '用法：npm run organize -- list',
  '      npm run organize -- begin',
  '      npm run organize -- folder <文件夹名>',
  '      npm run organize -- move <项目编号> <文件夹名|/>',
  '      npm run organize -- rename <项目编号> <新名称>',
  '      npm run organize -- restore',
].join('\n');
const usage = (message) => Object.assign(new Error(message), { usage: true });
const COUNTS = { list: 0, begin: 0, restore: 0, folder: 1, move: 2, rename: 2 };

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw usage('缺少要做的事');
  if (!(command in COUNTS)) throw usage(`不认识的命令：${command}`);
  if (rest.length !== COUNTS[command]) throw usage(`${command} 需要 ${COUNTS[command]} 个参数${command === 'rename' || command === 'folder' ? '（名字里有空格请加引号）' : ''}`);
  return { command, args: rest };
}

function overview(dataDir) {
  const projects = listProjects(dataDir).map((id) => {
    try { const p = JSON.parse(readFileSync(join(dataDir, 'projects', id, 'project.json'), 'utf8')); return { id, name: p.name || id, folder: typeof p.folder === 'string' ? p.folder : '', updatedAt: p.updatedAt || '' }; }
    catch { return { id, name: '（项目文件读不了）', folder: '', updatedAt: '' }; }
  });
  return { folders: listFolders(dataDir), projects };
}

export function formatList({ folders, projects }, backup) {
  const lines = [];
  lines.push(folders.length ? `文件夹（${folders.length} 个）：` : '还没有文件夹。');
  for (const f of folders) {
    lines.push(`- ${f.name}（${f.count} 个项目）`);
    for (const p of projects.filter((x) => x.folder === f.name)) lines.push(`    ${p.id}  「${p.name}」  更新于 ${p.updatedAt || '未知'}`);
  }
  const loose = projects.filter((p) => !p.folder);
  lines.push(`不在文件夹里的项目（${loose.length} 个）：`);
  for (const p of loose) lines.push(`    ${p.id}  「${p.name}」  更新于 ${p.updatedAt || '未知'}`);
  lines.push(backup ? `已记录整理前的原状（${backup.at}），可以 npm run organize -- restore 退回。` : '还没有记录整理前的原状（npm run organize -- begin）。');
  return lines.join('\n');
}

/** 执行一条命令，返回要打印的中文文字。 */
export function runOrganize(dataDir, { command, args }) {
  const out = [];
  const ensureBackup = () => {
    if (readBackup(dataDir)) return;
    const b = beginOrganize(dataDir);
    out.push(`先记录了整理前的原状（${b.at}，${Object.keys(b.projects).length} 个项目）。`);
  };
  if (command === 'list') return formatList(overview(dataDir), readBackup(dataDir));
  if (command === 'begin') {
    const b = beginOrganize(dataDir);
    return `已记录整理前的原状：${Object.keys(b.projects).length} 个项目、${b.folders.length} 个文件夹（${b.at}）。用户可以在总览点「退回整理前」，或运行 npm run organize -- restore。`;
  }
  if (command === 'restore') {
    if (!readBackup(dataDir)) throw new Error('没有整理前的备份，无法退回');
    const { restored } = restoreOrganize(dataDir);
    return `已退回整理前：恢复了 ${restored} 个项目的名称和所在文件夹，文件夹列表也恢复了；备份已删除。`;
  }
  if (command === 'folder') {
    ensureBackup();
    const existed = listFolders(dataDir).some((f) => f.name === args[0].trim());
    const name = ensureFolder(dataDir, args[0]);
    out.push(existed ? `文件夹「${name}」已经有了。` : `已新建文件夹「${name}」。`);
    return out.join('\n');
  }
  if (command === 'move') {
    ensureBackup();
    const [id, folder] = args;
    const project = moveProject(dataDir, id, folder);
    out.push(project.folder ? `已把 ${id}「${project.name}」移进文件夹「${project.folder}」。` : `已把 ${id}「${project.name}」移出文件夹（放在总览根上）。`);
    return out.join('\n');
  }
  if (command === 'rename') {
    ensureBackup();
    const [id, name] = args;
    const project = renameProject(dataDir, id, name);
    out.push(`已把 ${id} 改名为「${project.name}」。`);
    return out.join('\n');
  }
  throw usage(`不认识的命令：${command}`);
}

function main() {
  let parsed;
  try { parsed = parseArgs(stripDataDirArg(process.argv.slice(2))); }
  catch (e) { console.error(`出错：${e.message}`); console.error(USAGE); process.exit(2); }
  try {
    const { dataDir } = loadConfig();
    console.log(runOrganize(dataDir, parsed));
  } catch (e) {
    console.error(`出错：${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
