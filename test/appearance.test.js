import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectData} from '../src/validate.js';
const now='2026-10-01T12:00:00.000Z';
export function appearanceProject() {
 const base=(id,type,x)=>({id,type,x,y:20,width:60,height:60,zIndex:1,opacity:0.5,flipX:true,flipY:true});
 return {format:'visual-workbench/project',formatVersion:2,id:'appearance-demo',name:'外观',createdAt:now,updatedAt:now,artboard:{preset:'custom',width:400,height:140},fonts:[],assets:[{id:'asset_logo01',kind:'image',file:'assets/logo.svg',name:'logo',pendingLayout:false,width:60,height:60,addedAt:now}],pages:[{id:'page_appear01',name:'外观',background:'#ffffff',elements:[{...base('el_text01','text',20),text:'Flip',fontSize:24,color:'#ff0000'},{...base('el_image01','image',100),asset:'asset_logo01',fit:'fill',tint:'#ff0000'},{...base('el_shape01','shape',180),shape:'rect',fill:'#ff0000'},{...base('el_group01','group',260),children:[{...base('el_child01','shape',0),y:0,shape:'rect',fill:'#ff0000',opacity:1,flipX:false,flipY:false}]}]}]};
}
test('opacity and boolean flips accept all four types and reject malformed values',()=> {
 const project=appearanceProject();assert.equal(validateProjectData(project).ok,true);
 for(const key of ['flipX','flipY','opacity'])for(const value of key==='opacity'?[-0.1,1.1,'0.5',null]:[1,'true',null]) {
  for(let index=0;index<4;index++){const p=structuredClone(project);p.pages[0].elements[index][key]=value;assert.equal(validateProjectData(p).ok,false,`${key} ${value} type ${index}`);}
 }
});
