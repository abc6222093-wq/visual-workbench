import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, readdirSync, existsSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, extname, basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFingerprint } from './runtime-identity.js';
import { openBrowser, revealFile } from './platform.js';
import { createUsageSession } from './session.js';
import { detectSyncConflicts } from './sync-conflicts.js';
import { loadConfig, stripDataDirArg, getLocalConfigPath, saveLocalConfig } from './config.js';
import { initDataDir, initProjectDir, listProjects, projectDir } from './data-dir.js';
import { validateProjectData, CONTENT_CODES, isLegacyProject } from './validate.js';
import { saveVersion, listVersions, restoreVersion } from './version.js';
import * as versionStore from './version.js'; // 删除版本（deleteVersion）由另一处提供，运行时再取，没有时给中文提示
import { copyPages, copyPagesInto, rollbackWritten, blankPageHtml, blankPageEntry, newPageId } from './copy-pages.js';
import { createProjectWatcher } from './watch.js';
import { readMasters, setMaster, createFromMaster, blankPage } from './master.js';
import { agentBrief } from './brief.js';
import { exportHandoff, defaultHandoffDir } from './export/changes.js';
import { WEB_DEVICES, WEB_DEFAULT_ARTBOARD, webPageDefaults, projectKind } from '../web/project-kinds.js';
import { newEditId } from '../web/edits-model.js';
import { cleanupTrash, listTrash, deleteProject, restoreProject, purgeProject, duplicateProject } from './project-management.js';
import { createImportJobs, IMPORT_MAX_BYTES } from './import-html/jobs.js';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const REPO = resolve(WEB, '..');
const CODE_FINGERPRINT = codeFingerprint(REPO);
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
const MIME = { '.html':'text/html', '.htm':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.txt':'text/plain', '.mp4':'video/mp4', '.webm':'video/webm', '.mp3':'audio/mpeg', '.avif':'image/avif', '.ico':'image/x-icon', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.svg':'image/svg+xml', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf' };
const PRESETS = { 'slide-16x9':[1920,1080], 'web-desktop':[1440,900], 'web-mobile':[390,844], 'poster-a4':[2480,3508], 'poster-a3':[3508,4961], custom:[1920,1080] };
const fail = (status, message, details) => Object.assign(new Error(message), { status, details });
const hash = b => createHash('sha256').update(b).digest('hex');
const json = (res, status, body) => { const data = JSON.stringify(body); res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(data), 'Cache-Control':'no-store' }); res.end(data); };
function safe(root, ...parts) { const p = resolve(root, ...parts); if (p !== root && !p.startsWith(root + sep)) throw fail(400, 'Invalid path'); if (existsSync(p) && p !== root && !realpathSync(p).startsWith(realpathSync(root) + sep)) throw fail(403, 'Symlink outside data directory'); return p; }
function readProject(dir) { const bytes = readFileSync(join(dir, 'project.json')); return { project:JSON.parse(bytes), revision:hash(bytes) }; }
function atomic(file, bytes) { const tmp = join(dirname(file), `.project-${randomUUID()}.tmp`); try { writeFileSync(tmp, bytes, { flag:'wx' }); renameSync(tmp, file); } finally { rmSync(tmp, { force:true }); } }
// 工作台保存只挡结构问题；页面内容类问题（修改单对不上、资源缺失等）由 agent 用 npm run validate 处理，不能因此让用户存不了
function saveProject(dir, project, selfWrite) { const check = validateProjectData(project, { projectDir:dir, structural:true }); if (!check.ok) throw fail(400, check.errors.some(e=>e.code==='LEGACY_FORMAT')?'旧格式，请先运行 npm run convert 转换':'Invalid project', check.errors); const bytes = Buffer.from(JSON.stringify(project, null, 2) + '\n'); selfWrite?.('project.json', bytes); atomic(join(dir, 'project.json'), bytes); return hash(bytes); }
async function body(req, limit=25_000_000, tooLarge='Request too large') { let size=0, chunks=[]; for await (const c of req) { size+=c.length; if(size>limit) throw fail(413,tooLarge); chunks.push(c); } try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400,'Invalid JSON'); } }
function checkRevision(value, current) { if (value !== current) throw fail(409, 'Project changed on disk', { revision:current }); }
function projectPath(dataDir,id) {
  if (!ID.test(id)) throw fail(400,'Invalid project id');
  const dir=safe(join(dataDir,'projects'),id);
  if(!existsSync(join(dir,'project.json'))) throw fail(404,'Project not found');
  noSymlinks(dir);
  return dir;
}
function libraryRoot(dataDir) { const root=join(dataDir,'library/assets'); noSymlinks(root); return root; }
// 静态内容都带 Access-Control-Allow-Origin: *：页面在无同源权限的 iframe 里（null 源），字体、模块脚本要 CORS 才能加载
function serve(res, root, rel, extra={}) { const file=safe(root,rel); if(!existsSync(file)||!statSync(file).isFile()) throw fail(404,'File not found'); const data=readFileSync(file); const svg=extname(file).toLowerCase()==='.svg'; res.writeHead(200,{'Content-Type':(MIME[extname(file).toLowerCase()]||'application/octet-stream')+'; charset=utf-8','Content-Length':data.length,'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*',...(svg?{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"}:{}),...extra}); res.end(data); }
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
const exportName = (project, id) => String(project?.name || id).replace(/[<>\"|?*\\/:\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 120) || id;
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
// 导出进度（docs/round12-contract.md 约定 2）：界面先连 SSE 再发 POST，也容忍反过来；导出结束 60 秒后清掉记录
const PROGRESS_ID = /^[A-Za-z0-9_-]{8,64}$/;
const PROGRESS_KEEP_MS = 60_000;
function createExportProgress() {
  const records = new Map();
  const key = (id, progressId) => `${id}\n${progressId}`;
  const get = (id, progressId) => {
    const k = key(id, progressId);
    if (!records.has(k)) {
      const record = { events: [], listeners: new Set(), done: null, running: false, controller: new AbortController(), timer: null };
      record.expire = () => { clearTimeout(record.timer); record.timer = setTimeout(() => { for (const res of record.listeners) res.end(); records.delete(k); }, PROGRESS_KEEP_MS); record.timer.unref?.(); };
      records.set(k, record);
      record.expire(); // 没人用的记录（只连了 SSE 或只发了取消）也会过期
    }
    return records.get(k);
  };
  const write = (res, event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  return {
    get,
    progress(record, info) {
      const data = { current: Number(info?.current) || 0, total: Number(info?.total) || 0, label: String(info?.label || '') };
      record.events.push(data);
      if (record.events.length > 500) record.events.splice(0, record.events.length - 500);
      for (const res of record.listeners) write(res, 'progress', data);
    },
    finish(record, data) {
      record.done = data; record.running = false;
      for (const res of record.listeners) { write(res, 'done', data); res.end(); }
      record.listeners.clear();
      record.expire();
    },
    subscribe(record, req, res, streams) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
      res.write(': export progress\n\n');
      for (const data of record.events) write(res, 'progress', data);
      if (record.done) { write(res, 'done', record.done); res.end(); return; }
      record.listeners.add(res); streams.add(res);
      const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 25000); ping.unref();
      req.on('close', () => { clearInterval(ping); record.listeners.delete(res); streams.delete(res); });
    },
    close() { for (const record of records.values()) { clearTimeout(record.timer); record.controller.abort(); } records.clear(); },
  };
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
const defaultReveal = revealFile;

// 页面脚本（sandbox iframe，Origin: null）只能读静态内容，不能发修改请求
const MUTATING = new Set(['PUT','POST','PATCH','DELETE']);
function nullOrigin(req) { return req.headers.origin === 'null'; }
function originAllowed(req,port) { const host=req.headers.host||''; if(!new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::${port})?$`).test(host)) return false; const origin=req.headers.origin; if(!origin) return true; try { const u=new URL(origin); return u.protocol==='http:' && u.host===host; } catch { return false; } }

// 可以通过 /data/projects/<id>/<目录>/… 读的目录（页面文件与它引用的资源）；project.json、versions/ 不在这里
const STATIC_DIRS = ['pages','assets','fonts','import','series'];
const asBadRequest = e => e.status ? e : fail(400, e.message);
const idList = (value, label='pageIds') => { if(!Array.isArray(value)||!value.length||value.some(v=>typeof v!=='string')||new Set(value).size!==value.length) throw fail(400,`${label} 要写成不重复的页面编号列表`); return value; };

/**
 * 页面整理（格式 v3）：POST /api/projects/:id/pages，body { revision, op, … } → { project, revision, pageIds }
 * op = create { name?, after?, device? } | duplicate { pageIds, after? } | delete { pageIds } | copy-from { fromProject, pageIds, after? }
 */
function pageOperation({ dataDir, dir, id, body:b, selfWrite }) {
  const old=readProject(dir); checkRevision(b.revision,old.revision);
  if(isLegacyProject(old.project)) throw fail(409,'旧格式，请先运行 npm run convert 转换');
  let project=structuredClone(old.project); let written=[], created=[], removedFiles=[];
  const has = pid => project.pages.some(p=>p.id===pid);
  const after = b.after ?? null; if(after!==null&&(typeof after!=='string'||!has(after))) throw fail(400,'找不到要插在后面的那一页');
  if(b.op==='create') {
    if(b.name!==undefined&&typeof b.name!=='string') throw fail(400,'页面名称不对');
    if(b.device!==undefined&&!WEB_DEVICES[b.device]) throw fail(400,'设备只能是 desktop 或 mobile');
    const pid=newPageId(new Set(project.pages.map(p=>p.id)));
    const page=blankPageEntry({id:pid,name:b.name?.trim()||`第 ${project.pages.length+1} 页`,project,device:b.device});
    const bytes=Buffer.from(blankPageHtml({title:page.name})); const file=join(dir,page.file);
    mkdirSync(dirname(file),{recursive:true}); selfWrite(page.file,bytes); writeFileSync(file,bytes,{flag:'wx'}); written.push(page.file);
    const index=after?project.pages.findIndex(p=>p.id===after)+1:project.pages.length; project.pages.splice(index,0,page); created=[pid];
  } else if(b.op==='duplicate') {
    const ids=idList(b.pageIds); if(ids.some(pid=>!has(pid))) throw fail(400,'找不到要复制的页面');
    const last=[...project.pages].reverse().find(p=>ids.includes(p.id)).id;
    let out; try { out=copyPagesInto({srcDir:dir,src:old.project,pageIds:ids,destDir:dir,dest:project,after:after??last,onWrite:selfWrite,rename:p=>`${p.name||p.id} 副本`}); } catch(e) { throw asBadRequest(e); }
    project=out.project; written=out.written; created=out.pageIds;
  } else if(b.op==='delete') {
    const ids=idList(b.pageIds); if(ids.some(pid=>!has(pid))) throw fail(400,'找不到要删除的页面');
    if(ids.length>=project.pages.length) throw fail(400,'至少要留一页');
    saveVersion({projectDir:dir,note:'删除页面前自动存版',by:'user'});
    removedFiles=project.pages.filter(p=>ids.includes(p.id)).map(p=>p.file).filter(f=>typeof f==='string'&&/^pages\/[^/\\]+\.html$/.test(f));
    project.pages=project.pages.filter(p=>!ids.includes(p.id));
  } else if(b.op==='copy-from') {
    if(typeof b.fromProject!=='string'||!ID.test(b.fromProject)) throw fail(400,'来源项目编号不对');
    if(b.fromProject===id) throw fail(400,'同一个项目里请用「复制页面」');
    const srcDir=projectPath(dataDir,b.fromProject); const src=readProject(srcDir).project;
    if(isLegacyProject(src)) throw fail(409,'来源项目是旧格式，请先在工作台里打开它（会自动转换）');
    const ids=idList(b.pageIds); if(ids.some(pid=>!src.pages.some(p=>p.id===pid))) throw fail(400,'来源项目里找不到这些页面');
    let out; try { out=copyPagesInto({srcDir,src,pageIds:ids,destDir:dir,dest:project,after,onWrite:selfWrite}); } catch(e) { throw asBadRequest(e); }
    project=out.project; written=out.written; created=out.pageIds;
  } else throw fail(400,'op 只能是 create、duplicate、delete 或 copy-from');
  project.updatedAt=new Date().toISOString();
  let revision; try { revision=saveProject(dir,project,selfWrite); } catch(e) { rollbackWritten(dir,written,selfWrite); throw e; }
  for(const rel of removedFiles) { if(project.pages.some(p=>p.file===rel)) continue; selfWrite(rel,null); rmSync(join(dir,rel),{force:true}); }
  return {project,revision,pageIds:created};
}

export function createServer({ dataDir, port=4173, agentIdleMs=15000, watchPollMs=1000, exporter=defaultExporter, reveal=defaultReveal, configSource="explicit", configHome, usageOptions={}, onShutdown, importOptions={} } = {}) {
  if(!dataDir) throw new Error('dataDir is required');
  dataDir=resolve(dataDir); checkDataRoots(dataDir); initDataDir(dataDir);
  const usage = createUsageSession({dataDir,...usageOptions});
  let trashCleaned=false;
  try {if(!usage.status().blocked){cleanupTrash(dataDir);trashCleaned=true;}}catch(e){usage.close();throw e;}
  // 实时连接：监听项目文件夹，文件被工作台以外的程序（agent）改动时推送给开着的界面
  const watcher = createProjectWatcher({ projectsDir:join(dataDir,'projects'), agentIdleMs, pollMs:watchPollMs });
  const streams = new Set();
  let shuttingDown=false;
  const assertUsage = () => {if(shuttingDown)throw fail(503,'工作台正在关闭');const status=usage.status();if(status.blocked)throw fail(423,'另一台电脑上的工作台还开着，请先确认是否继续',status);};
  const checkedBody = async req => {const value=await body(req);assertUsage();checkDataRoots(dataDir);return value;};
  const selfWrite = id => (rel, bytes) => watcher.noteSelfWrite(id, rel, bytes);
  // 旧 HTML 导入：后台任务，前端轮询进度
  const imports = createImportJobs({ dataDir, ...importOptions });
  const exportProgress = createExportProgress();
  // 旧格式项目第一次打开时转换（src/convert-v2.js 先自动存版再转换）；同一项目同时只转一次
  const converting = new Map();
  const convertLegacy = (dir, id) => {
    if (!converting.has(id)) converting.set(id, (async () => {
      let mod; try { mod = await import('./convert-v2.js'); } catch (e) { throw fail(409, `这个项目是旧格式，需要转换后才能打开，但转换功能没有准备好：${e.message}`); }
      try { await mod.convertV2Project({ projectDir: dir }); }
      catch (e) { throw fail(409, e.message || '旧格式项目转换失败，项目保持原样'); }
      finally { watcher.noteSelfSnapshot(id); }
    })().finally(() => converting.delete(id)));
    return converting.get(id);
  };
  const masterList = () => readMasters(dataDir).filter(id => ID.test(id) && existsSync(join(dataDir,'projects',id,'project.json')));
  const server = http.createServer(async(req,res)=>{ try {
    if(nullOrigin(req)&&MUTATING.has(req.method)) throw fail(403,'页面里的脚本不能修改工作台数据');
    const staticGet=req.method==='GET'&&nullOrigin(req)&&!req.url.startsWith('/api/');
    if(!staticGet&&!originAllowed(req,server.address()?.port || port)) throw fail(403,'Local origin required');
    if(staticGet&&!new RegExp(`^(localhost|127\\.0\\.0\\.1|\\[::1\\])(?::${server.address()?.port || port})?$`).test(req.headers.host||'')) throw fail(403,'Local origin required');
    checkDataRoots(dataDir);
    if(shuttingDown)throw fail(503,'工作台正在关闭');
    const url=new URL(req.url,'http://localhost'); const parts=url.pathname.split('/').filter(Boolean);
    if(req.method==='GET'&&url.pathname==='/api/health') return json(res,200,{app:'visual-workbench',protocol:1,repoDir:REPO,pid:process.pid,fingerprint:CODE_FINGERPRINT});
    if(req.method==='GET'&&url.pathname==='/api/session') return json(res,200,usage.status());
    if(req.method==='POST'&&url.pathname==='/api/session/confirm') {const b=await body(req);if(!Array.isArray(b.tokens)||!b.tokens.every(t=>typeof t==='string'))throw fail(400,'请先查看正在使用的电脑，再确认继续');const status=usage.confirm(b.tokens);if(!status.blocked&&!trashCleaned){cleanupTrash(dataDir);trashCleaned=true;}return json(res,200,status);}
    if(req.method==='GET'&&url.pathname==='/api/settings') return json(res,200,{dataDir,source:configSource,localConfigPath:getLocalConfigPath({home:configHome}),platform:process.platform,revealLabel:process.platform==='win32'?'在资源管理器中显示':process.platform==='darwin'?'在访达中显示':'在文件管理器中显示'});
    if((url.pathname.startsWith('/api/')||url.pathname.startsWith('/data/'))&&usage.status().blocked) throw fail(423,'另一台电脑上的工作台还开着，请先确认是否继续',usage.status());
    if(req.method==='POST'&&url.pathname==='/api/shutdown') { await checkedBody(req); shuttingDown=true; res.once('finish',()=>{const timer=setTimeout(()=>server.closeAllConnections?.(),3000);timer.unref();server.close(()=>{clearTimeout(timer);onShutdown?.();});}); json(res,200,{closed:true}); return; }
    if(req.method==='GET'&&url.pathname==='/api/trash') return json(res,200,listTrash(dataDir));
    if(parts[0]==='api'&&parts[1]==='import-html'&&parts[2]==='jobs') { // 旧 HTML 导入：建任务 / 查进度 / 取消
      if(parts.length===3&&req.method==='POST') {const b=await body(req,Math.ceil(IMPORT_MAX_BYTES*4/3)+1_000_000,'文件太大（合计超过 380 MB），请去掉不需要的素材后再导入');assertUsage();checkDataRoots(dataDir);return json(res,201,imports.create(b));}
      if(parts.length===4&&req.method==='GET') return json(res,200,imports.get(parts[3]));
      if(parts.length===5&&parts[4]==='cancel'&&req.method==='POST') {assertUsage();return json(res,200,imports.cancel(parts[3]));}
    }
    if(parts[0]==='api'&&parts[1]==='trash'&&parts[2]) {
      if(parts.length===4&&parts[3]==='restore'&&req.method==='POST') {await checkedBody(req);const out=restoreProject(dataDir,parts[2]);return json(res,200,{...out,revision:readProject(projectPath(dataDir,out.project.id)).revision});}
      if(parts.length===3&&req.method==='DELETE') {await checkedBody(req);return json(res,200,purgeProject(dataDir,parts[2]));}
    }
    if(req.method==='PUT'&&url.pathname==='/api/settings') {const b=await checkedBody(req);try {saveLocalConfig(b.dataDir,{home:configHome});}catch(e){throw fail(400,e.message);}return json(res,200,{saved:true,dataDir,source:configSource,pendingDataDir:b.dataDir,message:'本机设置已保存。关闭工作台后重新双击启动生效；命令行和环境变量仍优先于本机设置。'});}
    if(req.method==='GET'&&url.pathname==='/api/projects') { const masters=new Set(masterList()); return json(res,200,listProjects(dataDir).map(id=>{ const project=readProject(projectPath(dataDir,id)).project; return {id,name:project.name,updatedAt:project.updatedAt,master:masters.has(id),...(isLegacyProject(project)?{legacy:true}:{}),project}; })); }
    if(req.method==='POST'&&url.pathname==='/api/projects') { const b=await checkedBody(req); if(typeof b.name!=='string'||!b.name.trim()) throw fail(400,'Name required'); const id=String(b.id||`project-${randomUUID().slice(0,8)}`); if(!ID.test(id)) throw fail(400,'Invalid project id'); const dir=safe(join(dataDir,'projects'),id); if(existsSync(dir)) throw fail(409,'Project already exists');
      if(b.fromMaster!==undefined) { // 从系列母版开始：继承画板、背景、字体、配色、动效代码和通用素材，不带页面内容
        if(!masterList().includes(b.fromMaster)) throw fail(400,'这个项目不是系列母版');
        let out; try { out=createFromMaster({masterDir:projectPath(dataDir,b.fromMaster),destProjectDir:dir,newId:id,newName:b.name.trim()}); } catch(e) { throw e.status?e:fail(400,e.message); }
        return json(res,201,{project:out.project,revision:readProject(dir).revision,fromMaster:b.fromMaster});
      }
      // 格式 v3：课件项目一页空白页；网页项目两页（电脑端 / 手机端）。页面文件放 pages/<页面编号>.html
      const web=b.kind==='web'; let artboard;
      if(web) artboard={...WEB_DEFAULT_ARTBOARD};
      else { const preset=b.preset||'slide-16x9'; if(!PRESETS[preset]) throw fail(400,'Invalid preset'); const [dw,dh]=PRESETS[preset], width=b.width??dw,height=b.height??dh; dims({width,height}); artboard={preset,width,height}; }
      mkdirSync(dir); try { initProjectDir(dir); const now=new Date().toISOString();
        const shell={format:'visual-workbench/project',formatVersion:3,id,name:b.name.trim(),...(web?{kind:'web'}:{}),createdAt:now,updatedAt:now,artboard,assets:[],fonts:[],pages:[]};
        const pages=web?[{...blankPageEntry({id:'page_home_desk',name:'首页 · 电脑端',project:shell,device:'desktop'})},{...blankPageEntry({id:'page_home_mob',name:'首页 · 手机端',project:shell,device:'mobile'})}]:[blankPage()];
        for(const page of pages) writeFileSync(join(dir,page.file),blankPageHtml({title:page.name}));
        const project={...shell,pages}; const revision=saveProject(dir,project); return json(res,201,{project,revision}); } catch(e){rmSync(dir,{recursive:true,force:true});throw e;} }
    if(parts[0]==='api'&&parts[1]==='projects'&&parts[2]) { const id=parts[2],dir=projectPath(dataDir,id);
      if(parts.length===3&&req.method==='DELETE') {
        // A normalized /versions/.. request has no body and must keep the old 404.
        // UI project deletion always sends an explicit JSON confirmation request.
        if(!req.headers['transfer-encoding'] && !(Number(req.headers['content-length'])>0))throw fail(404,'未找到删除请求，请从项目菜单确认删除');
        await checkedBody(req);return json(res,200,deleteProject(dataDir,id));
      }
      if(parts.length===3&&req.method==='PATCH') {const b=await checkedBody(req);if(typeof b.name!=='string'||!b.name.trim())throw fail(400,'请输入项目名称');const old=readProject(projectPath(dataDir,id));if(b.revision!==undefined)checkRevision(b.revision,old.revision);const project={...old.project,name:b.name.trim(),updatedAt:new Date().toISOString()};const revision=saveProject(dir,project,selfWrite(id));return json(res,200,{project,revision});}
      if(parts.length===4&&parts[3]==='duplicate'&&req.method==='POST') {const b=await checkedBody(req);const out=duplicateProject(dataDir,id,b);return json(res,201,{...out,revision:readProject(projectPath(dataDir,out.project.id)).revision});}
      if(parts.length===3&&req.method==='GET') { // 旧格式（v2）第一次打开时先转换（转换前自动存版）；失败则项目原样不动
        let current=readProject(dir);
        if(isLegacyProject(current.project)) { assertUsage(); await convertLegacy(dir,id); current=readProject(dir); }
        return json(res,200,{...current,syncConflicts:detectSyncConflicts(dir)}); }
      if(parts.length===3&&req.method==='PUT') { const b=await checkedBody(req),old=readProject(dir); checkRevision(b.revision,old.revision); if(!b.project||b.project.id!==id||b.project.createdAt!==old.project.createdAt) throw fail(400,'Invalid project identity'); const project={...b.project,updatedAt:new Date().toISOString()}; const revision=saveProject(dir,project,selfWrite(id)); return json(res,200,{project,revision}); }
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
      if(parts[3]==='brief'&&parts.length===4&&req.method==='GET') { // 复制给 agent：?pageIds=a,b 只写这些页（当前页），不给 = 全部页
        const {project}=readProject(dir); const ids=url.searchParams.get('pageIds')?.split(',').filter(Boolean);
        if(ids&&ids.some(pid=>!project.pages?.some(p=>p.id===pid))) throw fail(400,'页面编号不对');
        return json(res,200,{text:agentBrief({repoDir:REPO,dataDir,projectDir:dir,project,pageIds:ids}),filePath:join(dir,'project.json')}); }
      if(parts[3]==='pages'&&parts.length===4&&req.method==='POST') { const b=await checkedBody(req); return json(res,200,pageOperation({dataDir,dir,id,body:b,selfWrite:selfWrite(id)})); }
      // 第 11 轮：交接包（改动清单 + 改前改后对比图 + 复制给 agent 的文字）；改前基准是 import/baseline.json
      if(parts[3]==='handoff'&&parts.length===4&&req.method==='POST') {
        const b=await checkedBody(req); const outDir=defaultHandoffDir(dataDir,id);
        try { return json(res,200,await exportHandoff({projectDir:dir,outDir,images:b.images!==false})); }
        catch(e) { if(e.code==='NO_BASELINE') throw fail(409,e.message); throw fail(500,`交接包生成失败：${e.message}`); }
      }
      if(parts[3]==='master'&&parts.length===4&&req.method==='PUT') { const b=await checkedBody(req); if(typeof b.master!=='boolean') throw fail(400,'Invalid master flag'); setMaster(dataDir,id,b.master); return json(res,200,{id,master:b.master}); }
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
      if(parts[3]==='export'&&parts.length===4&&req.method==='POST') { // 导出：放映版 HTML / 每页图片 / PDF；带 progressId 时可看进度、可取消
        const b=await checkedBody(req); if(!EXPORT_KINDS.includes(b.kind)) throw fail(400,'导出类型只能是 html（放映版）、images（每页图片）或 pdf');
        if(b.progressId!==undefined&&(typeof b.progressId!=='string'||!PROGRESS_ID.test(b.progressId))) throw fail(400,'导出进度编号不对');
        const record=b.progressId?exportProgress.get(id,b.progressId):null;
        if(record&&(record.running||record.done)) throw fail(409,'这个导出进度编号已经用过了');
        const outDir=exportDir(dataDir,id,b.kind); let out;
        const options={projectDir:dir,kind:b.kind,outDir,name:exportName(readProject(dir).project,id)};
        if(record) { record.running=true; clearTimeout(record.timer); Object.assign(options,{onProgress:info=>exportProgress.progress(record,info),signal:record.controller.signal}); }
        const cancelled=()=>{ rmSync(outDir,{recursive:true,force:true}); exportProgress.finish(record,{ok:false,error:'已取消导出',cancelled:true}); return json(res,409,{error:'已取消导出',cancelled:true}); };
        try { if(record?.controller.signal.aborted) return cancelled(); out=await exporter(options); }
        catch(e) {
          if(record&&(e?.cancelled||record.controller.signal.aborted)) return cancelled();
          rmSync(outDir,{recursive:true,force:true}); const error=fail(e.status||500,`导出失败：${e.message}`);
          if(record) exportProgress.finish(record,{ok:false,error:error.message,cancelled:false});
          throw error;
        }
        if(record?.controller.signal.aborted) return cancelled(); // 导出器没理会取消、照样做完了：按用户的意思当作取消
        const finalDir=resolve(out?.outDir||outDir);
        const files=(out?.files||[]).map(f=>{ const path=resolve(finalDir,String(f.path)); return {path,bytes:Number(f.bytes)||0,name:path.startsWith(finalDir+sep)?path.slice(finalDir.length+1):basename(path)}; });
        if(record) exportProgress.finish(record,{ok:true});
        return json(res,201,{kind:b.kind,outDir:finalDir,files});
      }
      if(parts[3]==='export'&&parts[4]==='progress'&&parts.length===6&&req.method==='GET') { // 导出进度（Server-Sent Events：progress / done）
        if(!PROGRESS_ID.test(parts[5])) throw fail(400,'导出进度编号不对');
        exportProgress.subscribe(exportProgress.get(id,parts[5]),req,res,streams); return;
      }
      if(parts[3]==='export'&&parts[4]==='cancel'&&parts.length===6&&req.method==='POST') { // 取消导出（可以早于 POST export 到达）
        if(!PROGRESS_ID.test(parts[5])) throw fail(400,'导出进度编号不对');
        for await (const chunk of req) void chunk; assertUsage();
        const record=exportProgress.get(id,parts[5]);
        if(record.done) return json(res,200,{cancelled:false,done:record.done});
        record.controller.abort(); return json(res,200,{cancelled:true});
      }
      if(parts[3]==='versions'&&parts.length===4&&req.method==='GET') return json(res,200,listVersions(dir).map(p=>({id:basename(p),...JSON.parse(readFileSync(join(p,'meta.json'),'utf8'))})).reverse());
      if(parts[3]==='versions'&&parts.length===4&&req.method==='POST') { const b=await checkedBody(req); if(b.note!==undefined&&typeof b.note!=='string') throw fail(400,'Invalid note'); const v=saveVersion({projectDir:dir,note:b.note||'',by:'user'}); return json(res,201,{id:basename(v.versionDir),...v.meta}); }
      if(parts[3]==='copy'&&parts.length===4&&req.method==='POST') { const b=await checkedBody(req); if(!ID.test(b.id||'')) throw fail(400,'Invalid project id'); const dest=safe(join(dataDir,'projects'),b.id); const out=copyPages({srcProjectDir:dir,pages:b.pages,destProjectDir:dest,newId:b.id,newName:b.name}); return json(res,201,{project:out.project,revision:readProject(dest).revision}); }
      if(parts[3]==='assets'&&parts.length===4&&req.method==='POST') { const b=await checkedBody(req),old=readProject(dir); if(b.revision!==undefined) checkRevision(b.revision,old.revision); let filename,name,data,source,width=b.width,height=b.height;
        if(b.libraryFile!==undefined) { if(!validFile(b.libraryFile)) throw fail(400,'Invalid library file'); const library=libraryRoot(dataDir); const from=safe(library,b.libraryFile); if(!existsSync(from)) throw fail(404,'Library file not found'); data=readFileSync(from); const metaPath=safe(library,`${b.libraryFile}.json`); const meta=existsSync(metaPath)?JSON.parse(readFileSync(metaPath,'utf8')):{}; const inferred=imageSize(data,MIME[extname(from).toLowerCase()]); width=width??meta.width??inferred.width; height=height??meta.height??inferred.height; filename=`${randomUUID()}${extname(from)}`; name=b.name||meta.name||b.libraryFile; source={type:'library',from:b.libraryFile}; }
        else { const u=upload(b); ({filename,name,data}=u); source={type:'upload'}; if(width===undefined&&height===undefined&&u.width&&u.height) ({width,height}=u); }
        if(width!==undefined||height!==undefined) dims({width,height}); const asset={id:`asset_${randomUUID().replaceAll('-','').slice(0,16)}`,kind:'image',file:`assets/${filename}`,name,...(width&&height?{width,height}:{}),addedAt:new Date().toISOString(),source}; const file=safe(join(dir,'assets'),filename); watcher.noteSelfWrite(id,`assets/${filename}`,data); writeFileSync(file,data,{flag:'wx'}); try { const project={...old.project,updatedAt:new Date().toISOString(),assets:[...old.project.assets,asset]}; const revision=saveProject(dir,project,selfWrite(id)); return json(res,201,{asset,project,revision}); } catch(e){rmSync(file,{force:true});throw e;} }
    }
    if(url.pathname==='/api/reveal'&&req.method==='POST') { const b=await checkedBody(req); const target=revealPath(dataDir,b.path); await reveal(target); return json(res,200,{ok:true,path:target}); }
    if(url.pathname==='/api/library'&&req.method==='GET') { const root=libraryRoot(dataDir); return json(res,200,readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&validFile(e.name)&&MIME[extname(e.name).toLowerCase()]?.startsWith('image/')).map(e=>{ const data=readFileSync(safe(root,e.name)); const inferred=imageSize(data,MIME[extname(e.name).toLowerCase()]); const metaFile=safe(root,`${e.name}.json`); const meta=existsSync(metaFile)?JSON.parse(readFileSync(metaFile,'utf8')):{}; return {name:meta.name||e.name,file:e.name,url:`/data/library/assets/${encodeURIComponent(e.name)}`,width:meta.width??inferred.width??null,height:meta.height??inferred.height??null,mime:meta.mime||MIME[extname(e.name).toLowerCase()]}; })); }
    if(url.pathname==='/api/library'&&req.method==='POST') { const b=await checkedBody(req); const u=upload(b),root=libraryRoot(dataDir); const width=b.width??u.width,height=b.height??u.height; dims({width,height}); writeFileSync(safe(root,u.filename),u.data,{flag:'wx'}); writeFileSync(safe(root,`${u.filename}.json`),JSON.stringify({name:u.name,width,height,mime:u.mime})); return json(res,201,{name:u.name,file:u.filename,url:`/data/library/assets/${u.filename}`,width,height,mime:u.mime}); }
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='projects'&&parts.length>=5&&STATIC_DIRS.includes(parts[3])) { // 页面文件与资源；页面直接打开时用 CSP sandbox 隔离，不能当工作台同源脚本跑
      const rel=parts.slice(4).map(decodeFile).join('/'); const html=/\.html?$/i.test(rel);
      return serve(res,join(projectPath(dataDir,parts[2]),parts[3]),rel,{'Cache-Control':'no-cache',...(html?{'Content-Security-Policy':'sandbox allow-scripts'}:{})}); }
    if(req.method==='GET'&&parts[0]==='data'&&parts[1]==='library'&&parts[2]==='assets'&&parts.length===4 ) return serve(res,libraryRoot(dataDir),decodeFile(parts[3]));
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/data/')) return serve(res,WEB,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),{'Cache-Control':'no-cache'}); // 界面代码更新后，浏览器不能继续用旧的
    throw fail(404,'Not found');
  } catch(e) { if(res.headersSent) return res.end(); json(res,e.status||500,{error:e.message, ...(e.details?{details:e.details}:{})}); } });
  const close=server.close.bind(server);
  server.close=callback=>{ usage.close(); watcher.close(); imports.close(); exportProgress.close(); for(const stream of streams) stream.end(); streams.clear(); server.closeIdleConnections?.(); return close(callback); };
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
    const { dataDir, source } = loadConfig();
    const server = createServer({ dataDir, port, configSource:source, onShutdown:()=>process.exit(0) });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请用 --port 指定其他端口。` : `工作台启动失败：${error.message}`);
      server.close();
      process.exitCode = 1;
    });
    for(const signal of ['SIGINT','SIGTERM','SIGHUP']) process.once(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();});
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`;
      console.log(`视觉工作台：${url}`);
      console.log(`数据目录：${dataDir}`);
      console.log('按 Control + C 停止工作台。');
      if (!noOpen && process.env.VW_OPEN_BROWSER !== '0') openBrowser(url).catch(()=>console.warn(`浏览器未能自动打开，请手动访问 ${url}`));
    });
  } catch (error) {
    console.error(`工作台启动失败：${error.message}`);
    process.exitCode = 1;
  }
}
