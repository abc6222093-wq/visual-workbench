#!/usr/bin/env node
// 命令行校验：npm run validate [项目文件夹或 project.json ...]
// 无参数时校验 examples/ 下每个含 project.json 的子文件夹。全部通过退出码 0，否则 1。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProject, formatResult } from '../validate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function defaultTargets() {
  const dir = join(ROOT, 'examples');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'project.json')));
}

const args = process.argv.slice(2);
const targets = args.length ? args : defaultTargets();

if (!targets.length) {
  console.error('没有可校验的项目：examples/ 下没有含 project.json 的文件夹，也没有给出路径参数。');
  process.exit(1);
}

let passed = 0;
for (const target of targets) {
  const result = validateProject(target);
  console.log(formatResult(result));
  if (result.ok) passed += 1;
}

const failed = targets.length - passed;
console.log(`共 ${targets.length} 个项目，通过 ${passed}，未通过 ${failed}`);
process.exit(failed === 0 ? 0 : 1);
