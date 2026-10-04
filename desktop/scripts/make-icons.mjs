// 用工作台的兔子（web/ui/mascot.js）生成应用图标：build/icon.png、icon.ico、icon.icns。
// 生成物进 git；改了兔子造型后重新运行：npm run icons（在 desktop/ 里）。
// 加 --check：只比较已提交的图标能否被正确解析，不重写文件（CI 用）。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { ICO_SIZES, ICNS_TYPES, buildIco, buildIcns, parseIco, parseIcns } = require('../lib/icons.cjs');
const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(desktopDir, '..');
const buildDir = join(desktopDir, 'build');

if (process.argv.includes('--check')) {
  const ico = parseIco(readFileSync(join(buildDir, 'icon.ico')));
  const icns = parseIcns(readFileSync(join(buildDir, 'icon.icns')));
  if (!existsSync(join(buildDir, 'icon.png'))) throw new Error('缺少 build/icon.png');
  console.log(`图标已就绪：ICO ${ico.map((x) => x.size).join('/')}，ICNS ${icns.map((x) => x.type).join('/')}`);
  process.exit(0);
}

// sharp 用仓库根目录装好的那份，不在 desktop/ 里重复安装
const sharp = createRequire(join(repoDir, 'package.json'))('sharp');
const { mascot } = await import(pathToFileURL(join(repoDir, 'web', 'ui', 'mascot.js')).href);

// badge 版：浅粉紫蓝圆底 + 白色小兔。pad 是四周留白占比（Mac 图标习惯留一圈边）。
function svg(size, pad) {
  const inner = mascot({ pose: 'awake', size: 64, badge: true }).replace(/width="64" height="64"/, '');
  const s = 64 / (1 - pad * 2), off = (s - 64) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-off} ${-off} ${s} ${s}">${inner.replace('<svg ', '<svg x="0" y="0" width="64" height="64" ')}</svg>`);
}
const render = (size, pad) => sharp(svg(size, pad), { density: 72 }).resize(size, size).png().toBuffer();

mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'icon.png'), await render(1024, 0.04));
const icoImages = [];
for (const size of ICO_SIZES) icoImages.push({ size, png: await render(size, 0.02) });
writeFileSync(join(buildDir, 'icon.ico'), buildIco(icoImages));
const icnsImages = [];
for (const [type, size] of Object.entries(ICNS_TYPES)) icnsImages.push({ type, png: await render(size, 0.1) });
writeFileSync(join(buildDir, 'icon.icns'), buildIcns(icnsImages));
console.log('已生成 build/icon.png、icon.ico、icon.icns');
