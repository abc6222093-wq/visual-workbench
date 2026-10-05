# 当前移交 · 第 12 轮修正（真机验收问题）

分支 `claude/round12-free-pages` 的修正提交在 `claude/loving-carson-nd0htf`（基于 `ec54c28`，本会话在云端容器里做，推送到了这条分支；**没有合并进 main**，等用户验收后统筹窗口安排）。规则见 `CLAUDE.md`（= `AGENTS.md`，最前面是硬原则），格式见 `docs/format.md`（v3），内部约定见 `docs/round12-contract.md`，桌面应用见 `docs/desktop.md`。

## 本轮修了什么（对应第 12 轮真机验收的 10 项）
1. **放映打不开（404）**：放映页改走 `GET /api/projects/:id`（以前去读 `/data/projects/<id>/project.json`，真实服务那里不提供）。旧测试用的是自己写的简易服务所以没发现；现在用真实服务 + 含中文和空格的数据目录测。
2. **导出的放映版没有动效**：Chromium 里用「v2 转换 → 导出 → file:// 打开」复现不了（动效正常）。查到的两件事已修：放映版的透明挡板挡住了页面自己的点击（导入的旧 HTML 自带点击动画时收不到点击），桌面上挡板不再用；真实形态测试补齐（转换来的、旧 HTML 导入的、含中文空格路径）。Safari 的确切原因在本容器验证不了（装不了 WebKit），加了 macOS 的 WebKit 测试任务（`.github/workflows/test.yml` 的 `webkit` job，`scripts/test-webkit.js` 清单）由 Actions 给答案。
3. **第 N 屏**：带 `motion.steps` 的页，画布上方有「第 1 屏 … 第 N 屏」按钮；运行时以快进方式跑到那一屏后静止，照常改字、拖动、改色；往回切用双缓冲换 iframe，不闪。编辑模式下运行时拦住用户输入，页面自己的脚本收不到，**画布点击永远不触发动效**。
4. **点一下闪一下**：工具条显隐改变了玻璃片集合，`web/ui/glass.js` 以前会把整个 WebGL 玻璃层销毁重建（重建期间所有玻璃消失）。现在隐藏的玻璃片保留、不重建；只有换画面（总览 ↔ 编辑器）才重建。
5. **桌面应用右键**：右键菜单的代码在 `desktop/main.cjs`，是第 12 轮才进 `desktop/` 的，而用户装的应用是第 11 轮制作的，所以一直没有。**必须重新制作并替换应用**（见 `docs/desktop.md`）；应用壳现在在 UA 里带版本标记，工作台看到旧版本会在顶部提示。真机 Electron 本容器验证不了。
6. **拖动不明显**：悬停 2px 实线框、选中 2px 框 + 8 个 12px 把手、文字框框线内 10px / 外 6px 都是移动光标可拖；图片、色块整块可拖。另外发现 v2 转换出来的文字只标了 `text color`、根本没有 `move`，已改为 `text move color`。
7. **色块识别**：导入旧 HTML / 网页和 v2 转换自动把纯色色块标 `move resize background`、整页背景只标 `background`（`b<N>` / `bg<N>`，转换的页面底色是 body 上的 `page_bg`）。画布上点空白仍是取消选中，页面底色从工具条「页面底色」改。
8. **导出进度**：`exportProject` 报进度、可取消；服务加 SSE 进度流与取消接口；弹窗显示「正在导出第 3 / 15 页」和取消；命令行也打印进度。
9. **裁切在 Safari**：不支持 `object-view-box` 的浏览器改用背景图方式显示（src 不变、元素框不变）；Chromium 下用强制兼容分支验证了画面一致，WebKit 由 Actions 验证。
10. **文档**：PLAN 加「项目目标」「硬原则」「不是第二个 Canva」；CLAUDE.md = AGENTS.md 最前面放硬原则；README 删旧大纲说明、按现在的界面更新；旧验证记录标注已过时；format.md / contract.md 同步。

## 已知限制与未验证
- 本会话在 Linux 容器里，没有桌面应用、没有 Safari / WebKit：第 5 项真机、第 2 和第 9 项的 Safari 表现都要等用户重新制作应用后在 Mac 验收，以及 Actions 的 `webkit` job。
- 触屏设备（iPad）上放映版仍用挡板接滑动，页面自带的点按动画收不到。
- 导入的网页 / 旧 HTML 里的文字仍只标 `text color`（流式布局里挪文字意义不大）；要不要也给 `move` 由用户定。
- `web/ui/glass.js` 往运行中的玻璃实例里追加玻璃片用到了 `web/vendor/liquidglass.esm.js` 的内部字段，升级这个库要重查。

## 下一步
- 用户在 Mac 上：拉分支、`npm ci`、重新制作并替换桌面应用，按报告里的清单真机验收。
- 第 13 轮按 PLAN「项目目标」做：草稿分页、跨项目拼页统一风格、设计卡片、文件夹与命名、页面上画框写批注。

## 需要用户决定
见本轮报告「需要用户拍板的」。
