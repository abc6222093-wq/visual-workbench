# 第 12 轮内部约定：页面运行时、iframe 桥、模块分工

给改仓库代码的 agent 看。格式见 `docs/format.md`（v3）。共用纯逻辑：`web/edits-model.js`（修改单）、`web/page-marks.js`（扫标记与资源引用），Node 和浏览器都 import 它们。

## 1. 页面怎么显示（五处一致）
所有地方都用 `web/page-frame.js`（父页面侧）生成一个 **sandbox iframe**（`sandbox="allow-scripts"`，没有 allow-same-origin → 页面是 null 源，碰不到工作台、`/api/`、其他页面）：

1. 读页面文件文本（`/data/projects/<id>/pages/<page>.html`，或导出时内嵌的文本）。
2. 注入（放在 `<head>` 最前，没有 `<head>` 就补）：
   - `<base href="<页面文件所在目录的 URL>/">`（导出时资源已内嵌，base 可省）
   - `<style data-vw-base>`：课件页 `html,body{margin:0;width:Wpx;height:Hpx;overflow:hidden}`；网页页 `html,body{margin:0;width:Wpx}`（W = 设备宽）
   - `<script data-vw-runtime>` = `web/page-runtime.js` 的全文（**自包含的经典脚本**，不 import、不 export；提供 `window.vw`）
   - `<script data-vw-boot>`：`vw.__boot({ mode, pageId, size, edits, steps, fast, assetBase, screen?, cropFallback? })`（`screen`：编辑时停在第几屏，见 §3；`cropFallback`：强制用裁切的兼容显示方式，测试用）
3. `iframe.srcdoc = 注入后的 HTML`。父页面只用 `postMessage` 和它说话；绝不 `contentDocument`。
4. 字体、模块脚本从服务器加载需要 CORS：`src/server.js` 对所有 GET 静态内容（`/data/…`、`/vendor/…`、`web/` 文件）加 `Access-Control-Allow-Origin: *`；修改类请求（PUT / POST / PATCH / DELETE）若 `Origin` 头是 `null` 一律 403（页面脚本发不出修改请求）。

模式（`mode`）：
- `edit`：编辑画布。叠修改单；没给 `screen` 时不跑 `vw.motion` 的 `init`（全部显示）；给了 `screen: k` 时以快进方式跑 `init` 和 step 0…k-2 后停住（不 dispose，之后的 `step` / `toEnd` / `leave` 只回 `step-done { frozen: true }`）；运行时接管鼠标 / 键盘做用户修改（见 §3），并在 window 捕获阶段用 `stopImmediatePropagation` 拦住用户输入事件（pointer / mouse / click / dblclick / contextmenu / touch / key；wheel 不拦；不 preventDefault），页面自己的脚本收不到，所以**编辑画布上的点击永远不触发动效**。
- `play`：放映 / 导出 / 动效检查。叠修改单；跑 `init`，按父页面指令 `step` / `leave`；`fast: true` 时快进到最后一步。
- `static`：缩略图。父页面用 `DOMParser` 解析页面、`window.__vwRuntime.applyEditsToDocument(doc, edits)` 叠修改单、删掉所有 `<script>`、序列化后放进 `sandbox=""`（无脚本）的 iframe，CSS 缩放。`web/page-runtime.js` 在父页面也以 `<script src="/page-runtime.js">`（经典脚本）加载一次，暴露 `window.__vwRuntime = { applyEditsToDocument, VERSION }`，供缩略图用。

## 2. iframe 桥（postMessage，`{ vw: '<type>', … }`，父页面校验 `event.source === iframe.contentWindow`）

父 → 页面：
| type | 字段 | 说明 |
|---|---|---|
| `edits` | `edits` | 整份修改单重放（撤销 / 重做 / 同步后）。运行时记有每个目标每种修改的原样，先恢复再叠 |
| `select` | `id` 或 `null` | 父页面要求选中 / 取消选中（例如 Esc、点页面栏） |
| `set` | `target, kind, after` | 父页面的控件（颜色、字号）改了值：运行时叠上并回 `edit` |
| `addImage` | `entry`（addImage 条目） | 贴图：运行时把 `<img>` 加进 body 并选中它 |
| `removeImage` | `target` | 删除用户贴的图 |
| `step` | — | 推进一步；完成后回 `step-done` |
| `toEnd` | — | 快进到最后一步 |
| `leave` | `direction` | 跑 `leave`，完成后回 `left` |
| `mode` | `mode` | 切换 edit / play（放映内嵌预览用） |
| `scroll` | `top` | 网页页面滚到某个位置 |
| `settle` | `timeout` | 等字体、图片、有限动画结束，无限动画暂停（截图前用） |
| `uiScale` | `scale` | 画布缩放时发，让把手、框线保持屏幕像素大小 |
| `start` | — | 第 13 轮：`hold: true` 启动的页面收到后才跑 `init`（放映壳在显示新页之后发） |
| `screen` | `screen` | 编辑时切到第 k 屏：k ≥ 当前屏在原地快进，回 `screen-done { screen, applied: true }`；k 小于当前屏不能回退，回 `applied: false`，父页面另建 iframe（双缓冲）重载 |

页面 → 父：
| type | 字段 | 说明 |
|---|---|---|
| `loaded` | `pageId, height, held` | 只在 play 模式：文档加载完、修改单叠完、`init` 还没跑（或刚开始跑）。放映壳收到就把 iframe 显示出来（`frame.loaded`）。`held` 为真表示 boot 带了 `hold: true`，要等父页面发 `start` 才跑 `init`（第 13 轮，预加载的下一页用） |
| `motion` | `registered, hasStep` | 第 13 轮：edit 模式 ready 之后页面才调用 `vw.motion` 时补发 |
| `ready` | `pageId, height, marks: [{ id, caps, page?, values? }], steps, screen, motion?, countedSteps?, hasStep?` | 文档加载完、修改单叠完。`height` 是整页内容高度（网页页面）；`marks[].page: true` 表示标在 `<html>` / `<body>` 上的整页背景（画布上点不中、不悬停，父页面在没选中东西时给「页面底色」控件，`values.background` 是当前底色）；`screen` 是当前停在第几屏（没给时 null） |
| `screen-done` | `screen, applied` | 对 `screen` 的回复 |
| `edit` | `target, kind, before, after` | 用户做了一个修改（运行时已经叠上）。父页面用 `upsertEdit` 记进 `project.pages[].edits`，走撤销 / 自动保存 |
| `select` | `id|null, caps, rect:{x,y,width,height}` | 选中状态变化（rect 是页面坐标，父页面放浮动小控件用） |
| `editing` | `on` | 进入 / 退出改字 |
| `paste-image` | `name, type, buffer`（ArrayBuffer，transfer） | 用户在页面里粘贴了图片 |
| `menu` | `id, x, y` | 右键一张用户贴的图（父页面弹玻璃菜单：删除） |
| `step-done` | `nextStep, total` | |
| `left` | — | `leave` 跑完 |
| `height` | `height` | 内容高度变化（网页页面） |
| `error` | `message, stack?, phase` | 动效 / 运行时错误（动效检查用） |
| `key` | `key, code, metaKey, ctrlKey, shiftKey, altKey, id` | iframe 有焦点时键盘事件进不了父页面：非改字状态下的按键转发给父页面（撤销 / 重做、Delete 删贴图、Esc 取消选中） |
| `nav` | `dir` | play 模式里的点击 / 右键（父页面据此推进） |
| `scroll` | `top, left` | 页面滚动了 |
| `settled` | `ok, height, error?` | 对 `settle` 的回复 |

## 3. 运行时在 edit 模式里的交互（Word / PowerPoint 习惯）
- 只有带 `data-vw-id` 且能力非空的元素（和用户贴的图）能被碰；标在 `<html>` / `<body>` 上的整页背景例外（点空白永远是取消选中）。鼠标移上去：2px 实线蓝框（屏幕像素，按 uiScale 换算）；有 `text` 能力时指针是 I 形。
- **第 13 轮起选中优先**（0b）：带 `text` 的元素第一下按下是选中整个文字框（框 + 把手；有 `move` 时按住即拖，方向键微调），**已选中时再点一下（按下松开没拖动）或双击未选中的文字**才在点的位置出现光标进入改字；Enter 进入改字并全选；点元素外面或 Esc 退出改字回到选中状态。下面这段是进入改字之后的手感（不变）：
- 单击带 `text` 的元素（第 13 轮：指已选中后的那一下）：直接在点的位置出现光标进入改字（`contenteditable=plaintext-only` 不行——要保留行内格式，用 `contenteditable=true` 并在 `beforeinput` 里只允许插入文字、删除、换行 `<br>`；粘贴只取纯文字；拖选、双击选词、三击选段、Shift+方向键、Home/End、Ctrl/Cmd+A（只选本元素）、Ctrl/Cmd+Z/Y（改字期间由浏览器处理；退出后整条进父页面撤销）都由浏览器原生完成；选区底色用 `::selection` 明显一点；输入法组合期间不写 `edit`，`compositionend` 后才写）。
- 改字期间元素固定不动。改字时按 **Esc 或点元素外面**退出：只移除 `contenteditable` 和选区，不重建任何节点、不重载 iframe（测试会核对 iframe 和里面图片节点的身份）。退出时回一条 `text` 修改（before = 第一次改前的 innerHTML/textContent）。
- **移动**：带 `move` 的元素，选中后出现 2px 实线框和 8 个 12px 的把手（改字时虚线框）；第 13 轮起带 `text` 的元素未在改字时点哪都能拖（和图片、色块一样），改字期间只有框外那一圈（6px）能拖；不带 `text` 的元素点哪都能拖。拖动叠加 `transform: translate(dx,dy)`（在元素原 transform 之外再包一层：用 CSS 变量 `--vw-dx/--vw-dy` + `translate` 属性，不覆盖原 `transform`）。网页页面拖到窗口上下边缘自动滚动。
- **缩放**：带 `resize` 的元素，角上 4 个把手（Shift 不锁比例，图片默认锁比例）和左右 / 上下边把手，写 `style.width/height`。
- **颜色**：父页面控件（选中时在 iframe 上方浮一条小工具条：字号输入框、文字颜色、底色，按能力显示）发 `set`。
- **裁切**：带 `crop` 的 `<img>` 双击进入裁切，沿用第 10 轮 `web/crop-tool.js` 的交互（拖框、框内拖图、滚轮缩放、Esc / 点外面 / 完成），实现搬进运行时；显示用 `object-view-box: inset(...)` + `object-fit: cover`（Chromium），叠在 `<img>` 自身上，不包裹节点；浏览器不支持 `object-view-box`（Safari、Firefox）或 boot 给了 `cropFallback` 时，`src` 不变，用 `object-position` 把图片自己的画面挪到框外，再把同一张图作为背景按同样的 cover 算法摆好（ResizeObserver 跟着尺寸重算），画面一致、元素框不变。缩略图的 `applyEditsToDocument(doc, edits, { cropFallback })` 同样支持。
- **贴图**：`paste` 事件里有图片 → 回 `paste-image`；父页面存进项目 `assets/`，再发 `addImage`（放在当前可见区域中央，大图按页面缩到不超过页面的 60%）。用户贴的图默认能力 move / resize / crop，右键 → `menu`，Delete 键 → 父页面确认后 `removeImage`。
- 右键菜单：改字期间不拦截（浏览器 / 桌面应用的原生菜单：剪切、复制、粘贴、全选；桌面应用在 `desktop/main.cjs` 里补 `context-menu` 和编辑菜单的 roles）。

## 4. play 模式
- `vw.motion(handlers)` 登记；`__boot` 后在 `load` 时若 `steps > 0` 却没登记 `step` → `error`。
- `ctx`：`root`、`signal`、`step`、`fast`、`animate`、`timer`、`importModule`（`/vendor/…` 走父页面同源 URL 或导出表；`../assets/…` 相对 base）。快进时 `animate` 立即 finish、`timer` 立即 resolve、`document.getAnimations()` 的有限动画 finish；anime.js 的 wrapper 照第 11 轮 `web/motion-runtime.js` 搬。
- 放映壳（`web/playback.js`、放映页面、导出放映版的播放器）：当前页 iframe + 预加载下一页 iframe（隐藏）；点击 / 右键 / 方向键推进；上一页用 `fast: true` 重建。换页顺序是 **新页 `loaded` → 显示新页、销毁旧页 → `start`（第 13 轮：预加载的页用 `hold: true` 启动，init 要等这条消息才跑，所以入场动画是翻过去才开始）→ 等 `ready` → 等父页面画两帧（刚显示的跨源 iframe 画出一帧后 Chromium 才把鼠标事件路由进去）**：Chromium 不推进 `visibility:hidden` 的 iframe 里的动画，`init` 里 `await ctx.animate(...)` 的页面若先等 `ready` 再显示会永远停在「正在准备放映…」（第 12 轮收尾在桌面应用里实测到）。（第 12 轮的已知限制「预加载页提前跑 init」已在第 13 轮用 `hold` 解决，见 `docs/round13-contract.md` §4.2。）

## 4a. 导出进度（第 12 轮修正）
- `exportProject({ …, onProgress({ current, total, label }), signal })`：三种导出都报进度；`signal` 取消时抛 `error.cancelled = true`。
- `POST /api/projects/:id/export` 可带 `progressId`（`^[A-Za-z0-9_-]{8,64}$`）；`GET /api/projects/:id/export/progress/:progressId` 是 SSE（`progress`、`done { ok, error?, cancelled? }`，晚连上会重放）；`POST /api/projects/:id/export/cancel/:progressId` 取消，导出 POST 回 409 `{ error: '已取消导出', cancelled: true }` 并删掉半成品文件夹。界面先连流再 POST。

## 4b. 桌面应用版本
- 桌面壳在 User-Agent 末尾追加 ` VisualWorkbenchDesktop/<desktop/package.json version>`；界面 `desktopShellStatus(ua)`（web/runtime-settings.js）看到 `Electron/` 但没有标记或版本低于 0.2.0 时提示「桌面应用是旧版本」。`desktop/` 改了就要重新制作应用。

## 5. 文件与模块分工（子智能体之间不改同一文件）
| 模块 | 文件 | 负责 |
|---|---|---|
| 运行时与放映壳 | `web/page-runtime.js`、`web/page-frame.js`、`web/playback.js`、`web/motion-check.js`、`web/motion-check.html`、`web/export-render.js`、`web/export-render.html`、`web/player.html`（放映页）、`test/round12-runtime-*.test.js`、`test/round12-play*.test.js` | A |
| 编辑器与界面 | `web/app.js`、`web/index.html`、`web/style.css`、`web/glass.css`、`web/thumbnails.js`、`web/page-views.*`、`web/page-items.js`、`web/page-operations.js`、`web/home-selection.*`、`web/project-management.*`、`web/sync.js`、`web/runtime-settings.js`、`web/motion-status.js`、删除清单里的 web 文件、`test/round12-editor-*.test.js`、旧的界面测试取舍 | B |
| 格式、服务、命令行 | `schema/`、`src/validate.js`、`src/server.js`、`src/version.js`、`src/watch.js`、`src/copy-pages.js`、`src/master.js`、`src/brief.js`、`src/project-management.js`、`src/cli/edits.js`、`src/cli/*.js`（除 export / convert / import）、`web/project-kinds.js`、`desktop/`、对应测试 | C |
| 旧项目转换与示例 | `src/convert-v2.js`、`src/cli/convert.js`、`examples/`、`test/round12-convert*.test.js`、`test/fixtures/v2-*` | D |
| 旧 HTML / 网页导入 | `src/import-html/*`、`web/import-html.js`、`web/import-html.css`、`docs/import-html.md`、`test/round12-import*.test.js`、旧 import 测试 | E |
| 导出与交接包 | `src/export/*`、`src/cli/export.js`、`src/cli/export-changes.js`、`test/round12-export*.test.js`、旧 export 测试 | F |

共用但**只由主智能体改**：`docs/format.md`、`docs/round12-contract.md`、`web/edits-model.js`、`web/page-marks.js`。需要加东西就在报告里提。
