#!/usr/bin/env node
// 本地常用字体库（docs/format.md §19、docs/round13-contract.md §9）：
//   npm run fonts -- install [--only <key>] [--data-dir <目录>]   从官方开源发布处下载到 <数据目录>/library/fonts/<key>/
//   npm run fonts -- status  [--data-dir <目录>]                   列出每套装没装
// 下载流式写临时文件再改名；校验大小（有 Content-Length 时要一致）并用 subset-font 抽几个字试一下；
// 已存在且大小和清单一致的跳过；某一套失败报中文错误并继续其他套，最后退出码非 0。只从 src/fonts/catalog.js 里的官方地址下载。
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';
import { loadConfig, stripDataDirArg } from '../config.js';
import { FONT_CATALOG } from '../fonts/catalog.js';
import { MANIFEST, fontsApi, libraryDir, readManifest } from '../fonts/library.js';

const USAGE = [
  '用法：npm run fonts -- install [--only <字体编号>] [--data-dir <目录>]',
  '      npm run fonts -- status [--data-dir <目录>]',
  `字体编号：${FONT_CATALOG.map(e => e.key).join('、')}`,
].join('\n');
const usage = message => Object.assign(new Error(message), { usage: true });
const SAMPLE = '永和九年ABCabc123';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) throw usage('缺少要做的事（install 或 status）');
  if (command !== 'install' && command !== 'status') throw usage(`不认识的命令：${command}`);
  const options = { command, only: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--only' && command === 'install') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) throw usage('--only 后面要跟字体编号');
      options.only = value;
    } else if (arg.startsWith('--only=') && command === 'install') options.only = arg.slice(7);
    else throw usage(`不认识的参数：${arg}`);
  }
  if (options.only && !FONT_CATALOG.some(e => e.key === options.only)) throw usage(`没有这套字体：${options.only}`);
  return options;
}

const fileSize = path => { try { const s = statSync(path); return s.isFile() ? s.size : -1; } catch { return -1; } };
const formatMB = bytes => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

/** 下载一个文件：流式写到 <dest>.download，校验后改名。返回字节数。 */
export async function downloadFile(url, dest, { fetch: fetchImpl = globalThis.fetch, verifyFont = false } = {}) {
  let response;
  try { response = await fetchImpl(url, { headers: { 'accept-encoding': 'identity' }, redirect: 'follow' }); }
  catch (error) { throw new Error(`连不上下载地址 ${url}（${error.cause?.message || error.message}）`); }
  if (!response.ok || !response.body) throw new Error(`下载地址返回 ${response.status}：${url}`);
  const encoded = (response.headers.get('content-encoding') || 'identity') !== 'identity';
  const expected = encoded ? null : Number(response.headers.get('content-length')) || null;
  const temporary = `${dest}.download`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const size = fileSize(temporary);
    if (size <= 0) throw new Error(`下载到的文件是空的：${url}`);
    if (expected && size !== expected) throw new Error(`文件没下载完整（应为 ${expected} 字节，实际 ${size} 字节）：${url}`);
    if (verifyFont) {
      try { const out = await subsetFont(readFileSync(temporary), SAMPLE, { targetFormat: 'woff2' }); if (!out?.length) throw new Error('子集为空'); }
      catch (error) { throw new Error(`下载到的文件不是能用的字体（${error.message}）：${url}`); }
    }
    renameSync(temporary, dest);
    return size;
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * 安装字体库。返回 { dir, results: [{ key, ok, files: [{ file, status: 'downloaded'|'skipped', bytes }], error? }] }。
 * catalog / fetch / log 可注入（测试用本地 http 服务）。
 */
export async function installFonts(dataDir, { only = null, catalog = FONT_CATALOG, fetch: fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  const dir = libraryDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const previous = readManifest(dataDir);
  const manifestFamilies = new Map((previous?.families || []).filter(f => f && f.key).map(f => [f.key, f]));
  const results = [];
  for (const entry of catalog) {
    if (only && entry.key !== only) continue;
    const familyDir = join(dir, entry.key);
    const listed = manifestFamilies.get(entry.key);
    const result = { key: entry.key, family: entry.family, ok: true, files: [] };
    try {
      mkdirSync(familyDir, { recursive: true });
      const written = [];
      for (const file of entry.files) {
        const dest = join(familyDir, file.file);
        const local = fileSize(dest);
        const known = listed?.files?.find(f => f?.file === file.file)?.bytes ?? file.bytes;
        if (local > 0 && known && local === known) {
          result.files.push({ file: file.file, status: 'skipped', bytes: local });
          log(`  已有 ${entry.key}/${file.file}（${formatMB(local)}），跳过`);
        } else {
          log(`  下载 ${entry.key}/${file.file} …`);
          const bytes = await downloadFile(file.url, dest, { fetch: fetchImpl, verifyFont: file.kind !== 'license' });
          result.files.push({ file: file.file, status: 'downloaded', bytes });
          log(`  已下载 ${entry.key}/${file.file}（${formatMB(bytes)}）`);
        }
        const bytes = fileSize(dest);
        written.push(file.kind === 'license'
          ? { file: file.file, kind: 'license', bytes }
          : { file: file.file, weight: file.weight, style: file.style || 'normal', format: file.format, bytes });
      }
      manifestFamilies.set(entry.key, { key: entry.key, family: entry.family, aliases: entry.aliases, license: entry.license, files: written });
    } catch (error) {
      result.ok = false;
      result.error = `「${entry.family}」（${entry.key}）安装失败：${error.message}`;
      log(`  ${result.error}`);
    }
    results.push(result);
  }
  // 清单：保留之前装好的其他套，按目录顺序写
  const order = new Map(catalog.map((e, i) => [e.key, i]));
  const families = [...manifestFamilies.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
  const manifestFile = join(dir, MANIFEST);
  const temporary = `${manifestFile}.tmp`;
  writeFileSync(temporary, JSON.stringify({ families }, null, 2) + '\n');
  renameSync(temporary, manifestFile);
  return { dir, results };
}

export function formatStatus(api) {
  const lines = [`字体库文件夹：${api.dir}`];
  for (const family of api.families) {
    if (family.installed) lines.push(`- ${family.family}（${family.key}）：已安装，${family.files.map(f => `${f.file} ${formatMB(f.bytes)}`).join('、')}`);
    else lines.push(`- ${family.family}（${family.key}）：没装${family.missing.length ? `（缺 ${family.missing.join('、')}）` : ''}`);
  }
  if (api.families.some(f => !f.installed)) lines.push('没装的可以运行 npm run fonts -- install 安装。');
  return lines.join('\n');
}

async function main(argv) {
  let options;
  try { options = parseArgs(stripDataDirArg(argv)); }
  catch (error) { console.error(error.message); if (error.usage) console.error(USAGE); return 2; }
  let dataDir;
  try { dataDir = loadConfig({ argv }).dataDir; }
  catch (error) { console.error(error.message); return 2; }
  if (options.command === 'status') { console.log(formatStatus(fontsApi(dataDir))); return 0; }
  if (!existsSync(dataDir)) { console.error(`数据目录不存在：${dataDir}`); return 2; }
  console.log(`安装常用字体库到 ${libraryDir(dataDir)}（只从官方开源发布处下载）`);
  const { results } = await installFonts(dataDir, { only: options.only, log: line => console.log(line) });
  const failed = results.filter(r => !r.ok);
  for (const r of results) if (r.ok) console.log(`✓ ${r.family}（${r.key}）`);
  for (const r of failed) console.error(`✗ ${r.error}`);
  console.log(failed.length ? `${failed.length} 套没装好，其余已写入清单 ${MANIFEST}。` : `全部装好，清单已写入 ${MANIFEST}。`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
