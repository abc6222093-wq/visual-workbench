# 第 13 轮内部约定：整理和复用

给改仓库代码的 agent 看。第 12 轮的约定（运行时、iframe 桥、放映壳）见 `docs/round12-contract.md`，本文件只写第 13 轮新增 / 改动的部分。格式见 `docs/format.md`（v3，本轮加了 `draft`、`annotations`、`origin.project`、文件夹与设计卡片的用法）。

## 0. 本轮做什么（对应任务表）
| # | 事 | 主要文件 | 组 |
|---|---|---|---|
| 0a | 「第 N 屏」一定看得见：画布下方一排标签；没写 `steps` 的页由工作台数出屏数；页面栏显示「N 屏」 | `web/app.js`、`web/page-runtime.js`、`web/page-frame.js` | B + A |
| 0b | 文字：第一下点击选中整个文字框（可拖、可方向键），再点一下（或双击）才出光标 | `web/page-runtime.js` | A |
| 0c | 放映预加载的下一页，翻过去时入场动画才开始 | `web/page-runtime.js`、`web/page-frame.js`、`web/playback.js` | A |
| 1 | 草稿分页 | `web/draft-model.js`（主智能体）、`src/server.js`、`web/app.js`、`web/drafts.js`、`web/home.js` | C + B + H |
| 2 | 从其他项目添加页面 + 「请统一风格」 | `web/add-pages.js`、`web/app.js`、`src/copy-pages.js`、`src/brief.js` | B + C |
| 3 | 设计卡片 | `web/home.js`、`src/brief.js` | H + C |
| 4 | 文件夹与命名、「请整理文件夹」、`npm run organize` | `src/folders.js`、`src/cli/organize.js`、`src/server.js`、`web/home.js` | C + H |
| 5 | 批注 | `web/annotations.js`、`web/app.js`、`src/cli/annotations.js`、`src/brief.js` | B + C |
| 6 | 拖进来导入 | `web/import-html.js`、`src/import-html/jobs.js`、`web/home.js`、`web/app.js` | E + H + B |
| 7 | 本地常用字体库 | `src/fonts/*`、`src/cli/fonts.js`、`src/export/html.js`、`web/page-frame.js`、`web/runtime-settings.js` | D + A |

## 1. 文件分工（子智能体之间不改同一文件；共用文件只由主智能体改）
| 组 | 文件 |
|---|---|
| **A 运行时与放映** | `web/page-runtime.js`、`web/page-frame.js`、`web/playback.js`、`web/player.js`、`web/motion-check.js`、`test/round12-runtime-*.test.js`、`test/round12-playback.test.js`、`test/round12-fix-runtime-*.test.js`、`test/round12-fix-playback-reveal.test.js`、`test/round12-fix-editor-contextmenu.test.js`、`test/round12-fix-editor-glass.test.js`、`test/round12-fix-import-text-move.test.js`、新 `test/round13-runtime-*.test.js` |
| **B 编辑器界面** | `web/app.js`、`web/style.css`、`web/page-views.js`、`web/page-views.css`、`web/page-items.js`、`web/page-operations.js`、新 `web/drafts.js`、`web/annotations.js`、`web/add-pages.js`、`web/brief-menu.js`（可选）、`test/round12-editor-*.test.js`、`test/round12-fix-editor-screens.test.js`、`test/round9-pages.test.js`、`test/round9-smooth.test.js`、`test/page-views.test.js`、`test/page-operations.test.js`、新 `test/round13-editor-*.test.js` |
| **C 服务与命令行** | `src/server.js`、`src/brief.js`、`src/copy-pages.js`、`src/validate.js`、`src/project-management.js`、`src/master.js`、新 `src/folders.js`、`src/drafts.js`、`src/annotations.js`、`src/cli/organize.js`、`src/cli/annotations.js`、`src/cli/drafts.js`、`package.json` 的 scripts、`test/server*.test.js`、`test/round12-server-pages.test.js`、`test/brief.test.js`、`test/copy-pages.test.js`、`test/project-management.test.js`、新 `test/round13-server-*.test.js`、`test/round13-cli-*.test.js` |
| **D 字体库** | `src/fonts/catalog.js`、`src/fonts/library.js`（主智能体留了桩）、`src/cli/fonts.js`、`src/export/html.js`、`src/export/inline-page.js`、`web/runtime-settings.js`、`test/round12-export-html.test.js`、新 `test/round13-fonts-*.test.js` |
| **E 导入** | `src/import-html/*`、`web/import-html.js`、`web/import-html.css`、`docs/import-html.md`、`test/round12-import*.test.js`、`test/round10-import.test.js`、`test/round12-fix-import-blocks.test.js`、新 `test/round13-import-*.test.js` |
| **H 总览** | `web/home.js`、`web/home-selection.js`、`web/home-selection.css`、`web/project-management.js`、`web/project-management.css`、新 `web/folders.js`、`web/design-card.js`、`test/round9-home.test.js`、`test/project-management-ui.test.js`、`test/two-devices-ui.test.js`、`test/round6b-sidebar.test.js`、新 `test/round13-home-*.test.js` |
| **主智能体** | `schema/`、`docs/*.md`、`web/draft-model.js`、`web/edits-model.js`、`web/page-marks.js`、`web/project-kinds.js`、`web/index.html`、`PLAN.md`、`CLAUDE.md` / `AGENTS.md`、`README.md`、`HANDOFF.md`、`QUOTA.md`、`desktop/`、`examples/` |

需要别组改东西：在报告里写清楚要什么，不要自己改别组的文件。`web/index.html` 要加样式表或脚本时也写进报告，主智能体加。

## 2. 格式新增（schema 已改，主智能体负责）
- 页面 `draft: true`：草稿页（工作台生成和改写的页面文件；agent 设计完去掉这个标记）。草稿页文件的结构见 §5。
- 页面 `annotations: [{ id: "an_<8 位>", x, y, width, height, text, at }]`：批注，页面 CSS 像素；只在编辑画布上显示，不进放映 / 导出 / 缩略图。
- 页面 `origin` 加 `project`、`page`、`copiedAt`：从别的项目拼进来的页（`copyPagesInto` 跨项目复制时写上；同项目复制不写）。
- 项目 `folder`（已有）：所在文件夹名（一层，不嵌套）；`designCard`（已有）加可选 `at`。
- 数据目录 `workbench-state.json`：`masters`（已有）、`folders: ["名字", …]`（空文件夹也在这里）。
- 数据目录 `organize-backup.json`：整理前的原状 `{ at, folders: [...], projects: { <id>: { name, folder } } }`，退回用。
- 数据目录 `library/fonts/fonts.json`：字体库清单（见 §9）。

## 3. 服务端接口（C 实现；B / H / E 按此写界面）
已有的接口不变。新增 / 扩展：

| 方法 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `GET /api/projects` | — | 每项加 `folder`、`designCard`（有就带）、`drafts`（草稿页数） | 总览用 |
| `PATCH /api/projects/:id` | `{ name?, folder?, revision? }` | `{ project, revision }` | `folder` 为 `""` 表示移出文件夹；文件夹不存在则自动登记 |
| `GET /api/folders` | — | `{ folders: [{ name, count }], backup: { at } \| null }` | `count` 是文件夹里的项目数 |
| `POST /api/folders` | `{ name }` | `{ folders }` | 名字去首尾空白、≤ 60 字、不能含 `/` `\`、不能重名 |
| `PATCH /api/folders/:name` | `{ name }` | `{ folders }` | 重命名，里面的项目一起改 `folder` |
| `DELETE /api/folders/:name` | — | `{ folders }` | 删文件夹，里面的项目移到根（项目不删） |
| `POST /api/organize/backup` | — | `{ at }` | 记录原状（覆盖旧备份） |
| `POST /api/organize/restore` | — | `{ restored: n }` | 按备份恢复每个项目的 `name`、`folder` 和文件夹列表，然后删掉备份 |
| `GET /api/organize` | — | `{ backup: { at } \| null }` | |
| `POST /api/projects` | 加 `{ draft: "文案全文", name? }` | 加 `draft: { method, pages, note }` | 从文案新建：名称取 `#` 标题，没有就用 `name`；`method` 是 `marked`（有记号）或 `plain`（普通文字按空行和字数分）；`note` 是给用户看的一句话（怎么分的） |
| `POST /api/projects/:id/pages` | `op: "draft"`，`{ text, after, revision }` | 同其他 op，加 `draft` | 把文案分成草稿页插到 `after` 后面 |
| | `op: "draft-update"`，`{ pageId, blocks, revision }` | | 用户改了草稿：按 `blocks` 重写页面文件 |
| | `op: "draft-split"`，`{ pageId, blocksBefore, blocksAfter, revision }` | 新页 id 在 `pageIds` | 光标处分页：本页改成 `blocksBefore`，新草稿页（名字 `<本页名>（续）`，`notes` 为空）插在后面放 `blocksAfter` |
| | `op: "draft-merge"`，`{ pageId, revision }` | | 和下一页合并（下一页必须也是草稿）：块接在后面、notes 拼接、删下一页 |
| `GET /api/projects/:id/brief?intent=edits\|design\|unify&pageIds=…` | — | `{ text, filePath }` | `edits`（默认，原有的）；`design`：请设计草稿页；`unify`：请统一风格（拼进来的页）。见 §7 |
| `GET /api/brief/organize` | — | `{ text }` | 「请整理文件夹」的开场白 |
| `GET /api/fonts` | — | `{ dir, families: [...] }` | 字体库清单（D 的 `src/fonts/library.js` 提供 `fontsApi(dataDir)`，C 在 server 里挂上） |
| `GET /data/library/fonts/<路径>` | — | 文件 | 字体库文件，带 `Access-Control-Allow-Origin: *`（页面 iframe 是 null 源） |
| `POST /api/import-html/jobs` | 加 `{ intoProject, after }` | `jobId` | 导入成页面插进已有项目（E 实现，见 §8） |

草稿页的页面文件由服务端写（`src/drafts.js` 调 `web/draft-model.js`），写完 `watcher.noteSelfWrite`，和 `pageOperation` 的其他 op 一样走 `saveProject`。

## 4. 运行时与 iframe 桥（A）
### 4.1 0b 选中优先（edit 模式，带 `text` 的元素）
- 悬停：2px 框 + 指针 `move`（有 `move` 能力）；没有 `move` 的文字悬停指针为默认箭头。
- **第一下按下**（元素还没选中）：选中整个文字框（框 + 把手），按住拖就是移动（有 `move`），方向键微调。不出光标。
- **已选中时再点一下**（按下并松开、没有拖动）：在点的位置出光标，进入改字（`editing: true`）。**双击**未选中的文字：选中并进入改字（浏览器照常选词）。选中后按 Enter：进入改字并全选（已有）。
- 改字期间：框里点击放光标 / 拖选；框外那一圈（6px）仍可拖动（已有 `edgeTarget` 的改字分支）；点元素外面或 Esc 退出改字，回到「选中」状态；再按 Esc 取消选中（父页面已处理）。
- 改字的其他手感不变：原生选区、双击选词、三击选段、Shift+方向键、Cmd/Ctrl+A 只选本元素、回车 `<br>`、粘贴纯文字、输入法、退出不重建节点、右键原生菜单。
- 没有 `text` 的元素行为不变（点哪都拖、双击图片裁切）。
- `nearEdge` / `edgeTarget` 对未选中的文字不再是进入拖动的唯一入口（整块都能拖）；代码可以保留给改字中的那一圈。
- 旧测试里「单击文字直接出光标」的断言要相应改成「第一下选中、第二下出光标」，逐条列进报告。

### 4.2 0c 预加载不提前跑 init
- boot 参数加 `hold: true`：运行时文档加载完、修改单叠完后只报 `loaded`，**不跑** `startPlay()`，等父页面发 `{ vw: 'start' }` 再跑（之后照常报 `ready`）。
- `createPageFrame` 加 `hold` 选项和 `start()` 方法（发 `start`，只发一次）；`frame.held` 为真表示还没 start。
- `playback.js`：预加载的下一页用 `hold: true`；`show()` 顺序 = `await frame.loaded` → 显示新页、销毁旧页 → `frame.start()` → `await frame.ready` → 等两帧。第一页和往回翻（`fast`）不用 hold。
- 这样用计时器写的入场也是翻过去才开始；预加载只做文档解析和资源加载。导出放映版用同一套 `playback.js`，一并生效。
- 测试：init 里用 `ctx.timer` 记时间戳的页面，翻过去之前 `init` 没跑；翻过去后从头跑。

### 4.3 0a 数屏
- edit 模式的 `ready` 消息加 `motion: { registered, hasStep }`（页面有没有 `vw.motion` 登记、有没有 `step`）。登记可能晚于 ready（模块脚本），晚到时补发一条 `{ vw: 'motion', registered: true, hasStep }`。
- boot 参数加 `countSteps: true`（配 `mode: 'play'`、`fast: true`）：运行时等登记（最多 `timeout`），跑 `init`（快进），然后从 0 开始逐步 `step(i)`（快进），每步后比对画面快照（所有元素的 `innerHTML` 长度 + 计算样式里 opacity / visibility / transform / display / 位置），**和上一步相同就停**；最多 30 步；出错也停。然后报 `ready`，加 `countedSteps: n`、`hasStep`。父页面（B）在隐藏的探测 iframe 里用它，拿到后销毁。
- `page-frame.js` 的 `createPageFrame` 把 `countSteps` 传进 boot。

### 4.4 字体库注入
- `createPageFrame` / `buildSrcdoc` 加 `fontLibrary: [{ family, aliases: [...], faces: [{ url, weight: 100|…|900|'variable', style: 'normal'|'italic', format: 'opentype'|'truetype'|'woff2' }] }]`。
- `buildSrcdoc` 扫页面文本里出现的字体名（`font-family` 声明和 `@font-face` 的 `font-family`，大小写、空格、引号不敏感，别名也算），命中的每套在 `<style data-vw-base>` 之后、页面自己的样式之前注入 `<style data-vw-fontlib>`：每个 face 一条 `@font-face { font-family: "<页面里用的那个名字>"; src: url(<url>) format(<format>); font-weight: <weight 或 100 900>; font-style: …; font-display: block }`。页面自己后声明的子集 face 同名、同描述符时覆盖它；字集里没有的字由浏览器在同一字族里回退到先声明的完整 face（Chromium 的分段字体回退）。
- **A 先用测试验证这条回退真的成立**（用 `subset-font` 从 `examples/sample-deck/fonts/Inter-Variable.ttf` 做一个只含少数字母的子集当「页面自带的字体」，完整文件当「字体库」，页面声明子集；渲染一个子集里没有的字母，比较和完整字体的字形宽度）。成立就按上面做；不成立就改成运行时 JS：boot 后对所有元素按计算样式的 `font-family` 把「<同名字族>, <字体库字族>」写进行内样式（字体库 face 用另一个名字注入），测试同样要过。报告里写清楚用了哪种。
- 导出放映版：D 在 Node 里调 `page-frame.js` 导出的纯函数 `fontLibraryStyle(html, fontLibrary)`（返回要注入的 `<style>` 文本，或 `''`），所以这个函数要自包含、不碰 DOM。

## 5. 草稿页（主智能体写 `web/draft-model.js`，Node 和浏览器都 import）
```js
import { DRAFT_LEVELS, parseDraftText, draftPageHtml, blocksFromDraftHtml, isDraftHtml } from '../web/draft-model.js';
```
- `DRAFT_LEVELS`：`[{ id: 'title', label: '大标题' }, { id: 'subtitle', label: '副标题' }, { id: 'heading', label: '小标题' }, { id: 'body', label: '正文' }, { id: 'note', label: '注释' }, { id: 'quote', label: '引用' }, { id: 'header', label: '页眉' }, { id: 'footer', label: '页脚' }]`。
- `parseDraftText(text, { charsPerPage = 240 })` → `{ name, description, method: 'marked' | 'plain', note, pages: [{ name, blocks: [{ level, text }], notes }] }`。规则见 `docs/format.md` §15。
- `draftPageHtml({ name, blocks, artboard })` → 完整 HTML 文本（白底、朴素字、`white-space: pre-wrap`、字号按画板高度缩放；`<meta name="vw-draft" content="1">`；`<main data-vw-draft>` 里每块 `<p data-vw-level="<level>">文字</p>`，空行是空的 `<p>`）。不标 `data-vw`（草稿不走修改单）。
- `blocksFromDraftHtml(html)` → `blocks`（把页面文件解析回块，`<br>` 当换行）。`isDraftHtml(html)` 看 meta。
- 草稿页在 `project.json` 里 `draft: true`；用户在草稿页上的所有改动由界面（B 的 `web/drafts.js`）算成新的 `blocks`，发 `op: 'draft-update'`，服务端重写页面文件。**草稿页不用 iframe 改字**：B 在画布上盖一层和页面同尺寸、同缩放、同样式的 contenteditable 表单（样式用 `draftPageHtml` 里同一段 CSS，`draft-model.js` 导出 `draftCss(artboard)`），下面的 iframe 照常显示（或隐藏）。
- 界面要点（B）：页面栏草稿页有「草稿」标记；工具条有层级下拉框（Word 样式框那样，选项 = `DRAFT_LEVELS`），对光标所在块或选中的几块生效；`Ctrl/Cmd + Enter` 在光标处分页；工具条「和下一页合并」（下一页是草稿时可用）；输入 600ms 节流后发 `draft-update`，`#save-status` 照常；撤销 / 重做走 `draft-update` 的历史（界面自己记块的历史即可）。属性栏显示「文字超出页面 N px」（只是数值，不做判断）。
- 「复制给 agent → 请设计」（`intent=design`）：列出草稿页的块（层级 + 文字）和 notes，要求 agent 把草稿页改写成正式页面、保留页面编号、去掉 `draft`。

## 6. 批注（B 写 `web/annotations.js`；C 写 CLI 与 brief）
- 数据在 `page.annotations`（§2）。界面：画布工具条「批注」按钮（像 Word 的「新建批注」）；按下后在画布上拖出一个框，松开弹出小输入框写一句话（回车保存、Esc 取消）；批注显示成半透明黄色框 + 文字标签，盖在画布上（父页面的一层，在 `#artboard-holder` 里按画布同样的 transform 缩放），放映、导出、缩略图自然看不到。
- 点批注选中，拖动可移动，拖角可改大小，双击改文字，Delete / 右键「删除」删掉，Esc 取消选中。没有在「批注」模式时这一层 `pointer-events: none`，只有批注框本身能点。
- 改动走 `S.project.pages[].annotations` → `changed()`（撤销 / 自动保存和修改单一样）。
- `npm run annotations -- <项目> [--page <页面编号>] [--clear [<编号>…]]`：列出 / 清除。
- 三种 brief 都在每页末尾列出批注：`批注（n 条）：· an_xxx 「这里加一个字」（位置 x, y, 宽 w, 高 h）`。

## 7. 「复制给 agent」（B 做菜单，C 做文本）
按钮改成分裂菜单（点开列出四项）：
1. **请处理修改单**（默认，= 原来的 brief，`intent=edits`）
2. **请设计**（`intent=design`）：有草稿页时可用
3. **请统一风格**（`intent=unify`）：有 `origin.project` 不是本项目的页时可用；文本说明哪些页是拼进来的（页码、页名、来自哪个项目），本项目的设计卡片原文（没有卡片就说明「本项目还没有设计卡片，请先按本项目其他页的风格判断并写一张」），要求把这些页改成和本项目一致、内容不变、保留页面编号，然后写 / 更新设计卡片。
4. **请整理文件夹**（`GET /api/brief/organize`）：列出现有文件夹和全部项目（编号、名称、文件夹、更新时间），要求 agent 先 `npm run organize -- begin` 记录原状，再用 `npm run organize -- folder / move / rename` 整理，**不删除任何项目**，命名用「日期 + 简短名」，整理完列出改了什么；用户可以在总览点「退回整理前」。
所有 brief 文本末尾都提醒：每次做完设计要在 `project.json` 写 `designCard`。

## 8. 拖进来导入（E）
- `web/import-html.js` 导出 `filesFromDataTransfer(dataTransfer) → Promise<[{ path, file }]>`（支持文件、文件夹（`webkitGetAsEntry` 递归）、.zip）和 `openImportDialog({ …, files?, autoStart?, intoProject?, after? })`：给了 `files` 就当作已选好（名称按原规则猜）；`autoStart` 为真时直接开始；`intoProject` 为真时是「导入为页面」模式（不选项目类型和画板，画板 = 目标项目的）。
- 服务端：任务体带 `intoProject`、`after` 时，分析完在临时项目里生成页面后，用 `copyPagesInto` 复制进目标项目（素材、字体一起带），页面名照用，`notes` 照写，`origin.file` 照写；结果 `{ projectId: 目标, pageIds }`。写目标项目后调 `onProjectChanged(id)`（C 在 `createImportJobs` 里传 `id => watcher.noteSelfSnapshot(id)`）。
- 总览（H）：拖 `.html` / 文件夹 / `.zip` 到总览 → `openImportDialog({ files, autoStart: true })`；拖 `.md` / `.txt` → 从文案新建（`POST /api/projects { draft }`）。编辑器页面栏（B）：拖进来 → `openImportDialog({ files, autoStart: true, intoProject: S.project.id, after: S.pageId })`；页面栏右键「导入为页面…」→ 不带 files 的页面模式。

## 9. 字体库（D）
- 五套：站酷小薇（ZCOOL XiaoWei）、思源宋体 SC / JP（Source Han Serif = Noto Serif CJK）、思源黑体 SC / JP（Source Han Sans = Noto Sans CJK）。`src/fonts/catalog.js` 写死清单：每套的 `key`、`family`（规范名）、`aliases`（页面里可能写的名字：中文名、Noto 名、Source Han 名、去空格的写法）、官方下载地址（GitHub 开源发布：`google/fonts` 的 ZCOOLXiaoWei-Regular.ttf；`adobe-fonts/source-han-serif` 与 `source-han-sans` 的 Variable OTF 按语言版）、许可证（OFL）。
- `npm run fonts -- install [--data-dir <目录>]`：下载到 `<数据目录>/library/fonts/<key>/`，校验文件大小 > 0 且能被 `subset-font` 读（抽几个字试一下），写 `library/fonts/fonts.json`：`{ families: [{ key, family, aliases, license, files: [{ file, weight, style, format, bytes }] }] }`。下载失败的那一套报中文错误并继续其他套；已存在且大小一致的跳过。**不要从非官方地址下载。**
- `src/fonts/library.js`：`readFontLibrary(dataDir)`（读清单，缺文件的 face 不算）；`fontLibraryFor(project, pagesHtml)`（给 page-frame 的 `fontLibrary` 数组，url 用 `/data/library/fonts/<key>/<file>`）；`fontsApi(dataDir)` 返回 `GET /api/fonts` 的响应体；`matchFamily(name)` 按别名认字族。
- 导出放映版（`src/export/html.js`）：每页按 `fontLibraryStyle(html, fontLibrary)` 注入字体库 face（url 换成 `__VWFILE[libfont:<key>/<file>]__` 占位符），字体库文件和项目字体一样按最终文字（页面 + 修改单）子集化；页面没用到的字族不嵌。
- `web/runtime-settings.js`（数据文件夹弹窗）：多一段「常用字体库」：文件夹位置、每套装没装（从 `GET /api/fonts`），没装时写一句「让 agent 运行 npm run fonts -- install」。
- 认不出字族的页面：不注入、不报错。agent 自由选的字体不预存。

## 10. 从其他项目添加页面（B 写 `web/add-pages.js`，用已有接口）
- 入口：页面栏「添加页面」菜单里「从其他项目…」，或页面栏右键「从其他项目添加页面…」。
- 弹窗：左边项目列表（`GET /api/projects`，按文件夹分组，当前项目除外），右边该项目的页面缩略图网格（`createThumbnails`）带勾选，底部「插到第 N 页后面」（默认当前页）和「添加」。
- 调 `POST /api/projects/:id/pages { op: 'copy-from', fromProject, pageIds, after }`（已有）；C 让 `copyPagesInto` 跨项目时写 `origin: { project, page, copiedAt }`，`edits` 一起带（已有）。
- 加完后自动选中新页；提示「已添加 n 页，可以用「复制给 agent → 请统一风格」让 agent 统一风格」。

## 11. 设计卡片（H 写 `web/design-card.js`）
- 总览卡片右上角（母版开关旁边）有卡片图标，项目有 `designCard` 时才显示；点开弹窗：方向名（标题）、概念、色块一排（每个色块下写色号）、字体行、特征行（`·` 分隔）；按钮「复制给 agent」把卡片变成文字：
  ```
  设计风格参考（项目「<名>」的设计卡片）
  方向：…
  概念：…
  配色：#FFFFFF #88DAD1 …
  字体：…
  特征：… · …
  ```
- `src/brief.js` 导出 `designCardText(project)`（同一格式），`unify` 和 `edits` brief 都用它。

## 12. 文件夹（H 写 `web/folders.js`，用 §3 的接口）
- 总览：面包屑「项目总览 › 文件夹名」；根上先列文件夹（像访达的文件夹卡片：图标、名字、`n 个项目`），再列未分类的项目；进入文件夹只列里面的项目，面包屑第一级可点返回。
- 「新建文件夹」按钮在顶栏；文件夹右键：打开、重命名、删除（确认：里面的项目会移到总览根）；项目右键多一项「移到…」→ 弹小菜单列出文件夹和「总览（不放进文件夹）」；项目卡片可以拖到文件夹卡片上（高亮）；在文件夹里也可以拖到面包屑「项目总览」上移出。
- 顶栏有备份时显示「退回整理前（<时间>）」按钮 → `POST /api/organize/restore`。
- 总览的多选、框选、Delete 等照旧（`home-selection.js`）。

## 13. 测试
- 只用临时数据目录和临时 home（`test/helpers/`）。动到系统剪贴板的测试先存后还原。
- 0b 改了点击方式：旧断言逐条改并在报告里列出（文件、测试名、原断言 → 新断言）。
- 每组至少一个走真实服务 + 真实浏览器的测试（`startWorkbench` / `createServer` + `launchBrowser`）。
