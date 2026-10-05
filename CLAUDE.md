# 视觉工作台 · agent 规则

「视觉工作台」只在本地（macOS、Windows）运行。**agent 是设计师，工作台是用户的审稿桌和资料柜**：agent 自由写每一页（HTML + CSS + 可选 JS 动效），并在页面里标出用户可以动的地方；用户（使用者，没有代码背景）在工作台里审稿、放映、导出，只做最低限度的修改（改文案 / 字号、挪动、缩放、改颜色、裁切图片、贴剪贴板图片、整理页面和项目）。她的修改不改页面源码，记在这一页的**修改单**里叠着显示；agent 下一轮先读修改单，把她的意思正式融进设计，再清掉对应条目。设计好坏全由用户判断，工作台不对设计做任何判断或提示。产品基准见 `PLAN.md`，当前状态见 `HANDOFF.md`。

## 目录结构
- `src/`：本地服务（`server.js`）、校验（`validate.js`）、存版与回收（`version.js`）、实时监听（`watch.js`）、系列母版（`master.js`）、旧项目转换（`convert-v2.js`）、导入（`import-html/`）、导出（`export/`）、找浏览器（`browser.js`）、命令行脚本（`cli/`）
- `web/`：工作台界面；`web/page-runtime.js` 是注入每个页面 iframe 的运行时（提供 `vw.motion`、叠修改单、用户修改的交互）；`web/page-frame.js` 是父页面侧的 iframe 桥；`web/edits-model.js`、`web/page-marks.js` 是修改单与页面标记的纯逻辑（Node 也用）；`web/vendor/` 是本地第三方库
- `schema/project.schema.json`：项目格式的机器定义（格式 v3）
- `docs/format.md`：项目格式的文字说明（以最新版为准；`docs/format-v2.md` 只给旧项目转换参考）；`docs/round12-contract.md`：运行时与 iframe 桥的内部约定（改仓库代码时看）
- `examples/sample-deck/`、`examples/sample-web/`：示例项目，照着写
- `desktop/`：桌面应用壳（见 `docs/desktop.md`）
- `test/`：测试（`npm test`）
- 数据目录（以工作台的设置为准，复制给 agent 的文字里会写明，不要假设固定路径）：
  - `projects/<项目编号>/`：`project.json`、`pages/`（每页一个 HTML）、`assets/`、`fonts/`、`versions/`，导入的还有 `import/`，从母版新建的还有 `series.json` 与 `series/`
  - `library/assets/`、`library/fonts/`：公共素材库
  - `exports/<项目编号>/`：导出的放映版 HTML、图片、PDF、交接包
  - `workbench-state.json`：哪些项目是系列母版（用户在界面上标，agent 不改）
- 同级 `codex/`、`gemini/` 是给其他 agent 用的，不要碰

## 常用命令
| 做什么 | 命令 |
|---|---|
| 存一版 | `npm run save-version -- <项目> -m "<说明>"` |
| 校验项目 | `npm run validate -- <项目>` |
| 看修改单 | `npm run edits -- <项目> [--page <页面编号>]` |
| 清修改单 | `npm run edits -- <项目> --clear [--page <页面编号>] [<条目编号>…]` |
| 动效检查（真浏览器逐页跑） | `npm run check-motion -- <项目或导出的 .html>` |
| 旧项目转换（v2 → v3） | `npm run convert -- <项目>` |
| 复制页面到新项目 | `npm run copy-pages -- <源项目> <页码> --to <新编号>` |
| 导出 | `npm run export -- <项目> [--html \| --images \| --pdf \| --all]` |
| 交接包（改动清单 + 对比图） | `npm run export-changes -- <项目> [--out <目录>]` |

动效检查和导出图片 / PDF 要用浏览器：自动找当前系统安装的 Chrome、Edge，再找 Playwright 自带 Chromium；都没有时会给中文提示。

## 改项目前，必须依次做
1. 读最新的 `docs/format.md` 和 `schema/project.schema.json`，不要凭记忆。
2. 读最新的 `project.json` 和要改的页面文件；用 `npm run edits -- <项目>` 看修改单（用户可能刚改过）。从母版新建的项目先读 `series.json`。
3. 运行 `npm run save-version -- <项目> -m "<本轮说明>"` 存一版。

## 分工
- **agent 写页面**：`pages/<页面编号>.html` 是完整的 HTML 文档，样式、脚本、库随意（库复制进 `assets/`，用 `../assets/x.js` 引用；不引用网络地址）。课件项目 `<body>` 就是画板（尺寸由工作台按 `artboard` 注入，不用自己设）；网页项目宽 = 设备窗口宽、高随内容。页面始终在隔离的 iframe 里显示，不要依赖 `window.parent`。
- **agent 标出用户可以动的地方**：`data-vw-id="<稳定编号>" data-vw="<能力>"`，能力有 `text`（改文案和字号，行内加粗变色会保留）、`move`、`resize`、`color`（文字颜色）、`background`（底色）、`crop`（只对 `<img>`）。编号一页内唯一，改版面时不要改编号。装饰、结构、形状不标。
- **用户只做**：改文案 / 字号；已有元素的位置、大小、颜色；图片裁切；贴剪贴板图片（记为 `addImage`，编号 `u_` 开头）；页面排序、加页、复制页、跨项目复制页、项目整理。她不会改形状，形状、装饰、排版结构全由 agent 改。
- **修改单**在 `project.json` 的 `pages[].edits`（见 `docs/format.md` §7）。工作台只写修改单不碰页面文件；agent 不手写修改单，只用 `npm run edits` 看和清。
- **agent 处理修改单的做法**：读每条（含标「对不上」的：目标编号已不存在或能力已收回），把用户的意思正式写进页面（例如她把标题拖大了，就顺手调和周围；她贴了一张图，就把图正式排进版面并把素材留在 `assets/`），然后 `--clear` 清掉已处理的条目。清掉以后页面按源码显示，所以先改页面再清。
- 局部加粗、变色由 agent 写在页面里（`<b>`、`<span style="color:…">` 等），用户只改字。
- 素材、字体一律复制进项目自己的 `assets/`、`fonts/` 并登记，不跨项目引用。从素材库取用、或从别的项目复制页面，都是复制一份。

## 动效
- 页面里用 `vw.motion({ init, step, leave, dispose })` 登记（`docs/format.md` §6）；`project.json` 的 `motion.steps` 是点击次数的唯一依据，`steps > 0` 必须有 `step`。没有动效的页面省略 `motion`。
- 动效从用户修改后的状态出发（修改单在 `init` 前已叠上），不要写死坐标。往回翻页会快进：优先用 `ctx.animate` / `ctx.timer` / Web Animations；用库自带计时的，快进只能按真实时长等。
- 换页效果写在 `leave(ctx, { direction })`，不再有跨页的 `transition`。
- 工作台自己不生成任何动效；编辑画布只显示静态页面，缩略图不跑脚本。
- 第三方库的计时器、动画在 `dispose` 或 `ctx.signal` 里清理。

## 网页项目
- `kind: "web"`，每页有 `device`（desktop 1440×900 窗口 / mobile 390×844 窗口）和 `size`（整页高度 = 内容长度）；同一个网页可以有电脑端、手机端两页。
- 导入网页（本地文件 / 文件夹 / 压缩包，或网址）得到的页面保留了原来的 HTML、CSS 和动画，文字和图片已自动标好 `data-vw`，每个标记带 `data-vw-origin`（原网页里的 CSS 选择器）。原文件在 `import/` 只读。
- **agent 拿到交接包（改动清单）后怎么改网站**：清单就是修改单。按页、按目标：用 `data-vw-origin` 的选择器定位到真正的网站代码；`move` 的 dx/dy、`resize` 的宽高是页面 CSS 像素，按原网页的布局方式换算（流式布局的改 margin / 宽度，绝对定位的直接改坐标）；颜色、字号按精确值；文字按改后的 HTML（保留行内格式）；`addImage` 的图片在交接包里；改完对照 `compare/` 里的对比图检查。只改清单列出的目标和属性，不碰没列出的内容，不改 `import/` 里的任何文件。工作台不会把改动自动回写进网站代码。

## 旧项目与旧 HTML
- 格式 v2 的项目第一次被工作台打开时会先自动存版、再转换成 v3（每个元素变成绝对定位的 HTML，文字、图片已标好；原 `motion.source` 通过兼容层照搬，`transition` 换页效果搬不了，写在该页 `notes`）。也可以 `npm run convert -- <项目>`。转换失败的项目原样不动并给中文说明。转换后 agent 可以把页面改写成更自然的 HTML，但保留 `data-vw-id`。
- 项目文件夹里有 `import/` 的是导入来的，原文件只读参考；每页 `notes` 是迁移说明。用户要求「按原 HTML 重写动效」时，读 `import/` 里的原文件，用 `vw.motion` 重写。

## 两台电脑与数据目录
- 配置优先级：`--data-dir` > `VW_DATA_DIR` > 用户主目录 `.visual-workbench/config.json` > 仓库 `workbench.config.json`。总览「数据文件夹」显示实际路径和来源。
- Google Drive 仅作普通本地同步文件夹。切换电脑前关闭工作台并等同步完成。不要自动移动用户数据或改现有设置。
- `.workbench-sessions/` 是工作台的使用标记，每 15 秒更新，90 秒未更新算过期；看到新鲜标记先要求确认。agent 不能自行删标记绕过。
- 打开项目会列出疑似同步冲突副本。先核对双方，不自动删除或合并。

## 工作台开着时改文件
- 直接改项目文件夹里的文件（`project.json`、`pages/*.html`、`assets/`），界面会自动刷新。
- 用户可能同时在界面上改同一个项目：每次动手前重新读 `project.json`，只改你要改的地方，写回完整文件；`pages[].edits` 是她的，不要手改。两边改了同一处时界面保留用户的并提示她。
- 用户可以在界面上撤销你的修改，也可以退回到任何一个版本；动手前照旧 `npm run save-version`。

## 参考别的项目（点名参考）
- 引用长这样：`项目 autumn-deck · 第 3 页（page_intro） · title`：项目编号 · 页码（括号里是页面编号）· 页面里的 `data-vw-id`（可以没有，多个用「、」分隔）。先按页面编号在 `pages` 里找，再读对应的页面文件。
- 被参考的项目**只读**：不改它的任何文件，不对它存版。要用它的素材、字体或写法：复制一份到你正在做的项目里。整页照搬用 `npm run copy-pages`。

## 系列母版
- 用户把一个项目标为「系列母版」后，新建项目可以「从母版开始」。新项目里已经有：母版的画板尺寸、第 1 页的副本（作为起始页）、全部字体、来自公共素材库的素材，以及 `series.json`（`master`、`palette` 常用颜色、`pages` 母版各页清单）和 `series/pages/` 里母版各页 HTML 的只读副本。做新页面时照这些页面的写法改写，保持系列一致。
- 母版和新项目互不影响；哪些项目是母版记在 `workbench-state.json` 的 `masters` 里，agent 不改。

## 版本
- 存版按内容去重（`versions/.objects/`）；用户可以在版本列表里删除版本。agent 不要手动删 `versions/` 里的东西。

## 工作台界面代码约定（改 `web/` 时）
- 页面只通过 `web/page-frame.js` 显示（编辑、放映、缩略图、导出、动效检查五处一致），父页面绝不读写 iframe 的 `contentDocument`；运行时 `web/page-runtime.js` 必须保持自包含（无 import / export）。
- 编辑后只做增量刷新：数据变了调用 `updateEditor()`；`renderEditor()` 只用于打开项目这类换画面。
- 保存要安静：`#save-status` 给读屏和测试读。
- 选择习惯三处统一（页面区、项目总览、画布内）：点空白取消、拖框多选、Shift 加选、Esc 逐层取消。
- 工作台不对设计做任何判断、提示或自动调整；视觉风格不改，新控件沿用玻璃组件。

## 测试与本机配置隔离
- 测试只使用临时数据目录和临时用户主目录（`test/helpers/isolated-server.js`、`temporary-home.js`），不得读写真实 `~/.visual-workbench/config.json`。
- 仓库已公开，GitHub Actions 在推送和 PR 时自动运行：macOS、Ubuntu 跑全部测试；Windows 通过 `node scripts/test-windows.js` 跑清单内的测试。公开仓库里不得出现密钥、令牌、真实项目内容。

## 改完必须做
- `npm run validate -- <项目>` 和 `npm run check-motion -- <项目>` 都通过；处理过的修改单条目已清。
- 改了仓库代码（`src/`、`schema/`、`web/`、`desktop/`、`test/` 等），`npm test` 也必须通过。

## 禁止
- 不接云端服务，不做账号体系，不做工作台内置 AI 对话框，不做固定动效种类，工作台不生成动效。
- 导出的文件不能依赖网络（页面里不引用网络字体、CDN、外部链接）。
- 不执行 `git add -A` 或 `git add .`，只逐个文件 `git add <文件>`。
- 用户数据（数据目录里的项目、素材、字体、版本、导出）永远不进 git。
- 不自行获取、猜测或索取凭据。

## 交接
- 每轮结束重写 `HANDOFF.md`（当前状态：做了什么、没做什么、下一步、需要用户决定的事），不是追加流水账。
- 在 `QUOTA.md` 记一行本轮用量。
