# 视觉工作台 · agent 规则

「视觉工作台」只在本地（macOS）运行：agent 按固定格式生成设计（课件、海报、网页等）并写动效，エイ（使用者，没有代码背景）在工作台里微调、放映、导出，agent 再在她改过的基础上继续做。双方读写同一份 `project.json`。产品基准见 `PLAN.md`，当前状态见 `HANDOFF.md`。

## 目录结构
- `src/`：本地服务（`server.js`）、校验、存版与回收（`version.js`）、实时监听（`watch.js`）、系列母版（`master.js`）、导出（`export/`）、找浏览器（`browser.js`）、命令行脚本（`cli/`）
- `web/`：工作台界面（编辑器、放映、动效运行与检查）；`web/vendor/` 是本地第三方库
- `schema/project.schema.json`：项目格式的机器定义（格式 v2）
- `docs/format.md`：项目格式的文字说明（以最新版为准）
- `examples/sample-deck/`：示例项目，照着写
- `test/`：测试（`npm test`）
- 数据目录（默认 `~/Projects/visual-workbench-data`，可在 `workbench.config.json` 改）：
  - `projects/<项目编号>/`：`project.json`、`assets/`、`fonts/`、`versions/`，从母版新建的还有 `series.json`，agent 也可以放动效用的附属文件
  - `library/assets/`、`library/fonts/`：公共素材库
  - `exports/<项目编号>/`：导出的放映版 HTML、图片、PDF
  - `workbench-state.json`：哪些项目是系列母版（エイ 在界面上标，agent 不改）
- 同级 `codex/`、`gemini/` 是给其他 agent 用的，不要碰

## 常用命令
| 做什么 | 命令 |
|---|---|
| 存一版 | `npm run save-version -- <项目> -m "<说明>"` |
| 校验项目 | `npm run validate -- <项目>` |
| 动效检查（真浏览器逐页跑） | `npm run check-motion -- <项目或导出的 .html>` |
| 复制页面到新项目 | `npm run copy-pages -- <源项目> <页码> --to <新编号>` |
| 导出 | `npm run export -- <项目> [--html \| --images \| --pdf \| --all]` |

动效检查和导出图片 / PDF 要用浏览器：自动按 Mac 上的 Chrome → Edge → Playwright 自带 Chromium → WebKit（Safari 内核）顺序找；都没有时会给中文提示，照提示装 Chrome 或运行 `npx playwright install chromium`。

## 改项目文件前，必须依次做
1. 读最新的 `docs/format.md` 和 `schema/project.schema.json`，不要凭记忆。
2. 读最新的 `project.json`。エイ 可能刚改过，不要用记忆里的旧版。从母版新建的项目，先读 `series.json`（见下文「系列母版」）。
3. 运行 `npm run save-version -- <项目> -m "<本轮说明>"` 存一版。

## 分工
- エイ 只改位置、大小、文字、颜色、字体、层级，以及加图片素材。她调过的这些内容，除非她要求，一律不改。
- 动效和换页全部由 agent 写，エイ 不碰。
- 素材里 `pendingLayout: true` 表示「待排版」：把它排进页面后，改为 `false`。
- 素材、字体一律复制进项目自己的 `assets/`、`fonts/`，不跨项目引用。从素材库取用、或从别的项目复制页面，都是复制一份。

## 动效写法
- 每页在 `motion.source` 里内嵌自由编写的 JavaScript ES module；`motion.steps` 是点击推进次数。默认导出 `async function(ctx)`，返回可选的 `step(index)`、`transition({from,to,direction})`、`dispose()`；`steps > 0` 时必须有 `step`。没有动效的页面省略 `motion`。接口细节见 `docs/format.md` §9。
- 没有固定的动效种类，旧版（格式 v1）的 `page.steps` / 轨道 / `{"by": n}` 写法已经取消，不要再写。
- 每次放映从最新项目文件取 `ctx.element(id).base` 和放映节点 `node`。按元素当前的位置、大小、文字、颜色、字体、层级计算动效，不在代码里写死这些值，也不回写项目文件。エイ 挪动或修改元素后，动效照样从新状态出发。
- 编辑器只显示静止状态；动效与换页只在放映、「预览动效」、动效检查和导出时运行。导出图片 / PDF 用的是每页动效全部播完后的最终画面，所以最后一步要停在想展示的样子。
- 用库：`await ctx.importModule('/vendor/xxx.js')` 加载 `web/vendor/` 里的本地库，不用网络地址。导出放映版 HTML 时，这种写成字面量的路径会被自动打包进文件；拼接出来的路径打包不到。
- エイ 删除了动效引用的元素后，要修正源码；复制元素不会自动复制动效。
- 第三方库的计时器、动画在 `dispose` 或 `ctx.signal` 里清理。

## 工作台开着时改文件
- 直接改项目文件夹里的文件即可，界面会自动刷新，不用让エイ 手动刷新。
- エイ 可能同时在界面上改同一个项目：每次动手前重新读一遍 `project.json`，只改你要改的地方，写回完整文件。不要用很久以前读到的内容整份覆盖。
- 两边改了同一个元素的同一个属性时，界面保留エイ 的并提示她；`motion` 例外，按 agent 的整段保留（不会把两份代码拼在一起）。所以不要去改她刚调过的位置、大小、文字、颜色、字体、层级，除非她要求。
- エイ 可以在界面上撤销你的修改，也可以退回到任何一个版本；动手前照旧先 `npm run save-version`。

## 参考别的项目（点名参考）
- エイ 给的引用长这样：`项目 autumn-deck · 第 3 页（page_intro） · el_title`。含义：项目编号 · 页码（括号里是页面编号）· 元素编号（可以没有，也可以有多个，用「、」分隔）。一行一条。
- 找法：打开 `<数据目录>/projects/<项目编号>/project.json`，**先按括号里的页面编号**在 `pages` 里找（页码会因为增删页而变，对不上时以页面编号为准），再在该页的 `elements`（含分组的 `children`）里按元素编号找。
- 被参考的项目**只读**：不改它的 `project.json`，不改、不删、不移动它文件夹里的任何文件，也不对它执行存版。
- 要用它的素材、字体或动效代码：**复制一份**到你正在做的项目里再登记，不能在项目文件里写指向别的项目的路径。整页照搬用 `npm run copy-pages`。
- 参考的是做法（版式、配色、动效写法），不是让两个项目共用东西；改完后两个项目互不影响。

## 系列母版
- 一个项目被エイ 标为「系列母版」后，她新建项目时可以选「从母版开始」。新项目里已经有：母版的画板尺寸、第 1 页背景、全部字体、来自公共素材库的素材、母版文件夹里的附属文件，以及 `series.json`。页面只有一张空白起始页。
- 开工先读 `series.json`：`master` 是母版的项目编号；`palette` 是母版用过的颜色（按使用次数从多到少），颜色优先从这里取，字体用项目里已登记的；`motions` 是母版各页的动效代码原文，做新页面时照这个写法改写（元素编号换成新页面的），保持系列一致。
- 想看母版的版式，按「参考别的项目」的规则只读地去读母版，不要改母版。
- 母版和新项目互不影响：改新项目不会动母版；母版后来改了，也不会自动同步到已经建好的项目。エイ 想同步时会明确说。
- 哪些项目是母版记在 `<数据目录>/workbench-state.json` 的 `masters` 里。agent 不要自己改这个文件。

## 版本
- 存版按内容去重（`versions/.objects/` 里同样的文件只存一份）。エイ 可以在版本列表里删除版本；「退回前自动存档」只保留最近 10 条。删版本后，不再被任何版本用到的文件会被清掉。
- agent 不要手动删 `versions/` 里的东西，也不要改 `.objects/`。

## 改完必须做
- `npm run validate -- <项目>` 和 `npm run check-motion -- <项目>` 都通过，才算完成；动效检查会实际运行每页的模块、步骤及换页。
- 如果改了仓库代码（`src/`、`schema/`、`web/`、`test/` 等），`npm test` 也必须通过。

## 禁止
- 不接云端服务，不做账号体系，不做工作台内置 AI 对话框，不做固定动效种类。
- 导出的文件不能依赖网络（不引用网络字体、CDN、外部链接）。
- 不执行 `git add -A` 或 `git add .`，只逐个文件 `git add <文件>`。
- 用户数据（数据目录里的项目、素材、字体、版本、导出）永远不进 git。
- 不自行获取、猜测或索取凭据（密钥、令牌、密码）。

## 交接
- 每轮结束重写 `HANDOFF.md`（当前状态：做了什么、没做什么、下一步、需要エイ 决定的事），不是追加流水账。
- 在 `QUOTA.md` 记一行本轮用量。
