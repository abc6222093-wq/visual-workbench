import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../src/server.js';
import {initDataDir} from '../src/data-dir.js';
import {getLocalConfigPath} from '../src/config.js';
async function start(t,options){const server=createServer({...options,port:0});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};}
function temp(t){const root=mkdtempSync(join(tmpdir(),'vw-devices-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('设置只保存有效本机路径，不搬数据、不切换当前路径；显示来源及平台',async t=>{
 const root=temp(t),dataDir=join(root,'old'),next=join(root,'new'),home=join(root,'home');initDataDir(next);
 const request=await start(t,{dataDir,configHome:home,configSource:'env'});
 const settings=await request('/api/settings');assert.equal(settings.data.source,'env');assert.equal(settings.data.dataDir,dataDir);assert.ok(settings.data.revealLabel);
 assert.equal((await request('/api/settings','PUT',{dataDir:join(root,'missing')})).status,400);assert.equal(existsSync(getLocalConfigPath({home})),false);
 assert.equal((await request('/api/settings','PUT',{dataDir:next})).status,200);assert.equal(JSON.parse(readFileSync(getLocalConfigPath({home}))).dataDir,next);
 assert.equal((await request('/api/settings')).data.dataDir,dataDir);
 assert.equal((await request('/api/health')).data.app,'visual-workbench');
});
test('新鲜会话在后端阻挡读写，用户确认已看到的电脑后才可访问',async t=>{
 const root=temp(t),dataDir=join(root,'data');const one=await start(t,{dataDir,usageOptions:{hostname:'MacBook'}});const two=await start(t,{dataDir,usageOptions:{hostname:'Windows'}});
 assert.equal((await two('/api/projects')).status,423);assert.equal((await two('/api/projects','POST',{name:'blocked'})).status,423);
 const state=(await two('/api/session')).data;assert.equal(state.blocked,true);assert.equal(state.fresh[0].computer,'MacBook');
 assert.equal((await two('/api/session/confirm','POST',{tokens:state.fresh.map(s=>s.token)})).data.blocked,false);
 assert.equal((await two('/api/projects')).status,200);assert.equal((await one('/api/projects')).status,423);
});
test('打开项目列出冲突副本；两种大纲说明均带当前数据目录',async t=>{
 const root=temp(t),dataDir=join(root,'data'),request=await start(t,{dataDir});await request('/api/projects','POST',{id:'example',name:'Example'});
 const file=join(dataDir,'projects/example/project.json');writeFileSync(join(dataDir,'projects/example/project (1).json'),readFileSync(file));
 assert.deepEqual((await request('/api/projects/example')).data.syncConflicts,['project (1).json']);
 for(const mode of ['fill','layout']){const response=await request(`/api/projects/example/outline/brief?mode=${mode}`);assert.equal(response.status,200);assert.ok(response.data.text.includes(dataDir));assert.match(response.data.text,mode==='fill'?/只填不排/:/请按大纲排版/);}
 assert.equal((await request('/api/projects/example/outline/brief?mode=bad')).status,400);
});
