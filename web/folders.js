// 第 13 轮：总览的文件夹（一层，不嵌套）。纯逻辑 + 渲染片段 + 拖放；home.js 组装。
// 接口见 docs/round13-contract.md §3：GET/POST/PATCH/DELETE /api/folders、PATCH /api/projects/:id { folder }、/api/organize。
export const ROOT_LABEL = '项目总览';
export const PROJECTS_MIME = 'application/x-vw-projects';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = (name) => encodeURIComponent(name);

// 访达风格的文件夹图标（Lucide folder，ISC 许可）
export function folderIcon(size = 18) {
  return `<svg class="g-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
}

/** 文件夹名校验（和服务端同一规则）：去首尾空白、非空、≤ 60 字、不含 / \。返回错误文案或 ''。 */
export function folderNameError(name) {
  const n = String(name ?? '').trim();
  if (!n) return '请输入文件夹名称';
  if ([...n].length > 60) return '文件夹名称最多 60 个字';
  if (/[\\/]/.test(n)) return '文件夹名称不能包含 / 或 \\';
  return '';
}

/**
 * 当前视图要列的内容。projects：GET /api/projects 的项；folders：GET /api/folders 的 folders（可缺）。
 * current 为 '' 表示总览根：先列全部文件夹（含空的、含只在项目上出现的），再列没放进文件夹的项目；否则只列这个文件夹里的项目。
 */
export function folderView(projects = [], folders = [], current = '') {
  const counts = new Map();
  for (const f of folders || []) if (f?.name) counts.set(f.name, 0);
  for (const p of projects) if (p.folder) counts.set(p.folder, (counts.get(p.folder) || 0) + 1);
  const all = [...counts].map(([name, count]) => ({ name, count }));
  if (current) return { folders: [], projects: projects.filter((p) => p.folder === current), all };
  return { folders: all, projects: projects.filter((p) => !p.folder), all };
}

// 玻璃文件夹（第 17 轮）：左上角带小标签的 📁 形状，后片、露出来的几张缩略图（像文件从文件夹里露出来）、前片，外沿一圈白亮边。
// 形状按 160×100（和项目缩略图同为 16:10）画；玻璃的模糊、白色、投影在 home-selection.css。
const FOLDER_BACK = 'M4 19Q4 11 12 11H48Q53 11 56.5 14.5L60 18H148Q156 18 156 26V88Q156 96 148 96H12Q4 96 4 88Z';
const FOLDER_FRONT = 'M4 41Q4 33 12 33H148Q156 33 156 41V88Q156 96 148 96H12Q4 96 4 88Z';
// 亮边：先画一圈很淡的深色描边（白底上也看得清轮廓），再叠白色亮边
const FOLDER_RIM = `<svg class="hm-folder__rim" viewBox="0 0 160 100" preserveAspectRatio="none" aria-hidden="true"><path class="hm-folder__edge" d="${FOLDER_BACK}"/><path class="hm-folder__edge" d="${FOLDER_FRONT}"/><path d="${FOLDER_BACK}"/><path d="${FOLDER_FRONT}"/><path class="hm-folder__shine" d="M12 34H148"/></svg>`;
/** 文件夹卡片。thumbs：露出来的缩略图张数（最多 3；home.js 往 [data-thumb-folder] 里放缩略图）；空文件夹只有玻璃文件夹本身。 */
export function folderCardHtml({ name, count }, esc = escape, thumbs = 0) {
  const papers = Array.from({ length: Math.min(3, Math.max(0, thumbs)) }, (_, i) => `<span class="hm-folder__paper hm-folder__paper--${i}" data-thumb-folder="${esc(name)}" data-thumb-index="${i}"></span>`).join('');
  return `<div class="hm-cell hm-cell--folder" data-folder="${esc(name)}"><button class="hm-card hm-folder" data-action="folder-open" data-folder="${esc(name)}" data-drop-folder="${esc(name)}" title="打开文件夹「${esc(name)}」"><div class="hm-folder__art has-${Math.min(3, Math.max(0, thumbs))}"><span class="hm-folder__shadow"></span><span class="hm-folder__back"></span>${papers}<span class="hm-folder__front"></span>${FOLDER_RIM}</div><div class="hm-card__info"><strong>${esc(name)}</strong><small>${count} 个项目</small></div></button></div>`;
}

/** 面包屑：根上只有「项目总览」；文件夹里第一级可点返回，也是「移出文件夹」的放置目标。 */
export function breadcrumbHtml(current, esc = escape) {
  if (!current) return `<h1 class="ed-title">${ROOT_LABEL}</h1>`;
  return `<h1 class="ed-title hm-crumbs"><button type="button" class="hm-crumb" data-action="folder-root" data-drop-folder="" title="回到项目总览">${ROOT_LABEL}</button><span class="hm-crumbs__sep" aria-hidden="true">›</span><span class="hm-crumbs__here">${esc(current)}</span></h1>`;
}

/** 「移到…」小菜单：所有文件夹 + 「总览（不放进文件夹）」；当前所在的那一项不可点。 */
export function moveMenuItems(folderNames = [], currentFolder = '') {
  return [
    ...folderNames.map((name) => ({ label: name, action: `folder:${name}`, folder: name, disabled: name === currentFolder })),
    ...(folderNames.length ? [{ separator: true }] : []),
    { label: '总览（不放进文件夹）', action: 'folder:', folder: '', disabled: !currentFolder },
  ];
}

export function formatBackupTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 文件夹的动作：新建、重命名、删除、把项目移进 / 移出、退回整理前。 */
export function createFolderActions({ api, modal, closeModal = () => {}, confirm, notice = () => {}, refresh = async () => {}, flush = async () => {}, document: doc = globalThis.document }) {
  const report = async (task) => { try { return await task(); } catch (e) { notice(e.message); return null; } };
  function nameForm(title, value, submit, label) {
    modal(`<h2>${escape(title)}</h2><form class="project-management-form" data-folder-form><label>文件夹名称<input name="name" required maxlength="60" value="${escape(value)}" placeholder="例如：2026 秋季课程"></label><p class="g-sheet__note" data-folder-error hidden></p><div class="g-sheet__actions"><button type="button" class="g-btn" data-cancel>取消</button><button class="g-btn g-btn--prism" type="submit">${escape(label)}</button></div></form>`);
    const form = doc.querySelector('[data-folder-form]');
    if (!form) return;
    const input = form.elements.name, error = form.querySelector('[data-folder-error]');
    form.querySelector('[data-cancel]').onclick = closeModal;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = folderNameError(input.value);
      if (msg) { error.textContent = msg; error.hidden = false; return; }
      try { await submit(input.value.trim()); }
      catch (err) { error.textContent = err.message; error.hidden = false; }
    };
    input.focus(); input.select();
  }
  const create = () => nameForm('新建文件夹', '', async (name) => {
    await api('/api/folders', 'POST', { name });
    closeModal(); await refresh(); notice(`已新建文件夹「${name}」`);
  }, '新建');
  const rename = (old) => nameForm('重命名文件夹', old, async (name) => {
    if (name !== old) await api(`/api/folders/${enc(old)}`, 'PATCH', { name });
    closeModal(); await refresh(name !== old ? { renamed: [old, name] } : undefined); notice('文件夹名称已更新');
  }, '保存名称');
  const remove = (name) => report(async () => {
    if (!await confirm(`删除文件夹「${name}」？`, '里面的项目会移到项目总览的根上，项目本身不会删除。')) return false;
    await api(`/api/folders/${enc(name)}`, 'DELETE', {});
    await refresh({ removed: name }); notice('文件夹已删除，里面的项目已移到项目总览');
    return true;
  });
  // folder 为 '' = 移出文件夹
  const move = (ids, folder) => report(async () => {
    if (!ids.length) return false;
    for (const id of ids) { await flush(id); await api(`/api/projects/${enc(id)}`, 'PATCH', { folder }); }
    await refresh();
    notice(folder ? `已把 ${ids.length} 个项目移到「${folder}」` : `已把 ${ids.length} 个项目移到项目总览`);
    return true;
  });
  const restore = (backup) => report(async () => {
    const when = formatBackupTime(backup?.at);
    if (!await confirm('退回整理前？', `项目的名称和所在文件夹会恢复成${when ? ` ${when} ` : ''}整理之前的样子，项目内容不受影响。`)) return false;
    const out = await api('/api/organize/restore', 'POST', {});
    await refresh(); notice(`已退回整理前${out?.restored != null ? `（${out.restored} 个项目）` : ''}`);
    return true;
  });
  return { create, rename, remove, move, restore };
}

export const ORDER_MIME = 'application/x-vw-order';
/** 卡片的排序键：项目 "p:<编号>"，文件夹 "f:<名字>"。 */
export const cellKey = (cell) => (cell?.dataset.projectId ? `p:${cell.dataset.projectId}` : cell?.dataset.folder != null ? `f:${cell.dataset.folder}` : null);

/**
 * 总览卡片的拖动（第 13 轮放进文件夹 + 第 17 轮排序）：
 * - 项目卡片拖到文件夹卡片**正中**（或面包屑「项目总览」）= 放进文件夹（移出文件夹）：文件夹整个亮起来；
 * - 拖到两张卡片**之间** = 排序：卡片之间出现一条竖的插入线。文件夹卡片也能拖动排序（文件夹不能放进文件夹）。
 * 拖的是已选中的卡片就带上全部选中。root：总览滚动区所在的容器（含面包屑）；selectedIds()：当前选中的项目；
 * onMove(ids, folder)；onReorder(keys, beforeKey | null)（null = 放到最后）。返回 dispose。
 */
export function mountFolderDrops(root, { selectedIds = () => [], onMove = () => {}, onReorder = null } = {}) {
  const grid = root.querySelector('.hm-grid');
  const cellOf = (el) => { const c = el?.closest?.('.hm-cell'); return c && c.parentElement === grid ? c : null; };
  const has = (e, type) => [...(e.dataTransfer?.types || [])].includes(type);
  let hot = null, bar = null, drag = null, plan = null; // drag：{ keys, ids }；plan：{ folder } | { before }
  const light = (el) => { if (hot === el) return; hot?.classList.remove('is-drop-target'); hot = el; hot?.classList.add('is-drop-target'); };
  function hideBar() { bar?.remove(); bar = null; }
  function showBar(cell, after) {
    if (!bar) { bar = document.createElement('div'); bar.className = 'hm-insert'; bar.setAttribute('aria-hidden', 'true'); grid.append(bar); }
    const g = grid.getBoundingClientRect(), r = cell.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 16;
    bar.style.left = `${(after ? r.right + gap / 2 : r.left - gap / 2) - g.left}px`;
    bar.style.top = `${r.top - g.top}px`;
    bar.style.height = `${r.height}px`;
  }
  // 拖到文件夹卡片的正中（宽、高各中间 60%）才算放进去；边上一圈仍是排序
  function intoFolder(t, e) {
    if (!grid?.contains(t)) return true; // 面包屑
    const r = t.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    return fx > 0.2 && fx < 0.8 && fy > 0.1 && fy < 0.9;
  }
  function start(e) {
    const cell = cellOf(e.target); if (!cell) return;
    const key = cellKey(cell); if (!key) return;
    let ids = [], keys = [key];
    if (cell.dataset.projectId) {
      const id = cell.dataset.projectId, sel = selectedIds();
      ids = sel.includes(id) ? sel : [id];
      keys = ids.map((x) => `p:${x}`);
      e.dataTransfer.setData(PROJECTS_MIME, JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', ids.join('\n'));
    } else e.dataTransfer.setData('text/plain', cell.dataset.folder);
    e.dataTransfer.setData(ORDER_MIME, JSON.stringify(keys));
    e.dataTransfer.effectAllowed = 'move';
    drag = { keys, ids };
    root.classList.add('is-dragging-projects');
  }
  function over(e) {
    if (!has(e, PROJECTS_MIME) && !has(e, ORDER_MIME)) return;
    const t = e.target?.closest?.('[data-drop-folder]');
    if (t && has(e, PROJECTS_MIME) && intoFolder(t, e)) {
      light(t); hideBar(); plan = { folder: t.dataset.dropFolder || '' };
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      return;
    }
    light(null);
    if (!onReorder || !drag || !grid) { hideBar(); plan = null; return; }
    // 排序：在格子里找离鼠标最近的卡片（不算正在拖的），按左右半边决定插在它前面还是后面
    const cells = [...grid.children].filter((c) => c.classList.contains('hm-cell') && !drag.keys.includes(cellKey(c)));
    if (!cells.length) { hideBar(); plan = null; return; }
    let best = null, dist = Infinity;
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      const dx = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0;
      const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      const d = dy * 4 + dx; // 同一行优先
      if (d < dist) { dist = d; best = c; }
    }
    const r = best.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
    const next = after ? cells[cells.indexOf(best) + 1] : best;
    showBar(best, after);
    plan = { before: next ? cellKey(next) : null };
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  }
  function leave(e) { if (!root.contains(e.relatedTarget)) { light(null); hideBar(); } }
  function drop(e) {
    if (!has(e, PROJECTS_MIME) && !has(e, ORDER_MIME)) return;
    const p = plan, d = drag;
    light(null); hideBar(); plan = null;
    if (!p) return;
    e.preventDefault(); e.stopPropagation();
    if ('folder' in p) {
      let ids = d?.ids || [];
      if (!ids.length) try { ids = JSON.parse(e.dataTransfer.getData(PROJECTS_MIME) || '[]'); } catch {}
      if (ids.length) onMove(ids, p.folder);
    } else if (d) onReorder(d.keys, p.before);
  }
  function end() { light(null); hideBar(); plan = null; drag = null; root.classList.remove('is-dragging-projects'); }
  for (const card of root.querySelectorAll('.hm-cell[data-project-id] > .hm-card, .hm-cell--folder > .hm-card')) card.draggable = true;
  root.addEventListener('dragstart', start);
  root.addEventListener('dragover', over);
  root.addEventListener('dragleave', leave);
  root.addEventListener('drop', drop);
  root.addEventListener('dragend', end);
  return () => {
    end();
    root.removeEventListener('dragstart', start); root.removeEventListener('dragover', over);
    root.removeEventListener('dragleave', leave); root.removeEventListener('drop', drop); root.removeEventListener('dragend', end);
  };
}
