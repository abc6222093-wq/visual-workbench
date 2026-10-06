import { renderPageItems, pageChips } from './page-views.js';
// 页面列表 / 网格 / 时间轴的原地更新（第 9 轮）：在已有的 [data-page-view] 根里按 data-page-id 协调页面项。
// 已有的项复用（里面 [data-preview] 缩略图宿主的内容原样保留），新页用 renderPageItems 生成同结构的节点，
// 删掉的移除，顺序变了才挪动。根里不是页面项的子节点（插入线、框选框等覆盖层）不碰。返回新增页的 id 列表。
const isItem = node => node.nodeType === 1 && node.classList.contains('ed-page') && node.dataset.pageId !== undefined;
const setAttr = (node, name, value) => { if (node && node.getAttribute(name) !== value) node.setAttribute(name, value); };
const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
const toggle = (node, name, on) => { if (node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function patchPageItems(viewRoot, context) {
  const { project, currentPageId, selectedPageIds = [] } = context;
  const selected = new Set(selectedPageIds);
  const existing = new Map();
  for (const node of viewRoot.children) if (isItem(node)) existing.set(node.dataset.pageId, node);
  let fresh = null;
  const freshItem = id => {
    if (!fresh) {
      const box = document.createElement('div');
      box.innerHTML = renderPageItems({ ...context, mode: viewRoot.dataset.pageView || context.mode });
      fresh = box.firstElementChild;
    }
    return [...fresh.children].find(node => node.dataset.pageId === id);
  };
  const added = [];
  const desired = project.pages.map((p, i) => {
    let item = existing.get(p.id);
    existing.delete(p.id);
    if (!item) { item = freshItem(p.id); added.push(p.id); }
    const on = selected.has(p.id);
    setAttr(item, 'data-page-index', String(i));
    toggle(item, 'active', p.id === currentPageId);
    toggle(item, 'is-selected', on);
    const check = item.querySelector('[data-check]');
    if (check) { if (check.checked !== on) check.checked = on; setAttr(check, 'aria-label', `选择第 ${i + 1} 页`); }
    setAttr(item.querySelector('.ed-page__open'), 'title', p.name);
    setText(item.querySelector('.ed-page__label b'), String(i + 1).padStart(2, '0'));
    setText(item.querySelector('.ed-page__label i'), p.name);
    const chips = item.querySelector('.ed-page__chips'), html = pageChips(p, context.screensOf);
    if (chips && chips._html !== html && chips.innerHTML !== html) { chips.innerHTML = html; chips._html = html; }
    return item;
  });
  for (const node of existing.values()) node.remove();
  const kept = [...viewRoot.children].filter(isItem);
  let ref = kept.length ? kept.at(-1).nextSibling : null;
  for (let i = desired.length - 1; i >= 0; i--) {
    const node = desired[i];
    if (node.parentNode !== viewRoot || node.nextSibling !== ref) viewRoot.insertBefore(node, ref);
    ref = node;
  }
  return added;
}
