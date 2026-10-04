// 制作应用：node scripts/pack.mjs --platform win32|darwin --arch x64|arm64|universal [--repo-dir <仓库>]
// 只打包应用壳（main.cjs、lib/、build/），工作台代码 src/、web/ 不进包；
// 打包后在应用里写 app-config.json 记下仓库绝对路径（默认 = desktop/ 的上一级）。
import { packager } from '@electron/packager';
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const platform = arg('--platform', process.platform);
const arch = arg('--arch', process.arch);
const repoDir = resolve(arg('--repo-dir', join(desktopDir, '..')));
if (!existsSync(join(repoDir, 'src', 'server.js'))) throw new Error(`${repoDir} 里没有 src/server.js`);

const paths = await packager({
  dir: desktopDir,
  out: join(desktopDir, 'dist'),
  name: '视觉工作台',
  executableName: '视觉工作台',
  platform,
  arch,
  overwrite: true,
  asar: false, // 打包后还要往里写 app-config.json
  prune: true,
  icon: join(desktopDir, 'build', platform === 'darwin' ? 'icon.icns' : 'icon.ico'),
  appBundleId: 'io.github.visual-workbench.desktop',
  appCategoryType: 'public.app-category.graphics-design',
  appCopyright: '视觉工作台',
  win32metadata: { ProductName: '视觉工作台', FileDescription: '视觉工作台', CompanyName: '视觉工作台', InternalName: 'VisualWorkbench', OriginalFilename: '视觉工作台.exe' },
  // 不配置 osxSign / osxNotarize：没有 Apple 开发者账号，不签名
  ignore: [/^\/node_modules($|\/)/, /^\/dist($|\/)/, /^\/out($|\/)/, /^\/scripts($|\/)/, /\.ps1$/, /^\/app-config\.json$/, /^\/\.gitignore$/],
});

for (const out of paths) {
  const appDir = platform === 'darwin' ? join(out, '视觉工作台.app', 'Contents', 'Resources', 'app') : join(out, 'resources', 'app');
  writeFileSync(join(appDir, 'app-config.json'), JSON.stringify({ repoDir }, null, 2) + '\n');
  if (platform === 'darwin' && process.platform === 'darwin') {
    // 临时签名（ad-hoc，"-" 表示不需要任何证书或账号）：改过 Info.plist 后 Apple 芯片要求至少有它，
    // 否则会提示「已损坏」；有了它，第一次打开只是普通的「无法验证开发者」提示。
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(out, '视觉工作台.app')], { stdio: 'inherit' });
  }
  console.log(`已制作：${out}`);
  console.log(`仓库位置：${repoDir}`);
}
