const px = value => `${Number(value) || 0}px`;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function paint(value) {
  if (typeof value === 'string') return value;
  if (!value || !Array.isArray(value.stops)) return 'transparent';
  const stops = value.stops.map(stop => `${stop.color} ${stop.offset * 100}%`).join(', ');
  return value.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${value.angle ?? 0}deg, ${stops})`;
}

export function maskImage(mask) {
  if (!mask) return '';
  const stops = mask.stops.map(stop => `rgba(0,0,0,${clamp(stop.opacity, 0, 1)}) ${stop.offset * 100}%`).join(', ');
  return mask.type === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(${mask.angle ?? 0}deg, ${stops})`;
}

export function clipPath(clip) {
  return clip?.type === 'polygon' ? `polygon(${clip.points.map(([x, y]) => `${x}% ${y}%`).join(', ')})` : '';
}

export function filterString(filters = {}) {
  return Object.entries(filters).map(([name, value]) => `${name}(${value}${name === 'blur' ? 'px' : name === 'brightness' || name === 'contrast' || name === 'saturate' ? '' : ''})`).join(' ');
}

function assetUrl(base, file) {
  const prefix = String(base || '').replace(/\/$/, '');
  return `${prefix}/${file.split('/').map(encodeURIComponent).join('/')}`;
}

// 导出的单文件放映版没有服务器：可传 options.resolveAsset(file)，
// 或由导出页在 globalThis.__VW_EXPORT__.resolveAsset 提供文件内嵌的数据地址；都没有时照旧按 assetBase 拼地址
function fileUrl(options, file) {
  const resolve = options?.resolveAsset || globalThis.__VW_EXPORT__?.resolveAsset;
  return typeof resolve === 'function' ? resolve(file) : assetUrl(options?.assetBase, file);
}

function fontFaceName(project, font) { return `vw-${project.id}-${font.id}`; }

function ensureFonts(project, options) {
  if (typeof document === 'undefined' || !document.head) return;
  for (const font of project.fonts || []) {
    const key = `vw-font-${project.id}-${font.id}`;
    let style = document.getElementById(key);
    if (!style) { style = document.createElement('style'); style.id = key; document.head.append(style); }
    style.textContent = `@font-face{font-family:${JSON.stringify(fontFaceName(project, font))};src:url(${JSON.stringify(fileUrl(options, font.file))});font-weight:${font.weight === 'variable' ? '100 900' : font.weight || 400};font-style:${font.style || 'normal'}}`;
  }
}

function svgFill(svg, value, id) {
  if (!value) return 'none';
  if (typeof value === 'string') return value;
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.prepend(defs); }
  defs.replaceChildren();
  const gradient = document.createElementNS('http://www.w3.org/2000/svg', value.type === 'radial' ? 'radialGradient' : 'linearGradient');
  const gradientId = `vw-gradient-${id}`;
  gradient.setAttribute('id', gradientId);
  if (value.type === 'linear') {
    const angle = (value.angle || 0) * Math.PI / 180;
    gradient.setAttribute('x1', `${50 - 50 * Math.sin(angle)}%`);
    gradient.setAttribute('y1', `${50 + 50 * Math.cos(angle)}%`);
    gradient.setAttribute('x2', `${50 + 50 * Math.sin(angle)}%`);
    gradient.setAttribute('y2', `${50 - 50 * Math.cos(angle)}%`);
  }
  for (const item of value.stops) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', `${item.offset * 100}%`);
    stop.setAttribute('stop-color', item.color);
    gradient.append(stop);
  }
  defs.append(gradient);
  return `url(#${gradientId})`;
}

function shapeContent(node, element) {
  const fill = paint(element.fill);
  const stroke = element.stroke;
  if (element.shape === 'line' || element.shape === 'polygon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'width:100%;height:100%;overflow:visible;display:block';
    const figure = document.createElementNS('http://www.w3.org/2000/svg', element.shape === 'line' ? 'line' : 'polygon');
    if (element.shape === 'line') {
      figure.setAttribute('x1', '0'); figure.setAttribute('y1', '0'); figure.setAttribute('x2', '100'); figure.setAttribute('y2', '100');
    } else figure.setAttribute('points', element.points.map(point => point.join(',')).join(' '));
    figure.setAttribute('fill', element.shape === 'line' ? 'none' : svgFill(svg, element.fill, element.id));
    figure.setAttribute('stroke', stroke?.color || 'none');
    figure.setAttribute('stroke-width', String(stroke?.width || 0));
    figure.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(figure); node.append(svg);
  } else {
    node.style.background = fill;
    node.style.border = stroke ? `${stroke.width}px solid ${stroke.color}` : 'none';
    node.style.boxSizing = 'border-box';
    node.style.borderRadius = element.shape === 'ellipse' ? '50%' : px(element.cornerRadius || 0);
  }
}

// 文字描边：-webkit-text-stroke 画在字形边缘（宽度为线宽，画板像素）；paint-order 让填充盖在描边上，描边不吃掉字形。
// 文字阴影：text-shadow x y blur color。没有这两个属性的旧项目不写任何样式，画面与以前一致。
function applyTextStyle(node, element) {
  const stroke = element.stroke;
  const value = stroke && Number(stroke.width) > 0 ? `${px(stroke.width)} ${stroke.color}` : '';
  if (value || node.style.webkitTextStroke || node.style.getPropertyValue('-webkit-text-stroke')) {
    node.style.webkitTextStroke = value;
    node.style.setProperty('-webkit-text-stroke', value);
    node.style.paintOrder = value ? 'stroke fill' : '';
  }
  const shadow = element.shadow;
  const textShadow = shadow ? `${px(shadow.x)} ${px(shadow.y)} ${px(Math.max(0, Number(shadow.blur) || 0))} ${shadow.color}` : '';
  if (textShadow || node.style.textShadow) node.style.textShadow = textShadow;
}

// 图片元素节点 → 图片地址（导出版里是很长的 data: 地址，不放进 DOM 属性）
const imageSources = new WeakMap();
const MASK_SIZE = { cover: 'cover', contain: 'contain', fill: '100% 100%' };

// 图片内容：普通图片用 <img>；设了 tint（重新着色）时画成纯色块，用图片的透明度当遮罩，
// 只适合单色的矢量标志（SVG）或透明底的单色 PNG / WebP。遮罩挂在内层，不影响元素自己的 effects.mask。
function imageContent(node, element, src) {
  const tint = typeof element.tint === 'string' && element.tint ? element.tint : null;
  const fit = element.fit || 'cover';
  let child = node.firstElementChild;
  if (tint) {
    if (!child || !child.dataset.vwTint) {
      child = document.createElement('div');
      child.dataset.vwTint = '1';
      child.setAttribute('role', 'img');
      node.replaceChildren(child);
    }
    const url = `url(${JSON.stringify(src)})`;
    child.setAttribute('aria-label', element.name || '');
    child.style.cssText = 'width:100%;height:100%;display:block';
    child.style.backgroundColor = tint;
    for (const prefix of ['', '-webkit-']) {
      child.style.setProperty(`${prefix}mask-image`, url);
      child.style.setProperty(`${prefix}mask-size`, MASK_SIZE[fit] || 'cover');
      child.style.setProperty(`${prefix}mask-position`, 'center');
      child.style.setProperty(`${prefix}mask-repeat`, 'no-repeat');
    }
    return;
  }
  if (!child || child.tagName !== 'IMG') {
    child = document.createElement('img');
    child.decoding = 'sync'; // 拖动时画面每一步都会重画：同步解码，Safari 里图片不会闪一下空白
    child.src = src;
    child.draggable = false;
    node.replaceChildren(child);
  }
  child.alt = element.name || '';
  child.style.cssText = `width:100%;height:100%;display:block;object-fit:${fit}`;
}

export function updateElementNode(node, element) {
  node.style.position = 'absolute';
  node.style.left = px(element.x); node.style.top = px(element.y);
  node.style.width = px(element.width); node.style.height = px(element.height);
  node.style.transformOrigin = 'center center';
  node.style.transform = `rotate(${element.rotation || 0}deg) scale(${element.playbackScale ?? 1})`;
  node.style.opacity = String((element.opacity ?? 1) * (element.playbackVisibility ?? 1));
  node.style.zIndex = String(element.zIndex || 0);
  node.style.mixBlendMode = element.effects?.blend || 'normal';
  node.style.filter = filterString(element.effects?.filters);
  node.style.maskImage = maskImage(element.effects?.mask);
  node.style.webkitMaskImage = node.style.maskImage;
  node.style.clipPath = clipPath(element.effects?.clip);
  if (element.type === 'text') { node.style.color = element.color || '#000000'; applyTextStyle(node, element); }
  if (element.type === 'image' && imageSources.has(node)) imageContent(node, element, imageSources.get(node));
  if (element.type === 'shape') {
    if (element.shape === 'line' || element.shape === 'polygon') {
      const figure = node.querySelector('polygon,line');
      if (figure) {
        if (figure.tagName.toLowerCase() === 'polygon') figure.setAttribute('fill', svgFill(node.querySelector('svg'), element.fill, element.id));
        figure.setAttribute('stroke', element.stroke?.color || 'none');
        figure.setAttribute('stroke-width', String(element.stroke?.width || 0));
      }
    } else node.style.background = paint(element.fill);
  }
  node.style.visibility = element.visible === false ? 'hidden' : 'visible';
  return node;
}

function renderElement(project, element, options, fontMap, assetMap) {
  const node = document.createElement('div');
  node.dataset.elementId = element.id;
  node.dataset.elementType = element.type;
  if (element.type === 'text') {
    node.textContent = element.text;
    node.style.whiteSpace = 'pre-wrap';
    node.style.overflowWrap = 'break-word';
    node.style.fontFamily = fontMap.has(element.font) ? JSON.stringify(fontFaceName(project, fontMap.get(element.font))) : 'sans-serif';
    node.style.fontSize = px(element.fontSize || 16);
    node.style.fontWeight = String(element.fontWeight || 400);
    node.style.lineHeight = String(element.lineHeight || 1.4);
    node.style.letterSpacing = px(element.letterSpacing || 0);
    node.style.textAlign = element.align || 'left';
  } else if (element.type === 'image') {
    imageSources.set(node, fileUrl(options, assetMap.get(element.asset)?.file || ''));
  } else if (element.type === 'shape') shapeContent(node, element);
  else if (element.type === 'group') {
    for (const child of [...element.children].sort((a, b) => a.zIndex - b.zIndex)) node.append(renderElement(project, child, options, fontMap, assetMap));
  }
  updateElementNode(node, element);
  if (options.interactive) {
    node.style.cursor = element.locked ? 'default' : 'pointer';
    if (options.selectedIds?.includes(element.id)) node.style.outline = '2px solid #38bdf8';
    node.addEventListener('pointerdown', event => {
      if (element.locked) return;
      event.stopPropagation();
      options.onSelect?.(element.id, event);
    });
  }
  return node;
}

export function renderPage(project, page, options = {}) {
  ensureFonts(project, options);
  const root = document.createElement('div');
  root.className = 'vw-artboard';
  root.dataset.pageId = page.id;
  root.style.cssText = `position:relative;width:${px(project.artboard.width)};height:${px(project.artboard.height)};overflow:hidden;isolation:isolate;background:${paint(page.background)};flex:none`;
  const fonts = new Map((project.fonts || []).map(font => [font.id, font]));
  const assets = new Map((project.assets || []).map(asset => [asset.id, asset]));
  for (const element of [...page.elements].sort((a, b) => a.zIndex - b.zIndex)) root.append(renderElement(project, element, options, fonts, assets));
  return root;
}
