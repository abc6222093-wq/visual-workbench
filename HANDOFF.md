# 当前移交 · 第 16 轮（两处小修 + 加固 + 合进 main）

第 12–16 轮都已合进 `main`（第 13–16 轮原来在 `claude/round13-organize` 上做）。规则见 `CLAUDE.md`（= `AGENTS.md`），格式见 `docs/format.md`，内部约定见 `docs/round12-contract.md`、`docs/round13-contract.md`，桌面应用见 `docs/desktop.md`，路线图见 `PLAN.md`。

## 本轮做了什么
- **画布偏紫**：框选（页面里拖、或从画布四周拖）时会画一个淡蓝色半透明的框；如果在应用窗口外松开鼠标，工作台收不到「松开」，框就一直盖在页面上，白色页面看起来偏紫。现在只要之后收到的移动里按键已经松开，就当作松开：拖动结束、框去掉（`web/app.js` frameDrag / startWellMarquee）。
- **换页闪一下**：以前换页是在同一个 iframe 里重新载入，新页的字体、图片画出来之前整页是白的。现在双缓冲：新页先藏在旧页后面加载，运行时报「画好了」（新消息 `painted`：字体就绪、图片解码完、再等两帧，最多 1.5 秒）才换上（`web/app.js` refreshBoard / finishPageSwap，`web/page-runtime.js` whenPainted，`web/page-frame.js` painted）。
- **PPTX 不分用途**：只用于大屏幕和其他设备演示，固定 1.5 倍 JPEG；导出弹窗选 PPTX 时不出现「印刷版 / 线上浏览版」。
- **测试补齐**：第 14 轮跳过的 5 个旧测试按现在的行为改写；新增 `test/round16-runtime-basic`、`round16-editor-basic`（点选、多选、框选、移动、缩放、删除、撤销、右键、对齐、窗口外松开、换页双缓冲）、`round16-annotations`、`round16-upgrade-marks`、`round16-export`、`round16-play-inapp`。
- **文档**：PLAN（路线图到第 16 轮）、README（工作台怎么用，按现在的界面重写）、CLAUDE = AGENTS、format.md、两份内部约定、desktop.md 与代码一致。
- 合进 `main`，Mac 桌面应用重新制作并安装（壳代码没变，仍是 0.2.0）。

## 已知限制
- 换页时新页最多等 1.5 秒「画好」；图片很多、很大的页可能还是会先显示一部分。
- PPTX：本机没有 PowerPoint / Keynote，只用 Quick Look 和文件内容检查过；可改字版只转标了 text 的文字，字体用原来的名字（对方电脑没装会换字）。
- 新增的测试没有加进 Windows 清单（`scripts/test-windows.js`）；Windows 照旧只跑清单里的测试。
- 色块补标记要本机能找到浏览器；找不到时只补文字 / 图片的能力。

## Windows 电脑更新步骤
Windows 上的代码在 `C:\Users\admin\Projects\visual-workbench\main`，数据在 `G:\我的云端硬盘\visual-workbench-data`。
1. 先在 Mac 上关掉工作台，等 Google Drive 同步完成；Windows 上也先关掉「视觉工作台」应用（总览「关闭工作台」或关窗口）。
2. 更新代码（在 PowerShell 里）：
   - `cd C:\Users\admin\Projects\visual-workbench\main`
   - `git status`（有未提交改动就先停下来问）
   - `git fetch origin`，`git checkout main`，`git reset --hard origin/main`
   - `npm ci`（新加了依赖 pptxgenjs；Windows 上的 sharp 会按本机重新装）
3. 重新制作并安装 Windows 桌面应用（第 12 轮以来壳没改，但版本较旧时要重做，顺便确认）：`cd desktop`，`powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1`；完成后桌面「视觉工作台（应用）」和开始菜单快捷方式照常可用；可以在 `desktop` 里跑 `npm run smoke` 自测（退出码 0 为通过）。
4. 字体库：数据目录在 Google Drive 上，Mac 已经装过 `library/fonts/`（约 62 MB），同步过来就能用。在仓库里 `npm run fonts -- status` 看一下；显示没装齐时再 `npm run fonts -- install`（要联网下载）。
5. 打开工作台检查：第一次打开每个项目时，工作台会**先自动存一版**（说明「按新规则补标记前自动存版」），再按新规则补标记（文字、图片、色块都能移动缩放，没标的纯色色块补标）；44 页的项目要多等约 10 秒。之后再打开不会重复。
6. 验收：点选、Shift / Cmd + 点、拖框多选、拖动、拖角缩放（文字字号一起变）、Delete 删除、Ctrl+Z 撤销、右键「删除」、多选后工具条对齐、画笔、导出弹窗的「用途」和 PPTX、应用里点「放映」在窗口内全屏放映、Esc 回到原来那一页。
7. 已知：Windows 的 Ctrl 对应 Mac 的 Cmd；全量测试不在 Windows 上跑（只跑 `node scripts/test-windows.js` 的清单）。

## 下一步
- 统筹窗口按上面的步骤给 Windows 写指令。
- 之后按 PLAN 的路线图继续。

## 需要用户决定
- 暂无。
