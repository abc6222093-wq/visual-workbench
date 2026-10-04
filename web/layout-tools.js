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

// Resize in the element's parent coordinates, then compare actual page bounds.
// Changing either dimension moves its center exactly enough to keep the opposite
// rotated edge fixed. Projection also includes every flipped / rotated parent.
export function anchoredSize(element,handle,width,height) {
  const a=(element.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const sx=(width-element.width)*(handle.includes('w')?-1:handle.includes('e')?1:0)/2;
  const sy=(height-element.height)*(handle.includes('n')?-1:handle.includes('s')?1:0)/2;
  return {...element,width,height,x:element.x+(element.width-width)/2+sx*c-sy*s,y:element.y+(element.height-height)/2+sx*s+sy*c};
}
export function snapTransformedResize(options) {
  const original=options.bounds;let bounds={...original};const guides=[];
  if(options.disabled)return {bounds,guides,gaps:[]};
  const threshold=(options.threshold??6)/Math.max(options.scale||1,.001);
  const project=options.project||((e)=>e),targets=refs(options);
  if(options.page)targets.push({id:'page',x:0,y:0,...options.page});
  const dimensions=['width','height'].filter(d=>d==='width'?/[we]/.test(options.handle):/[ns]/.test(options.handle));
  const usedAxes=new Set();
  while(dimensions.length){
    const world=visualBounds(project(bounds));let best=null;
    for(const dimension of dimensions){
      const probe=anchoredSize(bounds,options.handle,bounds.width+(dimension==='width'?1:0),bounds.height+(dimension==='height'?1:0));
      const projected=visualBounds(project(probe));
      for(const axis of ['x','y']){
        if(usedAxes.has(axis))continue;
        const own=marks(world,axis),derivatives=marks(projected,axis).map((v,i)=>v-own[i]);
        for(const target of targets)for(const value of marks(target,axis))for(let i=0;i<3;i++){
          const coefficient=derivatives[i];if(Math.abs(coefficient)<1e-8)continue;
          const distance=value-own[i],delta=distance/coefficient;
          if(Math.abs(distance)>threshold||bounds[dimension]+delta<0)continue;
          // Don't pull a shallow-angle edge a long way along the pointer axis.
          if(Math.abs(delta)>threshold*2)continue;
          if(!best||Math.abs(distance)<Math.abs(best.distance))best={dimension,axis,value,delta,distance,targetId:target.id};
        }
      }
    }
    if(!best)break;
    bounds=anchoredSize(bounds,options.handle,bounds.width+(best.dimension==='width'?best.delta:0),bounds.height+(best.dimension==='height'?best.delta:0));
    dimensions.splice(dimensions.indexOf(best.dimension),1);usedAxes.add(best.axis);guides.push({type:'guide',axis:best.axis,value:best.value,targetId:best.targetId});
  }
  // A second dimension can move the first guide; show only alignments that remain.
  const world=visualBounds(project(bounds));
  return {bounds,gaps:[],guides:guides.filter(g=>marks(world,g.axis).some(value=>Math.abs(value-g.value)<1e-5))};
}

// Pointer deltas are expressed in the element's parent coordinates. Keep them
// continuous so several elements can share a single world-space snap correction.
export function resizeFromPointer(element,handle,dx,dy) {
  const angle=(element.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const lx=dx*c+dy*s,ly=-dx*s+dy*c;
  const width=/[we]/.test(handle)?Math.max(0,element.width+(handle.includes('w')?-lx:lx)):element.width;
  const height=/[ns]/.test(handle)?Math.max(0,element.height+(handle.includes('n')?-ly:ly)):element.height;
  return anchoredSize(element,handle,width,height);
}

// project(dx,dy) returns the combined world AABB after continuously resizing the
// selection. Solve up to two independent guide constraints in pointer space.
export function snapPointerResize(options) {
  let dx=options.dx,dy=options.dy;
  const guides=[],gaps=[];
  if(options.disabled)return {dx,dy,guides,gaps};
  const threshold=(options.threshold??6)/Math.max(options.scale||1,.001);
  const targets=refs(options);
  if(options.page)targets.push({id:'page',x:0,y:0,...options.page});
  const epsilon=.01,tolerance=1e-5;
  let first=null;
  for(let round=0;round<2;round++) {
    const world=options.project(dx,dy);
    const probeX=options.project(dx+epsilon,dy),probeY=options.project(dx,dy+epsilon);
    const candidates=[];
    for(const axis of ['x','y']) {
      const own=marks(world,axis),mx=marks(probeX,axis),my=marks(probeY,axis);
      for(let index=0;index<3;index++) {
        const gradient=[(mx[index]-own[index])/epsilon,(my[index]-own[index])/epsilon];
        let direction=gradient.slice();
        if(first) {
          const projection=(direction[0]*first.gradient[0]+direction[1]*first.gradient[1])/first.norm;
          direction=[direction[0]-projection*first.gradient[0],direction[1]-projection*first.gradient[1]];
        }
        const coefficient=gradient[0]*direction[0]+gradient[1]*direction[1];
        if(coefficient<1e-10)continue;
        for(const target of targets)for(const value of marks(target,axis)) {
          const distance=value-own[index];
          if(Math.abs(distance)>threshold)continue;
          const correction=direction.map(v=>v*distance/coefficient);
          const magnitude=Math.hypot(...correction);
          if(magnitude>threshold*2)continue;
          // Avoid spending the first degree of freedom on an already-aligned guide.
          if(magnitude<tolerance)continue;
          const nextDx=dx+correction[0],nextDy=dy+correction[1];
          if(Math.hypot(nextDx-options.dx,nextDy-options.dy)>threshold*2)continue;
          const next=options.project(nextDx,nextDy);
          if(Math.abs(marks(next,axis)[index]-value)>tolerance)continue;
          if(first&&Math.abs(marks(next,first.axis)[first.index]-first.value)>tolerance)continue;
          candidates.push({axis,index,value,targetId:target.id,gradient,dx:nextDx,dy:nextDy,magnitude});
        }
      }
    }
    candidates.sort((a,b)=>a.magnitude-b.magnitude);
    const best=candidates[0];if(!best)break;
    dx=best.dx;dy=best.dy;
    guides.push({type:'guide',axis:best.axis,value:best.value,targetId:best.targetId});
    if(!first)first={...best,norm:best.gradient[0]**2+best.gradient[1]**2};
  }
  const final=options.project(dx,dy);
  return {dx,dy,gaps,guides:guides.filter(g=>marks(final,g.axis).some(value=>Math.abs(value-g.value)<tolerance))};
}
