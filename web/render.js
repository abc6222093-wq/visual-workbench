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

function fontFaceName(project, font) { return `vw-${project.id}-${font.id}`; }

function ensureFonts(project, base) {
  if (typeof document === 'undefined' || !document.head) return;
  for (const font of project.fonts || []) {
    const key = `vw-font-${project.id}-${font.id}`;
    let style = document.getElementById(key);
    if (!style) { style = document.createElement('style'); style.id = key; document.head.append(style); }
    style.textContent = `@font-face{font-family:${JSON.stringify(fontFaceName(project, font))};src:url(${JSON.stringify(assetUrl(base, font.file))});font-weight:${font.weight === 'variable' ? '100 900' : font.weight || 400};font-style:${font.style || 'normal'}}`;
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
  if (element.type === 'text') node.style.color = element.color || '#000000';
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
    const image = document.createElement('img');
    image.decoding = 'sync'; // 拖动时画面每一步都会重画：同步解码，Safari 里图片不会闪一下空白
    image.src = assetUrl(options.assetBase, assetMap.get(element.asset)?.file || '');
    image.alt = element.name || '';
    image.draggable = false;
    image.style.cssText = `width:100%;height:100%;display:block;object-fit:${element.fit || 'cover'}`;
    node.append(image);
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
  ensureFonts(project, options.assetBase);
  const root = document.createElement('div');
  root.className = 'vw-artboard';
  root.dataset.pageId = page.id;
  root.style.cssText = `position:relative;width:${px(project.artboard.width)};height:${px(project.artboard.height)};overflow:hidden;isolation:isolate;background:${paint(page.background)};flex:none`;
  const fonts = new Map((project.fonts || []).map(font => [font.id, font]));
  const assets = new Map((project.assets || []).map(asset => [asset.id, asset]));
  for (const element of [...page.elements].sort((a, b) => a.zIndex - b.zIndex)) root.append(renderElement(project, element, options, fonts, assets));
  return root;
}
