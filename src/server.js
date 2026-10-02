import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, extname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { loadConfig, stripDataDirArg } from './config.js';
import { initDataDir, initProjectDir, listProjects, projectDir } from './data-dir.js';
import { validateProjectData } from './validate.js';
import { saveVersion, listVersions } from './version.js';
import { copyPages } from './copy-pages.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const validFile = name => typeof name === 'string' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.length <= 255;
const decodeFile = value => { let name; try { name = decodeURIComponent(value); } catch { throw fail(400, 'Invalid file name'); } if (!validFile(name)) throw fail(400, 'Invalid file name'); return name; };
function noSymlinks(path) {
  if (lstatSync(path).isSymbolicLink()) throw fail(403, 'Symbolic links are not allowed in project data');
  if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) noSymlinks(join(path, entry));
}
function checkDataRoots(dataDir) {
  for (const rel of ['projects', 'library', 'library/assets', 'library/fonts']) {
    const path = join(dataDir, rel);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw fail(403, '数据目录中的文件夹不能是符号链接');
  }
}
function imageSize(data, mime) {
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
function saveProject(dir, project) { const check = validateProjectData(project, { projectDir:dir }); if (!check.ok) throw fail(400, 'Invalid project', check.errors); const bytes = Buffer.from(JSON.stringify(project, null, 2) + '\n'); atomic(join(dir, 'project.json'), bytes); return hash(bytes); }
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
function serve(res, root, rel) { const file=safe(root,rel); if(!existsSync(file)||!statSync(file).isFile()) throw fail(404,'File not found'); const data=readFileSync(file); res.writeHead(200,{'Content-Type':(MIME[extname(file).toLowerCase()]||'application/octet-stream')+'; charset=utf-8','Content-Length':data.length,'X-Content-Type-Options':'nosniff'}); res.end(data); }
function upload(input) { const name=String(input.name||'image.png'); if(typeof input.data!=='string') throw fail(400,'Missing image data'); const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s.exec(input.data); const mime=input.mime||match?.[1]||'image/png'; if(!['image/png','image/jpeg','image/webp','image/gif'].includes(mime)) throw fail(400,'Unsupported image type'); const encoded=match?match[2]:input.data; if(!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length%4===1) throw fail(400,'Invalid base64 image'); const data=Buffer.from(encoded,'base64'); if(!data.length||data.length>15_000_000) throw fail(400,'Invalid image size'); const ext={ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif' }[mime]; const filename=`${randomUUID()}${ext}`; return {name, mime, data, filename}; }
function dims(o) { for(const key of ['width','height']) if(!Number.isInteger(o[key])||o[key]<1) throw fail(400,`Invalid ${key}`); }
function originAllowed(req,port) { const host=req.headers.host||''; if(!new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::${port})?$`).test(host)) return false; const origin=req.headers.origin; if(!origin) return true; try { const u=new URL(origin); return u.protocol==='http:' && u.host===host; } catch { return false; } }

export function createServer({ dataDir, port=4173 } = {}) {
  if(!dataDir) throw new Error('dataDir is required');
  dataDir=resolve(dataDir); checkDataRoots(dataDir); initDataDir(dataDir);
  const server = http.createServer(async(req,res)=>{ try {
    if(!originAllowed(req,server.address()?.port || port)) throw fail(403,'Local origin required');
    checkDataRoots(dataDir);
    const url=new URL(req.url,'http://localhost'); const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET'&&url.pathname==='/api/projects') return json(res,200,listProjects(dataDir).map(id=>{ const project=readProject(projectPath(dataDir,id)).project; return {id,name:project.name,updatedAt:project.updatedAt,project}; }));
    if(req.method==='POST'&&url.pathname==='/api/projects') { const b=await body(req); if(typeof b.name!=='string'||!b.name.trim()) throw fail(400,'Name required'); const preset=b.preset||'slide-16x9'; if(!PRESETS[preset]) throw fail(400,'Invalid preset'); const [dw,dh]=PRESETS[preset], width=b.width??dw,height=b.height??dh; dims({width,height}); const id=String(b.id||`project-${randomUUID().slice(0,8)}`); if(!ID.test(id)) throw fail(400,'Invalid project id'); const dir=safe(join(dataDir,'projects'),id); if(existsSync(dir)) throw fail(409,'Project already exists'); mkdirSync(dir); try { initProjectDir(dir); const now=new Date().toISOString(); const project={format:'visual-workbench/project',formatVersion:1,id,name:b.name.trim(),createdAt:now,updatedAt:now,artboard:{preset,width,height},assets:[],fonts:[],pages:[{id:'page_first',name:'第 1 页',background:'#ffffff',elements:[],steps:[]}]}; const revision=saveProject(dir,project); return json(res,201,{project,revision}); } catch(e){rmSync(dir,{recursive:true,force:true});throw e;} }
    if(parts[0]==='api'&&parts[1]==='projects'&&parts[2]) { const id=parts[2],dir=projectPath(dataDir,id);
      if(parts.length===3&&req.method==='GET') return json(res,200,readProject(dir));
      if(parts.length===3&&req.method==='PUT') { const b=await body(req),old=readProject(dir); checkRevision(b.revision,old.revision); if(!b.project||b.project.id!==id||b.project.createdAt!==old.project.createdAt) throw fail(400,'Invalid project identity'); const project={...b.project,updatedAt:new Date().toISOString()}; const revision=saveProject(dir,project); return json(res,200,{project,revision}); }
      if(parts[3]==='versions'&&parts.length===4&&req.method==='GET') return json(res,200,listVersions(dir).map(p=>({id:basename(p),...JSON.parse(readFileSync(join(p,'meta.json'),'utf8'))})).reverse());
      if(parts[3]==='versions'&&parts.length===4&&req.method==='POST') { const b=await body(req); if(b.note!==undefined&&typeof b.note!=='string') throw fail(400,'Invalid note'); const v=saveVersion({projectDir:dir,note:b.note||'',by:'user'}); return json(res,201,{id:basename(v.versionDir),...v.meta}); }
      if(parts[3]==='copy'&&parts.length===4&&req.method==='POST') { const b=await body(req); if(!ID.test(b.id||'')) throw fail(400,'Invalid project id'); const dest=safe(join(dataDir,'projects'),b.id); const out=copyPages({srcProjectDir:dir,pages:b.pages,destProjectDir:dest,newId:b.id,newName:b.name}); return json(res,201,{project:out.project,revision:readProject(dest).revision}); }
      if(parts[3]==='assets'&&parts.length===4&&req.method==='POST') { const b=await body(req),old=readProject(dir); if(b.revision!==undefined) checkRevision(b.revision,old.revision); let filename,name,data,source,width=b.width,height=b.height;
        if(b.libraryFile!==undefined) { if(!validFile(b.libraryFile)) throw fail(400,'Invalid library file'); const library=libraryRoot(dataDir); const from=safe(library,b.libraryFile); if(!existsSync(from)) throw fail(404,'Library file not found'); data=readFileSync(from); const metaPath=safe(library,`${b.libraryFile}.json`); const meta=existsSync(metaPath)?JSON.parse(readFileSync(metaPath,'utf8')):{}; const inferred=imageSize(data,MIME[extname(from).toLowerCase()]); width=width??meta.width??inferred.width; height=height??meta.height??inferred.height; filename=`${randomUUID()}${extname(from)}`; name=b.name||meta.name||b.libraryFile; source={type:'library',from:b.libraryFile}; }
        else { const u=upload(b); ({filename,name,data}=u); source={type:'upload'}; }
        if(width!==undefined||height!==undefined) dims({width,height}); const asset={id:`asset_${randomUUID().replaceAll('-','').slice(0,16)}`,kind:'image',file:`assets/${filename}`,name,...(width&&height?{width,height}:{}),pendingLayout:true,addedAt:new Date().toISOString(),source}; const file=safe(join(dir,'assets'),filename); writeFileSync(file,data,{flag:'wx'}); try { const project={...old.project,updatedAt:new Date().toISOString(),assets:[...old.project.assets,asset]}; const revision=saveProject(dir,project); return json(res,201,{asset,project,revision}); } catch(e){rmSync(file,{force:true});throw e;} }
    }
    if(url.pathname==='/api/library'&&req.method==='GET') { const root=libraryRoot(dataDir); return json(res,200,readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&validFile(e.name)&&MIME[extname(e.name).toLowerCase()]?.startsWith('image/')).map(e=>{ const data=readFileSync(safe(root,e.name)); const inferred=imageSize(data,MIME[extname(e.name).toLowerCase()]); const metaFile=safe(root,`${e.name}.json`); const meta=existsSync(metaFile)?JSON.parse(readFileSync(metaFile,'utf8')):{}; return {name:meta.name||e.name,file:e.name,url:`/data/library/assets/${encodeURIComponent(e.name)}`,width:meta.width??inferred.width??null,height:meta.height??inferred.height??null,mime:meta.mime||MIME[extname(e.name).toLowerCase()]}; })); }
    if(url.pathname==='/api/library'&&req.method==='POST') { const b=await body(req); dims(b); const u=upload(b),root=libraryRoot(dataDir); writeFileSync(safe(root,u.filename),u.data,{flag:'wx'}); writeFileSync(safe(root,`${u.filename}.json`),JSON.stringify({name:u.name,width:b.width,height:b.height,mime:u.mime})); return json(res,201,{name:u.name,file:u.filename,url:`/data/library/assets/${u.filename}`,width:b.width,height:b.height,mime:u.mime}); }
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='projects'&&parts.length===5&&['assets','fonts'].includes(parts[3]) ) return serve(res,join(projectPath(dataDir,parts[2]),parts[3]),decodeFile(parts[4]));
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='library'&&parts[2]==='assets'&&parts.length===4 ) return serve(res,libraryRoot(dataDir),decodeFile(parts[3]));
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/data/')) return serve(res,WEB,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)));
    throw fail(404,'Not found');
  } catch(e) { json(res,e.status||500,{error:e.message, ...(e.details?{details:e.details}:{})}); } });
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
