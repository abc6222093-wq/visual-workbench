// 第 13 轮 H 组：总览的文件夹、设计卡片、草稿页数、从文案新建、拖进来导入。
// 真实服务（临时数据目录 + 临时 home）+ 真实浏览器；文件夹 / 整理 / 从文案新建的接口用 page.route 按 docs/round13-contract.md §3 的形状假冒，
// 这样不依赖 C 组的进度，也能断言界面发出的请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './helpers/isolated-server.js';
import { launchBrowser } from '../src/browser.js';
import { folderView, moveMenuItems, folderNameError, breadcrumbHtml, formatBackupTime } from '../web/folders.js';
import { designCardText, renderDesignCardIcon, hasDesignCard } from '../web/design-card.js';
import { designCardText as briefDesignCardText } from '../src/brief.js';

const CARD = { direction: '方向 3｜稿纸与印章', concept: '像一张日语作文稿纸', colors: ['#FFFFFF', '#88DAD1', '#161B1A'], fonts: ['站酷小薇 84px 标题', '思源宋体 26px 名字'], traits: ['稿纸方格底纹', '左侧竖排标题'], at: '2026-10-06T00:00:00.000Z' };

test('folders.js / design-card.js 纯逻辑', () => {
  const projects = [{ id: 'a' }, { id: 'b', folder: '课程' }, { id: 'c', folder: '课程' }, { id: 'd', folder: '只在项目上' }];
  const root = folderView(projects, [{ name: '课程' }, { name: '空的' }], '');
  assert.deepEqual(root.folders, [{ name: '课程', count: 2 }, { name: '空的', count: 0 }, { name: '只在项目上', count: 1 }]);
  assert.deepEqual(root.projects.map((p) => p.id), ['a']);
  assert.deepEqual(folderView(projects, [], '课程').projects.map((p) => p.id), ['b', 'c']);
  assert.deepEqual(moveMenuItems(['课程', '空的'], '课程').map((i) => [i.label, !!i.disabled]), [['课程', true], ['空的', false], [undefined, false], ['总览（不放进文件夹）', false]]);
  assert.equal(moveMenuItems([], '').at(-1).disabled, true);
  assert.equal(folderNameError('  '), '请输入文件夹名称');
  assert.match(folderNameError('a/b'), /不能包含/);
  assert.match(folderNameError('字'.repeat(61)), /60/);
  assert.equal(folderNameError(' 好 '), '');
  assert.match(breadcrumbHtml('<x>'), /项目总览<\/button>.*&lt;x&gt;/);
  assert.equal(breadcrumbHtml(''), '<h1 class="ed-title">项目总览</h1>');
  assert.match(formatBackupTime('2026-10-06T08:05:00'), /^10月6日 08:05$/);
  // 和 src/brief.js 同一格式
  const project = { id: 'p', name: '水曜课表', designCard: CARD };
  assert.equal(designCardText(project), briefDesignCardText(project));
  assert.equal(designCardText(project).split('\n')[0], '设计风格参考（项目「水曜课表」的设计卡片）');
  assert.match(designCardText(project), /配色：#FFFFFF #88DAD1 #161B1A\n字体：站酷小薇 84px 标题 \/ 思源宋体 26px 名字\n特征：稿纸方格底纹 · 左侧竖排标题/);
  assert.equal(designCardText({ id: 'x' }), '');
  assert.equal(renderDesignCardIcon({ id: 'x', designCard: null }), '');
  assert.equal(hasDesignCard({ designCard: { colors: [] } }), false);
  assert.match(renderDesignCardIcon(project), /data-action="design-card" data-id="p"/);
});

// 起服务 + 三个真实项目；fake 保存文件夹状态，GET /api/projects 按它补上 folder / designCard / drafts
async function workbench(t) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-round13-home-'));
  const server = createServer({ dataDir: dir });
  let browser;
  t.after(async () => { await browser?.close(); if (server.listening) await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const [id, name] of [['p1', '项目一'], ['p2', '项目二'], ['p3', '项目三']]) {
    const r = await fetch(url + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
    assert.equal(r.status, 201, await r.clone().text());
  }
  const fake = { folders: ['课程'], folderOf: { p2: '课程' }, backup: { at: '2026-10-06T08:05:00' }, extra: { p1: { drafts: 2 }, p3: { designCard: CARD } }, calls: [] };
  const list = () => fake.folders.map((name) => ({ name, count: Object.values(fake.folderOf).filter((f) => f === name).length }));
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route((u) => u.pathname === '/api/projects' || u.pathname.startsWith('/api/projects/') || u.pathname.startsWith('/api/folders') || u.pathname.startsWith('/api/organize'), async (route) => {
    const req = route.request(), u = new URL(req.url()), method = req.method(), body = req.postDataJSON?.() ?? null;
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const reply = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (parts[1] === 'folders') {
      fake.calls.push([method, u.pathname, body]);
      if (method === 'GET') return reply({ folders: list(), backup: fake.backup });
      if (method === 'POST') { fake.folders.push(body.name); return reply({ folders: list() }, 201); }
      const name = parts[2];
      if (method === 'PATCH') { fake.folders = fake.folders.map((f) => (f === name ? body.name : f)); for (const k in fake.folderOf) if (fake.folderOf[k] === name) fake.folderOf[k] = body.name; return reply({ folders: list() }); }
      if (method === 'DELETE') { fake.folders = fake.folders.filter((f) => f !== name); for (const k in fake.folderOf) if (fake.folderOf[k] === name) delete fake.folderOf[k]; return reply({ folders: list() }); }
    }
    if (parts[1] === 'organize') {
      fake.calls.push([method, u.pathname, body]);
      if (method === 'POST' && parts[2] === 'restore') { fake.backup = null; fake.folderOf = { p2: '课程' }; return reply({ restored: 3 }); }
      return reply({ backup: fake.backup });
    }
    if (u.pathname === '/api/projects' && method === 'GET') {
      const res = await route.fetch(); const rows = await res.json();
      return reply(rows.map((r) => ({ ...r, folder: fake.folderOf[r.id] || '', ...(fake.extra[r.id] || {}) })));
    }
    if (u.pathname === '/api/projects' && method === 'POST' && body?.draft) {
      fake.calls.push([method, u.pathname, body]);
      const res = await route.fetch({ postData: JSON.stringify({ id: 'from-draft', name: body.name || '文案项目' }) });
      const out = await res.json();
      return reply({ ...out, draft: { method: 'plain', pages: 2, note: '没有分页记号：按空行和字数分成了 2 页' } }, 201);
    }
    if (parts.length === 3 && method === 'PATCH' && body && 'folder' in body) {
      fake.calls.push([method, u.pathname, body]);
      if (body.folder) { fake.folderOf[parts[2]] = body.folder; if (!fake.folders.includes(body.folder)) fake.folders.push(body.folder); } else delete fake.folderOf[parts[2]];
      return reply({ project: { id: parts[2] }, revision: 'r' });
    }
    return route.fallback();
  });
  return { page, url, fake, errors };
}
const cells = (page) => page.locator('.hm-grid > .hm-cell[data-project-id]').evaluateAll((els) => els.map((e) => e.dataset.projectId));
const folderCards = (page) => page.locator('.hm-cell--folder').evaluateAll((els) => els.map((e) => `${e.dataset.folder}|${e.querySelector('small').textContent}`));
const lastCall = (fake, method) => fake.calls.filter((c) => c[0] === method).at(-1);

test('总览文件夹：根上先列文件夹再列未分类项目、进出文件夹、右键移到…、拖进文件夹、拖到面包屑移出', async (t) => {
  const { page, url, fake, errors } = await workbench(t);
  await page.goto(url);
  await page.locator('.hm-cell--folder').first().waitFor();
  assert.deepEqual(await folderCards(page), ['课程|1 个项目']);
  assert.deepEqual(await cells(page), ['p1', 'p3']);
  // 文件夹卡片排在项目前面
  assert.equal(await page.locator('.hm-grid > .hm-cell').first().getAttribute('data-folder'), '课程');
  assert.equal(await page.locator('.ed-top h1').innerText(), '项目总览');
  // 进文件夹：面包屑、只有里面的项目
  await page.locator('.hm-cell--folder > .hm-card').click();
  await page.locator('.hm-crumb').waitFor();
  assert.match(await page.locator('.ed-top h1').innerText(), /项目总览\s*›\s*课程/);
  assert.deepEqual(await cells(page), ['p2']);
  assert.equal(await page.locator('.hm-cell--folder').count(), 0);
  await page.locator('.hm-crumb').click();
  await page.locator('.hm-cell--folder').waitFor();
  assert.deepEqual(await cells(page), ['p1', 'p3']);
  // 右键「移到…」→ 小菜单列出文件夹和总览
  await page.locator('.hm-cell[data-project-id="p1"] > .hm-card').click({ button: 'right' });
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['打开', '重命名', '复制项目', '移到…', '删除项目']);
  await page.getByRole('menuitem', { name: '移到…' }).click();
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['课程', '总览（不放进文件夹）']);
  assert.equal(await page.getByRole('menuitem', { name: '总览（不放进文件夹）' }).isDisabled(), true);
  await page.getByRole('menuitem', { name: '课程' }).click();
  await page.waitForFunction(() => !document.querySelector('.hm-grid > .hm-cell[data-project-id="p1"]'));
  assert.deepEqual(lastCall(fake, 'PATCH'), ['PATCH', '/api/projects/p1', { folder: '课程' }]);
  assert.deepEqual(await folderCards(page), ['课程|2 个项目']);
  // 拖项目卡片到文件夹卡片上
  await page.locator('.hm-cell[data-project-id="p3"] > .hm-card').dragTo(page.locator('.hm-cell--folder > .hm-card'));
  await page.waitForFunction(() => !document.querySelector('.hm-grid > .hm-cell[data-project-id="p3"]'));
  assert.deepEqual(lastCall(fake, 'PATCH'), ['PATCH', '/api/projects/p3', { folder: '课程' }]);
  assert.deepEqual(await folderCards(page), ['课程|3 个项目']);
  // 文件夹里：多选两个，拖到面包屑「项目总览」上移出
  await page.locator('.hm-cell--folder > .hm-card').click();
  await page.locator('.hm-crumb').waitFor();
  assert.deepEqual((await cells(page)).sort(), ['p1', 'p2', 'p3']);
  await page.locator('.hm-cell[data-project-id="p1"] > .hm-card').click({ modifiers: ['Shift'] });
  await page.locator('.hm-cell[data-project-id="p3"] > .hm-card').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.hm-cell[data-project-id="p3"] > .hm-card').dragTo(page.locator('.hm-crumb'));
  await page.waitForFunction(() => document.querySelectorAll('.hm-grid > .hm-cell[data-project-id]').length === 1);
  assert.deepEqual(fake.calls.filter((c) => c[0] === 'PATCH').slice(-2).map((c) => [c[1], c[2].folder]).sort(), [['/api/projects/p1', ''], ['/api/projects/p3', '']]);
  assert.deepEqual(await cells(page), ['p2']);
  // 多选右键：「把 n 个项目移到…」对选中的全部生效
  await page.locator('.hm-crumb').click();
  await page.locator('.hm-cell--folder').waitFor();
  await page.locator('.hm-cell[data-project-id="p1"] > .hm-card').click({ modifiers: ['Shift'] });
  await page.locator('.hm-cell[data-project-id="p3"] > .hm-card').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.hm-cell[data-project-id="p3"] > .hm-card').click({ button: 'right' });
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['把 2 个项目移到…', '删除 2 个项目', '取消选择']);
  await page.getByRole('menuitem', { name: '把 2 个项目移到…' }).click();
  await page.getByRole('menuitem', { name: '课程' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.hm-grid > .hm-cell[data-project-id]').length === 0);
  assert.deepEqual(fake.folderOf, { p1: '课程', p2: '课程', p3: '课程' });
  assert.deepEqual(errors, []);
});

test('总览文件夹：新建、右键重命名 / 删除（确认文案）、退回整理前', async (t) => {
  const { page, url, fake, errors } = await workbench(t);
  await page.goto(url);
  await page.locator('.hm-cell--folder').first().waitFor();
  // 新建文件夹：名字校验 + POST
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.locator('[data-folder-form] input[name="name"]').fill('a/b');
  await page.locator('[data-folder-form] [type="submit"]').click();
  assert.match(await page.locator('[data-folder-error]').innerText(), /不能包含/);
  await page.locator('[data-folder-form] input[name="name"]').fill('  海报  ');
  await page.locator('[data-folder-form] [type="submit"]').click();
  await page.locator('.hm-cell--folder[data-folder="海报"]').waitFor();
  assert.deepEqual(lastCall(fake, 'POST'), ['POST', '/api/folders', { name: '海报' }]);
  assert.deepEqual(await folderCards(page), ['课程|1 个项目', '海报|0 个项目']);
  // 空文件夹里有提示
  await page.locator('.hm-cell--folder[data-folder="海报"] > .hm-card').click();
  await page.locator('.hm-folder-empty').waitFor();
  await page.locator('.hm-crumb').click();
  // 右键文件夹：打开 / 重命名 / 删除文件夹
  await page.locator('.hm-cell--folder[data-folder="课程"] > .hm-card').click({ button: 'right' });
  assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['打开', '重命名', '删除文件夹']);
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.locator('[data-folder-form] input[name="name"]').fill('秋季课程');
  await page.locator('[data-folder-form] [type="submit"]').click();
  await page.locator('.hm-cell--folder[data-folder="秋季课程"]').waitFor();
  assert.deepEqual(lastCall(fake, 'PATCH'), ['PATCH', '/api/folders/%E8%AF%BE%E7%A8%8B', { name: '秋季课程' }]);
  await page.locator('.hm-cell--folder[data-folder="秋季课程"] > .hm-card').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  assert.match(await page.locator('.g-sheet').innerText(), /删除文件夹「秋季课程」？[\s\S]*移到项目总览的根上，项目本身不会删除/);
  await page.locator('.g-sheet .g-btn--prism').click();
  await page.waitForFunction(() => !document.querySelector('.hm-cell--folder[data-folder="秋季课程"]'));
  assert.equal(lastCall(fake, 'DELETE')[1], '/api/folders/%E7%A7%8B%E5%AD%A3%E8%AF%BE%E7%A8%8B');
  assert.deepEqual(await cells(page), ['p1', 'p2', 'p3']);
  // 退回整理前
  const restore = page.getByRole('button', { name: /退回整理前/ });
  assert.equal(await restore.innerText(), '退回整理前（10月6日 08:05）');
  await restore.click();
  assert.match(await page.locator('.g-sheet').innerText(), /退回整理前？/);
  await page.locator('.g-sheet .g-btn--prism').click();
  await page.waitForFunction(() => !/退回整理前/.test(document.querySelector('.ed-top').innerText));
  assert.deepEqual(lastCall(fake, 'POST'), ['POST', '/api/organize/restore', {}]);
  assert.deepEqual(await cells(page), ['p1', 'p3']);
  assert.match(await page.locator('#toast').innerText(), /已退回整理前（3 个项目）/);
  assert.deepEqual(errors, []);
});

test('总览卡片：草稿页数、设计卡片图标与弹窗、复制给 agent', async (t) => {
  const { page, url, errors } = await workbench(t);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  await page.goto(url);
  await page.locator('.hm-cell[data-project-id="p1"]').waitFor();
  const saved = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  t.after(async () => { if (saved !== null) await page.evaluate((s) => navigator.clipboard.writeText(s), saved).catch(() => {}); });
  assert.equal(await page.locator('.hm-cell[data-project-id="p1"] .hm-chip--draft').innerText(), '草稿 2 页');
  assert.equal(await page.locator('.hm-cell[data-project-id="p3"] .hm-chip').count(), 0);
  // 设计卡片图标只在有卡片的项目上，且常显在母版开关旁边
  assert.equal(await page.locator('.hm-cell[data-project-id="p1"] .hm-design').count(), 0);
  const icon = page.locator('.hm-cell[data-project-id="p3"] > .hm-design');
  assert.equal(await icon.isVisible(), true);
  const [ib, mb] = [await icon.boundingBox(), await page.locator('.hm-cell[data-project-id="p3"] > .hm-master').boundingBox()];
  assert.ok(ib.x + ib.width <= mb.x && Math.abs(ib.y - mb.y) < 2, '设计卡片图标在母版开关左边同一行');
  await icon.click();
  const sheet = page.locator('[data-design-card]');
  await sheet.waitFor();
  assert.equal(await sheet.locator('h2').innerText(), CARD.direction);
  assert.match(await sheet.innerText(), /像一张日语作文稿纸/);
  assert.deepEqual(await sheet.locator('.hm-dcard__swatch figcaption').allInnerTexts(), CARD.colors);
  assert.equal(await sheet.locator('.hm-dcard__swatch span').first().evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
  assert.match(await sheet.innerText(), /特征\s*稿纸方格底纹 · 左侧竖排标题/);
  await sheet.getByRole('button', { name: '复制给 agent' }).click();
  await page.waitForFunction(() => /已复制设计卡片/.test(document.querySelector('#toast').textContent));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied, designCardText({ id: 'p3', name: '项目三', designCard: CARD }));
  await sheet.getByRole('button', { name: '关闭' }).click();
  assert.equal(await page.locator('[data-design-card]').count(), 0);
  assert.deepEqual(errors, []);
});

test('新建项目「从文案开始」：粘贴文案 → POST { draft, name, 画板 } → 打开项目并提示怎么分的', async (t) => {
  const { page, url, fake, errors } = await workbench(t);
  await page.goto(url);
  await page.locator('.hm-cell[data-project-id="p1"]').waitFor();
  await page.locator('.ed-top [data-action="new"]').click();
  await page.locator('#new-form').waitFor();
  assert.equal(await page.locator('[data-draft-fields]').isVisible(), false);
  await page.getByLabel('从文案开始').check();
  assert.equal(await page.locator('[data-draft-fields]').isVisible(), true);
  assert.equal(await page.locator('#new-form input[name="name"]').evaluate((e) => e.required), false);
  // 没有文案时不提交
  await page.locator('#new-form [type="submit"]').click();
  assert.match(await page.locator('#toast').innerText(), /请先粘贴文案/);
  assert.equal(lastCall(fake, 'POST'), undefined);
  // 选 .md 文件读入
  await page.locator('[data-draft-input]').setInputFiles({ name: '水曜课表.md', mimeType: 'text/markdown', buffer: Buffer.from('第一段文字\n\n第二段文字') });
  await page.waitForFunction(() => document.querySelector('#new-form textarea[name="draft"]').value.includes('第二段'));
  assert.equal(await page.locator('#new-form input[name="name"]').inputValue(), '水曜课表');
  await page.locator('#new-form select[name="preset"]').selectOption('poster-a4');
  await page.locator('#new-form [type="submit"]').click();
  await page.waitForSelector('#artboard > iframe');
  assert.deepEqual(lastCall(fake, 'POST'), ['POST', '/api/projects', { draft: '第一段文字\n\n第二段文字', name: '水曜课表', preset: 'poster-a4', width: 2480, height: 3508 }]);
  await page.waitForFunction(() => /按空行和字数分成了 2 页/.test(document.querySelector('#toast').textContent));
  assert.deepEqual(errors, []);
});

// 拖进来：用 DataTransfer 造真实的 drop 事件；import-html.js 换成桩，记录 openImportDialog 收到的参数
test('拖进总览：「松开导入」高亮；.html 交给导入对话框直接开始；.md 从文案新建', async (t) => {
  const { page, url, fake, errors } = await workbench(t);
  await page.route((u) => u.pathname === '/import-html.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export function filesFromDataTransfer(dt) { const files = [...dt.files]; return Promise.resolve(files.map((file) => ({ path: 'drop/' + file.name, file }))); }
    export function openImportDialog(opts) { window.importCalls = window.importCalls || []; window.importCalls.push({ files: opts.files.map((f) => f.path), autoStart: opts.autoStart, hasApi: typeof opts.api === 'function', onDone: typeof opts.onDone, onCreated: typeof opts.onCreated }); }
  ` }));
  await page.goto(url);
  await page.locator('.hm-cell[data-project-id="p1"]').waitFor();
  const drag = (type, names) => page.evaluate(([type, names]) => {
    const dt = new DataTransfer();
    for (const n of names) dt.items.add(new File([n.endsWith('.md') ? '# 拖进来的文案\n\n正文' : '<h1>x</h1>'], n));
    document.querySelector('.hm-scroll').dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [type, names]);
  await drag('dragenter', ['a.html']);
  await drag('dragover', ['a.html']);
  assert.equal(await page.locator('.hm-panel').evaluate((e) => e.classList.contains('is-drop-import')), true);
  assert.equal(await page.locator('.hm-drop-hint').isVisible(), true);
  assert.match(await page.locator('.hm-drop-hint').innerText(), /松开导入/);
  await drag('drop', ['a.html', 'style.css']);
  assert.equal(await page.locator('.hm-drop-hint').isVisible(), false);
  await page.waitForFunction(() => window.importCalls?.length === 1);
  assert.deepEqual(await page.evaluate(() => window.importCalls[0]), { files: ['drop/a.html', 'drop/style.css'], autoStart: true, hasApi: true, onDone: 'function', onCreated: 'function' });
  await drag('drop', ['文案.md']);
  await page.waitForSelector('#artboard > iframe');
  assert.deepEqual(lastCall(fake, 'POST'), ['POST', '/api/projects', { draft: '# 拖进来的文案\n\n正文', name: '文案' }]);
  await page.waitForFunction(() => /分成了 2 页/.test(document.querySelector('#toast').textContent));
  assert.equal(await page.evaluate(() => window.importCalls.length), 1);
  assert.deepEqual(errors, []);
});
