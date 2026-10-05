// 第 13 轮：批注只在编辑画布显示，导出的放映版（内嵌的项目数据）里不带批注文字
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDeck, cleanup } from './round12-export-fixture.test.js';
import { exportHtml } from '../src/export/html.js';

test('导出放映版：project.json 里的 annotations 不进放映文件', async () => {
  const { dir, project } = await makeDeck({ edits: [] });
  try {
    project.pages[0].annotations = [{ id: 'an_test0001', x: 10, y: 20, width: 300, height: 120, text: '这里加一个字（批注不该出现在放映文件里）', at: '2026-10-06T00:00:00.000Z' }];
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
    const out = mkdtempSync(join(tmpdir(), 'vw-annot-export-'));
    try {
      const result = await exportHtml({ projectDir: dir, outFile: join(out, 'deck.html') });
      const html = readFileSync(result.file, 'utf8');
      assert.doesNotMatch(html, /批注不该出现在放映文件里/);
      assert.doesNotMatch(html, /"annotations"/);
      assert.match(html, /"pages"/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  } finally { cleanup(dir); }
});
