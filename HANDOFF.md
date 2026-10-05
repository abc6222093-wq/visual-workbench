# 当前移交 · 第 12 轮收尾（Mac 本机：更新代码、重新制作桌面应用、真机验证）

分支 `claude/round12-free-pages`（**没有合并进 main**，等统筹窗口安排）。规则见 `CLAUDE.md`（= `AGENTS.md`，最前面是硬原则），格式见 `docs/format.md`（v3），内部约定见 `docs/round12-contract.md`，桌面应用见 `docs/desktop.md`。

## 本轮做了什么
1. **用户 Mac 上的代码与桌面应用已更新**：仓库停在本分支最新提交；`~/Applications/视觉工作台.app` 已重新制作（版本 0.2.0，ad-hoc 签名，`app-config.json` 指向本仓库），程序坞里原来的图标继续指向它；`--smoke` 自测通过。
2. **真机验证（Playwright 驱动安装好的 Electron 应用，数据目录是含中文和空格的临时路径）全部正常**：改字时右键出剪切 / 复制 / 粘贴 / 全选且四项都有效（属性栏输入框同样）；Cmd+C / V / X / A / Z 在改字时有效；第 N 屏切换；编辑画布点击不播放动效；玻璃层不重建、磨砂玻璃全程可见；文字 / 图片 / 色块的悬停框、把手、拖动、缩放、改色；放映打开并推进；导出放映版有进度条、导出的文件用 file:// 打开能放映有动效；顶部没有「旧版本应用」提示。
3. **修了一个真机上才发现的放映死锁**（`web/playback.js`、`web/page-frame.js`、`web/page-runtime.js`）：放映壳以前先等页面 `ready` 再显示 iframe，而 `ready` 要等 `init` 跑完；`init` 里 `await ctx.animate(...)` 的入场动画（示例课件封面就是）在 `visibility:hidden` 的 iframe 里不会走（Chromium 不推进隐藏 iframe 的动画），所以放映一直停在「正在准备放映…」。现在运行时在 play 模式先报 `loaded`（文档加载完、修改单叠完），放映壳收到就显示新页、销毁旧页，再等 `ready`。导出的放映版用同一个放映壳，一并修好。测试：`test/round12-fix-playback-reveal.test.js`。
4. **导入的旧 HTML / 网页里的文字也能拖动**（`src/import-html/inpage.js`）：导入时文字标 `text move color`（以前只有 `text color`），和 v2 转换来的文字一致；迁移说明、`docs/import-html.md`、`docs/format.md` 同步。测试：`test/round12-fix-import-text-move.test.js`（导入输出的能力 + 编辑画布上从框线拖动产生 `move` 修改）。原有导入测试里断言的 `text color` 相应改成 `text move color`。
5. 本机 Chrome 154 把 srcdoc iframe 的 url 报成 `about:blank`，`test/round12-fix-export-real.test.js` 的能力探针改为按元素取 frame（断言不变）。

## 已知限制与未验证
- 放映壳预加载的下一页在隐藏状态下已经开始跑 `init`：用 `ctx.animate` 的入场在显示后才走（Chromium 冻结隐藏 iframe 的动画），用计时器的入场在显示前就走完了。要彻底解决需要让预加载页在显示时才跑 `init`（运行时与放映壳的约定要加一条），本轮没做。
- Safari / WebKit 的表现仍由 Actions 的 `webkit` job 给答案；触屏设备上放映版仍用挡板接滑动。
- Cmd 快捷键在真机上是用 Playwright 发键 + 应用菜单的 role 验证的，没有用系统级真实按键（需要辅助功能权限）。
- 桌面应用里「放映」是在同一个窗口里打开（应用壳不开新窗口），README 里「在新窗口全屏播放」是浏览器形态的说法。
- `web/ui/glass.js` 往运行中的玻璃实例里追加玻璃片用到了 `web/vendor/liquidglass.esm.js` 的内部字段，升级这个库要重查。

## 下一步
- 用户在 Mac 上直接打开程序坞里的「视觉工作台」验收；统筹窗口决定何时合并进 main。
- 第 13 轮按 PLAN「项目目标」做：草稿分页、跨项目拼页统一风格、设计卡片、文件夹与命名、页面上画框写批注。

## 需要用户决定
- 预加载页的 `init` 时机（见「已知限制」第 1 条）要不要在第 13 轮一起改。
