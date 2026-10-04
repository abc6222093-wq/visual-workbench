import { clone, uid, findElement, editable, rootSelection } from './editor.js';

export const isTypingTarget = target => !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-outline-document]');
export function selectableIds(page) { return page.elements.filter(e => editable(page, e.id)).map(e => e.id); }
export function marqueeIds(page, box, rectangles = null) {
  return page.elements.filter(e => {
    if (!editable(page, e.id)) return false;
    const r = rectangles?.get(e.id) || e;
    return r.x < box.x + box.width && r.x + r.width > box.x && r.y < box.y + box.height && r.y + r.height > box.y;
  }).map(e => e.id);
}
// Flatten only the selected root's parent transforms, retaining its own children.
export function elementInPage(page,id) {
  const found=findElement(page,id);if(!found)return null;
  return elementWithParents(found.element,found.ancestors);
}
export function elementWithParents(element,ancestors=[]) {
  const e=clone(element);
  for(const g of ancestors.slice().reverse()){
    const a=(g.rotation||0)*Math.PI/180, cx=e.x+e.width/2-g.width/2,cy=e.y+e.height/2-g.height/2;
    const x=g.flipX?-cx:cx,y=g.flipY?-cy:cy;
    e.x=g.x+g.width/2+x*Math.cos(a)-y*Math.sin(a)-e.width/2;e.y=g.y+g.height/2+x*Math.sin(a)+y*Math.cos(a)-e.height/2;
    e.rotation=(g.rotation||0)+((!!g.flipX!==!!g.flipY)?-(e.rotation||0):(e.rotation||0));
    if(g.flipX)e.flipX=!e.flipX;if(g.flipY)e.flipY=!e.flipY;
    if(g.opacity!==undefined)e.opacity=(e.opacity??1)*g.opacity;
    if(g.visible===false)e.visible=false;
  }
  if(e.rotation!==undefined)e.rotation=((e.rotation+180)%360+360)%360-180;
  return e;
}
export function copyElements(project, page, ids) {
  return { projectId: project.id, pageId: page.id, elements: rootSelection(page, ids).map(id => elementInPage(page,id)) };
}
export function pasteElements(project, page, clipboard, offset = 24) {
  if (!clipboard || clipboard.projectId !== project.id) throw Error('只能在同一个项目里粘贴元素');
  const items = clone(clipboard.elements), ids = [];
  function renew(e) {
    e.id = uid('el'); delete e.outlineId; delete e.documentDraft;
    e.children?.forEach(renew);
  }
  let z = Math.max(0, ...page.elements.map(e => e.zIndex || 0));
  for (const e of items) {
    renew(e); e.x += offset; e.y += offset; e.zIndex = ++z;
    page.elements.push(e); ids.push(e.id);
  }
  return ids;
}
export function nudgeElements(page, ids, dx, dy) {
  for (const id of rootSelection(page, ids)) {
    if (!editable(page, id)) continue;
    const found = findElement(page, id), e = found.element;
    // The arrow direction follows the page even inside a rotated / flipped group.
    let x = dx, y = dy;
    for (const group of found.ancestors) {
      const a = -(group.rotation || 0) * Math.PI / 180;
      [x,y] = [x*Math.cos(a)-y*Math.sin(a), x*Math.sin(a)+y*Math.cos(a)];
      if(group.flipX)x=-x;if(group.flipY)y=-y;
    }
    e.x += x; e.y += y;
  }
}
export function groupElements(page, ids) {
  const roots = rootSelection(page, ids).map(id => findElement(page,id)).filter(f => f && editable(page,f.element.id));
  if (roots.length < 2 || roots.some(f => f.items !== roots[0].items)) throw Error('请选择同一层里的至少两个未锁定元素');
  const children = roots.slice().sort((a,b)=>a.index-b.index).map(f => f.element), x=Math.min(...children.map(e=>e.x)), y=Math.min(...children.map(e=>e.y));
  const width=Math.max(...children.map(e=>e.x+e.width))-x, height=Math.max(...children.map(e=>e.y+e.height))-y;
  const group={id:uid('el'),type:'group',name:'分组',x,y,width:Math.max(1,width),height:Math.max(1,height),zIndex:Math.max(...children.map(e=>e.zIndex||0)),children};
  const selected=new Set(children), list=roots[0].items;
  const insert=Math.min(...roots.map(f=>f.index));
  children.forEach(e=>{e.x-=x;e.y-=y;});
  const remaining=list.filter(e=>!selected.has(e));remaining.splice(insert,0,group);list.splice(0,list.length,...remaining);
  return [group.id];
}
export function ungroupElements(page, ids) {
  const result=[];
  for (const id of rootSelection(page,ids)) {
    const f=findElement(page,id), g=f?.element;
    if(g?.type!=='group'||!editable(page,id))continue;
    const a=(g.rotation||0)*Math.PI/180, cos=Math.cos(a),sin=Math.sin(a);
    const children=g.children.slice().sort((a,b)=>(a.zIndex||0)-(b.zIndex||0)).map(child=>{
      const e=clone(child), cx=e.x+e.width/2-g.width/2,cy=e.y+e.height/2-g.height/2;
      const fx=g.flipX?-cx:cx,fy=g.flipY?-cy:cy;
      e.x=g.x+g.width/2+fx*cos-fy*sin-e.width/2;e.y=g.y+g.height/2+fx*sin+fy*cos-e.height/2;
      e.rotation=(g.rotation||0)+((!!g.flipX!==!!g.flipY)?-(e.rotation||0):(e.rotation||0));
      e.rotation=((e.rotation+180)%360+360)%360-180;
      if(g.flipX)e.flipX=!e.flipX;if(g.flipY)e.flipY=!e.flipY;
      e.opacity=(g.opacity??1)*(e.opacity??1);e.zIndex=g.zIndex||0;
      return e;
    });
    f.items.splice(f.index,1,...children);result.push(...children.map(e=>e.id));
  }
  return result;
}
export function escapeSelection(page, ids) {
  if(ids.length===1){const f=findElement(page,ids[0]);if(f?.parent)return[f.parent.id];}
  return [];
}
