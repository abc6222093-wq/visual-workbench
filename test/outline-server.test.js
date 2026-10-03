import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../src/server.js';
import {createOutline,addRow} from '../web/outline-model.js';
test('extract and apply back up; stale and invalid requests leave disk unchanged; restore includes outline',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'vw-outline-')),server=createServer({dataDir:dir,port:4173});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${server.address().port}`;
 const req=async(path,method='GET',payload)=>{const r=await fetch(base+path,{method,headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});return {status:r.status,body:await r.json()};};
 const made=await req('/api/projects','POST',{id:'outline-test',name:'Test'}),pageId=made.body.project.pages[0].id,o=createOutline();addRow(o,'title',1,'Hello');
 const url='/api/projects/outline-test',file=join(dir,'projects/outline-test/project.json'),before=readFileSync(file,'utf8');
 assert.equal((await req(url+'/outline/extract','POST',{revision:'stale',outlines:{[pageId]:o}})).status,409);assert.equal(readFileSync(file,'utf8'),before);
 const bad=structuredClone(o);bad.rows[0].from=9;assert.equal((await req(url+'/outline/extract','POST',{revision:made.body.revision,outlines:{[pageId]:bad}})).status,400);assert.equal(readFileSync(file,'utf8'),before);assert.equal((await req(url+'/versions')).body.length,0);
 const extracted=await req(url+'/outline/extract','POST',{revision:made.body.revision,outlines:{[pageId]:o}});assert.equal(extracted.status,200);assert.ok(extracted.body.backup);assert.equal((await req(url+'/versions')).body.length,1);
 const applied=await req(url+'/outline/apply','POST',{revision:extracted.body.revision,pageIds:[pageId]});assert.equal(applied.status,200);assert.equal(applied.body.unapplied[0].type,'new');
 const brief=await req(url+'/outline/brief?pageIds='+pageId);assert.ok(brief.body.text.includes(file));
 const restored=await req(url+'/versions/'+applied.body.backup+'/restore','POST',{});assert.equal(restored.status,200);assert.deepEqual(restored.body.project.pages[0].outline,o);
});
