import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageSession } from '../src/session.js';

function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'vw-session-'));
  const sessions = [];
  t.after(() => { sessions.forEach((session) => session.close()); rmSync(dataDir, { recursive: true, force: true }); });
  let clock = Date.parse('2026-01-01T00:00:00Z');
  return { dataDir, advance: (ms) => { clock += ms; }, create: (computer) => {
    const session = createUsageSession({ dataDir, hostname: computer, now: () => clock });
    sessions.push(session); return session;
  }, marker: (id) => {
    const dir = join(dataDir, '.workbench-sessions'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ sessionId: id, computer: id, startedAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() }));
  }, files: () => readdirSync(join(dataDir, '.workbench-sessions')) };
}

test('fresh sessions block startup without writing another marker; explicit tokens permit startup', (t) => {
  const f = fixture(t), a = f.create('A'), b = f.create('B');
  assert.equal(a.status().blocked, false);
  assert.equal(b.status().blocked, true);
  assert.equal(b.status().started, false);
  assert.equal(f.files().length, 1);
  const tokens = b.status().fresh.map((entry) => entry.token);
  assert.equal(b.confirm([]).blocked, true);
  assert.equal(b.confirm(tokens).blocked, false);
  assert.equal(f.files().length, 2);
  assert.equal(b.status().blocked, false);
  b.close(); b.close();
  assert.equal(f.files().length, 1);
});

test('late synced tokens block and confirmation cannot acknowledge unseen tokens', (t) => {
  const f = fixture(t), a = f.create('A');
  f.marker('B');
  const tokens = a.status().fresh.map((entry) => entry.token);
  f.marker('C');
  assert.equal(a.confirm(tokens).blocked, true);
  assert.equal(a.confirm(a.status().fresh.map((entry) => entry.token)).blocked, false);
  const file = join(f.dataDir, '.workbench-sessions', 'B.json');
  const marker = JSON.parse(readFileSync(file));
  marker.updatedAt = new Date(Date.parse(marker.updatedAt) + 1000).toISOString();
  writeFileSync(file, JSON.stringify(marker));
  assert.equal(a.status().blocked, false, 'heartbeats preserve acknowledged identity');
});

test('stale markers warn but permit startup and are preserved', (t) => {
  const f = fixture(t); f.marker('old'); f.advance(90001);
  const a = f.create('A');
  assert.equal(a.status().blocked, false);
  assert.equal(a.status().stale.length, 1);
  assert.ok(a.status().warning);
  a.close();
  assert.deepEqual(f.files(), ['old.json']);
});

test('blocked close never deletes another session', (t) => {
  const f = fixture(t); f.create('A'); const b = f.create('B');
  b.close(); assert.equal(f.files().length, 1);
  assert.equal(b.status().closed, true);
  assert.throws(() => b.confirm('bad'), /array/);
});

test('own marker removed by sync is recreated before access; unwritable marker blocks access',t=>{
 const f=fixture(t),session=f.create('A'),file=join(f.dataDir,'.workbench-sessions',f.files()[0]);rmSync(file);assert.equal(session.status().blocked,false);assert.equal(f.files().length,1);
 rmSync(file);mkdirSync(file);assert.throws(()=>session.status(),/无法更新.*使用标记/);rmSync(file,{recursive:true});assert.equal(session.status().blocked,false);
});
