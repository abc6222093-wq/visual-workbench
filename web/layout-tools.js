// Pure layout geometry. Coordinates and thresholds are in artboard units.
export function visualBounds(element) {
  const angle = (element.rotation || 0) * Math.PI / 180;
  const width = Math.abs(element.width * Math.cos(angle)) + Math.abs(element.height * Math.sin(angle));
  const height = Math.abs(element.width * Math.sin(angle)) + Math.abs(element.height * Math.cos(angle));
  return { x: element.x + (element.width - width) / 2, y: element.y + (element.height - height) / 2, width, height };
}
export function selectionBounds(elements) {
  if (!elements.length) return null;
  const boxes = elements.map(visualBounds);
  const x = Math.min(...boxes.map(e => e.x)), y = Math.min(...boxes.map(e => e.y));
  return { x, y, width: Math.max(...boxes.map(e => e.x + e.width)) - x, height: Math.max(...boxes.map(e => e.y + e.height)) - y };
}
const marks = (b, axis) => { const p = axis === 'x' ? b.x : b.y, size = axis === 'x' ? b.width : b.height; return [p, p + size / 2, p + size]; };
function refs(options) {
  return (options.references || []).map(e => ({ ...e, ...visualBounds(e) })).filter(e => !options.movingIds?.includes(e.id) && !(options.page && e.x <= 0 && e.y <= 0 && e.width >= options.page.width && e.height >= options.page.height));
}
function snap(options, resize = false) {
  const original = options.bounds, bounds = { ...original }, guides = [], gaps = [];
  const threshold = (options.threshold ?? 6) / Math.max(options.scale || 1, 0.001);
  const references = refs(options);
  // Rotated resize is deliberately conservative: screen-axis snapping would move the anchored corner.
  if (!options.disabled && !(resize && options.rotation % 360)) for (const axis of ['x', 'y']) {
    const size = axis === 'x' ? 'width' : 'height', edge = axis === 'x' ? ['w', 'e'] : ['n', 's'];
    let active = [0, 1, 2];
    if (resize) active = options.handle?.includes(edge[0]) ? [0] : options.handle?.includes(edge[1]) ? [2] : [];
    let best = null;
    const consider = (delta, detail) => { if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, ...detail }; };
    const targets = references.map(r => ({ bounds: r, id: r.id }));
    if (options.page) targets.push({ bounds: { x: 0, y: 0, ...options.page }, id: 'page' });
    const own = marks(bounds, axis);
    for (const target of targets) for (const value of marks(target.bounds, axis)) for (const index of active) consider(value - own[index], { type: 'guide', axis, value, targetId: target.id });
    if (!resize) {
      const sorted = references.slice().sort((a,b) => a[axis]-b[axis]);
      // Pairwise equal-gap candidates include insertion between and continuation on either end.
      for (let i=0;i<sorted.length;i++) for (let j=i+1;j<sorted.length;j++) {
        const a=sorted[i], b=sorted[j], gap=b[axis]-a[axis]-a[size];
        const cross=axis==='x'?'y':'x',crossSize=cross==='x'?'width':'height';
        const overlaps=(u,v)=>u[cross]<v[cross]+v[crossSize]&&u[cross]+u[crossSize]>v[cross];
        if(!overlaps(a,b)||!overlaps(bounds,a)||!overlaps(bounds,b))continue;
        if (gap < 0) continue;
        const candidates=[a[axis]-gap-bounds[size], b[axis]+b[size]+gap, (a[axis]+a[size]+b[axis]-bounds[size])/2];
        candidates.forEach((value,index)=> {
          if (index===2 && b[axis]-a[axis]-a[size]<bounds[size]) return;
          consider(value-bounds[axis],{type:'gap',axis,value: index===2 ? (b[axis]-a[axis]-a[size]-bounds[size])/2 : gap, referenceIds:[a.id,b.id]});
        });
      }
    }
    if (best) {
      if (resize) {
        if (active[0]===0) { bounds[axis]+=best.delta; bounds[size]-=best.delta; }
        else bounds[size]+=best.delta;
        if(bounds[size]<0) {bounds[axis]=original[axis];bounds[size]=original[size];continue;}
      } else bounds[axis]+=best.delta;
      (best.type==='gap'?gaps:guides).push(best);
    }
  }
  return { bounds, delta: Object.fromEntries(['x','y','width','height'].map(k=>[k,bounds[k]-original[k]])), guides, gaps };
}
export const snapMove = options => snap(options);
export const snapResize = options => snap(options, true);
export function alignElements(elements, mode) {
  const b=selectionBounds(elements); if(!b || elements.length<2) return elements.slice();
  return elements.map(e=> {
    const n={...e}, v=visualBounds(e);
    const offsetX=e.x-v.x, offsetY=e.y-v.y;
    if(mode==='left')n.x=b.x+offsetX; if(mode==='center'||mode==='centerX')n.x=b.x+(b.width-v.width)/2+offsetX; if(mode==='right')n.x=b.x+b.width-v.width+offsetX;
    if(mode==='top')n.y=b.y+offsetY; if(mode==='middle'||mode==='centerY')n.y=b.y+(b.height-v.height)/2+offsetY; if(mode==='bottom')n.y=b.y+b.height-v.height+offsetY;
    return n;
  });
}
export function distributeElements(elements, axis='x') {
  if(elements.length<3)return elements.slice();
  axis=axis==='vertical'||axis==='y'?'y':'x'; const size=axis==='x'?'width':'height';
  const ordered=elements.map(e=>({element:e,...visualBounds(e)})).sort((a,b)=>a[axis]-b[axis]);
  const first=ordered[0],last=ordered.at(-1);
  const gap=(last[axis]+last[size]-first[axis]-ordered.reduce((sum,e)=>sum+e[size],0))/(ordered.length-1);
  const positions=new Map();let cursor=first[axis]; for(const e of ordered){positions.set(e.element,cursor+e.element[axis]-e[axis]);cursor+=e[size]+gap;}
  return elements.map(e=>({...e,[axis]:positions.get(e)}));
}
