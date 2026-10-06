// 从其他项目添加页面（第 13 轮，docs/round13-contract.md §10）：左边项目列表（按文件夹分组，当前项目除外），
// 右边该项目的页面缩略图带勾选，底部「插到第 N 页后面」和「添加」。复制走已有的 op 'copy-from'（页面文件、素材、字体一起带）。
import { createThumbnails } from './thumbnails.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function openAddPagesDialog({ api, modal, closeModal, notice = () => {}, project, after, pagesOp, onDone = () => {} }) {
  const list = (await api('/api/projects')).filter(x => x.id !== project.id && !x.legacy && x.project?.pages?.length);
  if (!list.length) { notice('没有别的项目可以添加页面'); return; }
  const folderOf = x => x.folder ?? x.project?.folder ?? '';
  const groups = new Map();
  for (const x of [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))) {
    const f = folderOf(x);
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(x);
  }
  const ordered = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh-CN')));
  const position = Math.max(0, project.pages.findIndex(p => p.id === after));
  const options = project.pages.map((p, i) => `<option value="${esc(p.id)}" ${i === position ? 'selected' : ''}>第 ${i + 1} 页（${esc(p.name)}）</option>`).join('');
  modal(`<h2>从其他项目添加页面</h2><p class="g-sheet__note">选一个项目，勾选要添加的页面。页面用到的素材和字体一起复制，原项目不受影响。</p>
<div class="ap-body"><div class="ap-projects g-sheet__list" role="listbox" aria-label="项目">${ordered.map(f => `${f ? `<div class="ap-folder">${esc(f)}</div>` : groups.size > 1 ? '<div class="ap-folder">未放进文件夹</div>' : ''}${groups.get(f).map(x => `<button class="g-row ap-project" type="button" role="option" data-ap-project="${esc(x.id)}" aria-selected="false"><span class="g-row__text"><strong>${esc(x.name)}</strong><small>${x.project.pages.length} 页</small></span></button>`).join('')}`).join('')}</div>
<div class="ap-pages ed-scroll" aria-label="页面"><p class="g-sheet__empty">先在左边选一个项目</p></div></div>
<div class="ap-foot"><label class="g-field"><span>插到</span><select data-ap-after aria-label="插到哪一页后面">${options}</select><span>后面</span></label><span class="ap-count" data-ap-count>还没有勾选页面</span></div>
<div class="g-sheet__actions"><button class="g-btn" type="button" data-ap-cancel>取消</button><button class="g-btn g-btn--prism" type="button" data-ap-add disabled>添加</button></div>`);
  const sheet = document.querySelector('#modal-root .g-sheet');
  sheet.classList.add('ap-sheet');
  const thumbs = createThumbnails({ getProject: () => null, host: sheet });
  const state = { from: null, picked: [] };
  const pagesBox = sheet.querySelector('.ap-pages'), addButton = sheet.querySelector('[data-ap-add]'), count = sheet.querySelector('[data-ap-count]');
  const update = () => {
    addButton.disabled = !state.picked.length;
    count.textContent = state.picked.length ? `已勾选 ${state.picked.length} 页` : '还没有勾选页面';
  };
  function showProject(id) {
    const x = list.find(p => p.id === id);
    if (!x) return;
    state.from = x;
    state.picked = [];
    for (const b of sheet.querySelectorAll('[data-ap-project]')) { const on = b.dataset.apProject === id; b.classList.toggle('selected', on); b.setAttribute('aria-selected', String(on)); }
    pagesBox.innerHTML = `<div class="ap-grid">${x.project.pages.map((p, i) => `<label class="ap-page" data-ap-page="${esc(p.id)}"><span class="ap-thumb" data-ap-thumb="${i}"></span><span class="ap-label"><input class="g-check" type="checkbox" data-ap-check="${esc(p.id)}" aria-label="第 ${i + 1} 页 ${esc(p.name)}"><b>${String(i + 1).padStart(2, '0')}</b><i>${esc(p.name)}</i></span></label>`).join('')}</div>`;
    x.project.pages.forEach((p, i) => { if (p.file) pagesBox.querySelector(`[data-ap-thumb="${i}"]`)?.append(thumbs.make(x.project, p)); });
    update();
  }
  sheet.addEventListener('click', async e => {
    const proj = e.target.closest('[data-ap-project]');
    if (proj) { showProject(proj.dataset.apProject); return; }
    if (e.target.closest('[data-ap-cancel]')) { closeModal(); return; }
    if (e.target.closest('[data-ap-add]') && state.picked.length) {
      addButton.disabled = true;
      try {
        const target = sheet.querySelector('[data-ap-after]').value;
        const pageIds = state.from.project.pages.map(p => p.id).filter(id => state.picked.includes(id));
        const out = await pagesOp('copy-from', { fromProject: state.from.id, pageIds, after: target });
        if (!out) { update(); return; }
        closeModal();
        onDone(out);
        notice(`已添加 ${out.added.length || pageIds.length} 页，可以用「复制给 agent → 请统一风格」让 agent 统一风格`);
      } catch (error) { update(); notice(error.message); }
    }
  });
  sheet.addEventListener('change', e => {
    const check = e.target.closest('[data-ap-check]');
    if (!check) return;
    const id = check.dataset.apCheck;
    state.picked = state.picked.filter(x => x !== id);
    if (check.checked) state.picked.push(id);
    check.closest('.ap-page')?.classList.toggle('is-selected', check.checked);
    update();
  });
}
