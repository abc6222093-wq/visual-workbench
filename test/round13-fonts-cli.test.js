// 第 13 轮 · npm run fonts：用本地 http 服务假冒官方下载地址（小文件），验证写入、清单、跳过、失败继续、退出码与 status。
// 不真下载、不碰真实 home 和数据目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFonts, parseArgs, downloadFile } from '../src/cli/fonts.js';
import { fontsApi, readFontLibrary } from '../src/fonts/library.js';

const INTER = readFileSync(fileURLToPath(new URL('../examples/sample-deck/fonts/Inter-Variable.ttf', import.meta.url)));
const CLI = fileURLToPath(new URL('../src/cli/fonts.js', import.meta.url));
const tmp = t => { const dir = mkdtempSync(join(tmpdir(), 'vw-r13-fontcli-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

async function fakeServer(t, routes) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const body = routes[req.url];
    if (body === undefined) { res.writeHead(404); res.end('nope'); return; }
    if (typeof body === 'function') return body(req, res);
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, hits };
}

const entry = (base, key, file, extra = {}) => ({
  key, family: `Fam ${key}`, aliases: [`Alias ${key}`], license: { name: 'OFL-1.1', url: 'x' },
  files: [{ file, url: `${base}/${key}/${file}`, weight: 'variable', style: 'normal', format: 'truetype', ...extra }, { file: 'OFL.txt', url: `${base}/${key}/OFL.txt`, kind: 'license' }],
});

test('parseArgs：install / status / --only，错误给中文', () => {
  assert.deepEqual(parseArgs(['install']), { command: 'install', only: null });
  assert.deepEqual(parseArgs(['install', '--only', 'zcool-xiaowei']), { command: 'install', only: 'zcool-xiaowei' });
  assert.deepEqual(parseArgs(['status']), { command: 'status', only: null });
  assert.throws(() => parseArgs([]), /缺少要做的事/);
  assert.throws(() => parseArgs(['install', '--only', 'nope']), /没有这套字体/);
  assert.throws(() => parseArgs(['remove']), /不认识的命令/);
});

test('installFonts：下载写入、清单含 bytes、再跑一次跳过、某套失败继续其他套', async t => {
  const dataDir = tmp(t);
  const { base, hits } = await fakeServer(t, {
    '/good/Good.ttf': INTER, '/good/OFL.txt': Buffer.from('OFL license'),
    '/bad/OFL.txt': Buffer.from('OFL'),
    '/junk/Junk.ttf': Buffer.from('this is not a font'), '/junk/OFL.txt': Buffer.from('OFL'),
  });
  const catalog = [entry(base, 'good', 'Good.ttf'), entry(base, 'bad', 'Bad.ttf'), entry(base, 'junk', 'Junk.ttf')];
  const logs = [];
  const first = await installFonts(dataDir, { catalog, log: l => logs.push(l) });
  const byKey = Object.fromEntries(first.results.map(r => [r.key, r]));
  assert.equal(byKey.good.ok, true);
  assert.equal(byKey.bad.ok, false);
  assert.match(byKey.bad.error, /安装失败.*404/);
  assert.equal(byKey.junk.ok, false);
  assert.match(byKey.junk.error, /不是能用的字体/);
  const lib = join(dataDir, 'library', 'fonts');
  assert.equal(readFileSync(join(lib, 'good', 'Good.ttf')).length, INTER.length);
  assert.deepEqual(readdirSync(join(lib, 'junk')), [], '校验失败不留文件（也不留临时文件）');
  const manifest = JSON.parse(readFileSync(join(lib, 'fonts.json'), 'utf8'));
  assert.deepEqual(manifest.families.map(f => f.key), ['good']);
  assert.deepEqual(manifest.families[0].files, [
    { file: 'Good.ttf', weight: 'variable', style: 'normal', format: 'truetype', bytes: INTER.length },
    { file: 'OFL.txt', kind: 'license', bytes: 11 },
  ]);
  assert.deepEqual(manifest.families[0].aliases, ['Alias good']);
  assert.equal(readFontLibrary(dataDir).families[0].faces[0].bytes, INTER.length);

  // 再跑一次：已存在且大小一致的跳过，不再请求
  hits.length = 0;
  const second = await installFonts(dataDir, { catalog, only: 'good' });
  assert.deepEqual(second.results[0].files.map(f => f.status), ['skipped', 'skipped']);
  assert.deepEqual(hits, []);
  // 文件被截断：重新下载
  writeFileSync(join(lib, 'good', 'Good.ttf'), INTER.subarray(0, 100));
  const third = await installFonts(dataDir, { catalog, only: 'good' });
  assert.deepEqual(third.results[0].files.map(f => f.status), ['downloaded', 'skipped']);
  assert.equal(readFileSync(join(lib, 'good', 'Good.ttf')).length, INTER.length);
});

test('downloadFile：Content-Length 对不上报中文错误，不留临时文件；可注入 fetch', async t => {
  const dir = tmp(t);
  const { base } = await fakeServer(t, {
    '/short': (req, res) => { res.writeHead(200, { 'content-length': 1000 }); res.write('abc'); res.destroy(); },
  });
  await assert.rejects(downloadFile(`${base}/short`, join(dir, 'x.bin')), error => /没下载完整|连不上|terminated|下载/.test(error.message));
  assert.deepEqual(readdirSync(dir), []);
  const fakeFetch = async () => new Response(Buffer.from('hello'), { status: 200, headers: { 'content-length': '5' } });
  assert.equal(await downloadFile('https://example.invalid/a.txt', join(dir, 'a.txt'), { fetch: fakeFetch }), 5);
  assert.equal(readFileSync(join(dir, 'a.txt'), 'utf8'), 'hello');
  const failFetch = async () => { throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND') }); };
  await assert.rejects(downloadFile('https://example.invalid/b', join(dir, 'b'), { fetch: failFetch }), /连不上下载地址.*ENOTFOUND/);
});

test('命令行：status 列出每套没装（临时数据目录、临时 home）', t => {
  const dataDir = tmp(t);
  const home = tmp(t);
  mkdirSync(join(dataDir, 'library', 'fonts'), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.VW_DATA_DIR;
  const run = spawnSync(process.execPath, [CLI, 'status', '--data-dir', dataDir], { encoding: 'utf8', env });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /字体库文件夹：/);
  assert.match(run.stdout, /ZCOOL XiaoWei（zcool-xiaowei）：没装/);
  assert.match(run.stdout, /npm run fonts -- install/);
  const bad = spawnSync(process.execPath, [CLI, 'install', '--only', 'nope', '--data-dir', dataDir], { encoding: 'utf8', env });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /没有这套字体/);
  assert.equal(fontsApi(dataDir).families.every(f => !f.installed), true);
  assert.equal(existsSync(join(dataDir, 'library', 'fonts', 'fonts.json')), false, 'status 不写清单');
});
