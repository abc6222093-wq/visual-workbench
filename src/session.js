import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostname as systemHostname } from 'node:os';
import { randomUUID } from 'node:crypto';

// A local advisory marker, not a distributed lock: offline or delayed Drive
// synchronization can hide concurrent users. Recheck before every mutation.
export function createUsageSession({ dataDir, hostname = systemHostname(), now = Date.now, heartbeatMs = 15000, staleMs = 90000 }) {
  const dir = join(dataDir, '.workbench-sessions');
  mkdirSync(dir, { recursive: true });
  const sessionId = randomUUID();
  const ownPath = join(dir, `${sessionId}.json`);
  const startedAt = new Date(now()).toISOString();
  const acknowledged = new Set();
  let started = false, closed = false, timer, heartbeatError;
  function scan() {
    const fresh = [], stale = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json') || name === `${sessionId}.json`) continue;
      try {
        const marker = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        const updated = Date.parse(marker.updatedAt);
        if (typeof marker.sessionId !== 'string' || typeof marker.computer !== 'string' || !Number.isFinite(updated) || !Number.isFinite(Date.parse(marker.startedAt))) continue;
        const entry = { token: `${name}:${marker.sessionId}:${marker.startedAt}`, computer: marker.computer, startedAt: marker.startedAt, updatedAt: marker.updatedAt };
        (now() - updated <= staleMs ? fresh : stale).push(entry);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
    }
    return { fresh, stale };
  }
  function heartbeat() {
    if (!started || closed) return;
    const temporary = ownPath + '.tmp';
    writeFileSync(temporary, JSON.stringify({ sessionId, computer: hostname, startedAt, updatedAt: new Date(now()).toISOString() }) + '\n');
    renameSync(temporary, ownPath);
    heartbeatError = null;
  }
  function start() {
    if (started || closed) return;
    started = true;
    heartbeat();
    timer = setInterval(() => {
      try { heartbeat(); } catch (error) { heartbeatError = error; }
    }, heartbeatMs);
    timer.unref();
  }
  function ownMarkerValid() {try{return JSON.parse(readFileSync(ownPath,'utf8')).sessionId===sessionId;}catch{return false;}}
  function status() {
    if(started && !closed && (heartbeatError || !ownMarkerValid())) {
      try { heartbeat(); } catch(error) {heartbeatError=error;throw new Error(`无法更新数据文件夹的使用标记，已暂停访问：${error.message}`);}
    }
    const { fresh, stale } = scan();
    const blocked = !closed && fresh.some((entry) => !acknowledged.has(entry.token));
    if (!blocked && !closed) start();
    return { blocked, started, closed, sessionId, computer: hostname, fresh, stale,
      warning: stale.length ? '发现较早的使用记录，请确认另一台电脑已停止使用，并等待同步完成。' : null };
  }
  function confirm(tokens = []) {
    if (!Array.isArray(tokens) || tokens.some((token) => typeof token !== 'string')) throw new TypeError('tokens must be an array of strings');
    const { fresh } = scan();
    const supplied = new Set(tokens);
    for (const entry of fresh) if (supplied.has(entry.token)) acknowledged.add(entry.token);
    return status();
  }
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    if (started) {
      try { unlinkSync(ownPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  status();
  return { status, confirm, close };
}
