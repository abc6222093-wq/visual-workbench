import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowser } from '../src/browser.js';
import { createServer } from '../src/server.js';

async function open(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-step-selection-'));
  // Register cleanup before browser launch, including the NO_BROWSER failure path.
  let browser, server;
  t.after(async () => {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  cpSync(new URL('../examples/sample-deck/', import.meta.url), join(dir, 'projects/sample-deck'), { recursive: true, filter: name => !String(name).includes('/versions') });
  const file = join(dir, 'projects/sample-deck/project.json');
  const project = JSON.parse(readFileSync(file, 'utf8'));
  const p = project.pages[0];
  const title = p.elements.find(e => e.id === 'el_title1');
  Object.assign(title, { x: 200, y: 200, width: 600, height: 120, rotation: 0, zIndex: 1, locked: false, visible: true });
  p.elements = [title];
  p.motion = { steps: 1, source: `export default ctx => {
    window.__selectionMotionInits = (window.__selectionMotionInits || 0) + 1;
    if (${JSON.stringify(mode)} === 'pending' && window.__selectionMotionInits > 1) {
      window.__pendingSnapshotStarted = true;
      return new Promise(resolve=>ctx.signal.addEventListener('abort',()=>{window.__pendingSnapshotAborted=true;resolve({step(){}});},{once:true}));
    }
    const title = ctx.element('el_title1').node;
    if (${JSON.stringify(mode)} === 'pointer-none') {
      ctx.root.style.pointerEvents = 'none';
      title.style.pointerEvents = 'none';
    }
    if (${JSON.stringify(mode)} === 'decoration') {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;background:transparent';
      ctx.root.append(overlay);
    }
    return { step() { title.style.transform = 'translate(100px, 0px)'; } };
  }` };
  writeFileSync(file, JSON.stringify(project, null, 2));
  server = createServer({ dataDir: dir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard [data-element-id="el_title1"]');
  return { page, errors, file };
}

for (const mode of ['normal', 'pointer-none', 'decoration']) {
  test(`screen selection (${mode}): click and deselect preserve the rendered motion board`, async t => {
    const { page, errors, file } = await open(t, mode);
    const before = readFileSync(file, 'utf8');
    await page.locator('[data-step-view]').selectOption('1');
    await page.waitForSelector('#artboard[data-step-shown="1"]');
    await page.evaluate(() => { window.__selectionBoard = document.querySelector('#artboard'); });
    const initCount = await page.evaluate(() => window.__selectionMotionInits);
    const title = page.locator('#artboard [data-element-id="el_title1"]');
    const box = await title.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // Coordinate clicks exercise actual hit testing, even when motion disables native pointer events.
    assert.equal(await page.locator('#artboard [data-resize="el_title1"]').count(), 8, 'visible element stays selected after pointerup');
    assert.equal(await page.evaluate(() => document.querySelector('#artboard') === window.__selectionBoard), true, 'selection must not replace the board');
    assert.equal(await page.evaluate(() => window.__selectionMotionInits), initCount, 'selection must not restart motion');
    const boardBox = await page.locator('#artboard').boundingBox();
    await page.mouse.click(boardBox.x + boardBox.width - 30, boardBox.y + boardBox.height - 30);
    assert.equal(await page.locator('#artboard [data-resize="el_title1"]').count(), 0, 'empty canvas clears selection');
    assert.equal(await page.evaluate(() => document.querySelector('#artboard') === window.__selectionBoard), true, 'deselection must not replace the board');
    assert.equal(await page.evaluate(() => window.__selectionMotionInits), initCount);
    assert.equal(await page.locator('[data-step-view]').inputValue(), '1');
    assert.equal(readFileSync(file, 'utf8'), before, 'selection does not save project data');
    assert.deepEqual(errors, []);
  });
}

test('screen drag and resize preserve motion DOM during the gesture', async t => {
  const { page, errors } = await open(t, 'normal');
  await page.locator('[data-step-view]').selectOption('1');
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  const title = page.locator('#artboard [data-element-id="el_title1"]');
  const box = await title.boundingBox();
  await page.evaluate(() => { window.__selectionBoard = document.querySelector('#artboard'); });
  const initCount = await page.evaluate(() => window.__selectionMotionInits);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
  assert.equal(await page.evaluate(() => document.querySelector('#artboard') === window.__selectionBoard), true);
  assert.equal(await page.evaluate(() => window.__selectionMotionInits), initCount);
  assert.notEqual(await title.evaluate(n => n.style.translate), '');
  await page.mouse.up();
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  const handle = await page.locator('[data-resize="el_title1"][data-handle="se"]').boundingBox();
  await page.evaluate(() => { window.__selectionBoard = document.querySelector('#artboard'); });
  const resizedInitCount = await page.evaluate(() => window.__selectionMotionInits);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 20);
  assert.equal(await page.evaluate(() => document.querySelector('#artboard') === window.__selectionBoard), true);
  assert.equal(await page.evaluate(() => window.__selectionMotionInits), resizedInitCount);
  await page.mouse.up();
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  assert.equal(await page.locator('[data-resize="el_title1"]').count(), 8);
  assert.deepEqual(errors, []);
});

test('screen hit testing ignores elements hidden by ancestor opacity', async t => {
  const { page, errors } = await open(t, 'normal');
  await page.locator('[data-step-view]').selectOption('1');
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  const box = await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  // ctx.root is public motion API; hiding a parent must make descendants unpickable too.
  await page.evaluate(() => { document.querySelector('#artboard').style.opacity = '0'; });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await page.locator('#artboard [data-resize="el_title1"]').count(), 0, 'transparent ancestors make their children invisible');
  assert.deepEqual(errors, []);
});


test('leaving a page immediately aborts a pending post-drag motion snapshot',async t=>{
  const {page,errors}=await open(t,'pending');
  await page.locator('[data-step-view]').selectOption('1');
  await page.waitForSelector('#artboard[data-step-shown="1"]');
  const box=await page.locator('#artboard [data-element-id="el_title1"]').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+20,box.y+box.height/2+20);await page.mouse.up();
  await page.waitForFunction(()=>window.__pendingSnapshotStarted);
  await page.locator('[data-action="switch"][data-id="page_scene2"]').click();
  await page.waitForFunction(()=>window.__pendingSnapshotAborted);
  assert.equal(await page.locator('#artboard').getAttribute('data-page-id'),'page_scene2');
  assert.equal(await page.locator('#artboard-holder > div').count(),1);
  assert.deepEqual(errors,[]);
});
