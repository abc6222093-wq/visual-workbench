// 第 13 轮：设计卡片（project.designCard，见 docs/format.md §17）。总览卡片角上的小图标 + 查看弹窗 + 「复制给 agent」。
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);

/** 卡片里有没有能看的内容 */
export function hasDesignCard(project) {
  const card = project?.designCard;
  if (!card || typeof card !== 'object') return false;
  return !!(card.direction || card.concept || list(card.colors).length || list(card.fonts).length || list(card.traits).length);
}

/** 设计卡片 → 文字；和 src/brief.js 的 designCardText 同一格式（改一处要两处一起改）。没有卡片返回 ''。 */
export function designCardText(project) {
  const card = project?.designCard;
  if (!card || typeof card !== 'object') return '';
  const name = typeof project.name === 'string' && project.name ? project.name : project.id || '';
  const lines = [`设计风格参考（项目「${name}」的设计卡片）`];
  if (card.direction) lines.push(`方向：${card.direction}`);
  if (card.concept) lines.push(`概念：${card.concept}`);
  if (list(card.colors).length) lines.push(`配色：${list(card.colors).join(' ')}`);
  if (list(card.fonts).length) lines.push(`字体：${list(card.fonts).join(' / ')}`);
  if (list(card.traits).length) lines.push(`特征：${list(card.traits).join(' · ')}`);
  return lines.join('\n');
}

// Lucide palette（ISC 许可）
const ICON = '<svg class="g-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>';

/** 总览卡片右上角（母版开关旁边）的小图标；没有设计卡片时返回 ''。project：{ id, name, designCard } */
export function renderDesignCardIcon(project) {
  if (!hasDesignCard(project)) return '';
  return `<button class="ed-add hm-design" data-action="design-card" data-id="${esc(project.id)}" title="设计卡片" aria-label="查看设计卡片">${ICON}</button>`;
}

const swatchColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c.trim()) || /^(rgb|hsl)a?\([\d\s.,%/]+\)$/i.test(c.trim()) ? c.trim() : 'transparent');

export function designCardHtml(project) {
  const card = project.designCard || {};
  const colors = list(card.colors), fonts = list(card.fonts), traits = list(card.traits);
  return `<div class="hm-dcard" data-design-card>
<p class="hm-dcard__eyebrow">设计卡片 · ${esc(project.name || project.id)}</p>
<h2>${esc(card.direction || '（没有写方向名）')}</h2>
${card.concept ? `<p class="hm-dcard__concept">${esc(card.concept)}</p>` : ''}
${colors.length ? `<div class="hm-dcard__swatches" aria-label="配色">${colors.map((c) => `<figure class="hm-dcard__swatch"><span style="background:${esc(swatchColor(c))}"></span><figcaption>${esc(c)}</figcaption></figure>`).join('')}</div>` : ''}
${fonts.length ? `<div class="hm-dcard__row"><b>字体</b><span>${fonts.map(esc).join(' / ')}</span></div>` : ''}
${traits.length ? `<div class="hm-dcard__row"><b>特征</b><span>${traits.map(esc).join(' · ')}</span></div>` : ''}
<div class="g-sheet__actions"><button type="button" class="g-btn" data-dcard-close>关闭</button><button type="button" class="g-btn g-btn--prism" data-dcard-copy>复制给 agent</button></div>
</div>`;
}

/** 弹窗显示设计卡片；「复制给 agent」把 designCardText 写进剪贴板。 */
export function openDesignCard({ project, modal, closeModal = () => {}, notice = () => {}, document: doc = globalThis.document, clipboard = globalThis.navigator?.clipboard }) {
  modal(designCardHtml(project));
  const root = doc.querySelector('[data-design-card]');
  if (!root) return;
  root.querySelector('[data-dcard-close]').onclick = closeModal;
  root.querySelector('[data-dcard-copy]').onclick = async () => {
    try { await clipboard.writeText(designCardText(project)); notice('已复制设计卡片，可以粘贴给 agent 当风格参考'); }
    catch { notice('复制失败，请手动选中文字复制'); }
  };
}
