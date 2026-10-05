// 第 9 轮：自己写的文件读回不再算外部修改（第 12 轮起编辑器部分由 round12-editor-canvas 覆盖，这里只留监听器用例）
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createProjectWatcher} from '../src/watch.js';

test('round9 watcher: consecutive self writes are all recognised as self writes',async t=>{
 const projectsDir=mkdtempSync(join(tmpdir(),'vw-round9-watch-'));mkdirSync(join(projectsDir,'demo'));const file=join(projectsDir,'demo/project.json');writeFileSync(file,'{"v":0}\n');
 const w=createProjectWatcher({projectsDir,fsWatch:false,pollMs:60000});const events=[];w.subscribe('demo',ev=>events.push(ev));
 t.after(()=>{w.close();rmSync(projectsDir,{recursive:true,force:true});});
 const first=Buffer.from('{"v":11}\n'),second=Buffer.from('{"v":222}\n'); // 长度不同：轮询按 mtime+size 也一定能看到
 w.noteSelfWrite('demo','project.json',first);w.noteSelfWrite('demo','project.json',second);
 writeFileSync(file,first);await w.scanNow('demo');writeFileSync(file,second);await w.scanNow('demo');
 assert.deepEqual(events.filter(e=>e.type==='changed').map(e=>e.external),[false,false]);assert.equal(w.agentState('demo'),'idle');
 // 之后 agent 真的改了：照样算外部修改
 writeFileSync(file,'{"v":3333}\n');await w.scanNow('demo');assert.equal(events.filter(e=>e.type==='changed').at(-1).external,true);
});
