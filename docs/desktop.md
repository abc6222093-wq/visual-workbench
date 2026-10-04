# 桌面应用（视觉工作台.app / 视觉工作台.exe）

给 agent 和维护者看的说明。用户看 README 的「桌面应用」「第一次打开时的安全提示」两节就够了。

## 它是什么
`desktop/` 是一个很薄的 Electron 应用壳，只做三件事：

1. 找到工作台代码文件夹（仓库），用**系统里的 Node**（不是 Electron 自带的 Node，避免 sharp 原生模块不匹配）运行 `<仓库>/src/server.js --port 4173 --no-open`，工作目录是仓库根；
2. 开一个窗口（1440×900 起步，可缩放，标题「视觉工作台」，隐藏菜单栏）加载 `http://127.0.0.1:4173`；
3. 关窗口 = 正常关闭工作台：先让页面保存，再 `POST /api/shutdown`（服务清除「正在使用」标记后自己退出），等服务进程退出（最多 5 秒，超时才结束进程），然后退出应用。

`src/`、`web/` 不打进应用包，所以 `git pull` 之后**不需要重新制作应用**，下次打开就是新版本。只有 `desktop/` 本身改了才需要重新制作。

## 行为细节
- 已经开着时再点图标：只把原来的窗口叫到前面（单实例锁；Mac 上点程序坞图标同理）。
- 4173 上已有本仓库的工作台在跑（`/api/health` 的 `repoDir` 相同、代码指纹相同）：直接连上，不再启动；关窗口时仍然正常关闭它（发 shutdown），但不会去结束别人启动的进程。
- 4173 上是本仓库但代码已更新的旧服务：先正常关闭它，再启动新的。
- 4173 被别的程序占用：弹中文提示，不启动。
- 找不到系统 Node 22+：弹「未找到 Node.js 22 或更新版本…」，可点「打开下载页」。Mac 从程序坞打开时 PATH 很短，应用会自己补上 `/opt/homebrew/bin`、`/usr/local/bin` 等。
- 页面里点「关闭工作台」按钮：服务退出后应用也跟着退出。
- 外链和 `window.open` 用系统浏览器打开；工作台自己的页面留在窗口里。`Ctrl/Cmd+R` 重新载入，Windows 上 `F12`、Mac 上 `Alt+Cmd+I` 打开开发者工具。
- 运行日志：Windows `%APPDATA%\视觉工作台\desktop.log`，Mac `~/Library/Application Support/视觉工作台/desktop.log`。

## 仓库位置怎么找
依次尝试，第一个含 `src/server.js` 的胜出：
1. 环境变量 `VW_REPO_DIR`
2. `~/.visual-workbench/desktop.json` 的 `repoDir`（应用找不到仓库时，让用户「选择文件夹」后写在这里）
3. 应用里的 `app-config.json`（制作应用时写入仓库绝对路径）
4. 开发态：`desktop/` 的上一级

`~/.visual-workbench/config.json`（数据文件夹设置）应用不读不写，照旧由工作台服务自己读。

## 文件
| 文件 | 作用 |
|---|---|
| `desktop/main.cjs` | 主进程接线 |
| `desktop/lib/core.cjs` | 可测的纯逻辑：找仓库、找 Node、健康检查、端口判断、关闭流程 |
| `desktop/lib/icons.cjs` | 手写 ICO / ICNS 容器 |
| `desktop/scripts/make-icons.mjs` | 用 `web/ui/mascot.js` 的兔子生成 `desktop/build/icon.png/.ico/.icns`（生成物进 git） |
| `desktop/scripts/pack.mjs` | 用 `@electron/packager` 制作应用（不签名；Mac 上只做免费的 ad-hoc 临时签名） |
| `desktop/install-windows.ps1` | Windows 一键安装：制作应用、写仓库位置、建桌面和开始菜单快捷方式 |
| `.github/workflows/desktop.yml` | macOS + Windows 构建、`--smoke` 自测、上传下载包 |
| `test/round11-desktop-*.test.js` | 单元测试（不需要装 electron） |

## 常用命令（在 `desktop/` 里）
| 做什么 | 命令 |
|---|---|
| 装依赖（第一次） | `npm install`（Electron 装在 `desktop/node_modules`，不进 git） |
| 开发态直接运行 | `npm start` |
| 自测 | `npm run smoke`（用临时数据目录，不碰用户数据；成功退出码 0，90 秒超时退出码 1） |
| 重新生成图标 | `npm run icons` |
| 制作 Windows 应用 | `npm run pack:win` → `dist/视觉工作台-win32-x64/视觉工作台.exe` |
| 制作 Mac 应用 | `npm run pack:mac` → `dist/视觉工作台-darwin-universal/视觉工作台.app`（要在 Mac 上做） |
| Windows 安装 | `powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1` |

## Windows 安装
运行 `install-windows.ps1`（不需要管理员）：装依赖 → `pack:win` → 在 `dist\视觉工作台-win32-x64\resources\app\app-config.json` 写仓库位置 → 建快捷方式：
- 桌面「视觉工作台（应用）」（原来的「视觉工作台」双击启动文件快捷方式保留不动）
- 开始菜单「视觉工作台」（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\视觉工作台.lnk`）

应用本体留在仓库的 `desktop\dist\` 里（不进 git）。以后只有 `desktop/` 改了才需要重新运行一次。重新制作前先关掉应用。

## Mac 安装
推荐在用户的 Mac 上由 agent 直接制作（本机做的应用没有「从网上下载」的标记，打开时不会有安全提示）：
1. 在仓库里 `npm ci`，再 `cd desktop && npm ci && npm run pack:mac`。
2. 把 `desktop/dist/视觉工作台-darwin-universal/视觉工作台.app` 拖进「应用程序」文件夹，再把它拖到程序坞。

也可以用 GitHub Actions 的构建产物：仓库 Actions → desktop → 最新一次运行 → 下载 `visual-workbench-mac`，解压得到 `视觉工作台.app`，拖进「应用程序」。下载来的应用：
- 第一次打开：在「应用程序」里**右键（或按住 Control 点）→ 打开 → 打开**；或者先双击一次，再到「系统设置 → 隐私与安全性」，往下找到「视觉工作台」那一行点「仍要打开」。只需要做一次。
- 它不知道你的仓库在哪（里面记的是构建机器上的路径），第一次会弹「找不到视觉工作台的代码文件夹」，点「选择文件夹」选中仓库即可，会记在 `~/.visual-workbench/desktop.json`。
- 如果提示「已损坏，无法打开」：让 agent 在终端执行 `xattr -cr /Applications/视觉工作台.app` 后再按上面的方法打开。

## 自测与 CI
`--smoke`：主进程启动服务（临时数据目录）→ 窗口 `did-finish-load` → 走正常关闭流程 → 退出码 0；任何一步失败或 90 秒超时退出码 1；已有一个应用实例在跑时退出码 2。
`desktop.yml` 在 `macos-latest`、`windows-latest` 上：`npm ci`（根和 `desktop/`）→ 校验图标 → 单元测试 → 制作应用 → `--smoke` → 确认 4173 已释放 → 打 zip 上传（`visual-workbench-mac`、`visual-workbench-windows`）。

## 已知限制
- 页面目前没有提供「关闭前保存」的钩子：应用先在页面里调用 `window.vwFlushBeforeClose()`（若存在），否则等 0.9 秒让自动保存（600ms 节流）落盘，再发 shutdown。`web/` 若导出这个钩子（调用 app.js 里的 `flush()`），关闭会更稳。
- 另一台电脑的「正在使用」标记还新鲜、服务拒绝操作时，`/api/shutdown` 会返回 423，此时应用直接结束自己启动的服务进程。
- 不签名、不公证（没有 Apple 开发者账号）；Windows 也不签名，SmartScreen 可能提示。
