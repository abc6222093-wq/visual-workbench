import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, extname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadConfig, stripDataDirArg } from './config.js';
import { initDataDir, initProjectDir, listProjects, projectDir } from './data-dir.js';
import { validateProjectData } from './validate.js';
import { saveVersion, listVersions, restoreVersion } from './version.js';
import * as versionStore from './version.js'; // 删除版本（deleteVersion）由另一处提供，运行时再取，没有时给中文提示
import { copyPages } from './copy-pages.js';
import { createProjectWatcher } from './watch.js';
import { readMasters, setMaster, createFromMaster, blankPage } from './master.js';
import { agentBrief } from './brief.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const REPO = resolve(WEB, '..');
const VERSION_ID = /^[0-9]{8}-[0-9]{6}(-[0-9]+)?$/;
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const validFile = name => typeof name === 'string' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.length <= 255;
const decodeFile = value => { let name; try { name = decodeURIComponent(value); } catch { throw fail(400, 'Invalid file name'); } if (!validFile(name)) throw fail(400, 'Invalid file name'); return name; };
function noSymlinks(path) {
  if (lstatSync(path).isSymbolicLink()) throw fail(403, 'Symbolic links are not allowed in project data');
  if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) noSymlinks(join(path, entry));
}
function checkDataRoots(dataDir) {
  for (const rel of ['projects', 'library', 'library/assets', 'library/fonts', 'exports']) {
    const path = join(dataDir, rel);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw fail(403, '数据目录中的文件夹不能是符号链接');
  }
}
function imageSize(data, mime) {
  if (mime === 'image/svg+xml') return svgSize(data);
  if (mime === 'image/png' && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return { width:data.readUInt32BE(16), height:data.readUInt32BE(20) };
  if (mime === 'image/gif' && data.length >= 10 && data.subarray(0, 3).toString() === 'GIF') return { width:data.readUInt16LE(6), height:data.readUInt16LE(8) };
  if (mime === 'image/webp' && data.length >= 30 && data.subarray(12, 16).toString() === 'VP8X') return { width:1+data.readUIntLE(24,3), height:1+data.readUIntLE(27,3) };
  if (mime === 'image/jpeg' && data.length > 4 && data[0] === 255 && data[1] === 216) {
    for (let i=2; i+9<data.length;) { if(data[i]!==255) break; const marker=data[i+1], length=data.readUInt16BE(i+2); if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return {width:data.readUInt16BE(i+7),height:data.readUInt16BE(i+5)}; if(length<2) break; i+=length+2; }
  }
  return {};
}
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf' };
const PRESETS = { 'slide-16x9':[1920,1080], 'web-desktop':[1440,900], 'web-mobile':[390,844], 'poster-a4':[2480,3508], 'poster-a3':[3508,4961], custom:[1920,1080] };
const fail = (status, message, details) => Object.assign(new Error(message), { status, details });
const hash = b => createHash('sha256').update(b).digest('hex');
const json = (res, status, body) => { const data = JSON.stringify(body); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(data), 'Cache-Control':'no-store' }); res.end(data); };
function safe(root, ...parts) { const p = resolve(root, ...parts); if (p !== root && !p.startsWith(root + sep)) throw fail(400, 'Invalid path'); if (existsSync(p) && p !== root && !realpathSync(p).startsWith(realpathSync(root) + sep)) throw fail(403, 'Symlink outside data directory'); return p; }
function readProject(dir) { const bytes = readFileSync(join(dir, 'project.json')); return { project:JSON.parse(bytes), revision:hash(bytes) }; }
function atomic(file, bytes) { const tmp = join(dirname(file), `.project-${randomUUID()}.tmp`); try { writeFileSync(tmp, bytes, { flag:'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force:true }); } }
function saveProject(dir, project, selfWrite) { const check = validateProjectData(project, { projectDir:dir }); if (!check.ok) throw fail(400, 'Invalid project', check.errors); const bytes = Buffer.from(JSON.stringify(project, null, 2) + '\n'); selfWrite?.('project.json', bytes); atomic(join(dir, 'project.json'), bytes); return hash(bytes); }
async function body(req) { let size=0, chunks=[]; for await (const c of req) { size+=c.length; if(size>25_000_000) throw fail(413,'Request too large'); chunks.push(c); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400,'Invalid JSON'); } }
function checkRevision(value, current) { if (value !== current) throw fail(409, 'Project changed on disk', { revision:current }); }
function projectPath(dataDir,id) {
  if (!ID.test(id)) throw fail(400,'Invalid project id');
  const dir=safe(join(dataDir,'projects'),id);
  if(!existsSync(join(dir,'project.json'))) throw fail(404,'Project not found');
  noSymlinks(dir);
  return dir;
}
function libraryRoot(dataDir) { const root=join(dataDir,'library/assets'); noSymlinks(root); return root; }
function serve(res, root, rel, extra={}) { const file=safe(root,rel); if(!existsSync(file)||!statSync(file).isFile()) throw fail(404,'File not found'); const data=readFileSync(file); const svg=extname(file).toLowerCase()==='.svg'; res.writeHead(200,{'Content-Type':(MIME[extname(file).toLowerCase()]||'application/octet-stream')+'; charset=utf-8','Content-Length':data.length,'X-Content-Type-Options':'nosniff',...(svg?{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}:{}),...extra}); res.end(data); }
// SVG 安全检查：只收纯图形。带脚本、事件属性、javascript: 链接、foreignObject、外部链接的一律拒绝
function checkSvg(data) {
  const text=data.toString('utf8');
  if(!/<svg[\s>]/i.test(text)) throw fail(400,'这个文件不是有效的 SVG 图片');
  if(/<script/i.test(text)) throw fail(400,'SVG 里含有脚本（<script>），为了安全不能使用');
  if(/<foreignObject/i.test(text)) throw fail(400,'SVG 里嵌了网页内容（foreignObject），为了安全不能使用');
  if(/[\s"'\/]on[a-z]+\s*=/i.test(text)) throw fail(400,'SVG 里含有事件代码（on… 属性），为了安全不能使用');
  if(/javascript\s*:/i.test(text)) throw fail(400,'SVG 里含有 javascript: 链接，为了安全不能使用');
  if(/href\s*=\s*["']?\s*(?:https?:)?\/\//i.test(text)) throw fail(400,'SVG 引用了网络上的外部文件，为了安全不能使用；请把图形直接画在 SVG 里');
  if(/<!ENTITY/i.test(text)) throw fail(400,'SVG 里含有实体声明（<!ENTITY>），为了安全不能使用');
}
// SVG 尺寸：根 <svg> 的 width / height（像素或无单位），没有就用 viewBox 的宽高
function svgSize(data) {
  const root=/<svg\b[^>]*>/i.exec(data.toString('utf8'))?.[0]; if(!root) return {};
  const attr=name=>new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`,'i').exec(root)?.[1];
  const length=v=>{ const m=/^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v||''); return m?Math.round(Number(m[1])):undefined; };
  let width=length(attr('width')), height=length(attr('height'));
  const box=(attr('viewBox')||'').trim().split(/[\s,]+/).map(Number);
  if(box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0) {
    if(!width&&!height) { width=Math.round(box[2]); height=Math.round(box[3]); }
    else if(!width) width=Math.round(height*box[2]/box[3]);
    else if(!height) height=Math.round(width*box[3]/box[2]);
  }
  return width>=1&&height>=1?{width,height}:{};
}
const UPLOAD_EXT={ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg' };
function upload(input) { const name=String(input.name||'image.png'); if(typeof input.data!=='string') throw fail(400,'Missing image data'); const match=/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,(.*)$/s.exec(input.data); const mime=input.mime||match?.[1]||'image/png'; if(!UPLOAD_EXT[mime]) throw fail(400,'Unsupported image type'); const encoded=match?match[2]:input.data; if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4===1) throw fail(400,'Invalid base64 image'); const data=Buffer.from(encoded,'base64'); if(!data.length||data.length>15_000_000) throw fail(400,'Invalid image size'); if(mime==='image/svg+xml') checkSvg(data); const ext=UPLOAD_EXT[mime]; const filename=`${randomUUID()}${ext}`; return {name, mime, data, filename, ...imageSize(data,mime)}; }
function dims(o) { for(const key of ['width','height']) if(!Number.isInteger(o[key])||o[key]<1) throw fail(400,`Invalid ${key}`); }
// ---------- 导出 ----------
// 导出文件放在 <数据目录>/exports/<项目编号>/<时间>-<类型>/，不在项目文件夹里：
// 实时连接不会把导出当成 agent 在改，存版本时也不会把导出文件存进去。
const EXPORT_KINDS = ['html', 'images', 'pdf'];
const pad = n => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const exportName = (project, id) => String(project?.name || id).replace(/[\\/:\0]/g, '-').replace(/^\.+/, '').trim().slice(0, 120) || id;
function exportDir(dataDir, id, kind) {
  const parent = join(dataDir, 'exports', id);
  mkdirSync(parent, { recursive: true });
  if (lstatSync(join(dataDir, 'exports')).isSymbolicLink() || lstatSync(parent).isSymbolicLink()) throw fail(403, '导出文件夹不能是符号链接');
  const base = `${stamp()}-${kind}`;
  for (let n = 1; ; n++) {
    const dir = join(parent, n === 1 ? base : `${base}-${n}`);
    if (!existsSync(dir)) { mkdirSync(dir); return dir; }
  }
}
async function defaultExporter(options) {
  let mod;
  try { mod = await import('./export/index.js'); } catch (e) { throw fail(500, `导出功能还没准备好：${e.message}`); }
  if (typeof mod.exportProject !== 'function') throw fail(500, '导出功能还没准备好：缺少 exportProject');
  return mod.exportProject(options);
}
// 在访达中显示：只允许 <数据目录>/exports/ 里面的东西（解析真实路径，挡住 ../ 和符号链接逃逸）
function revealPath(dataDir, input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) throw fail(400, '缺少要显示的路径');
  const root = join(dataDir, 'exports');
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) throw fail(403, '只能显示导出文件夹里的文件');
  const target = resolve(input), realRoot = realpathSync(root);
  if (!target.startsWith(root + sep) && !target.startsWith(realRoot + sep)) throw fail(403, '只能显示导出文件夹里的文件');
  if (!existsSync(target)) throw fail(404, '找不到这个文件，可能已经被移走或删除');
  const real = realpathSync(target);
  if (!real.startsWith(realRoot + sep)) throw fail(403, '只能显示导出文件夹里的文件');
  return target;
}
const defaultReveal = path => new Promise((done, failed) => {
  if (process.platform !== 'darwin') return failed(fail(400, '「在访达中显示」只能在 Mac 上使用'));
  execFile('open', ['-R', path], error => error ? failed(fail(500, `没能打开访达：${error.message}`)) : done());
});

function originAllowed(req,port) { const host=req.headers.host||''; if(!new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::${port})?$`).test(host)) return false; const origin=req.headers.origin; if(!origin) return true; try { const u=new URL(origin); return u.protocol==='http:' && u.host===host; } catch { return false; } }

export function createServer({ dataDir, port=4173, agentIdleMs=15000, watchPollMs=1000, exporter=defaultExporter, reveal=defaultReveal } = {}) {
  if(!dataDir) throw new Error('dataDir is required');
  dataDir=resolve(dataDir); checkDataRoots(dataDir); initDataDir(dataDir);
  // 实时连接：监听项目文件夹，文件被工作台以外的程序（agent）改动时推送给开着的界面
  const watcher = createProjectWatcher({ projectsDir:join(dataDir,'projects'), agentIdleMs, pollMs:watchPollMs });
  const streams = new Set();
  const selfWrite = id => (rel, bytes) => watcher.noteSelfWrite(id, rel, bytes);
  const masterList = () => readMasters(dataDir).filter(id => ID.test(id) && existsSync(join(dataDir,'projects',id,'project.json')));
  const server = http.createServer(async(req,res)=>{ try {
    if(!originAllowed(req,server.address()?.port || port)) throw fail(403,'Local origin required');
    checkDataRoots(dataDir);
    const url=new URL(req.url,'http://localhost'); const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET'&&url.pathname==='/api/projects') { const masters=new Set(masterList()); return json(res,200,listProjects(dataDir).map(id=>{ const project=readProject(projectPath(dataDir,id)).project; return {id,name:project.name,updatedAt:project.updatedAt,master:masters.has(id),project}; })); }
    if(req.method==='POST'&&url.pathname==='/api/projects') { const b=await body(req); if(typeof b.name!=='string'||!b.name.trim()) throw fail(400,'Name required'); const id=String(b.id||`project-${randomUUID().slice(0,8)}`); if(!ID.test(id)) throw fail(400,'Invalid project id'); const dir=safe(join(dataDir,'projects'),id); if(existsSync(dir)) throw fail(409,'Project already exists');
      if(b.fromMaster!==undefined) { // 从系列母版开始：继承画板、背景、字体、配色、动效代码和通用素材，不带页面内容
        if(!masterList().includes(b.fromMaster)) throw fail(400,'这个项目不是系列母版');
        let out; try { out=createFromMaster({masterDir:projectPath(dataDir,b.fromMaster),destProjectDir:dir,newId:id,newName:b.name.trim()}); } catch(e) { throw e.status?e:fail(400,e.message); }
        return json(res,201,{project:out.project,revision:readProject(dir).revision,fromMaster:b.fromMaster});
      }
      const preset=b.preset||'slide-16x9'; if(!PRESETS[preset]) throw fail(400,'Invalid preset'); const [dw,dh]=PRESETS[preset], width=b.width??dw,height=b.height??dh; dims({width,height}); mkdirSync(dir); try { initProjectDir(dir); const now=new Date().toISOString(); const project={format:'visual-workbench/project',formatVersion:2,id,name:b.name.trim(),createdAt:now,updatedAt:now,artboard:{preset,width,height},assets:[],fonts:[],pages:[blankPage('#ffffff')]}; const revision=saveProject(dir,project); return json(res,201,{project,revision}); } catch(e){rmSync(dir,{recursive:true,force:true});throw e;} }
    if(parts[0]==='api'&&parts[1]==='projects'&&parts[2]) { const id=parts[2],dir=projectPath(dataDir,id);
      if(parts.length===3&&req.method==='GET') return json(res,200,readProject(dir));
      if(parts.length===3&&req.method==='PUT') { const b=await body(req),old=readProject(dir); checkRevision(b.revision,old.revision); if(!b.project||b.project.id!==id||b.project.createdAt!==old.project.createdAt) throw fail(400,'Invalid project identity'); const project={...b.project,updatedAt:new Date().toISOString()}; const revision=saveProject(dir,project,selfWrite(id)); return json(res,200,{project,revision}); }
      if(parts[3]==='events'&&parts.length===4&&req.method==='GET') { // 推送：文件变化 + agent 状态（Server-Sent Events）
        res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive'});
        const send=(event,data)=>{ if(!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        const revisionNow=()=>{ try { return readProject(dir).revision; } catch { return null; } };
        const off=watcher.subscribe(id,ev=>ev.type==='changed'?send('changed',{...ev,revision:revisionNow()}):send('agent',ev));
        send('hello',{projectId:id,revision:revisionNow(),agent:watcher.agentState(id)});
        const ping=setInterval(()=>{ if(!res.writableEnded) res.write(': ping\n\n'); },25000); ping.unref();
        streams.add(res); req.on('close',()=>{ off(); clearInterval(ping); streams.delete(res); });
        return;
      }
      if(parts[3]==='brief'&&parts.length===4&&req.method==='GET') return json(res,200,{text:agentBrief({repoDir:REPO,dataDir,projectDir:dir,project:readProject(dir).project})});
      if(parts[3]==='master'&&parts.length===4&&req.method==='PUT') { const b=await body(req); if(typeof b.master!=='boolean') throw fail(400,'Invalid master flag'); setMaster(dataDir,id,b.master); return json(res,200,{id,master:b.master}); }
      if(parts[3]==='versions'&&parts.length===6&&parts[5]==='restore'&&req.method==='POST') { // 退回到某个版本：先自动存一版当前状态
        const vid=parts[4]; if(!VERSION_ID.test(vid)) throw fail(400,'Invalid version id'); if(!existsSync(join(dir,'versions',vid,'project.json'))) throw fail(404,'Version not found');
        let out; try { out=restoreVersion({projectDir:dir,versionId:vid,by:'user'}); } catch(e) { throw fail(400,e.message); } finally { watcher.noteSelfSnapshot(id); }
        return json(res,200,{...readProject(dir),restoredFrom:vid,backup:{id:basename(out.backup.versionDir),...out.backup.meta}});
      }
      if(parts[3]==='versions'&&parts.length===5&&req.method==='DELETE') { // 删除一个版本（不能恢复）
        const vid=parts[4]; if(!VERSION_ID.test(vid)) throw fail(400,'版本编号不对'); if(!existsSync(join(dir,'versions',vid,'meta.json'))&&!existsSync(join(dir,'versions',vid,'project.json'))) throw fail(404,'找不到这个版本');
        const deleteVersion=versionStore.deleteVersion; if(typeof deleteVersion!=='function') throw fail(501,'这个版本的工作台还不能删除版本');
        let out; try { out=await deleteVersion({projectDir:dir,versionId:vid}); } catch(e) { throw fail(e.status||400,e.message); } finally { watcher.noteSelfSnapshot(id); }
        return json(res,200,{id:vid,...out});
      }
      if(parts[3]==='export'&&parts.length===4&&req.method==='POST') { // 导出：放映版 HTML / 每页图片 / PDF
        const b=await body(req); if(!EXPORT_KINDS.includes(b.kind)) throw fail(400,'导出类型只能是 html（放映版）、images（每页图片）或 pdf');
        const outDir=exportDir(dataDir,id,b.kind); let out;
        try { out=await exporter({projectDir:dir,kind:b.kind,outDir,name:exportName(readProject(dir).project,id)}); }
        catch(e) { rmSync(outDir,{recursive:true,force:true}); throw fail(e.status||500,`导出失败：${e.message}`); }
        const finalDir=resolve(out?.outDir||outDir);
        const files=(out?.files||[]).map(f=>{ const path=resolve(finalDir,String(f.path)); return {path,bytes:Number(f.bytes)||0,name:path.startsWith(finalDir+sep)?path.slice(finalDir.length+1):basename(path)}; });
        return json(res,201,{kind:b.kind,outDir:finalDir,files});
      }
      if(parts[3]==='versions'&&parts.length===4&&req.method==='GET') return json(res,200,listVersions(dir).map(p=>({id:basename(p),...JSON.parse(readFileSync(join(p,'meta.json'),'utf8'))})).reverse());
      if(parts[3]==='versions'&&parts.length===4&&req.method==='POST') { const b=await body(req); if(b.note!==undefined&&typeof b.note!=='string') throw fail(400,'Invalid note'); const v=saveVersion({projectDir:dir,note:b.note||'',by:'user'}); return json(res,201,{id:basename(v.versionDir),...v.meta}); }
      if(parts[3]==='copy'&&parts.length===4&&req.method==='POST') { const b=await body(req); if(!ID.test(b.id||'')) throw fail(400,'Invalid project id'); const dest=safe(join(dataDir,'projects'),b.id); const out=copyPages({srcProjectDir:dir,pages:b.pages,destProjectDir:dest,newId:b.id,newName:b.name}); return json(res,201,{project:out.project,revision:readProject(dest).revision}); }
      if(parts[3]==='assets'&&parts.length===4&&req.method==='POST') { const b=await body(req),old=readProject(dir); if(b.revision!==undefined) checkRevision(b.revision,old.revision); let filename,name,data,source,width=b.width,height=b.height;
        if(b.libraryFile!==undefined) { if(!validFile(b.libraryFile)) throw fail(400,'Invalid library file'); const library=libraryRoot(dataDir); const from=safe(library,b.libraryFile); if(!existsSync(from)) throw fail(404,'Library file not found'); data=readFileSync(from); const metaPath=safe(library,`${b.libraryFile}.json`); const meta=existsSync(metaPath)?JSON.parse(readFileSync(metaPath,'utf8')):{}; const inferred=imageSize(data,MIME[extname(from).toLowerCase()]); width=width??meta.width??inferred.width; height=height??meta.height??inferred.height; filename=`${randomUUID()}${extname(from)}`; name=b.name||meta.name||b.libraryFile; source={type:'library',from:b.libraryFile}; }
        else { const u=upload(b); ({filename,name,data}=u); source={type:'upload'}; if(width===undefined&&height===undefined&&u.width&&u.height) ({width,height}=u); }
        if(width!==undefined||height!==undefined) dims({width,height}); const asset={id:`asset_${randomUUID().replaceAll('-','').slice(0,16)}`,kind:'image',file:`assets/${filename}`,name,...(width&&height?{width,height}:{}),pendingLayout:true,addedAt:new Date().toISOString(),source}; const file=safe(join(dir,'assets'),filename); watcher.noteSelfWrite(id,`assets/${filename}`,data); writeFileSync(file,data,{flag:'wx'}); try { const project={...old.project,updatedAt:new Date().toISOString(),assets:[...old.project.assets,asset]}; const revision=saveProject(dir,project,selfWrite(id)); return json(res,201,{asset,project,revision}); } catch(e){rmSync(file,{force:true});throw e;} }
    }
    if(url.pathname==='/api/reveal'&&req.method==='POST') { const b=await body(req); const target=revealPath(dataDir,b.path); await reveal(target); return json(res,200,{ok:true,path:target}); }
    if(url.pathname==='/api/library'&&req.method==='GET') { const root=libraryRoot(dataDir); return json(res,200,readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&validFile(e.name)&&MIME[extname(e.name).toLowerCase()]?.startsWith('image/')).map(e=>{ const data=readFileSync(safe(root,e.name)); const inferred=imageSize(data,MIME[extname(e.name).toLowerCase()]); const metaFile=safe(root,`${e.name}.json`); const meta=existsSync(metaFile)?JSON.parse(readFileSync(metaFile,'utf8')):{}; return {name:meta.name||e.name,file:e.name,url:`/data/library/assets/${encodeURIComponent(e.name)}`,width:meta.width??inferred.width??null,height:meta.height??inferred.height??null,mime:meta.mime||MIME[extname(e.name).toLowerCase()]}; })); }
    if(url.pathname==='/api/library'&&req.method==='POST') { const b=await body(req); const u=upload(b),root=libraryRoot(dataDir); const width=b.width??u.width,height=b.height??u.height; dims({width,height}); writeFileSync(safe(root,u.filename),u.data,{flag:'wx'}); writeFileSync(safe(root,`${u.filename}.json`),JSON.stringify({name:u.name,width,height,mime:u.mime})); return json(res,201,{name:u.name,file:u.filename,url:`/data/library/assets/${u.filename}`,width,height,mime:u.mime}); }
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='projects'&&parts.length===5&&['assets','fonts'].includes(parts[3]) ) return serve(res,join(projectPath(dataDir,parts[2]),parts[3]),decodeFile(parts[4]),{'Cache-Control':'no-store'});
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='library'&&parts[2]==='assets'&&parts.length===4 ) return serve(res,libraryRoot(dataDir),decodeFile(parts[3]));
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/data/')) return serve(res,WEB,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),{'Cache-Control':'no-cache'}); // 界面代码更新后，浏览器不能继续用旧的
    throw fail(404,'Not found');
  } catch(e) { if(res.headersSent) return res.end(); json(res,e.status||500,{error:e.message, ...(e.details?{details:e.details}:{})}); } });
  const close=server.close.bind(server);
  server.close=callback=>{ watcher.close(); for(const stream of streams) stream.end(); streams.clear(); server.closeIdleConnections?.(); return close(callback); };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = stripDataDirArg(process.argv.slice(2));
    let port = 4173;
    let noOpen = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--no-open') noOpen = true;
      else if (argv[i] === '--port') port = Number(argv[++i]);
      else if (argv[i].startsWith('--port=')) port = Number(argv[i].slice(7));
      else throw new Error(`未知参数：${argv[i]}`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数');
    const { dataDir } = loadConfig();
    const server = createServer({ dataDir, port });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请用 --port 指定其他端口。` : `工作台启动失败：${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`视觉工作台：${url}`);
      console.log(`数据目录：${dataDir}`);
      console.log('按 Control + C 停止工作台。');
      if (!noOpen) execFile('open', [url], error => {
        if (error) console.warn(`浏览器未能自动打开，请手动访问 ${url}`);
      });
    });
  } catch (error) {
    console.error(`工作台启动失败：${error.message}`);
    process.exitCode = 1;
  }
}
