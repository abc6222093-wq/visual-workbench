import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../web/playback.js';

const element = { id: 'item', type: 'shape', x: 120, y: 50, width: 100, height: 80, fill: '#f00' };
function fixture(source, steps = 2) {
  const project = { id: 'test-project', formatVersion: 2, pages: [] };
  const page = { id: 'one', elements: [structuredClone(element)], motion: { steps, source } };
  project.pages = [page];
  const node = { style: {}, animate: () => ({ finished: Promise.resolve(), cancel() {} }) };
  const root = { querySelector: () => node };
  return { project, page, node, root };
}
async function settled(playback) {
  for (let i = 0; i < 20 && playback.isPlaying(); i++) await new Promise(resolve => setTimeout(resolve, 0));
}
test('step runs in click order and receives frozen current geometry', async () => {
  const source = `export default async function(ctx) {
    const {node,base}=ctx.element('item');
    node.style.left=base.x+'px';
    return { step(index) { node.style.left=(base.x+(index+1)*10)+'px'; } };
  }`;
  const { project, page, node, root } = fixture(source);
  page.elements[0].x = 230;
  const playback = createPlayback(project, page, { root });
  await playback.ready;
  assert.equal(node.style.left, '230px');
  assert.equal(playback.next(), true);
  await settled(playback);
  assert.equal(node.style.left, '240px');
  assert.equal(playback.getState().nextStep, 1);
  assert.equal(playback.next(), true);
  await settled(playback);
  assert.equal(node.style.left, '250px');
  assert.equal(playback.next(), false);
  playback.destroy();
});
test('initialization errors reach ready and onError', async () => {
  const { project, page, root } = fixture('export default () => { throw new Error("bad motion") }', 1);
  const errors = [];
  const playback = createPlayback(project, page, { root, onError: error => errors.push(error.message) });
  await assert.rejects(playback.ready, /bad motion/);
  assert.deepEqual(errors, ['bad motion']);
  playback.destroy();
});
test('destroy aborts active timer and calls dispose', async () => {
  const source = `export default async function(ctx) {
    const {node}=ctx.element('item');
    return { async step() { try { await ctx.timer(1000); } finally { node.style.done='yes'; } }, dispose() { node.style.disposed='yes'; } };
  }`;
  const { project, page, root, node } = fixture(source, 1);
  const playback = createPlayback(project, page, { root });
  await playback.ready;
  playback.next();
  await new Promise(resolve => setTimeout(resolve, 0));
  playback.destroy();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(node.style.disposed, 'yes');
  assert.equal(node.style.done, 'yes');
});

test('legacy project and old steps fail before playback', async () => {
  const { project, page, root } = fixture('export default () => ({step(){}})', 1);
  project.formatVersion = 1;
  const old = createPlayback(project, page, { root });
  await assert.rejects(old.ready, /旧版项目格式/);
  old.destroy();
  project.formatVersion = 2;
  page.steps = [];
  const tracks = createPlayback(project, page, { root });
  await assert.rejects(tracks.ready, /旧版 steps/);
  tracks.destroy();
});
test('invalid handler is reported', async () => {
  const { project, page, root } = fixture('export default () => ({step: 42})', 1);
  const playback = createPlayback(project, page, { root });
  await assert.rejects(playback.ready, /step 必须是函数/);
  playback.destroy();
});

test('static pages without motion are valid and have no click steps', async () => {
  const { project, page, root } = fixture('export default () => ({})', 0);
  delete page.motion;
  const playback = createPlayback(project, page, { root });
  await playback.ready;
  assert.equal(playback.next(), false);
  await playback.destroy();
});
