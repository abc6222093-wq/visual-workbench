# 交接 · 当前状态（第 4 轮结束，2026-10-02）

本文件写的是**现在的状态**，每轮重写。各轮细节看 git 历史。

## 现在能做什么（第一版功能完整）
エイ 能完整走通：新建项目（空白或从系列母版）→ agent 做内容和动效 → 她在工作台微调 → 放映 → 导出成一个文件带走。

| 功能 | 在哪 |
|---|---|
| 项目格式 v2（每页 `motion.source` 自由代码动效） | `schema/`、`docs/format.md` §9 |
| 编辑器、放映（全屏，点击推进） | `web/app.js`、`web/motion-stage.js`、`web/playback.js` |
| 预览本页动效（不进全屏，播完回到静止编辑） | 工具栏「预览动效」，`web/motion-preview.js` |
| 实时连接、agent 状态、三方合并（`motion` 整体保留 agent 的） | `src/watch.js`、`web/sync.js` |
| 存版去重、退回、删除版本、空间回收 | `src/version.js`；版本列表里的删除按钮 |
| 点名参考、系列母版（`series.json` 带配色和母版动效代码） | `src/master.js`、`src/brief.js` |
| 动效检查（真浏览器逐页跑；编辑器里自动检查） | `npm run check-motion`、`web/motion-check.js` |
| 导出：放映版 HTML / 每页 PNG / PDF，在访达中显示 | 顶栏「导出」；`npm run export`；`src/export/` |
| 找浏览器（Chrome → Edge → Chromium → WebKit，找不到给中文提示） | `src/browser.js` |

测试：`npm test` 185 个；CI 在 Linux 上用 Chromium 跑全部测试、校验和示例项目的动效检查。

## 本轮做了什么
1. 把 `claude/round3-sync` 和 `codex/round3-motion` 依次合进 main（普通合并）。冲突两处（`src/server.js` 新建项目、`QUOTA.md`），语义冲突三处（`blankPage` 的 v1 `steps`、两个测试按 v2 改写）。
2. 合并后联调：动效代码的实时刷新、存版退回、从母版新建、三方合并各有测试（`test/motion-integration.test.js`）；修了三方合并在三方都不同时取エイ 版本的问题，改为 `motion` 整体取 agent 的并记冲突。
3. 动效检查在 Mac 上能跑：这台 Mac 没有 Chrome，自动用 Playwright 自带的 WebKit。顺带修了 Safari 下三个问题：编辑器里的动效检查永远不结束（`event.source` 判断、隐藏 iframe 被暂停动画）、错误信息丢失（`error.stack` 不含信息）、全屏放映按 Esc 回不到编辑。
4. 预览本页动效。
5. 导出放映版 HTML（示例项目 269.5 KB）。
6. 导出图片 / PDF（PDF 自己写，不依赖 Chrome 打印）。
7. 导出入口（弹窗 + 在访达中显示）。
8. 版本空间回收。
9. `CLAUDE.md` = `AGENTS.md` 统一，`docs/format.md` 补了版本、导出、浏览器三节。
10. `PLAN.md` 更新到当前产品状态。

## 没做的
- Chrome / Chromium 下没在本机实测（本机没有 Chrome），靠 CI 的 Chromium 跑全部测试；真实 Safari 窗口里也没手点过，只用了 Playwright WebKit。
- 从公共素材库取素材的命令行脚本（一直留着）。
- `web/style.css` 里 `.modal*` 和 `modal()` 的非玻璃分支还能删（不影响功能）。
- 示例项目 `examples/sample-deck` 第 1 页的文字还写着「动效只挂编号，只写相对变化」（v1 时代的说法），内容层面没改。

## 下一步
1. エイ 在自己的 Mac 上实际走一遍：建项目 → 让 agent 做 → 调 → 放映 → 导出 → 把 HTML 发到手机上打开。
2. 按她的反馈修。若她装了 Chrome，`check-motion` 会自动改用 Chrome。
3. 素材库取用脚本。

## 需要エイ 决定的
- **导出文件放哪**：现在在 `数据目录/exports/<项目编号>/<时间>-<类型>/`，导出完可点「在访达中显示」。建议先这样；如果更想直接放到「下载」或桌面，告诉我。
- **放映版遇到出错的页**：现在是提示一下、再点直接去下一页（工作台里会停在那页）。建议保留，上课时不会卡住。
- **从母版新建时的动效**：新项目只有一张空白页，母版的动效代码记在 `series.json` 里给 agent 照着写，不会自动出现在新页面上。建议先这样（直接复制会引用不存在的元素）。
- **PDF 里的文字不能选中**（每页是一张图）。建议先这样；要可选文字需要 Chrome，可以以后做。
