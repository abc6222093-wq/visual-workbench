// 文字框自动高度：宽度由用户定，高度由内容定。这里只负责「量」，写回 height 由调用方做（进撤销、保存、同步）。
// 量的是布局高度（画板像素）：用 getComputedStyle 的 height 读出带小数的实际值，不受祖先 transform（画板缩放、分组旋转）影响。
// 描边（-webkit-text-stroke）、投影不改变布局高度，不额外计算。
import { patchPage } from './render.js';

export const MIN_TEXT_HEIGHT = 1;
const ZWSP = '​';
const HEIGHT_KEYS = ['text', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'font', 'width', 'stroke', 'align'];

const lineOf = (fontSize, lineHeight) => Math.max(MIN_TEXT_HEIGHT, Math.ceil((Number(fontSize) || 16) * (Number(lineHeight) || 1.4)));
const used = node => parseFloat(getComputedStyle(node).height) || 0;
// 末尾换行：pre-wrap 下浏览器不画最后的空行，补一个零宽字符让它占一行（不改元素本身的 text）
const probeText = text => text.endsWith('\n') ? text + ZWSP : text;
const finish = (height, fontSize, lineHeight, text) => text === '' ? lineOf(fontSize, lineHeight) : Math.max(MIN_TEXT_HEIGHT, Math.ceil(height - 0.01));

// 节点（或翻转子层）里的文字：文字节点照原样，<br> 算换行（就地编辑时末尾占位的 <br> 不算），把手等元素跳过
function nodeText(node) {
  const host = node.querySelector(':scope > [data-vw-flip]') || node;
  let out = '';
  const kids = [...host.childNodes];
  let last = kids.length - 1;
  while (last >= 0 && kids[last].nodeType === 3 && !kids[last].data) last--;
  kids.forEach((child, i) => {
    if (child.nodeType === 3) out += child.data;
    else if (child.nodeName === 'BR') { if (i !== last) out += '\n'; }
    else if (child.nodeType === 1 && !child.hasAttribute('data-resize') && !child.hasAttribute('data-rotate')) out += child.textContent;
  });
  return out;
}

/**
 * 画板上已有的文字节点 → 内容高度（画板像素，向上取整）。
 * 在同一父节点里放一个复制了节点内联样式的隐形探针（height:auto）去量，节点本身不动：就地编辑时光标、选区不受影响。
 * text 可选：就地编辑 onInput 拿到的新文字；不给时从节点读。
 */
export function measureTextNode(node, text = nodeText(node)) {
  const fontSize = parseFloat(node.style.fontSize) || 16, lineHeight = parseFloat(node.style.lineHeight) || 1.4;
  if (text === '') return lineOf(fontSize, lineHeight);
  const parent = node.parentNode;
  if (!parent) return lineOf(fontSize, lineHeight);
  const probe = document.createElement('div');
  probe.style.cssText = node.style.cssText;
  probe.style.cssText += ';position:absolute;left:0;top:0;height:auto;min-height:0;max-height:none;transform:none;visibility:hidden;pointer-events:none;outline:none;padding:0;border:0';
  probe.setAttribute('aria-hidden', 'true');
  probe.textContent = probeText(text);
  parent.append(probe);
  const height = used(probe);
  probe.remove();
  return finish(height, fontSize, lineHeight, text);
}

/**
 * 离屏测量器：文档里一个隐藏的、scale 1 的画板，用 render.js 同一套样式（含 @font-face 名）渲染单个文字元素来量。
 * 字体没加载完就量会偏差：measure 前先 await ready。
 */
export function createTextMeasurer(project, { assetBase, resolveAsset } = {}) {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;overflow:hidden;width:0;height:0';
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;overflow:hidden';
  holder.append(root);
  document.body.append(holder);
  const options = { assetBase, resolveAsset, pageId: false };
  patchPage(root, project, { id: 'vw-measure', background: 'transparent', elements: [] }, options); // 先登记 @font-face
  const fonts = (project.fonts || []).map(font => {
    const weight = font.weight === 'variable' ? 400 : font.weight || 400;
    return document.fonts.load(`${font.style === 'italic' ? 'italic ' : ''}${weight} 16px ${JSON.stringify(`vw-${project.id}-${font.id}`)}`).catch(() => []);
  });
  const ready = Promise.all([document.fonts.ready, ...fonts]).then(() => document.fonts.ready).then(() => undefined);
  let disposed = false;
  function measure(element) {
    const text = String(element?.text ?? '');
    if (disposed || text === '') return lineOf(element?.fontSize, element?.lineHeight);
    const probe = { ...element, x: 0, y: 0, rotation: 0, height: 1, zIndex: 0, visible: true, opacity: 1, flipX: false, flipY: false, effects: undefined, playbackScale: 1 };
    patchPage(root, project, { id: 'vw-measure', background: 'transparent', elements: [probe] }, options);
    const node = root.querySelector(':scope > [data-element-id]');
    node.style.height = 'auto';
    if (text.endsWith('\n')) node.append(document.createTextNode(ZWSP)); // 下次 patch 会把多余文字节点一起换掉
    return finish(used(node), element.fontSize, element.lineHeight, text);
  }
  return { measure, ready, dispose() { disposed = true; holder.remove(); } };
}

// 纯函数：pages 里所有文字元素（含分组内）的 height 改成 measure(element)；返回改动清单 [{pageId, id, from, to}]
export function fitTextHeights(project, measure, { pages = project.pages } = {}) {
  const changes = [];
  const walk = (pageId, elements) => {
    for (const element of elements || []) {
      if (element.type === 'group') walk(pageId, element.children);
      else if (element.type === 'text') {
        const to = measure(element);
        if (Number.isFinite(to) && to !== element.height) { changes.push({ pageId, id: element.id, from: element.height, to }); element.height = to; }
      }
    }
  };
  for (const page of pages || []) walk(page.id, page.elements);
  return changes;
}

// 元素改动是否影响文字高度（只看文字元素；x/y/color/opacity 等不算）
export function affectsTextHeight(before, after) {
  if (!before || !after) return !!(before || after) && (before || after).type === 'text';
  if (before.type !== 'text' && after.type !== 'text') return false;
  if (before.type !== after.type) return true;
  return HEIGHT_KEYS.some(key => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}
