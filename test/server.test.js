import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './helpers/isolated-server.js';

async function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'vw-server-')); const server=createServer({dataDir:dir,port:4173});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,method='GET',payload,headers={})=>{const r=await fetch(base+path,{method,headers:{...(payload?{'content-type':'application/json'}:{}),...headers},body:payload?JSON.stringify(payload):undefined});return {status:r.status,body:await r.json()};};
  return {dir,base,request};
}

test('create, list, validate, save with revision, and reject stale writes',async t=>{
 const {dir,request}=await fixture(t);
 const made=await request('/api/projects','POST',{id:'demo',name:'Demo',preset:'custom',width:800,height:600}); assert.equal(made.status,201); assert.equal(made.body.project.pages.length,1);
 const listing=await request('/api/projects'); assert.equal(listing.body[0].id,'demo');
 const loaded=await request('/api/projects/demo'); assert.equal(loaded.body.revision,made.body.revision);
 const project={...loaded.body.project,name:'Edited'};
 const saved=await request('/api/projects/demo','PUT',{project,revision:loaded.body.revision}); assert.equal(saved.status,200); assert.equal(saved.body.project.name,'Edited');
 assert.equal((await request('/api/projects/demo','PUT',{project,revision:loaded.body.revision})).status,409);
 const file=join(dir,'projects/demo/project.json'); assert.equal(JSON.parse(readFileSync(file)).name,'Edited');
 const invalid={...saved.body.project,pages:[]}; assert.equal((await request('/api/projects/demo','PUT',{project:invalid,revision:saved.body.revision})).status,400);
 assert.equal(JSON.parse(readFileSync(file)).pages.length,1);
});

test('versions and copies preserve source project',async t=>{
 const {dir,request}=await fixture(t);
 await request('/api/projects','POST',{id:'source',name:'Source'});
 const version=await request('/api/projects/source/versions','POST',{note:'before edit'}); assert.equal(version.status,201); assert.equal(version.body.by,'user');
 const versions=await request('/api/projects/source/versions'); assert.equal(versions.body.length,1); assert.equal(versions.body[0].note,'before edit');
 const copy=await request('/api/projects/source/copy','POST',{id:'copy-1',name:'Copy',pages:[1]}); assert.equal(copy.status,201); assert.equal(copy.body.project.name,'Copy');
 assert.equal((await request('/api/projects/source')).body.project.name,'Source'); assert.ok(existsSync(join(dir,'projects/copy-1/project.json')));
});

test('library upload, project asset copy, and file serving',async t=>{
 const {request,base}=await fixture(t);
 await request('/api/projects','POST',{id:'assets',name:'Assets'});
 const data=Buffer.from('tiny').toString('base64');
 const lib=await request('/api/library','POST',{name:'tiny.png',data,width:2,height:2,mime:'image/png'}); assert.equal(lib.status,201);
 const library=(await request('/api/library')).body; assert.equal(library.length,1); assert.equal(library[0].width,2); assert.equal(library[0].name,'tiny.png');
 const asset=await request('/api/projects/assets/assets','POST',{libraryFile:lib.body.file,width:2,height:2}); assert.equal(asset.status,201); assert.equal(asset.body.asset.pendingLayout,undefined); assert.equal(asset.body.asset.source.type,'library');
 const served=await fetch(`${base}/data/projects/assets/${asset.body.asset.file}`); assert.equal(served.status,200); assert.equal(await served.text(),'tiny');
});

test('rejects hostile origins and traversal',async t=>{
 const {request,base}=await fixture(t);
 assert.equal((await request('/api/projects','GET',undefined,{Origin:'https://evil.example'})).status,403);
 const outside=await fetch(`${base}/../package.json`); assert.equal(outside.status,404);
});

test('serves registered Unicode and space filenames, rejects project symlinks',async t=>{
 const {dir,request,base}=await fixture(t);
 await request('/api/projects','POST',{id:'unicode',name:'Unicode'});
 const assetDir=join(dir,'projects/unicode/assets');
 const name='课件 图片.png'; writeFileSync(join(assetDir,name),'image bytes');
 assert.equal(await (await fetch(`${base}/data/projects/unicode/assets/${encodeURIComponent(name)}`)).text(),'image bytes');
 assert.equal((await fetch(`${base}/data/projects/unicode/assets/%2e%2e%2fproject.json`)).status,400);
 const external=join(dir,'external.txt'); writeFileSync(external,'outside');
 try { symlinkSync(external,join(assetDir,'linked.png')); } catch (e) { if (process.platform !== 'win32' || e.code !== 'EPERM') throw e; t.diagnostic('Windows 未开启开发者模式或管理员权限，无法创建符号链接；本用例只省略链接部分，其余断言照常执行'); return; }
 assert.equal((await request('/api/projects/unicode')).status,403);
 rmSync(join(assetDir,'linked.png'));
 rmSync(assetDir,{recursive:true}); symlinkSync(dir,assetDir);
 assert.equal((await request('/api/projects/unicode')).status,403);
});

test('rejects symlinked project file and source font when copying',async t=>{
 const {dir,request}=await fixture(t);
 await request('/api/projects','POST',{id:'links',name:'Links'});
 const p=join(dir,'projects/links/project.json'); const saved=readFileSync(p); rmSync(p); const outside=join(dir,'outside.json'); writeFileSync(outside,saved);
 try { symlinkSync(outside,p); } catch (e) { if (process.platform !== 'win32' || e.code !== 'EPERM') throw e; writeFileSync(p,saved); t.diagnostic('Windows 未开启开发者模式或管理员权限，无法创建符号链接；本用例只省略链接部分，其余断言照常执行'); return; }
 assert.equal((await request('/api/projects/links')).status,403); rmSync(p); writeFileSync(p,saved);
 const font=join(dir,'projects/links/fonts/a.ttf'); symlinkSync(outside,font);
 assert.equal((await request('/api/projects/links/copy','POST',{id:'new-copy',pages:[1]})).status,403);
 assert.equal(existsSync(join(dir,'projects/new-copy')),false);
});

test('infers dimensions and name for a raw library image',async t=>{
 const {dir,request}=await fixture(t);
 await request('/api/projects','POST',{id:'raw',name:'Raw'});
 const png=Buffer.alloc(24); Buffer.from('89504e470d0a1a0a','hex').copy(png); png.writeUInt32BE(7,16); png.writeUInt32BE(9,20);
 writeFileSync(join(dir,'library/assets/图片 空格.png'),png);
 const listing=(await request('/api/library')).body; assert.equal(listing[0].width,7); assert.equal(listing[0].height,9);
 const added=await request('/api/projects/raw/assets','POST',{libraryFile:'图片 空格.png'});
 assert.equal(added.status,201); assert.equal(added.body.asset.width,7); assert.equal(added.body.asset.name,'图片 空格.png');
});
