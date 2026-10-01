# 交接 · HANDOFF

每轮结束由当轮 agent 更新。最新的一轮写在最上面。

## 第 1 轮（2026-10-01）：项目格式与仓库初始化 —— 已完成

### 做了什么
- **项目格式 v1**：`schema/project.schema.json`（机器定义）+ `docs/format.md`（说明书）。画板 → 页面 → 元素（文字 / 图片 / 形状 / 分组），每个东西有稳定编号；动效 = 步骤 → 轨道 → 变化，挂在元素编号上，只用相对变化（`{"by": n}` / `{"times": n}`）。
- **示例项目** `examples/sample-deck/`：3 页，覆盖全部要求的动效（依次淡入、点击出现、连续推进、联动平移缩放、跨步骤移动变色、渐变遮罩、multiply 混合、黑白滤镜、多边形裁切），含一个待排版素材、一个随项目存放的字体（Inter，OFL）、一个分组。
- **校验** `npm run validate [项目]`：schema + 9 种语义错误（编号重复、素材/字体文件缺失、引用不存在、动效目标不存在、动效用了绝对值……），通过时列出待排版素材。
- **数据目录**：`workbench.config.json` 的 `dataDir`（默认 `~/Projects/visual-workbench-data`），`npm run init-data` 建 `projects/`、`library/assets/`、`library/fonts/`。已在エイ的电脑上建好。
- **存一版** `npm run save-version -- <项目> -m "备注"`：快照 project.json + assets + fonts 到 `versions/<时间>/`，带 meta.json。
- **复制页面** `npm run copy-pages -- <源项目> <页码> --to <新编号>`：新建项目，只带用到的素材和字体，源项目不动。
- **测试** `npm test`：46 个，全部通过。GitHub Actions 在 push 时跑 `npm test` + `npm run validate`。
- **文档**：`CLAUDE.md` = `AGENTS.md`（agent 规则）、`PLAN.md`（产品基准）、`README.md`（给エイ）、`QUOTA.md`（额度账本）。

### 没做的（都是本轮明确不做的）
- 任何界面、编辑器、本地服务器。
- 从公共素材库取素材的脚本（格式里已定义 `source.type = "library"`，复制规则写在 `docs/format.md` §8.3，脚本留给做界面那一轮）。
- 动效的实际播放（渲染器）。本轮只定义了数据和校验，§9.4「初始可见性」等规则要在渲染时实现。

### 下一轮从哪接
1. 读 `CLAUDE.md`、`docs/format.md`、`PLAN.md`。
2. 第 2 轮建议目标：本地服务器 + 实时连接（监听数据目录里 `project.json` 的变化并推送到页面；页面保存时写回同一份文件）。注意：エイ 的工作台和 agent 同时写同一份文件时要避免互相覆盖，建议"谁最后写谁赢 + 写之前比对 `updatedAt`"。
3. 渲染动效时按 `docs/format.md` §9 实现：步骤顺序、`auto` 衔接、`appear` 初始隐藏、相对变化累加、`scale` 绕元素中心。
4. 示例里 `asset_newpic1` 是待排版素材，可作为"agent 发现待排版素材并排版"的演练。

### 需要エイ拍板的
见本轮报告第 5 节（也整理在下面，附建议）：
- 动效里"变色"用目标颜色（`{"to": "#…"}`）还是相对色相偏移？**建议目标颜色**（已这样实现）。
- 画板预设的网页宽度（电脑 1440、手机 390）是否合适？**建议先这样**，做界面时再调。
- 版本目录名用本地时间（`20261001-233213`）还是备注做文件夹名？**建议时间 + meta.json 里放备注**（已这样实现）。
