import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addPage,addRow} from '../web/outline-model.js';
import {reconcileDocument} from '../web/outline-document.js';
import {saveVersion} from '../src/version.js';
import {validateProjectData} from '../src/validate.js';
test('按示例文档在临时副本填两页草稿：原页面逐字不变，存版并校验',t=>{
 const dir=mkdtempSync(join(tmpdir(),'vw-fill-example-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 cpSync(new URL('../examples/sample-deck/',import.meta.url),dir,{recursive:true,filter:p=>!p.split(/[\\/]/).includes('versions')});
 const file=join(dir,'project.json'),project=JSON.parse(readFileSync(file)),before=structuredClone(project.pages);
 const backup=saveVersion({projectDir:dir,note:'按示例文档填大纲前',by:'agent'});assert.ok(backup.versionDir);
 const source=readFileSync(new URL('../examples/outline-source.txt',import.meta.url),'utf8');
 const added=[];let page;
 for(const line of source.split(/\r?\n/)){
  const header=/^第 \d 页：(.*)$/.exec(line);if(header){page=addPage(project,project.pages.at(-1).id);page.name=header[1];added.push(page);continue;}
  if(!page)continue;const part=/^(大标题|英文副标题|正文|注释|备注|图片说明|强调)：(.*)$/.exec(line);if(!part)continue;
  const [,kind,text]=part;
  if(kind==='备注')page.outline.notes=text;
  else if(kind==='图片说明')page.outline.images.push({id:'image_observe',asset:project.assets[0].id,caption:text,from:1,until:null});
  else if(kind==='强调'){const row=page.outline.rows.at(-1),start=row.text.indexOf(text);assert.ok(start>=0);row.emphasis=[{start,end:start+text.length}];}
  else addRow(page.outline,{'大标题':'title','英文副标题':'english','正文':'body','注释':'note'}[kind],1,text);
 }
 for(const p of added){reconcileDocument(project,p);assert.equal(p.motion,undefined);assert.ok(p.elements.every(e=>e.documentDraft));assert.ok(p.outline.rows.every(row=>p.elements.some(e=>e.id===row.elementId&&e.text===row.text)));}
 assert.deepEqual(project.pages.slice(0,before.length),before);assert.equal(added.length,2);
 writeFileSync(file,JSON.stringify(project,null,2)+'\n');const result=validateProjectData(project,{projectDir:dir});assert.equal(result.ok,true,JSON.stringify(result.errors));
 if(process.env.VW_EXAMPLE_REPORT)writeFileSync(process.env.VW_EXAMPLE_REPORT,JSON.stringify(added.map(p=>({id:p.id,name:p.name,outline:p.outline})),null,2)+'\n');
});
