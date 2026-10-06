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

export function folderCardHtml({ name, count }, esc = escape) {
  return `<div class="hm-cell hm-cell--folder" data-folder="${esc(name)}"><button class="hm-card hm-folder" data-action="folder-open" data-folder="${esc(name)}" data-drop-folder="${esc(name)}" title="打开文件夹「${esc(name)}」"><div class="hm-card__thumb hm-folder__thumb">${folderIcon(64)}</div><div class="hm-card__info"><strong>${esc(name)}</strong><small>${count} 个项目</small></div></button></div>`;
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

/**
 * 把项目卡片拖到文件夹卡片（或面包屑「项目总览」）上：拖起时带上要移动的项目（拖的是已选中的卡片就带上全部选中）。
 * root：总览滚动区所在的容器（含面包屑）；selectedIds()：当前选中；onMove(ids, folder)。返回 dispose。
 */
export function mountFolderDrops(root, { selectedIds = () => [], onMove = () => {} } = {}) {
  const cellOf = (el) => el?.closest?.('.hm-cell[data-project-id]');
  const targetOf = (el) => el?.closest?.('[data-drop-folder]');
  const ours = (e) => [...(e.dataTransfer?.types || [])].includes(PROJECTS_MIME);
  let hot = null;
  const light = (el) => { if (hot === el) return; hot?.classList.remove('is-drop-target'); hot = el; hot?.classList.add('is-drop-target'); };
  function start(e) {
    const cell = cellOf(e.target); if (!cell) return;
    const id = cell.dataset.projectId, sel = selectedIds();
    const ids = sel.includes(id) ? sel : [id];
    e.dataTransfer.setData(PROJECTS_MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.join('\n'));
    e.dataTransfer.effectAllowed = 'move';
    root.classList.add('is-dragging-projects');
  }
  function over(e) {
    if (!ours(e)) return;
    const t = targetOf(e.target);
    light(t || null);
    if (!t) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  }
  function leave(e) { if (hot && !hot.contains(e.relatedTarget)) light(null); }
  function drop(e) {
    if (!ours(e)) return;
    const t = targetOf(e.target); light(null);
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    let ids = [];
    try { ids = JSON.parse(e.dataTransfer.getData(PROJECTS_MIME) || '[]'); } catch {}
    if (ids.length) onMove(ids, t.dataset.dropFolder || '');
  }
  function end() { light(null); root.classList.remove('is-dragging-projects'); }
  for (const cell of root.querySelectorAll('.hm-cell[data-project-id] > .hm-card')) cell.draggable = true;
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
