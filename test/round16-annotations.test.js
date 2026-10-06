// 第 15–16 轮：画笔批注（web/annotations.js）与批注截图（src/annotation-shots.js、brief、npm run annotations --clear）。
// 画一条线 → kind:'stroke'；圈一个圈（首尾重合）不被抽成两个点；选中改颜色、Delete 删除、撤销；
// 复制给 agent（GET brief）时有批注的页生成 annotations/<页面编号>.png（页面尺寸、带批注颜色），文字里有截图路径与「截图编号」；
// 存版不含 annotations/；npm run annotations -- --clear 后截图被删。
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';import {join,dirname} from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {startWorkbench,openProject,painted} from './round12-editor-fixture.js';
import {saveVersion} from '../src/version.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const disk=file=>JSON.parse(readFileSync(file,'utf8'));
const notes=files=>disk(files.demo).pages[0].annotations||[];
async function until(fn,ms=8000){const t0=Date.now();let v;while(Date.now()-t0<ms){v=fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw new Error('等不到 '+JSON.stringify(v));}
const screen=(page,x,y)=>page.evaluate(([x,y])=>{const r=document.querySelector('#artboard').getBoundingClientRect(),s=r.width/1920;return {x:r.left+x*s,y:r.top+y*s,s};},[x,y]);
async function drawPath(page,pts){
 const first=await screen(page,...pts[0]);await page.mouse.move(first.x,first.y);await page.mouse.down();
 for(const p of pts.slice(1)){const q=await screen(page,...p);await page.mouse.move(q.x,q.y,{steps:2});}
 await page.mouse.up();
}
const count=(data,info,test)=>{let n=0;for(let i=0;i<data.length;i+=info.channels)if(test(data[i],data[i+1],data[i+2]))n++;return n;};

test('round16 画笔批注：画线、圈圈、改颜色、删除撤销；批注截图生成、存版不含、清除后删掉',async t=>{
 const {page,errors,files,url,dir}=await startWorkbench(t,{prefix:'vw-round16-annot-'});
 await openProject(page);await page.waitForSelector('#artboard[data-ready="1"]',{timeout:15000});
 const pen=page.locator('.ed-tools [data-action="annotate-pen"]');
 await pen.click();assert.equal(await pen.getAttribute('aria-pressed'),'true');
 await painted(page);await page.waitForTimeout(100);
 // 一条直线（页面坐标 300,800 → 1000,800）
 await drawPath(page,[[300,800],[500,800],[700,800],[1000,800]]);
 let list=await until(()=>notes(files).length===1&&notes(files));
 const line=list[0];
 assert.equal(line.kind,'stroke');assert.match(line.id,/^an_/);
 assert.ok(Array.isArray(line.points)&&line.points.length>=2);
 assert.ok(Math.abs(line.points[0][0]-300)<4&&Math.abs(line.points.at(-1)[0]-1000)<4,JSON.stringify(line.points));
 assert.equal(line.color.toLowerCase(),'#e5484d');assert.equal(line.arrow,false);
 // 圈一个圈：首尾重合
 const circle=[];for(let k=0;k<=24;k++){const a=k/24*Math.PI*2;circle.push([1400+180*Math.cos(a),400+180*Math.sin(a)]);}
 await drawPath(page,circle);
 list=await until(()=>notes(files).length===2&&notes(files));
 const ring=list[1];
 assert.equal(ring.kind,'stroke');
 assert.ok(ring.points.length>=8,`圈不应被抽成两个点：${ring.points.length}`);
 const xs=ring.points.map(p=>p[0]);assert.ok(Math.max(...xs)-Math.min(...xs)>300,'圈的范围还在');
 // 退出画笔，点线选中，改成蓝色
 await page.keyboard.press('Escape');assert.equal(await pen.getAttribute('aria-pressed'),'false');
 await painted(page);await page.waitForTimeout(100);
 const on=await screen(page,650,800);await page.mouse.click(on.x,on.y);
 await page.waitForSelector('.vw-stroke.is-selected',{state:'attached'});
 await page.locator('.ed-quickbar [data-annot-color="#2f6bff"]').click();
 await until(()=>notes(files)[0]?.color==='#2f6bff');
 assert.equal(notes(files)[1].color.toLowerCase(),'#e5484d','只改选中的那条');
 // Delete 删除、撤销
 if(!await page.locator('.vw-stroke.is-selected').count()){await page.mouse.click(on.x,on.y);await page.waitForSelector('.vw-stroke.is-selected',{state:'attached'});}
 await page.keyboard.press('Delete');
 await until(()=>notes(files).length===1&&notes(files)[0].id===ring.id);
 await page.locator('[data-action="undo"]').click();
 list=await until(()=>notes(files).length===2&&notes(files));
 assert.equal(list.find(a=>a.id===line.id)?.color,'#2f6bff');
 await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='已保存');

 // 复制给 agent：生成批注截图
 const projectDir=dirname(files.demo),shot=join(projectDir,'annotations','page_p01.png');
 const res=await fetch(`${url}/api/projects/demo/brief`);assert.equal(res.status,200);
 const {text}=await res.json();
 assert.ok(existsSync(shot),'生成了 annotations/page_p01.png');
 assert.ok(text.includes(shot),'文字里有截图路径');
 assert.match(text,/截图编号 1/);assert.match(text,/截图编号 2/);
 assert.ok(!existsSync(join(projectDir,'annotations','page_p02.png')),'没有批注的页不截');
 const {data,info}=await sharp(shot).raw().toBuffer({resolveWithObject:true});
 assert.equal(info.width,1920);assert.equal(info.height,1080);
 assert.ok(count(data,info,(r,g,b)=>r<90&&g>80&&g<140&&b>220)>500,'截图上有蓝色的线');
 assert.ok(count(data,info,(r,g,b)=>r>200&&g<110&&b<120)>500,'截图上有红色的圈');
 // 存版不含 annotations/
 const {versionDir}=saveVersion({projectDir,note:'测试存版',by:'agent'});
 assert.ok(!existsSync(join(versionDir,'annotations')),`版本里不该有批注截图：${readdirSync(versionDir).join(',')}`);
 // npm run annotations -- --clear：截图跟着删
 const home=join(dir,'cli-home');
 const r=spawnSync(process.execPath,[join(ROOT,'src/cli/annotations.js'),'demo','--clear'],{encoding:'utf8',env:{...process.env,VW_DATA_DIR:dir,HOME:home,USERPROFILE:home}});
 assert.equal(r.status,0,r.stderr);
 assert.ok(!existsSync(shot),'清除后截图被删');
 assert.equal((disk(files.demo).pages[0].annotations||[]).length,0);
 assert.deepEqual(errors,[]);
});
