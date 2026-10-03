import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileDocument, documentText, documentParagraphs, rowAtOffset, updateDocument, setDocumentRole, setDocumentVisibility, addDocumentScreen, deleteDocumentScreen } from '../web/outline-document.js';
import { extractOutline, isVisible } from '../web/outline-model.js';
import { validateProjectData } from '../src/validate.js';
const fixture = () => JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url)));
const setup = () => { const project = fixture(), page = project.pages[0]; page.elements = []; delete page.motion; return { project, page }; };
test('document imports existing styled text and group children, excluding decorative text', () => {
  const project = fixture(), page = project.pages[0];
  const e = page.elements.find(e => e.type === 'text'), original = structuredClone(e);
  page.elements.push({ ...structuredClone(e), id: 'el_decorative1', decorative: true });
  const child = { ...structuredClone(e), id: 'el_nestedtext1', text: 'Nested' };
  page.elements.push({ id: 'el_group1234', type: 'group', x: 50, y: 40, width: 100, height: 100, zIndex: 2, children: [child] });
  reconcileDocument(project, page);
  assert.ok(page.outline.rows.some(r => r.elementId === child.id));
  assert.ok(!page.outline.rows.some(r => r.elementId === 'el_decorative1'));
  assert.deepEqual(e, original); assert.equal(validateProjectData(project).ok, true);
  assert.equal(reconcileDocument(project, page).changed, false);
});
test('legacy conversion retains pending text, conflict copy and unmapped drafts', () => {
  const project = fixture(), page = project.pages[0]; page.outline = extractOutline(project, page);
  const snapshot = structuredClone(page.outline.baseline), row = page.outline.rows[0], e = page.elements.find(e => e.id === row.elementId);
  row.text = 'Pending'; reconcileDocument(project, page); assert.equal(e.text, 'Pending');
  assert.deepEqual(page.outline.baseline, snapshot);
  delete page.outline.mode; row.text = 'Second pending'; e.text = 'Canvas conflict';
  page.outline.rows.push({ id: 'row_unmapped1', role: 'body', text: 'Draft', emphasis: [], from: 1, until: null });
  reconcileDocument(project, page);
  assert.ok(documentText(page, null).includes('Second pending')); assert.ok(documentText(page, null).includes('Canvas conflict')); assert.ok(documentText(page, null).includes('Draft'));
  assert.equal(validateProjectData(project).ok, true);
});
test('editing paragraphs preserves stable ids, styles, identical unaffected copy and unicode', () => {
  const { project, page } = setup();
  updateDocument(project, page, 1, 'same\n\nsame\n\n終わり😀');
  const rows = [...page.outline.rows]; for (const e of page.elements) delete e.documentDraft;
  const first = structuredClone(page.elements[0]);
  updateDocument(project, page, 1, '編集中👩‍💻\nline\n\nsame\n\n終わり😀');
  assert.equal(page.outline.rows[1].id, rows[1].id); assert.equal(page.outline.rows[2].id, rows[2].id);
  assert.deepEqual({ ...page.elements[0], text: first.text }, first);
  assert.equal(documentText(page, 1), '編集中👩‍💻\nline\n\nsame\n\n終わり😀');
  assert.equal(rowAtOffset(page, 1, documentParagraphs(page, 1)[1].start).id, rows[1].id);
  for (const e of page.elements) delete e.documentDraft;
  const geometry = structuredClone(page.elements); setDocumentRole(page, rows[0].id, 'title'); assert.deepEqual(page.elements, geometry);
});
test('screen editing deletes only visible mapped elements and canvas deletions stay deleted', () => {
  const { project, page } = setup(); updateDocument(project, page, 1, 'First'); addDocumentScreen(page);
  setDocumentVisibility(page, page.outline.rows[0].id, [1]); updateDocument(project, page, 2, 'Second');
  const first = page.outline.rows[0], second = page.outline.rows[1];
  updateDocument(project, page, 2, ''); assert.equal(page.outline.rows[0].id, first.id); assert.ok(!page.elements.some(e => e.id === second.elementId));
  page.elements = []; reconcileDocument(project, page); assert.equal(page.outline.rows.length, 0);
});
test('all-view editing and screen removal preserve text, elements, and motion', () => {
  const { project, page } = setup(); updateDocument(project, page, null, 'One\n\nTwo'); addDocumentScreen(page); addDocumentScreen(page);
  setDocumentVisibility(page, page.outline.rows[0].id, [2]); setDocumentVisibility(page, page.outline.rows[1].id, [1, 3]);
  page.motion = { steps: 2, source: 'export default ()=>({step(){}})' };
  const elements = structuredClone(page.elements), motion = structuredClone(page.motion);
  deleteDocumentScreen(page, 2); assert.ok(isVisible(page.outline.rows[0], 2)); assert.deepEqual(page.outline.rows[1].visibleOn, [1, 2]);
  deleteDocumentScreen(page, 2); deleteDocumentScreen(page, 1); assert.equal(page.outline.screens, 1);
  assert.deepEqual(page.elements, elements); assert.deepEqual(page.motion, motion); assert.equal(documentText(page, null), 'One\n\nTwo');
  assert.equal(validateProjectData(project).ok, true);
});
test('new independent text boxes avoid shapes, rotated groups and each other', () => {
  const { project, page } = setup(); page.elements.push({ id: 'el_group1234', type: 'group', x: 20, y: 90, width: 200, height: 200, rotation: 45, zIndex: 1, children: [{ id: 'el_shape1234', type: 'shape', shape: 'rect', x: 0, y: 0, width: 200, height: 200, zIndex: 1 }] });
  updateDocument(project, page, 1, 'First\n\nSecond');
  const [group, a, b] = page.elements;
  const bottom = group.y + group.height / 2 + Math.hypot(group.width, group.height) / 2;
  const right = group.x + group.width / 2 + Math.hypot(group.width, group.height) / 2;
  assert.ok(a.y > bottom || a.x > right); assert.ok(b.y > a.y + a.height || b.x > a.x + a.width || a.x > b.x + b.width);
  assert.equal(validateProjectData(project).ok, true);
});

test('background layers and decorative text do not force drafts outside artboard', () => {
  const { project, page } = setup();
  page.elements.push({ id: 'el_background1', type: 'shape', shape: 'rect', x: 0, y: 0, width: project.artboard.width, height: project.artboard.height, zIndex: 0 });
  page.elements.push({ id: 'el_decoration1', type: 'text', text: 'Decoration', fontSize: 20, color: '#111111', decorative: true, x: 0, y: 0, width: project.artboard.width, height: project.artboard.height, zIndex: 1 });
  const result = updateDocument(project, page, 1, 'Body');
  assert.deepEqual(result.overflow, []); assert.equal(page.elements.at(-1).y, 48); assert.equal(page.elements.at(-1).x, 48);
});
test('role defaults change untouched drafts but preserve manual styles and agent layouts', () => {
  const { project, page } = setup(); updateDocument(project, page, 1, 'Draft');
  const e = page.elements[0], id = page.outline.rows[0].id;
  assert.equal(e.documentDraft, true); setDocumentRole(page, id, 'title', project); assert.equal(e.fontSize, 64); assert.equal(e.fontWeight, 700);
  e.fontSize = 55; const before = structuredClone(e); setDocumentRole(page, id, 'note', project);
  assert.deepEqual(e, Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'documentDraft')));
  assert.equal(page.outline.rows[0].role, 'note'); assert.equal(validateProjectData(project).ok, true);
});
test('full content canvas explicitly reports overflow', () => {
  const { project, page } = setup();
  page.elements.push({ id: 'el_content1234', type: 'text', text: 'Content', fontSize: 20, color: '#111111', x: 0, y: 0, width: project.artboard.width, height: project.artboard.height, zIndex: 1 });
  reconcileDocument(project, page); const result = updateDocument(project, page, 1, 'Content\n\nNew');
  assert.equal(result.overflow.length, 1); assert.ok(page.elements.at(-1).y >= project.artboard.height);
});

test('delete plus append never donates deleted paragraph style across an unchanged anchor', () => {
  const { project, page } = setup(); updateDocument(project, page, 1, 'A\n\nB\n\nC');
  const [a, b, c] = page.outline.rows; const oldB = page.elements.find(e => e.id === b.elementId);
  oldB.fontSize = 99; delete oldB.documentDraft;
  const result = updateDocument(project, page, 1, 'A\n\nC\n\nX');
  assert.equal(page.outline.rows[0].id, a.id); assert.equal(page.outline.rows[1].id, c.id);
  assert.notEqual(page.outline.rows[2].id, b.id); assert.deepEqual(result.deleted, [b.id]);
  assert.equal(page.elements.find(e => e.id === page.outline.rows[2].elementId).fontSize, 28);
});
test('repeated paragraphs preserve surrounding ids and a single body newline', () => {
  const { project, page } = setup(); updateDocument(project, page, 1, 'same\n\nsame\n\nend');
  const [first, second, end] = page.outline.rows;
  updateDocument(project, page, 1, 'same\n\nnew\nline\n\nsame\n\nend');
  assert.equal(page.outline.rows[0].id, first.id); assert.equal(page.outline.rows[2].id, second.id); assert.equal(page.outline.rows[3].id, end.id);
  assert.equal(page.outline.rows[1].text, 'new\nline');
});
