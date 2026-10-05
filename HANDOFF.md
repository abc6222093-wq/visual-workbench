# 当前移交 · 第 13 轮（整理和复用）

分支 `claude/round13-organize`（基于已合并第 12 轮的 `main` 531390c；**没有合并进 main**，等用户验收后统筹窗口安排）。规则见 `CLAUDE.md`（= `AGENTS.md`），格式见 `docs/format.md`（v3，本轮加 §15–§19），内部约定见 `docs/round12-contract.md` 和 `docs/round13-contract.md`（§14 是做完后的最终形状），桌面应用见 `docs/desktop.md`。

## 本轮做了什么
- **第 12 轮验收没通过的两处 + 一处遗留**：
  - 0a「第 N 屏」一定看得见：屏按钮挪到画布下方一排大标签；没写 `motion.steps` 但有 `vw.motion` 的页由工作台在隐藏 iframe 里快进数出屏数并提醒「请 agent 在 project.json 写上 motion.steps」；只有页面自带动画、没有分屏的页写一句说明；页面栏显示「N 屏」。用户以前看不到的原因：她的两个项目（44 页导入的旧 HTML、11 页 v2 课件）没有任何页写 `steps`、也没有页用 `vw.motion`，旧 HTML 的动画是页面自己的 CSS / JS 动画，而旧按钮只在 `steps ≥ 1` 时出现，且在工具条里很小。
  - 0b 文字：第一下点击选中整个文字框（框 + 把手，按住就拖、方向键微调），已选中再点一下（或双击）才出光标；改字期间手感不变。
  - 0c 放映预加载的下一页用 `hold` 启动，翻过去才跑 `init`，入场动画从头播；导出的放映版同样。
- **草稿分页**（`web/draft-model.js` 纯逻辑 + `src/drafts.js` + `web/drafts.js`）：从文案新建 / 添加草稿页 / 拖入 .md .txt；草稿页 = 工作台生成并改写的页面文件（`draft: true`）；画布上像 Word 一样改、层级下拉、Cmd+Enter 分页、合并、属性栏「文字超出页面 N px」；「复制给 agent → 请设计」。
- **拼页 + 统一风格**：「添加页面 → 从其他项目…」；跨项目复制写 `origin.project / page / copiedAt`；「复制给 agent → 请统一风格」附本项目设计卡片。
- **设计卡片**：总览图标 + 弹窗 + 「复制给 agent」；规则文档写明每次做完设计必写；示例项目已有一张。
- **文件夹与命名**：`workbench-state.json` 的 `folders`；总览新建 / 重命名 / 删除 / 拖放 / 右键移到… / 面包屑；`npm run organize`（begin / list / folder / move / rename / restore）+ `organize-backup.json` + 总览「退回整理前」；「复制给 agent → 请整理文件夹」。
- **批注**：`pages[].annotations`，画布工具条「批注」拖框写字，只在编辑画布显示（导出文件的内嵌项目数据也去掉了 annotations）；`npm run annotations`；三种 brief 每页末尾列批注。
- **拖进来导入**：总览拖 HTML / 文件夹 / zip 直接导入成新项目；编辑器页面栏拖入或右键「导入为页面…」插进当前项目（原文件进 `import/<时间>/`）。
- **本地常用字体库**：`src/fonts/catalog.js` 五套官方直链（简体是 Adobe 仓库的 CN 文件）；`npm run fonts -- install / status`；已经装进用户的数据目录 `library/fonts/`（62 MB，含许可证，清单 `fonts.json`）；编辑画布 / 放映页 / 导出渲染页注入同名字族的完整字体（Chromium 分段回退，实测字集外的字落到完整字体）；导出放映版按最终文字子集化嵌入；「数据文件夹」弹窗显示字体库状态。
- 文档：PLAN（路线图、「整理和复用」一节）、CLAUDE/AGENTS、README、format.md、两份内部约定、import-html.md。
- 桌面应用已重新制作并安装（0.2.0，壳没变），`--smoke` 通过；真机验证脚本 60 项全部正常。

## 已知限制与未做
- 草稿页的「分页」「合并」不进撤销历史（撤销只管页内文字）；正在保存草稿时同时改页名，页名可能被服务端返回覆盖（`pagesOp` 原有问题）。
- 「导入为页面」不支持网址来源（界面没给入口，服务端支持）。
- 放映时 `motion.steps` 缺失的页仍按 0 步放映（数屏只用于编辑画布和提醒）；要分屏放映请 agent 写上 steps。
- 字体回退：多字符串开着 kerning 时宽度比完整字体约宽 1%。
- 在文件夹里点「新建项目」，新项目不会自动放进当前文件夹。
- 画布上的层（草稿 / 批注）刚出现的一两帧里点击会被送进下面的隔离 iframe（真人操作碰不到，测试里等两帧）。
- Windows 电脑本轮不更新。

## 下一步
- 用户在 Mac 上验收（程序坞里的「视觉工作台」已是新版），统筹窗口决定何时合并进 main、何时更新 Windows。
- 第 14 轮按 PLAN：印刷版和线上版两种导出、PPTX 导出。

## 需要用户决定
- 放映时要不要也用工作台数出的屏数（现在只在编辑画布用，放映按 agent 写的 steps）。建议：不用，让 agent 写上 steps 更稳。
- 草稿页「分页 / 合并」要不要进撤销。建议：第 14 轮顺手做。
