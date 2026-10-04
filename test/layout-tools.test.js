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
