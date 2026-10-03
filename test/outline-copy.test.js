import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {copyPages} from '../src/copy-pages.js';
import {createOutline} from '../web/outline-model.js';
test('copy retains outline-only assets including deleted baseline images without touching source',()=>{const dir=mkdtempSync(join(tmpdir(),'vw-outline-copy-'));try{const src=join(dir,'source'),dest=join(dir,'dest');cpSync(new URL('../examples/sample-deck/',import.meta.url),src,{recursive:true});const file=join(src,'project.json'),p=JSON.parse(readFileSync(file)),page=p.pages[0];page.elements=[];page.motion=undefined;page.outline=createOutline();const asset=p.assets[0];page.outline.baseline={screens:1,rows:[],images:[{id:'image_deleted',asset:asset.id,caption:'removed',from:1,until:null}]};writeFileSync(file,JSON.stringify(p));const before=readFileSync(file,'utf8');const out=copyPages({srcProjectDir:src,pages:[1],destProjectDir:dest,newId:'outline-copy'});assert.deepEqual(out.project.pages[0].outline,page.outline);assert.ok(out.copiedAssets.includes(asset.id));assert.ok(existsSync(join(dest,asset.file)));assert.equal(readFileSync(file,'utf8'),before);}finally{rmSync(dir,{recursive:true,force:true});}});
