import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOutline, addPage, deletePage, addRow, deleteRow, setRowRole, addScreen, markDisappear, isVisible, extractOutline, planApplyText, copyBrief } from '../web/outline-model.js';
import { validateProjectData } from '../src/validate.js';
import { mergeProjects } from '../web/sync.js';
const fixture = () => JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url)));

test('outline content lifecycle: page add/delete, all levels, row delete, inherited/hidden/new screens', () => {
  const project = fixture(), added = addPage(project, project.pages[0].id);
  assert.equal(project.pages[1], added);
  const row = addRow(added.outline, 'title', 1, 'title');
  for (const role of ['title', 'subtitle', 'english', 'body', 'note']) { setRowRole(row, role); assert.equal(validateProjectData(project).ok, true); }
  addScreen(added.outline); markDisappear(row, 2);
  const second = addRow(added.outline, 'body', 2, 'new');
  assert.equal(isVisible(row, 1), true); assert.equal(isVisible(row, 2), false);
  assert.equal(isVisible(second, 1), false); assert.equal(isVisible(second, 2), true);
  deleteRow(added.outline, row.id); assert.equal(added.outline.rows.length, 1);
  assert.equal(deletePage(project, added.id), true); assert.equal(project.pages.some(p => p.id === added.id), false);
});
test('copied brief distinguishes all pages and selected pages, carries file location and layout/check obligations', () => {
  const project = fixture();
  for (const page of project.pages) page.outline = extractOutline(project, page);
  const all = copyBrief(project, undefined, '/local/projects/sample-deck/project.json');
  const selected = copyBrief(project, [project.pages[1].id], '/local/projects/sample-deck/project.json');
  for (const p of project.pages) assert.ok(all.includes(p.id));
  assert.ok(selected.includes(project.pages[1].id)); assert.ok(!selected.includes(project.pages[0].id)); assert.ok(!selected.includes(project.pages[2].id));
  for (const brief of [all, selected]) { assert.match(brief, /project\.json/); assert.match(brief, /check-motion/); assert.match(brief, /elementId/); assert.match(brief, /motion\.steps/); }
});
test('outline validates image refs and malformed emphasis/visibility; old project remains valid', () => {
  const project = fixture(); assert.equal(validateProjectData(project).ok, true);
  const outline = project.pages[0].outline = createOutline();
  outline.images.push({ id: 'image_testing', asset: 'asset_missing', caption: '', from: 1, until: null });
  assert.ok(validateProjectData(project).errors.some(e => e.code === 'UNKNOWN_ASSET_REF'));
  outline.images[0].asset = project.assets[0].id;
  const row = addRow(outline, 'body', 1, 'abcdef');
  row.emphasis = [{ start: 0, end: 4 }, { start: 3, end: 5 }]; assert.equal(validateProjectData(project).ok, false);
  row.emphasis = []; row.visibleOn = [2]; assert.equal(validateProjectData(project).ok, false);
  row.visibleOn = []; assert.equal(validateProjectData(project).ok, true);
});
test('exact visibility inherits last screen and extraction prefers saved roles including grouped text', () => {
  const project = fixture(), page = project.pages[2];
  page.outline = extractOutline(project, page);
  const row = page.outline.rows.find(r => r.elementId === 'el_gtitle3');
  assert.ok(row, 'group child is extracted'); row.role = 'english';
  const extracted = extractOutline(project, page);
  assert.equal(extracted.rows.find(r => r.elementId === 'el_gtitle3').role, 'english');
  extracted.rows[0].visibleOn = [1, extracted.screens];
  addScreen(extracted); assert.equal(isVisible(extracted.rows[0], extracted.screens), true);
});
test('missing layout baseline and all structural changes are reported; only text fields differ in canvas', () => {
  const project = fixture(), page = project.pages[0]; page.outline = extractOutline(project, page);
  const before = structuredClone(page.elements), row = page.outline.rows[0];
  row.text += ' revised'; row.emphasis = [{start:0,end:1}]; row.from = 2; row.until = 3;
  page.outline.screens++; page.outline.images[0].caption += ' revised';
  const unbased = page.outline.rows[1]; delete unbased.baseline;
  const result = planApplyText(project, [page.id]);
  for (const type of ['emphasis', 'from', 'until', 'screens', 'image', 'unmapped-baseline']) assert.ok(result.unapplied.some(c => c.type === type), type);
  const expected = structuredClone(before); expected.find(e => e.id === row.elementId).text = row.text;
  assert.deepEqual(result.project.pages[0].elements, expected);
  assert.deepEqual(project.pages[0].elements, before, 'planning never mutates its input');
});
test('outline real-time merge preserves local typing while adopting an agent edit on another row', () => {
  const base = fixture(); base.pages[0].outline = extractOutline(base, base.pages[0]);
  const local = structuredClone(base), remote = structuredClone(base);
  local.pages[0].outline.rows[0].text = 'local typing'; remote.pages[0].outline.rows[1].text = 'agent change';
  const result = mergeProjects(base, local, remote);
  assert.equal(result.merged.pages[0].outline.rows[0].text, 'local typing');
  assert.equal(result.merged.pages[0].outline.rows[1].text, 'agent change');
  assert.deepEqual(result.conflicts, []);
});

test('malformed outline properties produce schema errors without crashing validation', () => {
  for (const outline of [{rows:{}}, {screens:1,notes:'',rows:[null],images:[]}, {screens:1,notes:'',rows:[{id:'row_invalid',emphasis:{}}],images:[]}]) {
    const project=fixture(); project.pages[0].outline=outline;
    assert.equal(validateProjectData(project).ok,false);
  }
});
