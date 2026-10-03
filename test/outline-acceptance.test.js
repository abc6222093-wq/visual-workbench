import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';
import { launchBrowser } from '../src/browser.js';

// Use a disposable copy: the checked-in sample and real user projects stay untouched.
test('sample-deck: actual outline extraction, edit two texts, apply without changing any other element data', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-outline-acceptance-'));
  const projectDir = join(dir, 'projects/sample-deck');
  cpSync(new URL('../examples/sample-deck/', import.meta.url), projectDir, { recursive: true, filter: path => !String(path).includes('/versions') });
  const file = join(projectDir, 'project.json');
  const original = JSON.parse(readFileSync(file, 'utf8'));
  const server = createServer({ dataDir: dir });
  let browser;
  t.after(async () => {
    await browser?.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('[data-action="open"][data-id="sample-deck"]').click();
  await page.waitForSelector('#artboard');
  await page.locator('[data-action="toggle-outline"]').click();
  assert.equal(await page.locator('[data-outline-page]').count(), original.pages.length, 'old project opens with one starter card per page');
  const extracted = page.waitForResponse(r => r.url().endsWith('/outline/extract') && r.ok());
  await page.locator('[data-outline-action="extract"]').click();
  await extracted;
  await page.waitForFunction(() => !document.querySelector('#outline-host').inert);
  const afterExtract = JSON.parse(readFileSync(file, 'utf8'));
  const cover = afterExtract.pages[0];
  assert.equal(cover.outline.screens, cover.motion.steps + 1);
  assert.equal(cover.outline.rows.find(r => r.elementId === 'el_bullet1').from, 2, 'capture sees initial hidden bullet and its appearance after first click');
  assert.deepEqual(afterExtract.pages.map(p => p.elements), original.pages.map(p => p.elements));
  const pairs = [];
  for (const [elementId, text] of [['el_title1', '先理解，再行动'], ['el_subtitle1', '写大纲 · agent 排版 · エイ 微调']]) {
    const row = cover.outline.rows.find(r => r.elementId === elementId);
    await page.locator(`[data-outline-row="${row.id}"] textarea`).fill(text);
    pairs.push({ elementId, before: structuredClone(cover.elements.find(e => e.id === elementId)), text });
  }
  const applied = page.waitForResponse(r => r.url().endsWith('/outline/apply') && r.ok());
  await page.locator('[data-outline-action="apply"]').click();
  const result = await (await applied).json();
  assert.equal(result.applied.length, 2);
  assert.deepEqual(result.unapplied, []);
  await page.waitForFunction(() => !document.querySelector('#outline-host').inert);
  const afterApply = JSON.parse(readFileSync(file, 'utf8'));
  for (const pair of pairs) {
    pair.after = afterApply.pages[0].elements.find(e => e.id === pair.elementId);
    assert.deepEqual(pair.after, { ...pair.before, text: pair.text });
    delete pair.text;
  }
  const expectedPages = structuredClone(original.pages);
  for (const pair of pairs) expectedPages[0].elements.find(e => e.id === pair.elementId).text = pair.after.text;
  assert.deepEqual(afterApply.pages.map(p => p.elements), expectedPages.map(p => p.elements));
  const versions = await (await fetch(`${origin}/api/projects/sample-deck/versions`)).json();
  assert.equal(versions.length, 2, 'extract and apply each save a version first');
  const briefs = [];
  for (const ids of [afterApply.pages.map(p => p.id), ['page_cover1']]) {
    const brief = await (await fetch(`${origin}/api/projects/sample-deck/outline/brief?pageIds=${ids.join(',')}`)).json();
    briefs.push(brief.text);
    assert.ok(brief.text.includes(file));
    for (const id of ids) assert.ok(brief.text.includes(id));
    if (ids.length === 1) assert.ok(!brief.text.includes('page_scene2'));
  }
  const external = structuredClone(afterApply);
  external.pages[1].outline.notes = 'agent 从文件写入的新备注';
  writeFileSync(file, JSON.stringify(external));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-outline-field=notes]')].some(n => n.value === 'agent 从文件写入的新备注'));
  const card = page.locator('[data-outline-page="page_cover1"]');
  const sketch = await card.locator('[data-outline-composition]').boundingBox();
  assert.ok(Math.abs(sketch.width / sketch.height - original.artboard.width / original.artboard.height) < .02, 'outline sketch preserves artboard proportions');
  const upload = await fetch(`${origin}/api/library`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'大纲主图',mime:'image/svg+xml',width:64,height:64,data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#445566"/></svg>').toString('base64')}) });
  assert.equal(upload.status,201);
  await card.locator('[data-outline-action="add-image"]').click();
  await page.locator('[data-outline-library="0"]').click();
  const image = card.locator('[data-outline-image]').last();
  await image.waitFor();
  const imageSaved = page.waitForResponse(r=>r.request().method()==='PUT'&&r.ok());
  await image.locator('input').fill('这张做主图');
  await imageSaved;
  const withImage = JSON.parse(readFileSync(file,'utf8'));
  assert.equal(withImage.pages[0].outline.images.at(-1).caption,'这张做主图');
  assert.deepEqual(withImage.pages.map(p=>p.elements),expectedPages.map(p=>p.elements), 'library outline image never places or changes canvas elements');
  assert.deepEqual(errors, []);
  console.log('ROUND6_COPY_BRIEFS=' + JSON.stringify(briefs));
  console.log('ROUND6_SAMPLE_ELEMENT_COMPARISON=' + JSON.stringify(pairs));
});
