import test from 'node:test';
import assert from 'node:assert/strict';
import {snapMove,snapResize,alignElements,distributeElements} from '../web/layout-tools.js';
const b=(x,y=40,width=20,height=20)=>({x,y,width,height});
test('screen threshold, Alt bypass and excluded background',()=> {
  assert.equal(snapMove({bounds:b(8),page:{width:500,height:400},scale:0.5}).bounds.x,0);
  assert.equal(snapMove({bounds:b(8),page:{width:500,height:400},scale:1}).bounds.x,8);
  assert.equal(snapMove({bounds:b(2),page:{width:500,height:400},disabled:true}).bounds.x,2);
  assert.equal(snapMove({bounds:b(2),references:[{id:'bg',...b(0,0,500,400)}],page:{width:500,height:400},disabled:true}).guides.length,0);
});
test('equal-gap snaps continuation and unequal positions are not falsely equal',()=> {
 const r=snapMove({bounds:b(83),references:[{id:'a',...b(0)},{id:'b',...b(40)}],threshold:4});
 assert.equal(r.bounds.x,80);assert.equal(r.gaps[0].value,20);
 const n=snapMove({bounds:b(90),references:[{id:'a',...b(0)},{id:'b',...b(40)}],threshold:2});assert.equal(n.bounds.x,90);assert.equal(n.gaps.length,0);
});
test('resize anchors opposite edge and rotated resizing stays conservative',()=> {
 const r=snapResize({bounds:b(3,40,97),handle:'w',page:{width:500,height:400}});assert.equal(r.bounds.x,0);assert.equal(r.bounds.width,100);
 const e=snapResize({bounds:b(20,40,77),handle:'e',references:[{id:'a',...b(100)}]});assert.equal(e.bounds.x,20);assert.equal(e.bounds.width,80);
 assert.deepEqual(snapResize({bounds:b(3),handle:'w',rotation:30,page:{width:500,height:400}}).bounds,b(3));
});
test('alignment and unequal-size distribution preserve group children',()=> {
 const children=[b(1)],elements=[{id:'a',...b(0),children},{id:'b',...b(30,80,30)},{id:'c',...b(100,10,10)}];
 const aligned=alignElements(elements,'bottom');assert.equal(aligned[0].y,80);assert.equal(aligned[0].children,children);assert.equal(elements[0].y,40);
 const distributed=distributeElements(elements,'x');assert.equal(distributed[1].x,45);assert.equal(distributed[2].x,100);assert.equal(distributed[0].children,children);
});
test('rotated reference and selection use their screen-axis bounding boxes',()=> {
 const rotated={id:'r',...b(100,100,40,20),rotation:90};
 const snap=snapMove({bounds:b(111,40),references:[rotated],threshold:2});assert.equal(snap.bounds.x,110);
 const aligned=alignElements([rotated,{id:'plain',...b(0,0)}],'left');assert.equal(aligned[0].x,-10);assert.equal(aligned[1].x,0);
});
test('all six alignments use the combined bounds and vertical distribution uses equal gaps',()=>{
 const elements=[{id:'a',...b(10,20,20,30)},{id:'b',...b(50,70,40,10)},{id:'c',...b(120,130,20,20)}];
 for(const mode of ['left','center','right','top','middle','bottom']){const result=alignElements(elements,mode),axis=['left','center','right'].includes(mode)?'x':'y',size=axis==='x'?'width':'height',factor=['left','top'].includes(mode)?0:['center','middle'].includes(mode)?.5:1;const marks=result.map(e=>e[axis]+factor*e[size]);assert.ok(marks.every(v=>Math.abs(v-marks[0])<1e-8),mode);}
 const result=distributeElements(elements,'y');assert.equal(result[1].y-result[0].y-result[0].height,result[2].y-result[1].y-result[1].height);assert.deepEqual(elements.map(e=>e.y),[20,70,130]);
 const offRow=snapMove({bounds:b(83,200),references:[{id:'a',...b(0)},{id:'b',...b(40)}],threshold:4});assert.equal(offRow.gaps.length,0);
});

test('transformed resizing snaps a rotated edge without moving the opposite anchor',async()=>{
 const {snapTransformedResize,visualBounds}=await import('../web/layout-tools.js');
 const old={x:60,y:70,width:80,height:40,rotation:30};
 const left=e=>{const a=e.rotation*Math.PI/180;return [e.x+e.width/2-e.width/2*Math.cos(a),e.y+e.height/2-e.width/2*Math.sin(a)];};
 const result=snapTransformedResize({bounds:old,handle:'e',references:[{id:'target',x:146,y:500,width:20,height:20}],threshold:3});
 assert.ok(result.guides.some(g=>g.axis==='x'&&g.value===146));
 assert.ok(Math.abs(visualBounds(result.bounds).x+visualBounds(result.bounds).width-146)<1e-8);
 left(old).forEach((v,i)=>assert.ok(Math.abs(v-left(result.bounds)[i])<1e-8));assert.equal(result.bounds.height,old.height);
 assert.deepEqual(snapTransformedResize({bounds:old,handle:'e',disabled:true}).bounds,old);
});
test('resizing inside flipped rotated parents projects guides onto the page and preserves anchored edges',async()=>{
 const {snapTransformedResize,visualBounds}=await import('../web/layout-tools.js');const {elementWithParents}=await import('../web/element-operations.js');
 const parent={x:80,y:100,width:400,height:250,rotation:30,flipX:true};const old={x:60,y:70,width:80,height:40,rotation:20};
 const project=e=>elementWithParents(e,[parent]);const before=visualBounds(project(old));const target=before.x-2;
 const result=snapTransformedResize({bounds:old,handle:'e',project,references:[{id:'target',x:target,y:700,width:20,height:20}],threshold:3});
 assert.ok(result.guides.some(g=>g.axis==='x'&&Math.abs(g.value-target)<1e-8));assert.ok(Math.abs(visualBounds(project(result.bounds)).x-target)<1e-8);
 const anchor=e=>{const a=e.rotation*Math.PI/180;return {x:e.x+e.width/2-e.width/2*Math.cos(a),y:e.y+e.height/2-e.width/2*Math.sin(a),width:0,height:0};};
 const a=project(anchor(old)),z=project(anchor(result.bounds));assert.ok(Math.abs(a.x-z.x)<1e-8);assert.ok(Math.abs(a.y-z.y)<1e-8);assert.equal(result.bounds.height,old.height);
});

test('multi-selection pointer resizing snaps combined right edge 497 to page 500',async()=>{
 const {resizeFromPointer,snapPointerResize,selectionBounds}=await import('../web/layout-tools.js');
 const elements=[{x:20,y:40,width:80,height:40},{x:397,y:100,width:100,height:40}];
 const project=(dx,dy)=>selectionBounds(elements.map(e=>resizeFromPointer(e,'e',dx,dy)));
 const result=snapPointerResize({dx:0,dy:0,project,page:{width:500,height:400}});
 assert.ok(Math.abs(result.dx-3)<1e-8);assert.equal(result.dy,0);
 assert.ok(Math.abs(project(result.dx,result.dy).x+project(result.dx,result.dy).width-500)<1e-8);
 assert.ok(result.guides.some(g=>g.axis==='x'&&g.value===500));
 assert.deepEqual(snapPointerResize({dx:1.25,dy:-2,project,page:{width:500,height:400},disabled:true}),{dx:1.25,dy:-2,guides:[],gaps:[]});
});
test('continuous resizing of several rotated boxes leaves every opposite corner fixed',async()=>{
 const {resizeFromPointer,snapPointerResize,selectionBounds}=await import('../web/layout-tools.js');
 const elements=[{x:70,y:80,width:80,height:40,rotation:25},{x:210,y:150,width:120,height:70,rotation:-35}];
 const anchor=e=>{const a=e.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [e.x+e.width/2-e.width*c/2+e.height*s/2,e.y+e.height/2-e.width*s/2-e.height*c/2];};
 const project=(dx,dy)=>selectionBounds(elements.map(e=>resizeFromPointer(e,'se',dx,dy)));
 const original=project(2.25,1.5),right=original.x+original.width;
 const result=snapPointerResize({dx:2.25,dy:1.5,project,references:[{id:'r',x:right+2,y:900,width:30,height:20}],threshold:3});
 assert.ok(result.guides.some(g=>g.axis==='x'&&Math.abs(g.value-right-2)<1e-8));
 for(const e of elements){const resized=resizeFromPointer(e,'se',result.dx,result.dy);anchor(e).forEach((v,i)=>assert.ok(Math.abs(v-anchor(resized)[i])<1e-8));assert.notEqual(resized.width,Math.round(resized.width));}
});
test('pointer constraints preserve first guide and avoid excessive shallow-angle correction',async()=>{
 const {snapPointerResize}=await import('../web/layout-tools.js');
 const project=(dx,dy)=>({x:50,y:50,width:147+dx,height:246+dy});
 const result=snapPointerResize({dx:0,dy:0,project,page:{width:200,height:300}});
 assert.ok(Math.abs(result.dx-3)<1e-8);assert.ok(Math.abs(result.dy-4)<1e-8);assert.equal(result.guides.length,2);
 const shallow=(dx,dy)=>({x:50,y:80,width:147+.01*dx,height:20});
 const unchanged=snapPointerResize({dx:0,dy:0,project:shallow,page:{width:200,height:300}});
 assert.equal(unchanged.dx,0);assert.equal(unchanged.dy,0);assert.equal(unchanged.guides.length,0);
});
