# 导入 HTML / 网页（第 12 轮：保留原网页）

把以前做的网页课件 / 海报 / 网页变成工作台项目（格式 v3，见 `docs/format.md`）：**按页切开后保留原来的 HTML、CSS、脚本和动画**，每页写成一个独立的页面文件 `pages/<页面编号>.html`；看得出的文字自动标成可改（`text color`），图片标成可裁切（`move resize crop`），纯色色块标成可移动缩放改底色（`move resize background`），整页背景只标 `background`。原文件原样复制进项目的 `import/`，绝不修改。导入**永远新建项目**，不生成动效（`motion` 不写），原页面的 CSS / JS 动画在页面里自己跑。

第 10、11 轮的做法（把页面拆成文字 / 图片 / 形状元素、截图块、分组）已经取消。

## 入口

总览「导入 HTML / 网页」打开弹窗（`web/import-html.js` 的 `openImportDialog`，由 `web/app.js` 调用，导出函数签名不变）：

- 项目类型：**课件 / 海报**（默认）或 **网页**；
- 来源：单个 `.html`（素材都内嵌在文件里）、整个文件夹、`.zip`；网页还可以填网址（每行一个，只认 http / https，没写协议按 https，去重，一次最多 30 个）；
- 项目名称（默认取文件名 / 文件夹名 / 第一个网址的域名）；
- 课件的画板类型：与新建项目同一组预设。选好文件后从 HTML 文本自动识别并预选：固定宽高的页面容器（如 `width:1920px;height:1080px`）> `viewport` 宽度 > reveal.js / 课件 JSON。网页固定电脑端 1440 × 900、手机端 390 × 844 窗口（勾选框可只要其一）。
- 开始后显示进度条、当前步骤和「取消导入」；完成后显示页数、分页方式（课件）或电脑端 / 手机端页数与跳过的网址（网页）、可改的文字数、可裁切的图片数、复制的素材 / 字体数、没下载到的外链、缺失字体、耗时和「打开项目」。

大文件不会卡住工作台：浏览器端按 3 MB 分块读文件转 base64，拼成一个 Blob 上传；切页在服务端后台浏览器里进行，弹窗每 0.5 秒查询一次进度。弹窗被关掉时会取消任务。

## 服务端接口（不变）

| 接口 | 说明 |
|---|---|
| `POST /api/import-html/jobs` | body：`{name, kind?, preset, width, height, files:[{path, data(base64)}], entry?, urls?, devices?}`。`kind` 为 `"deck"`（默认）或 `"web"`；`files` 可以是一个 .html、一个文件夹的全部文件（path 带相对路径）或一个 .zip（自动解开），合计上限 380 MB；网页可以改给 `urls`（1–30 个）。`devices` 是 `["desktop","mobile"]` 的子集。返回 `201 {jobId}` |
| `GET /api/import-html/jobs/:id` | `{jobId, state:'running'|'done'|'failed'|'cancelled', progress:0..1, step, pages, summary, projectId, error}` |
| `POST /api/import-html/jobs/:id/cancel` | 取消：关闭后台浏览器、删除临时文件，不留项目 |

入口文件：指定的 `entry`，否则层级最浅的 `index.html`，否则层级最浅、按名字排第一的 `.html`。所有文件在同一个顶层文件夹里时去掉这一层。路径里有 `../`、绝对路径的直接拒绝。

`summary`：`method`、`methodLabel`、`pages`、`texts`（标成可改的文字数）、`images`（标成可裁切的图片数）、`blocks`（标成色块的数）、`backgrounds`（标成整页背景的数）、`assets`、`fonts`、`styles`（复制的外部样式表数）、`scripts`、`animations`（样式表里的 @keyframes 名）、`missingFonts`、`remote`（没下载到的网络地址）、`missing`（原文件里引用了但找不到的文件）、`failed`、`message`、`seconds`；网页另有 `kind: "web"`、`source`、`devices: {desktop, mobile}`、`skipped: [{url, devices, reason}]`、`truncated`。

## 流程与清理

1. 上传的文件写到 `<数据目录>/.import-tmp/<任务>/src/`；
2. 本地临时 http 服务挂这些文件，Chromium（`launchBrowser`）打开入口，视口 = 画板尺寸；只许访问这个本地服务，网络请求（CDN、网络字体）一律拦下，所有不是 GET 的请求也拦下；
3. 页面文件和资源直接写进 `.import-tmp/<任务>/project/`，全部完成并通过 `validateProjectData(project, { projectDir })` 后才一次改名进 `projects/<import-xxxxxxxx>/`；
4. 结束（完成、失败、取消）都删除 `.import-tmp/<任务>/`；上次异常退出留下、超过一天的临时文件在下次启动时清掉。关闭工作台时取消进行中的任务。

## 自动分页（课件；按顺序，命中就用，摘要和每页 notes 里写明）

1. **课件 JSON**：`<script type="application/json">`（优先 `id="deck-data"`）里 `slides[].html` 每项是完整 HTML 文档，`assets` 是占位符表（对象、`[{key, data}]` 数组或纯字符串数组）。占位符换成真实地址后，**每页就是这份完整文档**，原样保留。
2. **幻灯片框架**：reveal.js（`.reveal .slides > section`，嵌套 section 展开成顺序页）、impress.js（`.step`）、Swiper（`.swiper-slide`）；以及 `section` / `.slide` / `.page` / `[data-page]` 作为 body 的直接或二级子元素、同一父元素下 ≥ 2 个、宽高比和画板接近（±20%）。
3. **按屏滚动**：顶层块（body 的子元素，或唯一包裹层的子元素）里 ≥ 2 个、且至少 60% 的高度约等于一屏（±12%）。
4. **保底**：整页按画板高度切分；只切出 1 页时摘要写明没有识别出分页结构。

## 每页怎么生成（`src/import-html/inpage.js` 的 `prepare` / `finish`，在后台浏览器里用 DOM 操作完成）

- **取原文**：本地文件用**未执行脚本的原 HTML**（`DOMParser` 解析入口文件或课件 JSON 的那一页），所以脚本保留后再跑一遍不会重复渲染；网址来源用打开后的当前 DOM（见下）。
- **只留这一页**：
  - 课件 JSON：整份文档；
  - 幻灯片框架 / 页面容器 / 按屏滚动：`<body>` 里只留这一页的元素（加 `data-vw-import-page`），它的祖先容器保留标签和全部属性（class 等，原 CSS 的 `.reveal .slides section` 这类选择器还能对上），兄弟页面去掉；`<head>` 原样；
  - reveal / impress / Swiper：追加 `<style data-vw-import>` 强制这一页显示（display / visibility / opacity / transform）；reveal 的 `.fragment` 加 `visible`，页面显示最后一步；
  - 原页面宽度和画板不同时（例如 960 宽的 reveal 幻灯片放进 1920 的画板），给这一页加 `zoom`；
  - 保底切分：整份文档，第 N 屏（从 0 数）追加 `html{overflow:hidden} body{margin-top:-N×H px;height:auto;overflow:visible}` 露出这一屏。
- **自动标记**（编号在一页内唯一）：
  - 文字：`h1`–`h6`、`p`、`li`、`blockquote`、`figcaption`、`td` / `th`、`dt` / `dd`、`label`、`button`、`a`、`caption`、`summary`、`legend`，以及直接含文字的 `span` / `div` 等，并且里面没有块级元素、图片、表单控件 → `data-vw-id="t<N>" data-vw="text color"`。标了的元素里面不再标（行内格式 `<strong>`、`<span>` 等留在文字里）。
  - 图片：每个 `<img>` → `data-vw-id="i<N>" data-vw="move resize crop"`。
  - 纯色色块（第 12 轮修正）：有可见底色（计算后的 `background-color` 不透明，或 `background-image` 是渐变；`background-image` 是图片 `url()` 的不算）、自身没有直接文字（可以有子元素，例如卡片底里的标题照旧标文字）、不是 `img` / `svg` / `video` / `canvas`、显示着并且有尺寸的块（色条、卡片底、印章底、装饰圆点等）→ `data-vw-id="b<N>" data-vw="move resize background"`。
  - 整页背景：`<html>`、`<body>`、这一页的根（`.slide` / `section` 等，加了 `data-vw-import-page` 的那个）和它的祖先容器有底色时，以及盒子 ≥ 页面尺寸 95%（课件是画板宽高，网页是设备宽 × 整页高）的块 → `data-vw-id="bg<N>" data-vw="background"`（只改颜色，不能移动缩放）。
  - 色块要看计算样式和盒子尺寸：网址来源量打开后的当前画面；本地文件在一个不跑脚本的隐藏 iframe 里按工作台显示时的尺寸渲染这一页（只留这一页、zoom 已加）再量。只加标记，不改样式、不做任何调整。
  - 每个标记都写 `data-vw-origin="<CSS 选择器>"`：在原文档里唯一（有唯一 id 用 `#id`；否则 `标签.稳定 class`；再不唯一就自下而上拼 `父 > 标签:nth-of-type(n)`），交接包用它定位回原网页。
  - 原文件里已经有 `data-vw-id` 的元素不动，新编号避开它们。
  - `script`、`style`、`svg`、`canvas`、`video`、`iframe`、表单输入框里面不标。底色块按上面的规则自动标（第 12 轮修正起）。
- **资源**（`src/import-html/resources.js`）：页面里的引用先在浏览器里换成绝对地址，Node 取到字节后复制进项目，再改写引用：
  - 图片（`img` / `source` 的 `src`、`srcset`，`video` 的 `poster`，SVG `image`，CSS 里的 `url()`，包括 `data:` 内嵌图）→ `assets/`，登记 `kind: "image"`（带宽高）；
  - 外部样式表 → `assets/*.css`（`kind: "file"`），样式表里的 `url()`、`@import` 按样式表自己的地址换算后同样复制并改写；
  - 外部脚本 → `assets/`（`kind: "file"`）；内联 `<style>`、`<script>` 原样保留；
  - `@font-face` 里的字体文件 → `fonts/`，登记 `{ family, weight（范围写法记 variable）, style }`；
  - 页面在 `pages/`、样式表在 `assets/`，两处一律写 `../assets/…`、`../fonts/…`；同样内容只存一份；
  - 网络地址（http / https）：本地文件来源**不下载**，保留原样并写进 notes「没下载到的网络地址」和摘要；Google Fonts 等字体链接记为缺失字体。网址来源用页面加载时收到的响应，没有就再发一次 GET 下载；下不到的同样保留原样并写明；
  - 原文件里引用了但找不到的本地文件：去掉引用，notes 里列出；
  - 页面里的相对链接 `<a href>` 换成原网页的绝对地址；`iframe` 不复制，notes 里列出。
- 某一页失败或超时（90 秒）：这一页写一个只有失败原因的页面，notes 写原因，其他页照常。

## 每页 notes（迁移说明）

分页方式及原文件第几页；只留这一页 / 保底切分 / zoom 的说明；自动标记了多少文字、图片、色块和整页背景；保留了哪些 `<style>`、外部样式表、内联 / 外部脚本；原来在跑的动画（CSS 动画 / 过渡名称和元素数）和样式表里的 @keyframes；动画 / 脚本库（gsap、anime、Reveal 等全局对象）；分步线索（`.fragment`、`data-fragment-index`、`data-aos` 等）；`<canvas>`、`iframe`；没下载到的网络地址；找不到的文件；缺失字体；复制进 `fonts/` 的字体；「本轮导入不截图」；需要点击推进的动效请用 `vw.motion` 写；原文件位置。页面名取页内第一个 h1–h3 文字前 20 字，否则课件 JSON 里的页名，否则「第 N 页」；网页是「<网页标题> · 电脑端 / 手机端」。

## 导入网页

网页项目 `kind: "web"`，`artboard` 固定 `{ preset: "web-desktop", width: 1440, height: 900 }`；网页不分页，**每个网页导入成电脑端一页 + 手机端一页**。每页 `device`、`size = { width: 设备宽, height: 整页高 }`、`origin = { url 或 file, capturedAt }`。

每个设备单独开一个浏览器窗口：电脑端 1440 × 900，手机端 390 × 844（手机 UA、`deviceScaleFactor` 1）。打开后慢慢滚到底触发懒加载、回到页顶，整页高度取 `scrollHeight`（至少等于窗口高，**上限 20000**，超出的在 notes 和摘要里说明）。

- **本地网页文件**：页面文件 = 入口文件的原文（脚本保留），资源照上面的规则复制。
- **网址**：页面文件 = 打开后的当前 DOM（`document.documentElement.outerHTML`）；读得到的样式表内容内联进 `<style data-vw-from="原地址">`（`url()` 换成绝对地址后再下载改写），读不到的（跨域）保留 `<link>` 再按 GET 下载；**脚本不保留**（DOM 已经是脚本跑过的样子，再跑会重复渲染），notes 里列出去掉的脚本。`import/pages/<序号>-<desktop|mobile>.html` 是导入时的网页快照，`import/source.json` 记录 `{ source: "urls", importedAt, urls, devices, pages: [{ url, finalUrl, device, capturedAt, file, pageId, height, fullHeight? }], skipped }`。

### 只读保证（原网站绝不受影响）

- 浏览器里所有**不是 GET 的请求一律放弃**：表单提交、POST 打点、`sendBeacon` 都发不出去；页面一打开就把 `navigator.sendBeacon`、`form.submit()` / `requestSubmit()` 换成什么都不做，Service Worker 被禁用、不接受下载。下载资源只发 GET。
- 不点击、不输入、不登录、不提交任何东西；弹出的对话框一律关掉。

### 跳过规则（跳过的网址列在摘要、项目 `description` 和第 1 页 notes 里）

- **需要登录**：最终网址相对输入的网址发生了跳转、并且跳到的地址含 `login|signin|auth|passport|sso`；或 HTTP 401 / 403；或页面主体只有密码输入框。
- 网址格式不对、不是 http / https、打开超时、域名解析失败、连接不上、证书错误、HTTP 4xx / 5xx。
- 某个网址被跳过不影响其他网址；**全部被跳过时任务失败**，错误信息列出每个网址的原因。

## import/ 文件夹

- 原文件逐字节复制（文件名不变）；原文件里有 `source.json` 的改名为 `source-原文件.json`，有 `README.md` 的，导入说明写成 `README-导入说明.md`。
- `import/README.md`：来源、时间、分页方式或设备、页数、标记数、缺失字体、跳过的网址。
- 第 11 轮的 `import/baseline.json` 不再写：用户的改动记在每页的修改单 `edits` 里，交接包的改动清单就是修改单。

## 已知限制

- 切页后，整份文档共用的脚本里如果找其他页的元素会报错（notes 里提醒 agent 检查）。
- 文字标记只看 DOM 结构，不看样子：被 CSS 藏起来的文字也会标；纯装饰的文字也会标。
- 只靠 CDN 才能排版的页面，本地文件来源时 CDN 没下载，页面会按没有它的样子显示（notes 和摘要里列出）。
- 网址来源的 `<canvas>` 内容、表单当前值、靠交互才出现的内容不会出现在页面文件里。
- 不支持 ZIP64 和加密的压缩包。
