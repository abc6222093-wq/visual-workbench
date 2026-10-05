// 快捷工具条（第 11 轮，参考 Canva）：选中元素时出现在画布上方的一条窄工具条，放最常用的设置。
// 只负责拼 HTML；输入框用 data-qprop、按钮用 data-qaction（和属性栏的 data-prop / data-action 同一套处理：
// app.js 的 updateProp / previewProp / 点击分派都认这两个属性；换个名字是为了不和属性栏里的同名控件重复）。未选中元素时返回空字符串（工具条隐藏）。
import { icon } from './ui/icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hex6 = (color, fallback) => (typeof color === 'string' && /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : fallback);

const num = (prop, label, value, { step = 1, min = '', width = 64, extra = '' } = {}) =>
  `<label class="g-field qt-field" style="--qt-w:${width}px" title="${label}"><span>${label}</span><input data-qprop="${prop}" type="number" step="${step}" ${min !== '' ? `min="${min}"` : ''} value="${esc(value)}" aria-label="${label}" ${extra}></label>`;
const color = (prop, label, value) =>
  `<label class="g-field qt-field qt-color" title="${label}"><span>${label}</span><input data-qprop="${prop}" type="color" value="${esc(value)}" aria-label="${label}"></label>`;
const select = (prop, label, value, options, width = 96) =>
  `<label class="g-field qt-field" style="--qt-w:${width}px" title="${label}"><span>${label}</span><select data-qprop="${prop}" aria-label="${label}">${options.map(([v, text]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const button = (action, label, name, extra = '') =>
  `<button class="ed-tbtn qt-btn" data-qaction="${action}" title="${label}" ${extra}>${name ? icon(name, 15) : ''}<span>${label}</span></button>`;
const sep = '<span class="ed-sep"></span>';
// 透明度用百分数显示（data-percent：写回时除以 100）
const opacity = (value) => num('opacity', '透明度', Math.round((value ?? 1) * 100), { step: 5, min: 0, width: 58, extra: 'max="100" data-percent="1"' });
// 整体缩放：输入 120 = 以选区中心放大到 120%；生效后回到 100
const scale = () => `<label class="g-field qt-field" style="--qt-w:58px" title="整体缩放（以选区中心为基准）"><span>整体缩放 %</span><input data-scale-selection type="number" step="5" min="1" value="100" aria-label="整体缩放百分比"></label>`;

export function quickToolbarHTML({ elements = [], fonts = [] } = {}) {
  if (!elements.length) return '';
  const e = elements[0];
  const kind = elements.length > 1 ? 'multi' : e.type;
  let body = '';
  if (kind === 'text') {
    body = [
      select('font', '字体', e.font || '', [['', '系统默认'], ...fonts.map((f) => [f.id, f.family])], 120),
      num('fontSize', '字号', e.fontSize, { min: 1, width: 48 }),
      color('color', '颜色', hex6(e.color, '#000000')),
      select('align', '对齐', e.align || 'left', [['left', '左'], ['center', '中'], ['right', '右']], 34),
      num('lineHeight', '行距', e.lineHeight ?? 1.4, { step: 0.05, width: 42 }),
      num('letterSpacing', '字距', e.letterSpacing ?? 0, { step: 0.5, width: 40 }),
      sep,
      button('quick-style', '描边', '', 'data-section="stroke"'),
      button('quick-style', '投影', '', 'data-section="shadow"'),
    ].join('');
  } else if (kind === 'image') {
    body = [
      button('crop-image', '裁切', 'maximize'),
      button('replace-image', '替换', 'imagePlus'),
      sep,
      button('quick-flip', '水平翻转', '', `data-axis="flipX" aria-pressed="${e.flipX === true}"`),
      button('quick-flip', '垂直翻转', '', `data-axis="flipY" aria-pressed="${e.flipY === true}"`),
      sep,
      opacity(e.opacity),
    ].join('');
  } else if (kind === 'shape') {
    body = [
      color('fill', '填充', typeof e.fill === 'string' ? hex6(e.fill, '#d9d3ef') : '#d9d3ef'),
      e.shape === 'rect' ? num('cornerRadius', '圆角', e.cornerRadius ?? 0, { min: 0, width: 44 }) : '',
      sep,
      opacity(e.opacity),
    ].join('');
  } else {
    // 分组、多选：透明度 + 整体缩放
    body = [`<span class="qt-label">${kind === 'group' ? '分组' : `${elements.length} 个元素`}</span>`, opacity(e.opacity), scale()].join('');
  }
  return `<div class="qt-inner" data-kind="${kind}">${body}</div>`;
}
// 结构签名：类型、选择、字体列表不变时只更新各输入框的值，不重写工具条
export function quickToolbarKey({ elements = [], fonts = [], selected = [] } = {}) {
  return JSON.stringify([selected, elements.map((e) => [e.type, e.shape || '']), fonts.map((f) => [f.id, f.family])]);
}
