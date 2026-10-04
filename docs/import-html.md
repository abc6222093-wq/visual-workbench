# 旧 HTML 导入（第 10 轮）

把以前做的网页课件 / 海报 / 网页变成工作台项目：自动拆页，把文字、图片、背景变成可以拖动修改的元素。导入**不要求和原来一模一样**；原来的动画不搬，导入后由 agent 按新格式（`motion.source`）重写。导入**永远新建项目**，不修改原文件。

## 入口

总览「导入旧 HTML」打开弹窗（`web/import-html.js` 的 `openImportDialog`）：

- 选单个 `.html`（素材都内嵌在文件里）、整个文件夹（图片等放在旁边的文件夹里）或 `.zip`；
- 项目名称（默认取文件名 / 文件夹名）；
- 画板类型：与新建项目同一组预设（演示文稿 1920×1080 默认、桌面网页、手机网页、A4、A3、自定义）。选好文件后从 HTML 文本自动识别并预选：固定宽高的页面容器（如 `width:1920px;height:1080px`，16:9 归为演示文稿、A 系列比例归为 A4）> `viewport` 宽度（≤600 手机网页、1000–1700 桌面网页）> reveal.js / 课件 JSON（演示文稿）。
- 开始后显示进度条、当前步骤和「取消导入」；完成后显示页数、分页方式、元素数、截图块数、缺失字体、耗时和「打开项目」。

大文件不会卡住工作台：浏览器端按 3 MB 分块读文件转 base64，拼成一个 Blob 上传；分析在服务端后台浏览器里进行，弹窗每 0.5 秒查询一次进度。弹窗被关掉时会取消任务。

## 服务端接口

| 接口 | 说明 |
|---|---|
| `POST /api/import-html/jobs` | body：`{name, preset, width, height, files:[{path, data(base64)}], entry?}`。`files` 可以是一个 .html、一个文件夹的全部文件（path 带相对路径）或一个 .zip（自动解开）。合计上限 380 MB。返回 `201 {jobId}` |
| `GET /api/import-html/jobs/:id` | `{jobId, state:'running'|'done'|'failed'|'cancelled', progress:0..1, step, pages, summary, projectId, error}` |
| `POST /api/import-html/jobs/:id/cancel` | 取消：关闭后台浏览器、删除临时文件，不留项目 |

入口文件：指定的 `entry`，否则层级最浅的 `index.html`，否则层级最浅、按名字排第一的 `.html`。所有文件在同一个顶层文件夹里时去掉这一层。路径里有 `../`、绝对路径的直接拒绝。

## 流程与清理

1. 上传的文件写到 `<数据目录>/.import-tmp/<任务>/src/`；
2. 本地临时 http 服务挂这些文件，Chromium（`launchBrowser`）打开，视口 = 画板尺寸；只许访问这个本地服务，网络请求（CDN、网络字体）一律拦下；
3. 项目先写在 `.import-tmp/<任务>/project/`，全部完成并通过 `validateProjectData` 后才一次改名进 `projects/<import-xxxxxxxx>/`；
4. 结束（完成、失败、取消）都删除 `.import-tmp/<任务>/`；上次异常退出留下、超过一天的临时文件在下次启动时清掉。关闭工作台时取消进行中的任务。

## 自动分页（按顺序，命中就用，摘要和每页 notes 里写明）

1. **课件 JSON**：`<script type="application/json">`（优先 `id="deck-data"`）里 `slides[].html` 每项是完整 HTML 文档，`assets` 是占位符表（对象 `{"__XXX_ASSET_0__": "data:…"}` 或数组 `[{key, data}]`），占位符换成真实地址后每页单独作为一个文档加载。
2. **幻灯片框架**：reveal.js（`.reveal .slides > section`，嵌套 section 展开成顺序页）、impress.js（`.step`）、Swiper（`.swiper-slide`）；以及 `section` / `.slide` / `.page` / `[data-page]` 作为 body 的直接或二级子元素、同一父元素下 ≥ 2 个、宽高比和画板接近（±20%）。
3. **按屏滚动**：顶层块（body 的子元素，或唯一包裹层的子元素）里 ≥ 2 个、且至少 60% 的高度约等于一屏（±12%）。
4. **保底**：整页按画板高度切分，摘要提示这是保底办法；只切出 1 页时摘要写明没有识别出分页结构。

每页单独打开、单独显示（其他页隐藏），等 `document.fonts.ready`，揭开 reveal 的 `.fragment` 和 AOS，把 `document.getAnimations()` 中有限的动画全部 `finish`（无限循环的停在当前帧），等 2 帧后取「最后一步的画面」。页面框内坐标按 `画板宽 / 页面框宽` 缩放（例如 960 宽的 reveal 幻灯片放大 2 倍）。

## 每页元素转换规则

- **文字**：含直接文本的最内层块元素为一个文字元素，inline 子元素（span、strong、a 等）合并进去，`<br>` 成为 `\n`，普通空白合并。位置取内容框（去掉内边距和边框），文字框按字形中心对齐、高度 = 行数 × 行高；flex / grid 容器里的文字取文字自身范围。属性：字号（含祖先缩放）、字重、颜色、第一个 font-family、行高倍数（normal 按实际行距推算，取不到用 1.2）、字距、对齐、`text-shadow` 第一个 → `shadow`、`-webkit-text-stroke` → `stroke`、`text-transform` 大小写。`name` 取前 12 个字。
- **图片**：`<img>`、CSS `background-image: url()`、内嵌 `<svg>`（outerHTML 存成 .svg，计算后的填充 / 描边写进去）。`fit` 由 `object-fit` / `background-size` 推断（cover / contain / fill）。字节来源：`data:` 地址、上传的本地文件、`blob:` 地址（页面里转成 data:）；网络图片不下载。位图用 sharp 压到最大显示尺寸的 2 倍以内转 webp；不安全的 SVG（脚本、事件、外链等）转成位图。同一张图只登记一次，素材 `source: {type:'upload'}`、`pendingLayout: false`。
- **色块**：有背景色或统一实线边框的块 → 矩形形状（`fill`、`stroke`、`cornerRadius`）；能解析的线性 / 径向渐变 → 渐变填充的形状。重复平铺的背景图案、解析不了的多层背景 → 只截这个块自身（子元素隐藏）。
- **背景**：页面容器、body、html 中第一个不透明的背景色 → 页面 `background`；单层可解析渐变 → 页面渐变；背景图 → 铺满整页的图片元素（`locked: true`，zIndex 最低）。
- **字体**：`@font-face` 的 src 是 `data:` 或上传的文件 → 复制进 `fonts/` 登记（family 保留原名，weight 取 descriptor，范围写法如 `100 900` 记为 `variable`，拿不到为 400）；网络字体（非本地的 http/https）和 Google Fonts 链接不下载，记入缺失字体。文字元素的 `font` 指向同名登记字体（优先可变字体，否则字重最接近的），没有就是 `null`。
- **截图块**：`<canvas>`、`<video>`、`<iframe>`、`<embed>`、`<object>`，以及用了 filter / backdrop-filter / clip-path / mask / mix-blend-mode / 渐变字 / 非平移 transform（铺满半页以上的纯缩放容器除外）的块 → 截图时只显示这个块（其余内容隐藏、底色为页面背景）→ PNG 图片元素，`name` 以「[截图]」开头，列入摘要。
- 看不见的（display none、opacity 0、visibility hidden、尺寸为 0、在页面框外）跳过；叠放顺序按 DOM 顺序。
- 每页元素上限 300，超出后剩余部分合成一张截图并在 notes 里说明。
- 某一页分析失败或超时（90 秒）：这一页整页截一张图，notes 写原因，其他页照常。

## 每页 notes（迁移说明）

分页方式及原文件第几页；观察到的原动画（CSS 动画 / 过渡名称和元素数量）；样式表定义的关键帧；动画库 / 脚本（gsap、anime、Reveal 等全局对象和 script 文件名）；分步线索（`.fragment`、`data-fragment-index`、`data-step`、`data-aos` 等）；哪些块被截成图片；缺失字体；用到但没有内嵌文件的字体；原文件位置；以及「请按原 HTML 的动画意图用新格式重写 motion（不要搬旧代码）」。页面名取页内第一个 h1–h3 文字（否则字号最大的文字）前 20 字，再否则「第 N 页」。

## 原文件与给 agent 的开场白

原 HTML 及素材按原文件名复制到 `projects/<id>/import/`，并写 `import/README.md`（来源、时间、分页方式、页数；原文件里已有 README.md 时改名为 `README-导入说明.md`）。`import/` 会随项目存版、复制。`src/brief.js`：项目里有 `import/` 文件夹时，开场白加一段说明这是旧 HTML 导入的项目、notes 是迁移说明、原文件位置，以及按原动画意图用新格式重写 motion。

## 已知限制

- 文字按块合并：同一段里不同颜色 / 字号的 span 合成一个文字元素，取块的样式。
- 叠放只按 DOM 顺序，不读 CSS `z-index`；旋转、倾斜的块截成图片，不转成 `rotation`。
- 依赖网络的脚本、样式、字体、图片都不加载（离线、安全）；靠 CDN 脚本才能排版的页面会按没有脚本时的样子导入。
- 截图块和截图背景是位图，不能改字；agent 之后可以按截图重做成可编辑元素。
- 不支持 ZIP64 和加密的压缩包。
