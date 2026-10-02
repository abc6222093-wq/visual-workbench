import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

const source = 'export default () => ({ step() {}, transition() {}, dispose() {} })';
function project(code = source, steps = 1) {
  return { id: 'motion-test', formatVersion: 2, artboard: { width: 640, height: 360 }, assets: [], fonts: [], pages: [{ id: 'page_one', elements: [{ id: 'item', type: 'shape', shape: 'rect', x: 30, y: 40, width: 100, height: 50, fill: '#ff0000' }], motion: { steps, source: code } }] };
}
test('browser checker exercises module, steps, transitions, cleanup and delayed errors', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-motion-check-'));
  const server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/motion-check.html`);
  const cases = [
    ['valid', source, true],
    ['syntax', 'export default () => ({', false],
    ['export', 'export const value = 1', false],
    ['handler', 'export default () => ({step: 3})', false],
    ['element', "export default ctx => { ctx.element('missing'); return {step(){}} }", false],
    ['step', "export default () => ({step(){throw new Error('step failed')}})", false],
    ['transition', "export default () => ({step(){},transition(){throw new Error('transition failed')}})", false],
    ['dispose', "export default () => ({step(){},dispose(){return Promise.reject(new Error('dispose failed'))}})", false],
    ['console', "export default () => ({step(){console.error('console failed')}})", false],
    ['unhandled', "export default () => ({step(){Promise.reject(new Error('unhandled failed'))}})", false],
    ['timeout', "export default ctx => ({step(){return ctx.timer(500)}})", false]
  ];
  for (const [name, code, expected] of cases) {
    const result = await page.evaluate(async value => { const { checkMotion } = await import('/motion-check.js'); return checkMotion(value, { timeout: 120 }); }, project(code));
    assert.equal(result.ok, expected, `${name}: ${JSON.stringify(result.results)}`);
  }

  for (const [name, change] of [
    ['legacy version', value => { value.formatVersion = 1; }],
    ['old page steps', value => { value.pages[0].steps = []; }]
  ]) {
    const value = project(); change(value);
    const result = await page.evaluate(async value => { const { checkMotion } = await import('/motion-check.js'); return checkMotion(value, { timeout: 120 }); }, value);
    assert.equal(result.ok, false, name);
  }
  const sample = JSON.parse(readFileSync(new URL('../examples/sample-deck/project.json', import.meta.url), 'utf8'));
  const shifted = structuredClone(sample);
  shifted.pages[1].elements.find(item => item.id === 'el_marker2').x += 97;
  shifted.pages[1].elements.find(item => item.id === 'el_marker2').y += 43;
  async function markerPositions(value) {
    return page.evaluate(async value => {
      const { renderPage } = await import('/render.js');
      const { createPlayback } = await import('/playback.js');
      const selected = value.pages[1];
      const root = renderPage(value, selected, { assetBase: '/project' });
      document.body.append(root);
      const marker = root.querySelector('[data-element-id="el_marker2"]');
      const rect = () => { const r = marker.getBoundingClientRect(); return { x: r.x, y: r.y }; };
      const playback = createPlayback(value, selected, { root });
      await playback.ready;
      const points = [rect()];
      for (let i = 0; i < 3; i++) {
        playback.next();
        while (playback.isPlaying()) await new Promise(resolve => setTimeout(resolve, 10));
        points.push(rect());
      }
      await playback.destroy(); root.remove();
      return points;
    }, value);
  }
  const a = await markerPositions(sample);
  const b = await markerPositions(shifted);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs((b[i].x - a[i].x) - 97) < 2, `marker x at step ${i}`);
    assert.ok(Math.abs((b[i].y - a[i].y) - 43) < 2, `marker y at step ${i}`);
  }
  assert.ok(a[2].x < a[1].x - 100, 'marker moves left in step 2');
  assert.ok(a[3].x > a[2].x + 300, 'marker moves right in step 3');
});
