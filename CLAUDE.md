# 视觉工作台 · agent 规则

「视觉工作台」只在本地（macOS）运行：agent 按固定格式生成设计（课件、海报、网页等），エイ（使用者，没有代码背景）在工作台里微调，agent 再在她改过的基础上继续做。双方读写同一份 `project.json`。产品基准见 `PLAN.md`。

## 目录结构
- `src/`：校验与命令行脚本（`validate`、`init-data`、`save-version`、`copy-pages`）
- `schema/project.schema.json`：项目格式的机器定义
- `docs/format.md`：项目格式的文字说明（以最新版为准）
- `examples/sample-deck/`：示例项目，照着写
- `test/`：测试（`npm test`）
- 数据目录（默认 `~/Projects/visual-workbench-data`，可在 `workbench.config.json` 改）：`projects/<项目编号>/`（`project.json`、`assets/`、`fonts/`、`versions/`）、`library/assets/`、`library/fonts/`（公共素材库）
- 同级 `codex/`、`gemini/` 是给其他 agent 用的，不要碰

## 改项目文件前，必须依次做
1. 读最新的 `docs/format.md` 和 `schema/project.schema.json`，不要凭记忆。
2. 读最新的 `project.json`。エイ 可能刚改过，不要用记忆里的旧版。
3. 运行 `npm run save-version -- <项目> -m "<本轮说明>"` 存一版。

## 改动规则
- 每页可在 `motion.source` 内嵌自由编写的 JavaScript ES module；`motion.steps` 是点击推进次数。默认导出 `async function(ctx)`，返回可选的 `step(index)`、`transition({from,to,direction})`、`dispose()`；`steps > 0` 时必须有 `step`。接口细节见 `docs/format.md` §9。
- 每次放映从最新项目文件取得 `ctx.element(id).base` 和放映 DOM `node`。根据当前元素的位置、大小、文字、颜色、字体、层级计算动效，不在代码里写死这些值，也不回写编辑数据。エイ 挪动或修改元素后，动效仍从新状态出发。
- 编辑器只显示项目文件的静止状态；动效与换页效果只在放映或检查时运行。删除被动效引用的元素后须修正源码；复制元素不会自动复制动效。
- エイ 只改位置、大小、文字、颜色、字体、层级，以及加图片素材。她调过的这些内容，除非她要求，一律不改。
- 动效全部由 agent 写，エイ 不碰。
- 素材里 `pendingLayout: true` 表示「待排版」：把它排进页面后，改为 `false`。
- 素材、字体一律复制进项目自己的 `assets/`、`fonts/`，不跨项目引用。从素材库取用、或从别的项目复制页面（`npm run copy-pages -- <源项目> <页码> --to <新编号>`），都是复制一份。

## 改完必须做
- `npm run validate -- <项目>` 和 `npm run check-motion -- <项目>` 都通过，才算完成；动效检查会实际运行每页的模块、步骤及换页。
- 如果改了仓库代码（`src/`、`schema/`、`test/` 等），`npm test` 也必须通过。

## 禁止
- 不接云端服务，不做账号体系，不做工作台内置 AI 对话框，不做固定动效种类。
- 不执行 `git add -A` 或 `git add .`，只逐个文件 `git add <文件>`。
- 用户数据（数据目录里的项目、素材、字体、版本）永远不进 git。
- 不自行获取、猜测或索取凭据（密钥、令牌、密码）。

## 交接
- 在 `QUOTA.md` 记一行本轮用量。
