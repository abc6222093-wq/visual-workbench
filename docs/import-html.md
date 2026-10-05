# 旧 HTML 导入（第 10 轮）与导入网页（第 11 轮）

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
- **字体**：`@font-face` 的 src 是 `data:` 或上传的文件 → 复制进 `fonts/` 登记（family 保留原名，weight 取 descriptor，范围写法如 `100 900` 记为 `variable`，拿不到为 400）；网络字体（非本地的 http/https）和 Google Fonts 链接不下载，记入缺失字体。课件 JSON 里 assets 是纯字符串数组时，按下标替换页面里 `__XXX_n__` 形式的占位符（含不带引号的 `src:url(...)`）；同名字体在不同页是不同子集文件时各自登记，文字优先指向本页登记的那份。文字元素的 `font` 指向同名登记字体（优先可变字体，否则字重最接近的），没有就是 `null`。
- **变形、遮罩、混合（按计算后的矩阵判断）**：单位矩阵、纯平移、等比缩放 → 不截图，位置大小取实际框，缩放后的字号按累计缩放算；旋转（可带等比缩放）→ 写成元素的 `rotation`（中心取实际框中心，子元素角度累加）；非等比缩放的无文字块 → 按实际框；斜切、镜像、3D → 截图。单层 `url()` 遮罩加纯色背景（单色 logo 的常见写法）→ 图片元素加 `tint`；单层渐变遮罩 → `effects.mask`；常见的 `mix-blend-mode`（multiply、screen、overlay 等 9 种）→ `effects.blend`（向子元素传递）；简单的 `inset` / `polygon` `clip-path` → `effects.clip`。这些只写在没有子元素的块上，做不到的照旧截图。
- **取画面的时机**：每页加载后先按一次 End（分步课件会跳到最后一步），再等字体就绪、把有限动画 finish、无限动画暂停，取结束态的画面；优先取铺满视口的舞台容器（如 `.stage`）作为页面，页面外的「编辑」「保存」按钮不算内容。
- **截图块**：`<canvas>`、`<video>`、`<iframe>`、`<embed>`、`<object>`，以及 filter / backdrop-filter、解析不了的 clip-path / mask、渐变字、斜切或镜像的块 → PNG 图片元素，`name` 以「[截图]」开头，列入摘要。叠在别的内容上的截图块用透明底并带上 blend；canvas / video 和背景层仍以页面背景作底色。覆盖页面 90% 以上的装饰元素加 `locked: true`。
- 看不见的（display none、opacity 0、visibility hidden、尺寸为 0、在页面框外）跳过；叠放顺序按 DOM 顺序。
- 每页元素上限 300，超出后剩余部分合成一张截图并在 notes 里说明。
- 某一页分析失败或超时（90 秒）：这一页整页截一张图，notes 写原因，其他页照常。

## 每页 notes（迁移说明）

分页方式及原文件第几页；观察到的原动画（CSS 动画 / 过渡名称和元素数量）；样式表定义的关键帧；动画库 / 脚本（gsap、anime、Reveal 等全局对象和 script 文件名）；分步线索（`.fragment`、`data-fragment-index`、`data-step`、`data-aos` 等）；哪些块被截成图片；缺失字体；用到但没有内嵌文件的字体；原文件位置；以及「请按原 HTML 的动画意图用新格式重写 motion（不要搬旧代码）」。页面名取页内第一个 h1–h3 文字（否则字号最大的文字）前 20 字，再否则「第 N 页」。

## 原文件与给 agent 的开场白

原 HTML 及素材按原文件名复制到 `projects/<id>/import/`，并写 `import/README.md`（来源、时间、分页方式、页数；原文件里已有 README.md 时改名为 `README-导入说明.md`）。`import/` 会随项目存版、复制。`src/brief.js`：项目里有 `import/` 文件夹时，开场白加一段说明这是旧 HTML 导入的项目、notes 是迁移说明、原文件位置，以及按原动画意图用新格式重写 motion。

## 导入网页（第 11 轮）

弹窗顶部选「项目类型」：**课件 / 海报**（上面写的全部规则，行为不变）或 **网页**。网页项目 `kind: "web"`，`artboard` 固定 `{ preset: "web-desktop", width: 1440, height: 900 }`；网页不分页，**每个网页导入成电脑端一页 + 手机端一页**（勾选框可只要其一），页名「<网页标题> · 电脑端 / 手机端」。

### 两种来源

1. **本地网页文件**：单个 `.html`、整个文件夹或 `.zip`（设计窗口产出的网页），沿用上面的上传流程；只打开入口文件（规则同上）。
2. **网址**：文本框里每行一个网址（只认 http / https，没写协议的按 https；去重；一次最多 30 个）。本地测试网站（`http://127.0.0.1:<端口>`）同样可以。

每个设备单独开一个浏览器窗口：电脑端 1440 × 900，手机端 390 × 844（手机 UA、`deviceScaleFactor` 1）。网址用 `page.goto(url, { waitUntil: 'networkidle' })` 打开（单个网址 45 秒超时）；然后慢慢滚到底触发懒加载、回到页顶，整页高度取 `document.documentElement.scrollHeight`（至少等于窗口高，**上限 20000**，超过的部分截掉，在 notes 和摘要里说明）。页面 `size = { width: 设备宽度, height: 整页高 }`，`device` 是 `desktop` / `mobile`，`origin = { url 或 file, capturedAt }`。

### 只读保证（原网站绝不受影响）

- 浏览器里所有**不是 GET 的请求一律放弃**（`page.route` 中 `request.method() !== 'GET'` → `abort()`）：表单提交、POST 打点、`sendBeacon` 都发不出去；另外页面一打开就把 `navigator.sendBeacon`、`form.submit()` / `requestSubmit()` 换成什么都不做，Service Worker 被禁用、不接受下载。
- 不点击、不输入、不登录、不提交任何东西；弹出的对话框一律关掉。本地文件来源仍然只许访问临时本地服务（同上）。

### 跳过规则（跳过的网址列在摘要、项目 `description` 和第 1 页 notes 里）

- **需要登录**：最终网址相对输入的网址发生了跳转、并且跳到的地址（域名 + 路径 + 参数）含 `login|signin|auth|passport|sso`；或 HTTP 401 / 403；或页面主体只有密码输入框（有看得见的 `input[type=password]`，表单 / 页眉 / 导航 / 页脚以外的文字不到 200 字）。
- 网址格式不对、不是 http / https、打开超时、域名解析失败、连接不上、证书错误、HTTP 4xx / 5xx。
- 某个网址被跳过不影响其他网址；**全部被跳过时任务失败**，错误信息列出每个网址的原因。

### 分组（组件颗粒度，只对网页项目）

按 DOM 结构判断，下列容器成为一个分组（`type: "group"`，子元素坐标相对分组左上角，层级在每一层里从 1 往上排）：

- `header` / `nav` / `footer` / `section` / `article` / `aside` / `main`；
- 含 2 个以上子元素的 `a` / `button`；
- `class` 名含 `card|item|btn|button|nav|hero|footer|header` 的容器；
- 同一父元素下重复出现 ≥ 2 次、结构相同（标签 + class + 子元素标签序列相同）且有子元素的块（卡片、列表项）。

分组最多嵌套 4 层；只有一个子元素的分组去掉外壳，没有内容的分组不要。容器自己的背景色 / 边框 / 圆角转成 `shape`（rect，`fill`、`stroke`、`cornerRadius`），放在这个分组的最底层。分组名是「导航栏 / 页眉 / 页脚 / 区块 / 首屏 / 按钮 / 链接 / 卡片 / 列表项 / 分组 · 前 10 个字」。固定定位、粘性元素按它在页顶时的位置记一次。网页每页元素上限 800（课件仍是 300）。课件导入**不分组**，和以前一样是平铺的元素。

### 原网页位置 origin（课件和网页都写）

每个元素（含分组）写 `origin: { selector, tag, text? }`：`selector` 能在原网页里 `querySelector` 到唯一元素——有唯一的 `id` 用 `#id`；否则先试 `标签.稳定 class`（不像自动生成的 class）；再不唯一就自下而上拼 `父 > 标签:nth-of-type(n)` 直到唯一（遇到有唯一 id 的祖先就从它开始）。`tag` 是标签名，文字元素的 `text` 是原文前 80 字。页面背景图的 origin 指向 `html` / `body`；超出上限合成的剩余截图没有 origin。

### import/ 文件夹

- 所有导入（课件和网页）完成时都把导入那一刻的 `project.json` 原样写成 `import/baseline.json`，作为改动清单的「改前」基准。原文件里本来就有 `baseline.json` / `source.json` 的，原文件改名为 `baseline-原文件.json` / `source-原文件.json`（其余原文件照旧逐字节复制）。
- 网址来源没有原文件：每页写一份导入时的网页快照 `import/pages/<序号>-<desktop|mobile>.html`（只读参考），`import/source.json` 记录 `{ source: "urls", importedAt, urls, devices, pages: [{ url, finalUrl, device, capturedAt, file, pageId, height, fullHeight? }], skipped: [{ url, devices, reason }] }`。
- 网页项目的 `import/README.md` 写来源、设备、页数、分组数和跳过的网址。

### 接口字段（`POST /api/import-html/jobs`）

| 字段 | 说明 |
|---|---|
| `kind` | `"deck"`（默认，可不写）或 `"web"` |
| `devices` | 网页：`["desktop","mobile"]` 的子集，默认两个都要；空或不认识的设备 → 400 |
| `urls` | 网页、网址来源：字符串数组（每个一条网址），1–30 个；和 `files` 二选一（有 `files` 时按本地文件导入） |
| `files` / `entry` | 本地文件来源，同上 |
| `preset` / `width` / `height` | 只对课件有效；网页固定 1440 × 900 画板 |

完成后 `summary` 额外有：`kind: "web"`、`source: "files" | "urls"`、`devices: { desktop, mobile }`（各几页）、`groups`（分组数）、`skipped: [{ url, devices, reason }]`、`truncated: [{ url, device, height }]`；`elements` 是含分组在内的全部元素数。弹窗完成后显示页数、电脑端 / 手机端各几页、分组数、元素数、截图块、跳过的网址与原因。

## 已知限制

- 文字按块合并：同一段里不同颜色 / 字号的 span 合成一个文字元素，取块的样式。
- 叠放只按 DOM 顺序，不读 CSS `z-index`；斜切、镜像的块截成图片（旋转会写成 `rotation`）。
- 依赖网络的脚本、样式、字体、图片都不加载（离线、安全）；靠 CDN 脚本才能排版的页面会按没有脚本时的样子导入。
- 截图块和截图背景是位图，不能改字；agent 之后可以按截图重做成可编辑元素。
- 不支持 ZIP64 和加密的压缩包。
- 网页导入：分组只看 DOM 结构，不看视觉效果；`z-index` 叠放、`position: fixed` 的弹层按页顶时的样子取一次；靠登录、点击、滚动交互才出现的内容不会出现在导入结果里；网址抓取取到的图片 / 字体只来自页面实际加载过的响应。
