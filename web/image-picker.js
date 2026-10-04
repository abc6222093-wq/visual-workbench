// 「替换图片」选择弹窗（第 10 轮）：本项目素材 / 公共素材库两个页签 + 上传。
// 只负责选：返回 { kind:'asset', id } | { kind:'library', file, width, height } | { kind:'upload', file } | null，
// 复制进项目、登记素材、改元素由调用方做。
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const isImage = asset => /^image\//.test(asset?.mime || '') || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(asset?.file || '');
const fileUrl = (base, file) => `${String(base || '').replace(/\/$/, '')}/${String(file).split('/').map(encodeURIComponent).join('/')}`;

function grid(items, empty) {
  if (!items.length) return `<p class="g-sheet__empty">${esc(empty)}</p>`;
  return `<div data-picker-grid style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:46vh;overflow:auto;padding:2px">${items.map(item =>
    `<button type="button" class="g-row" data-pick="${esc(item.key)}" title="${esc(item.name)}" style="flex-direction:column;align-items:stretch;gap:6px;padding:6px;min-height:0;height:auto">`
    + `<span style="display:grid;place-items:center;aspect-ratio:4/3;border-radius:7px;background:rgba(60,52,92,0.06);overflow:hidden"><img src="${esc(item.url)}" alt="" loading="lazy" draggable="false" style="max-width:100%;max-height:100%;object-fit:contain;display:block"></span>`
    + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px">${esc(item.name)}</span></button>`).join('')}</div>`;
}

export function pickImage({ modal, closeModal, api, projectAssets = [], assetBase = '', allowUpload = true } = {}) {
  return new Promise(resolve => {
    let settled = false, library = null, tab = 'project';
    const own = (projectAssets || []).filter(isImage).map(asset => ({ key: `asset:${asset.id}`, name: asset.name || asset.file, url: fileUrl(assetBase, asset.file), value: { kind: 'asset', id: asset.id } }));
    modal(`<div data-image-picker><h2>替换图片</h2>
      <div class="g-seg" role="tablist" style="margin-bottom:12px"><button type="button" class="active" data-picker-tab="project">本项目素材</button><button type="button" data-picker-tab="library">公共素材库</button></div>
      <div data-picker-body></div>
      <div class="g-sheet__actions">${allowUpload ? '<button type="button" class="g-btn" data-picker-upload>上传图片…</button><input type="file" accept="image/*" data-picker-file hidden>' : ''}<button type="button" class="g-btn" data-picker-cancel>取消</button></div></div>`);
    const root = document.querySelector('[data-image-picker]');
    if (!root) { resolve(null); return; }
    const body = root.querySelector('[data-picker-body]');
    // 弹窗被别处关掉（点遮罩、Esc、打开别的弹窗）也算取消
    const observer = new MutationObserver(() => { if (!root.isConnected) finish(null, false); });
    observer.observe(document.body, { childList: true, subtree: true });
    function finish(value, close = true) {
      if (settled) return;
      settled = true; observer.disconnect();
      if (close && root.isConnected) closeModal?.();
      resolve(value);
    }
    function show() {
      root.querySelectorAll('[data-picker-tab]').forEach(button => button.classList.toggle('active', button.dataset.pickerTab === tab));
      if (tab === 'project') { body.innerHTML = grid(own, '本项目还没有图片素材'); return; }
      if (!library) { body.innerHTML = '<p class="g-sheet__empty">正在读取公共素材库…</p>'; return; }
      if (library instanceof Error) { body.innerHTML = `<p class="g-sheet__empty">读取公共素材库失败：${esc(library.message)}</p>`; return; }
      body.innerHTML = grid(library, '公共素材库里还没有图片');
    }
    async function loadLibrary() {
      try {
        const list = await api('/api/library');
        library = (Array.isArray(list) ? list : []).filter(isImage).map(item => ({ key: `library:${item.file}`, name: item.name || item.file, url: item.url, value: { kind: 'library', file: item.file, width: item.width ?? null, height: item.height ?? null } }));
      } catch (error) { library = error instanceof Error ? error : new Error(String(error)); }
      if (!settled && tab === 'library') show();
    }
    root.addEventListener('click', event => {
      const tabButton = event.target.closest('[data-picker-tab]');
      if (tabButton) { tab = tabButton.dataset.pickerTab; if (tab === 'library' && !library) loadLibrary(); show(); return; }
      const pick = event.target.closest('[data-pick]');
      if (pick) {
        const item = [...own, ...(Array.isArray(library) ? library : [])].find(entry => entry.key === pick.dataset.pick);
        if (item) finish(item.value);
        return;
      }
      if (event.target.closest('[data-picker-cancel]')) finish(null);
      else if (event.target.closest('[data-picker-upload]')) root.querySelector('[data-picker-file]')?.click();
    });
    root.querySelector('[data-picker-file]')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) finish({ kind: 'upload', file });
    });
    show();
  });
}
