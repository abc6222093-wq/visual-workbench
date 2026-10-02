import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentBrief } from '../src/brief.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(REPO, 'examples', 'sample-deck');

function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'vw-'));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function setup(tmp) {
  const dataDir = join(tmp, 'data');
  const projectDir = join(dataDir, 'projects', 'sample-deck');
  cpSync(SAMPLE, projectDir, { recursive: true });
  const project = JSON.parse(readFileSync(join(projectDir, 'project.json'), 'utf8'));
  return { dataDir, projectDir, project };
}

test('开场白包含代码文件夹、规则文档、项目编号名称和路径、三句操作提示', () => {
  withTmp((tmp) => {
    const { dataDir, projectDir, project } = setup(tmp);
    const text = agentBrief({ repoDir: REPO, dataDir, projectDir, project });
    const must = [
      `工作台代码文件夹：${REPO}`,
      join(REPO, 'CLAUDE.md'),
      join(REPO, 'AGENTS.md'),
      join(REPO, 'docs', 'format.md'),
      join(REPO, 'HANDOFF.md'),
      '编号：sample-deck',
      '名称：示例课件 · 格式演示',
      `文件夹：${projectDir}`,
      `项目文件：${join(projectDir, 'project.json')}`,
      'npm run save-version -- sample-deck -m "本轮说明"',
      `npm run validate "${projectDir}"`,
      '自动刷新',
    ];
    for (const s of must) assert.ok(text.includes(s), `应包含：${s}\n---\n${text}`);
    assert.equal(text.includes('undefined'), false);
    assert.equal(text.includes('系列母版'), false);
  });
});

test('有 series.json 时多一行母版来源与配色位置', () => {
  withTmp((tmp) => {
    const { dataDir, projectDir, project } = setup(tmp);
    const without = agentBrief({ repoDir: REPO, dataDir, projectDir, project });
    const seriesFile = join(projectDir, 'series.json');
    writeFileSync(seriesFile, JSON.stringify({ master: 'brand-master', palette: ['#ffffff'] }, null, 2) + '\n');
    const withSeries = agentBrief({ repoDir: REPO, dataDir, projectDir, project });
    assert.equal(withSeries.split('\n').length, without.split('\n').length + 1);
    assert.ok(withSeries.includes(`这个项目来自系列母版 brand-master，配色见 ${seriesFile}`));
    assert.equal(withSeries.includes('undefined'), false);
  });
});

test('不传 project 时从项目文件读；series.json 损坏也不出现 undefined', () => {
  withTmp((tmp) => {
    const { projectDir } = setup(tmp);
    writeFileSync(join(projectDir, 'series.json'), '坏掉的');
    const text = agentBrief({ repoDir: REPO, projectDir });
    assert.ok(text.includes('编号：sample-deck'));
    assert.ok(text.includes('系列母版'));
    assert.equal(text.includes('undefined'), false);
  });
});
