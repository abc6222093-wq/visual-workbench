// 项目文件夹监听：agent 在工作台外改了项目文件后通知界面，并推算「agent 正在改 / 空闲」状态。
//
// 用法：
//   const watcher = createProjectWatcher({ projectsDir });
//   const off = watcher.subscribe('demo', event => { ... });
//   watcher.noteSelfWrite('demo', 'project.json', bytes); // 服务器自己通过接口写文件时调用
//   watcher.noteSelfSnapshot('demo');                      // 服务器一次写很多文件（如版本退回）后调用
//   watcher.agentState('demo');                            // 'working' | 'idle'
//   await watcher.scanNow('demo');                         // 测试/调试用：跳过去抖立即比较一次
//   watcher.close();
//
// 事件：
//   { type: 'changed', projectId, files: [...], external, at }
//   { type: 'agent', projectId, state: 'working' | 'idle', at }
//
// 实现要点：
//   - fs.watch(projectsDir, { recursive: true }) 是主要手段；每 pollMs 再对有订阅者的项目做一次
//     轮询扫描（比较 mtimeMs + size）兜底。两条路径都只是把文件标记为「待检查」，然后统一走
//     「去抖 → 算哈希和上次比较 → 发事件」，所以不会重复发。
//   - 是否真的变了按内容（sha256）判断；删除记为 null。
//   - 第一次订阅某项目时同步扫描一遍建立基线哈希；最后一个订阅者取消后丢弃该项目的状态。

import { watch, readdirSync, lstatSync, readFileSync, createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
// 「自己写的」记录的有效期：超过这么久还没被监听看到就作废，避免陈旧记录把以后 agent 的修改误判成自己写的
const SELF_TTL_MS = 60_000;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();

/** 相对项目文件夹的路径（用 /）是否应被忽略 */
function ignoredPath(rel) {
  const parts = rel.split('/');
  if (parts[0] === 'versions') return true;
  if (parts.some(s => s === '' || s.startsWith('.'))) return true;
  const last = parts[parts.length - 1];
  return last.endsWith('~') || last.endsWith('.tmp') || last.endsWith('.swp');
}

/** 目录是否应整个跳过（depth 为 0 表示项目文件夹下的第一层） */
const ignoredDir = (name, depth) => name.startsWith('.') || (depth === 0 && name === 'versions');

/** 同步遍历项目文件夹，返回 Map<相对路径, { mtimeMs, size }>；只收普通文件，跳过符号链接和被忽略的路径 */
function walk(root) {
  const out = new Map();
  const visit = (dir, prefix, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!ignoredDir(ent.name, depth)) visit(abs, rel, depth + 1);
      } else if (ent.isFile() && !ignoredPath(rel)) {
        try {
          const st = lstatSync(abs);
          if (st.isFile()) out.set(rel, { mtimeMs: st.mtimeMs, size: st.size });
        } catch { /* 遍历途中被删了，忽略 */ }
      }
    }
  };
  visit(root, '', 0);
  return out;
}

/** 同步算文件哈希；读不到返回 undefined */
function hashFileSync(abs) {
  try { return sha256(readFileSync(abs)); } catch { return undefined; }
}

/**
 * 异步检查一个文件当前的状态。
 * 返回 { kind: 'file', hash, mtimeMs, size } | { kind: 'missing' } | { kind: 'other' }（目录等）| null（读出错，下次再说）
 */
async function inspect(abs) {
  let st;
  try { st = await lstat(abs); } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? { kind: 'missing' } : null;
  }
  if (!st.isFile()) return { kind: 'other' };
  try {
    const h = createHash('sha256');
    for await (const chunk of createReadStream(abs)) h.update(chunk);
    return { kind: 'file', hash: h.digest('hex'), mtimeMs: st.mtimeMs, size: st.size };
  } catch (e) {
    return e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') ? { kind: 'missing' } : null;
  }
}

function normalizeRel(relPath) {
  if (typeof relPath !== 'string') throw new TypeError('文件路径必须是字符串');
  const rel = relPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  const parts = rel.split('/');
  if (!rel || parts.some(s => s === '' || s === '.' || s === '..')) throw new Error(`文件路径不合法：${relPath}`);
  return rel;
}

function checkId(projectId) {
  if (typeof projectId !== 'string' || !ID.test(projectId)) throw new Error(`项目编号不合法：${projectId}`);
}

/**
 * 创建项目文件夹监听器。
 * @param {object} options
 * @param {string} options.projectsDir 存放所有项目文件夹的目录
 * @param {number} [options.debounceMs=120] 同一项目多次变化合并成一个事件的去抖时间
 * @param {number} [options.agentIdleMs=15000] 多久没有外部修改就认为 agent 空闲
 * @param {number} [options.pollMs=1000] 轮询兜底的间隔；0 表示关闭轮询
 * @param {boolean} [options.fsWatch=true] 是否使用 fs.watch（测试/调试用：设为 false 可只靠轮询）
 */
export function createProjectWatcher({ projectsDir, debounceMs = 120, agentIdleMs = 15000, pollMs = 1000, fsWatch = true } = {}) {
  if (typeof projectsDir !== 'string' || !projectsDir) throw new TypeError('必须提供 projectsDir');
  // 持续有变化时最多等这么久也要发一次，避免一直去抖下去
  const maxWaitMs = Math.max(debounceMs * 8, 1000);

  /** @type {Map<string, any>} 有订阅者的项目的状态 */
  const projects = new Map();
  /** @type {Map<string, Map<string, { hash: string|null, at: number }>>} 「自己写的」记录，未订阅的项目也记 */
  const selfRecords = new Map();
  let watcher = null;
  let closed = false;
  let pollTimer = null;

  const alive = p => !closed && projects.get(p.id) === p;

  function emit(p, event) {
    for (const fn of [...p.listeners]) {
      try { fn(event); } catch { /* 订阅者自己的错误不影响监听 */ }
    }
  }

  function setSelf(projectId, rel, hash) {
    let recs = selfRecords.get(projectId);
    if (!recs) selfRecords.set(projectId, recs = new Map());
    recs.set(rel, { hash, at: Date.now() });
  }

  /** 这次变化是否是自己写的；匹配上就消耗掉记录 */
  function consumeSelf(projectId, rel, hash) {
    const recs = selfRecords.get(projectId);
    const rec = recs && recs.get(rel);
    if (!rec) return false;
    if (Date.now() - rec.at > SELF_TTL_MS) { recs.delete(rel); return false; }
    if (rec.hash !== hash) return false; // 可能是读到写了一半的内容，先留着记录
    recs.delete(rel);
    if (!recs.size) selfRecords.delete(projectId);
    return true;
  }

  function createProject(projectId) {
    const p = {
      id: projectId,
      dir: join(projectsDir, projectId),
      listeners: new Set(),
      hashes: new Map(), // 相对路径 -> sha256（不存在的文件不在表里）
      stats: new Map(), // 相对路径 -> { mtimeMs, size }
      dirty: new Set(),
      firstDirtyAt: 0,
      debounce: null,
      flushing: null,
      again: false,
      agent: 'idle',
      agentTimer: null,
    };
    // 建立基线
    for (const [rel, st] of walk(p.dir)) {
      const h = hashFileSync(join(p.dir, ...rel.split('/')));
      if (h === undefined) continue;
      p.hashes.set(rel, h);
      p.stats.set(rel, st);
    }
    return p;
  }

  function dropProject(p) {
    clearTimeout(p.debounce);
    clearTimeout(p.agentTimer);
    p.debounce = p.agentTimer = null;
    if (projects.get(p.id) === p) projects.delete(p.id);
  }

  /** 按 mtimeMs + size 找出可能变了的文件（含新增、删除） */
  function statScan(p) {
    const cur = walk(p.dir);
    const out = [];
    for (const [rel, st] of cur) {
      const prev = p.stats.get(rel);
      if (!prev || prev.mtimeMs !== st.mtimeMs || prev.size !== st.size) out.push(rel);
    }
    for (const rel of p.hashes.keys()) if (!cur.has(rel)) out.push(rel);
    return out;
  }

  /** 标记待检查（rel 为 null 表示只是「该项目有动静」）并安排去抖 */
  function markDirty(p, rel) {
    if (!alive(p)) return;
    // 已经在等待检查的同一文件再来一次（例如轮询间隔比去抖短）不重新计时，免得一直被推迟
    if (rel && p.dirty.has(rel) && p.debounce) return;
    if (rel) p.dirty.add(rel);
    const t = Date.now();
    if (!p.firstDirtyAt) p.firstDirtyAt = t;
    clearTimeout(p.debounce);
    const delay = Math.max(0, Math.min(debounceMs, p.firstDirtyAt + maxWaitMs - t));
    p.debounce = setTimeout(() => { p.debounce = null; flush(p); }, delay);
    p.debounce.unref();
  }

  function flush(p) {
    if (p.flushing) { p.again = true; return p.flushing; }
    p.flushing = (async () => {
      do {
        p.again = false;
        try { await runFlush(p); } catch { /* 不让监听回调抛出未捕获异常 */ }
      } while (p.again && alive(p));
    })().finally(() => { p.flushing = null; });
    return p.flushing;
  }

  /** 比较哈希 → 发事件。fs.watch 与轮询两条路径最终都走这里 */
  async function runFlush(p) {
    const candidates = new Set(p.dirty);
    p.dirty.clear();
    p.firstDirtyAt = 0;
    // 顺带把整个项目按 mtime/size 扫一遍，让同一批里 fs.watch 晚到或漏掉的文件也合并进这次事件
    for (const rel of statScan(p)) candidates.add(rel);
    const files = [];
    let external = false;
    for (const rel of [...candidates].sort()) {
      if (!alive(p)) return;
      const info = await inspect(join(p.dir, ...rel.split('/')));
      if (!alive(p)) return;
      if (!info) continue;
      let hash;
      if (info.kind === 'file') hash = info.hash;
      else if (info.kind === 'missing' || p.hashes.has(rel)) hash = null; // 删除，或文件变成了目录
      else continue; // 目录本身的事件
      const prev = p.hashes.get(rel) ?? null;
      if (hash === null) { p.hashes.delete(rel); p.stats.delete(rel); }
      else { p.hashes.set(rel, hash); p.stats.set(rel, { mtimeMs: info.mtimeMs, size: info.size }); }
      if (hash === prev) continue;
      files.push(rel);
      if (!consumeSelf(p.id, rel, hash)) external = true;
    }
    if (!files.length || !alive(p)) return;
    emit(p, { type: 'changed', projectId: p.id, files, external, at: now() });
    if (external && alive(p)) noteExternal(p);
  }

  function noteExternal(p) {
    clearTimeout(p.agentTimer);
    p.agentTimer = setTimeout(() => {
      p.agentTimer = null;
      if (!alive(p) || p.agent === 'idle') return;
      p.agent = 'idle';
      emit(p, { type: 'agent', projectId: p.id, state: 'idle', at: now() });
    }, agentIdleMs);
    p.agentTimer.unref();
    if (p.agent === 'idle') {
      p.agent = 'working';
      emit(p, { type: 'agent', projectId: p.id, state: 'working', at: now() });
    }
  }

  function onFsEvent(_type, filename) {
    try {
      if (closed) return;
      if (filename == null) { for (const p of projects.values()) markDirty(p, null); return; }
      const parts = String(filename).split(/[\\/]+/).filter(Boolean);
      const p = projects.get(parts[0]);
      if (!p) return;
      const rel = parts.slice(1).join('/');
      if (rel && ignoredPath(rel)) return;
      markDirty(p, rel || null);
    } catch { /* 忽略 */ }
  }

  function startWatcher() {
    if (!fsWatch || watcher || closed) return;
    try {
      const w = watch(projectsDir, { recursive: true }, onFsEvent);
      w.on('error', () => {
        try { w.close(); } catch { /* 忽略 */ }
        if (watcher === w) watcher = null; // 下次轮询或订阅时再试
      });
      if (typeof w.unref === 'function') w.unref();
      watcher = w;
    } catch {
      watcher = null; // 目录不存在等：只靠轮询
    }
  }

  function poll() {
    if (closed) return;
    startWatcher();
    for (const p of projects.values()) {
      if (!p.listeners.size) continue;
      try { for (const rel of statScan(p)) markDirty(p, rel); } catch { /* 忽略 */ }
    }
  }

  if (pollMs > 0) {
    pollTimer = setInterval(poll, pollMs);
    pollTimer.unref();
  }

  return {
    /** 订阅某项目的事件，返回取消订阅函数 */
    subscribe(projectId, listener) {
      checkId(projectId);
      if (typeof listener !== 'function') throw new TypeError('listener 必须是函数');
      if (closed) throw new Error('监听器已关闭');
      let p = projects.get(projectId);
      if (!p) projects.set(projectId, p = createProject(projectId));
      p.listeners.add(listener);
      startWatcher();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        p.listeners.delete(listener);
        if (!p.listeners.size) dropProject(p);
      };
    },

    /** 服务器通过接口写了（或删了，bytes 为 null）某个文件；写之前或之后调用都可以 */
    noteSelfWrite(projectId, relPath, bytes) {
      checkId(projectId);
      const rel = normalizeRel(relPath);
      if (bytes !== null && typeof bytes !== 'string' && !(bytes instanceof Uint8Array)) {
        throw new TypeError('bytes 必须是 Buffer、字符串或 null');
      }
      if (closed) return;
      const hash = bytes === null ? null : sha256(bytes);
      const p = projects.get(projectId);
      // 内容和当前基线一样：监听不会看到变化，不记，免得留下陈旧记录
      if (p && (p.hashes.get(rel) ?? null) === hash && !p.dirty.has(rel)) return;
      setSelf(projectId, rel, hash);
    },

    /** 把该项目当前所有被监听文件的状态都记为「自己写的」 */
    noteSelfSnapshot(projectId) {
      checkId(projectId);
      if (closed) return;
      const p = projects.get(projectId);
      if (!p) return; // 没人订阅：以后第一次订阅时会重新建立基线
      const cur = walk(p.dir);
      for (const [rel, st] of cur) {
        const prev = p.stats.get(rel);
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size && !p.dirty.has(rel)) continue;
        const h = hashFileSync(join(p.dir, ...rel.split('/')));
        if (h === undefined) continue;
        if (h !== (p.hashes.get(rel) ?? null)) setSelf(projectId, rel, h);
      }
      for (const rel of p.hashes.keys()) if (!cur.has(rel)) setSelf(projectId, rel, null);
    },

    /** 当前 agent 状态 */
    agentState(projectId) {
      const p = projects.get(projectId);
      return p && !closed ? p.agent : 'idle';
    },

    /** 测试/调试用：跳过去抖，立即对该项目做一次「扫描 → 比较 → 发事件」，返回 Promise */
    scanNow(projectId) {
      const p = projects.get(projectId);
      if (!p || closed) return Promise.resolve();
      clearTimeout(p.debounce);
      p.debounce = null;
      return flush(p);
    },

    /** 停掉监听器和所有定时器；可重复调用 */
    close() {
      if (closed) return;
      closed = true;
      clearInterval(pollTimer);
      pollTimer = null;
      if (watcher) { try { watcher.close(); } catch { /* 忽略 */ } watcher = null; }
      for (const p of [...projects.values()]) dropProject(p);
      projects.clear();
      selfRecords.clear();
    },
  };
}
