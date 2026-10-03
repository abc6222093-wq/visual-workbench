# 视觉工作台 · 项目格式（v2）

机器可读定义：`schema/project.schema.json`（JSON Schema 2020-12）。示例：`examples/sample-deck/`。校验：`npm run validate <项目路径>`。

本文是给 agent 和エイ看的说明书。**schema 与本文冲突时以 schema 为准**，并请修正本文。

## 1. 设计原则

1. **项目文件是唯一的真相来源**：エイ 和 agent 读写同一份 `project.json`。放映动效不能回写编辑数据。
2. **编号稳定**：页面、元素、素材、字体的 `id` 一旦生成就不改。动效按元素编号查找，不按数组位置或名字。
3. **动效由 agent 自由写代码**：每页可内嵌一个 JavaScript ES module。没有固定动效种类；放映器只负责提供最新元素状态与点击步数。
4. **布局取实时数据**：每次放映从最新项目文件创建只读快照。代码根据元素当前的位置、尺寸、外观计算动效，エイ 挪动、缩放或改字后仍能从新状态出发。
5. **编辑默认全部显示**：默认按项目文件画静止状态；可以手动查看动效的第 N 屏。动效及换页只在放映、屏幕视图、预览、检查和导出时运行，不回写编辑数据。
6. **素材随项目走**：素材、字体文件都存在项目文件夹里。

## 2. 文件与目录

### 2.1 数据目录

默认 `~/Projects/visual-workbench-data`，可在仓库的 `workbench.config.json` 改 `dataDir`，也可用环境变量 `VW_DATA_DIR` 或命令行 `--data-dir` 覆盖。用 `npm run init-data` 建出初始结构：

```
<数据目录>/
  projects/                 项目区，每个项目一个子文件夹
    <项目编号>/
      project.json          项目文件（本文定义的格式）
      assets/               素材文件（图片）
      fonts/                字体文件
      versions/             版本存档，见 §10
      series.json           从系列母版新建时才有：母版来源、配色、动效代码
  exports/<项目编号>/       导出的放映版 HTML、图片、PDF，见 §12
  workbench-state.json      哪些项目是系列母版（エイ 在界面上标）
  library/                  公共素材库，所有项目都能取用
    assets/
    fonts/
```

### 2.2 项目内的路径

`project.json` 里所有文件路径都是**相对项目文件夹**的：素材必须在 `assets/` 下，字体必须在 `fonts/` 下，不允许 `../` 或绝对路径。

## 3. 顶层结构

```json
{
  "format": "visual-workbench/project",
  "formatVersion": 2,
  "id": "sample-deck",
  "name": "示例课件",
  "description": "可选",
  "createdAt": "2026-10-01T12:00:00.000Z",
  "updatedAt": "2026-10-01T12:00:00.000Z",
  "artboard": { "preset": "slide-16x9", "width": 1920, "height": 1080 },
  "assets": [ … ],
  "fonts":  [ … ],
  "pages":  [ … ]
}
```

| 字段 | 说明 |
|---|---|
| `format` / `formatVersion` | 固定值，用于识别文件和将来升级 |
| `id` | 项目编号 = 项目文件夹名。小写字母、数字、连字符，2–64 位 |
| `createdAt` / `updatedAt` | ISO 8601 时间。工作台每次自动保存更新 `updatedAt` |
| `artboard` | 画板，见 §4 |
| `assets` / `fonts` | 素材、字体登记表，见 §8 |
| `pages` | 页面列表，至少一页，见 §5 |

## 4. 画板

整个项目共用一个画板尺寸，单位是像素。

| `preset` | 用途 | 建议尺寸 |
|---|---|---|
| `slide-16x9` | 课件 | 1920 × 1080 |
| `web-desktop` | 电脑网页 | 1440 宽，高度自定 |
| `web-mobile` | 手机网页 | 390 宽，高度自定 |
| `poster-a4` | A4 海报（300 dpi） | 2480 × 3508 |
| `poster-a3` | A3 海报（300 dpi） | 3508 × 4961 |
| `custom` | 自定 | 任意 |

`width`、`height` 必填，preset 只是标签；工作台按 width/height 画。

## 5. 页面

```json
{
  "id": "page_cover1",
  "name": "封面",
  "notes": "给人看的备注，不渲染",
  "background": "#0f172a",
  "elements": [ … ],
  "motion": { "steps": 2, "source": "export default async function(ctx) { … }" }
}
```

- `background`：颜色或渐变（§7）。
- `elements`：元素列表，见 §6。画面上的叠放顺序由每个元素的 `zIndex` 决定，不由数组顺序决定。
- `outline`：可选，页内大纲，不自动改变画布；见 §15。
- `motion`：可选。`steps` 是点击推进的次数，`source` 是本页动效与离页换页代码，见 §9。没有动效可省略 `motion`。

页码 = 在 `pages` 里的位置（从 1 数）。页码会随增删变化，所以工具间传递用 `id`，只有给エイ看的命令行参数用页码。

## 6. 元素

### 6.1 通用属性

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `el_…` | 稳定编号，见 §6.7 |
| `type` | `text` / `image` / `shape` / `group` | |
| `name` | 字符串 | 给人看的名字，可改 |
| `x`, `y` | 数字 | 左上角坐标（分组内的子元素相对分组左上角） |
| `width`, `height` | 数字 ≥ 0 | |
| `rotation` | 数字 | 顺时针角度，绕元素中心，默认 0 |
| `opacity` | 0–1 | 默认 1 |
| `zIndex` | 整数 | 层级，大的在上 |
| `locked` | 布尔 | 锁定后工作台不让拖，默认 false |
| `effects` | 对象 | 混合、滤镜、遮罩、裁切，见 §6.6。**只由 agent 写** |

**エイ 在工作台里改的就是这些**：`x` `y` `width` `height` `rotation` `zIndex`，以及文字类的 `text` `color` `font` `fontSize` 等。agent 下一轮必须以文件里的最新值为准。

### 6.2 文字 `text`

```json
{ "id": "el_title1", "type": "text", "x": 160, "y": 300, "width": 1600, "height": 160, "zIndex": 10,
  "text": "视觉工作台", "font": "font_inter", "fontSize": 120, "fontWeight": 700,
  "lineHeight": 1.2, "letterSpacing": 0, "align": "left", "color": "#ffffff" }
```

- `font`：引用 `fonts[].id`；`null` 表示系统默认字体。
- `fontWeight` 100–900；`lineHeight` 是倍数；`align` 为 left / center / right。
- `stroke`（可选）：文字描边，`{ "color": "#RRGGBB[AA]", "width": 数字 ≥ 0 }` 或 `null`（没有描边）。`width` 是线宽（画板像素），线沿字形边缘居中画，字的填充色盖在描边上面，所以描边不会吃掉字形，露在字外的约为线宽的一半。
- `shadow`（可选）：文字阴影，`{ "color": "#RRGGBB[AA]", "x": 数字, "y": 数字, "blur": 数字 ≥ 0 }` 或 `null`（没有阴影）。`x` 向右、`y` 向下偏移，`blur` 模糊半径，单位都是画板像素。
- 描边和阴影是**元素属性**：编辑、放映、动效检查、导出（放映版 HTML、图片、PDF）都按同一份画法显示。不要再在动效代码里临时加描边 / 阴影（那样只在放映时出现）。エイ 可以在工作台里改它们，改过的值 agent 不动。

```json
{ "id": "el_title2", "type": "text", "x": 160, "y": 300, "width": 1600, "height": 160, "zIndex": 10,
  "text": "描边标题", "fontSize": 120, "color": "#ffffff",
  "stroke": { "color": "#e11d48", "width": 6 },
  "shadow": { "color": "#00000080", "x": 0, "y": 8, "blur": 16 } }
```

### 6.3 图片 `image`

```json
{ "id": "el_bgphoto", "type": "image", "x": 0, "y": 0, "width": 1920, "height": 1080, "zIndex": 0,
  "asset": "asset_city01", "fit": "cover" }
```

- `asset`：引用 `assets[].id`，校验会检查它存在。
- `fit`：cover（裁满）/ contain（完整放进去）/ fill（拉伸）。
- `tint`（可选）：重新着色，`"#RRGGBB[AA]"` 或 `null`（原色）。设了以后，图片按自己的透明度当形状，整体画成这一种颜色——用来给**单色矢量标志（SVG）**换颜色，透明底的单色 PNG / WebP 也可以。多色图片会变成一块单色剪影；JPEG 没有透明部分，会整块变成纯色，所以校验会报 `TINT_NEEDS_ALPHA`。エイ 可以在工作台里改颜色。

```json
{ "id": "el_logo1", "type": "image", "x": 80, "y": 60, "width": 240, "height": 80, "zIndex": 20,
  "asset": "asset_logo01", "fit": "contain", "tint": "#ffffff" }
```

- 素材可以是 SVG（`assets/xxx.svg`）。工作台只收纯图形的 SVG：含脚本、`on…` 事件属性、`javascript:`、`<foreignObject>` 或引用网络地址的会被拒绝。

### 6.4 形状 `shape`

```json
{ "id": "el_card2a", "type": "shape", "x": 1000, "y": 200, "width": 360, "height": 240, "zIndex": 3,
  "shape": "rect", "fill": "#334155", "stroke": { "color": "#94a3b8", "width": 2 }, "cornerRadius": 24 }
```

- `shape`：rect / ellipse / line / polygon。
- `fill`：颜色、渐变或 `null`（不填充）；`stroke`：`{ color, width }` 或 `null`。
- `polygon` 必须有 `points`：顶点列表，每个点 `[x, y]` 取 0–100，表示**元素框宽高的百分比**。这样拖动、缩放元素不用改顶点。

### 6.5 分组 `group`

```json
{ "id": "el_group3", "type": "group", "x": 1100, "y": 200, "width": 640, "height": 520, "zIndex": 2,
  "children": [ …元素… ] }
```

- 分组自己有位置和大小（它的框）；子元素的 `x`/`y` 相对分组左上角，子元素的 `zIndex` 只在组内比较。
- 子元素编号也必须全项目唯一。
- 动效代码可通过编号取得分组或子元素的放映节点。

### 6.6 视觉效果 `effects`（agent 专属）

```json
"effects": {
  "blend": "multiply",
  "filters": { "grayscale": 1, "blur": 0 },
  "mask": { "type": "linear", "angle": 180, "stops": [ { "offset": 0, "opacity": 1 }, { "offset": 1, "opacity": 0 } ] },
  "clip": { "type": "polygon", "points": [[50,0],[100,50],[50,100],[0,50]] }
}
```

| 键 | 含义 |
|---|---|
| `blend` | 颜色混合模式：normal / multiply / screen / overlay / darken / lighten / difference / soft-light / hard-light |
| `filters` | `grayscale`、`sepia` 0–1；`blur` 像素；`brightness`、`contrast`、`saturate` 倍数（1 = 原样） |
| `mask` | 渐变遮罩：stops 里 `opacity` 1 = 显示、0 = 遮住 |
| `clip` | 多边形裁切：顶点按元素框百分比 |

这些是静态效果（编辑和放映起点均按项目文件绘制）。放映代码可在放映节点上临时改变外观，见 §9。

### 6.7 编号规则

| 类型 | 格式 | 例子 |
|---|---|---|
| 页面 | `page_` + 4–32 位小写字母/数字/下划线 | `page_cover1` |
| 元素 | `el_…` | `el_title1` |
| 素材 | `asset_…` | `asset_city01` |
| 字体 | `font_…` | `font_inter` |

- agent 新建时可以用易读的后缀，但**不要和已有的重复**（校验会报 `DUPLICATE_ID`）。
- 编号一旦写进文件就不改。改名字用 `name`。
- 复制页面到新项目时编号保持不变（§8.4）。

## 7. 颜色、渐变

- 颜色：`#RRGGBB` 或 `#RRGGBBAA`。
- 渐变：`{ "type": "linear" | "radial", "angle": 0–360, "stops": [ { "offset": 0–1, "color": "#…" }, … ] }`，角度同 CSS（0 = 从下到上，90 = 从左到右）。
- 页面背景、形状填充可以用颜色或渐变；文字颜色只能是颜色。

## 8. 素材与字体

### 8.1 素材登记表 `assets`

```json
{ "id": "asset_newpic1", "kind": "image", "file": "assets/new-photo.png",
  "name": "エイ 新拖进来的照片", "width": 400, "height": 300,
  "pendingLayout": true, "addedAt": "2026-10-01T12:30:00.000Z",
  "source": { "type": "upload" } }
```

| 字段 | 说明 |
|---|---|
| `id` | 稳定编号 |
| `kind` | 目前只有 `image` |
| `file` | 相对路径，必须在 `assets/` 下；校验检查文件存在 |
| `pendingLayout` | **待排版标记**。工作台把エイ拖进来的新素材登记为 `true`；agent 把它排进页面后改成 `false` |
| `source` | 来源：`upload`（エイ拖入）/ `library`（从公共素材库取）/ `copied-from-project`（从别的项目复制页面带来） |

**agent 每轮开工要做的事**：`npm run validate <项目>` 会在末尾列出待排版素材；或者直接找 `pendingLayout: true`。

### 8.2 字体登记表 `fonts`

```json
{ "id": "font_inter", "family": "Inter", "file": "fonts/Inter-Variable.ttf",
  "weight": "variable", "style": "normal", "license": "fonts/Inter-OFL.txt" }
```

- 字体文件随项目存在 `fonts/`，这样换机器、存版、复制页面时字体不会丢。
- `weight` 是 100–900 的固定字重或 `"variable"`。
- 建议把许可证文件一起放进 `fonts/` 并在 `license` 里指向它。

### 8.3 公共素材库

`<数据目录>/library/assets/`、`library/fonts/` 是公共库。取用时**复制**一份进项目的 `assets/` 或 `fonts/`，再在登记表登记（`source.type = "library"`）。项目文件里永远不出现指向库的路径。

### 8.4 复制页面到新项目

`npm run copy-pages -- <源项目> <页码,如 1,3> --to <新项目编号>`：新建项目，只复制选中的页，以及这些页用到的素材和字体（文件一起复制，`source` 改为 `copied-from-project`）。页面、元素编号保持不变。源项目不动。

## 9. 动效与换页

### 9.1 文件写法

本轮格式版本为 `2`，旧版本 `1` 的固定轨道不能直接打开；迁移时保留静态元素，将旧 `steps` 的表现重写到 `motion.source`，再把 `formatVersion` 改为 `2`。工作台不会自动丢弃旧动效。

每页可选 `motion`。`steps` 是非负整数，表示这一页有多少次点击推进；`source` 是**内嵌在项目 JSON 中的 JavaScript ES module 字符串**。代码与页面一起存版、复制。旧版 `page.steps`、轨道、固定变化类型均已取消。

```json
"motion": {
  "steps": 2,
  "source": "export default async function(ctx) { const {node} = ctx.element('el_title1'); const pose = node.style.transform; return { async step(index) { await ctx.animate(node, [{ transform: pose + ' translateX(' + index * 120 + 'px)' }, { transform: pose + ' translateX(' + (index + 1) * 120 + 'px)' }], { duration: 500, fill: 'forwards' }); } }; }"
}
```

`source` 必须提供默认导出函数：

```js
export default async function (ctx) {
  // 初始化本页放映状态；不修改 ctx.project、ctx.page 或 project.json
  return {
    async step(index) { /* 点击推进：index 从 0 到 motion.steps - 1 */ },
    async transition({ from, to, direction }) { /* 离开本页时的换页效果 */ },
    dispose() { /* 清理本页自建的节点、监听器、第三方库实例 */ },
  };
}
```

返回对象中的三个函数均可选；但 `steps > 0` 时必须返回 `step` 函数。`steps: 0` 的页面可以只提供 `transition`。每次点击等当前异步步骤完成后才能继续；最后一步完成后的**下一次点击**才翻到下一页。`transition` 接收的 `from` / `to` 是实际放映页 DOM 容器（`to` 为已渲染的下一页），`direction` 为 `1`（前进）或 `-1`（后退）；没有 `transition` 时直接切换。切换或重置时调用 `dispose`。页内自动连续推进可在一次 `step` 内串联多个 `await ctx.animate(...)` 和 `await ctx.timer(...)`，不必增加点击次数。

工作台开着时エイ 和 agent 同时改同一个项目，三方合并把每页 `motion`（`steps` + `source`）当作一个整体：双方都改了时取 agent 的整份并提示エイ，不会把两份代码拼在一起。

从系列母版新建的项目，`series.json` 的 `motions` 里原样记录了母版各页的 `{ pageId, pageName, steps, source }`，供 agent 照着为新页面改写。

### 9.2 工作台提供的 `ctx`

| 成员 | 说明 |
|---|---|
| `ctx.project`、`ctx.page` | 放映初始化时，从最新项目文件复制并递归冻结的只读快照；包含エイ 最新的元素数据。 |
| `ctx.root` | 本页放映 DOM 容器；代码可在其中创建临时粒子等节点。不要修改编辑器 DOM。 |
| `ctx.element(id)` | 返回 `{ node, base }`；`node` 是本页该编号的放映 DOM 节点，`base` 是含 `x/y/width/height/rotation/opacity/颜色/字体/层级` 等属性的冻结元素快照。找不到编号会抛错，动效检查会报告。分组子元素也可查。 |
| `ctx.step` | 当前正在执行的从 0 开始的步索引；初始化时为 `-1`。 |
| `ctx.signal` | `AbortSignal`；翻页、重置时终止，用于清理异步工作。 |
| `ctx.animate(node, keyframes, options)` | 基于浏览器动画 API 播放并返回 `Animation.finished` 的 Promise；工作台登记动画并在终止时取消。 |
| `ctx.timer(ms)` | 等待毫秒数，终止时拒绝 Promise。 |
| `ctx.importModule(path)` | 导入同源本地绝对路径模块，例如 `/vendor/anime.esm.min.js`，返回模块对象。 |
| `ctx.assetUrl(file)` | 将本项目 `assets/` 或 `fonts/` 中的相对文件路径转为本地 URL。 |

动效代码在放映时运行于浏览器。可使用 DOM、Web Animations API，也可导入本地现成库，例如 `await ctx.importModule('/vendor/anime.esm.min.js')`；不依赖云端 CDN。内嵌模块使用数据 URL 加载，因此相对路径及 `/vendor/...` 这样的根路径直接 import 不支持；用 `ctx.importModule` 解析同源本地路径，或 import 完整的本地 HTTP URL。未内置的库可打包内联进 `source`（保留许可证），或由开发者放入本地 `web/vendor/`；后一方式依赖该工作台安装，不随项目存版。第三方库的额外计时器或动画须在 `dispose` 或 `ctx.signal` 中清理。代码异常由动效检查命令报告。动效代码以 `motion.source` 为准；项目文件夹里的附属 .js 不能用 `ctx.importModule` 导入，只当参考或存档。导出放映版时如何打包库见 §12。

### 9.3 从エイ 修改后的状态出发

每次放映，`ctx.element(id).base` 都来自项目文件的最新值；`node` 是按该值渲染的放映节点。相对平移可以用 `transform: translate(...)`，曲线路径可按 `base.width`、`base.height` 算控制点；元素间联动可同时读取两个元素的 `base` 或 DOM 尺寸。不要在代码里固化元素的画板坐标、宽高、文字、颜色、字体、层级，也不要把播放后的样式写回项目文件。若动效跨几个点击持续移动同一元素，应在放映节点上延续前一步状态，或依据 `base` 计算累计位移。

エイ 删除了动效代码引用的元素后，agent 必须修正 `source`；复制元素不会自动复制动效逻辑。编辑器只按文件数据显示静止状态，因此エイ 仍能摆放所有元素，包括放映开头会被隐藏的元素。

### 9.4 检查

首次运行真实浏览器检查或完整测试，先 `npm ci`；浏览器的查找顺序见 §13（Linux CI 用 `npx playwright install --with-deps chromium`）。每个阶段默认上限 5 秒；CLI 每页使用独立浏览器，即使该页同步死循环，也会终止它并继续检查其他页。每页总时限默认按步骤数计算（至少 10 秒）。长动效可用 `npm run check-motion -- <项目> --timeout-ms 15000 --total-timeout-ms 180000` 指定阶段和整页时限。

改完先运行 `npm run validate -- <项目>` 检查项目结构、编号、素材与字体引用，再运行 `npm run check-motion -- <项目>`。后者会实际打开每一页，初始化模块，按顺序执行所有步骤和换页效果，报告语法、导出、运行时及元素查找错误。工作台打开项目时也会提示检查失败的页面。检查通过能发现代码错误；视觉节奏和画面效果仍需在放映中预览。

检查还会在移动、尺寸及样式变体上重跑所有页，覆盖双向换页与清理；不能证明任意代码没有写死坐标。模块是受信任的本地 agent 代码，检查 iframe 只隔离画板，不是恶意代码沙箱；同步无限循环可能卡住工作台，CLI 独立浏览器可由每页总时限退出。

## 10. 版本

- 工作台自动保存：覆盖同一份 `project.json`，不产生历史。
- 产生版本的时机：エイ 手动"存一版"；agent 每轮**动手改之前**执行 `npm run save-version -- <项目> -m "备注"`；エイ 退回到旧版本前，工作台自动存一份「退回前自动存档」。
- 一个版本 = `versions/<时间戳>/` 下项目文件夹里除 `versions/` 外的全部文件（`project.json`（含 `motion.source`）、`assets/`、`fonts/`、`series.json`、附属文件）+ `meta.json`（时间、备注、谁存的）。
- 去重：文件内容按 sha256 存进 `versions/.objects/`，版本目录里是指向它的硬链接，同样的文件只占一份空间。
- 回收：エイ 可以在版本列表里删除版本；「退回前自动存档」只保留最近 10 条（`AUTO_BACKUP_KEEP`）。删除后，不再被任何版本用到的对象自动清掉。agent 不要手动删 `versions/` 或改 `.objects/`。
- 版本编号可能在删除后被复用，不要假设编号单调递增；新旧以 `meta.json` 的 `savedAt` 为准。
- 版本目录不进 git（整个数据目录都不进）。

## 11. 校验

`npm run validate [项目路径或 project.json …]`，不给参数就校验 `examples/` 下全部示例。退出码 0 = 全部通过。

| 错误码 | 含义 |
|---|---|
| `INVALID_JSON` | 文件不存在或不是合法 JSON |
| `SCHEMA` | 不符合 `schema/project.schema.json`（缺字段、类型不对、多了未知字段、编号格式不对……） |
| `DUPLICATE_ID` | 页面 / 元素 / 素材 / 字体编号重复（元素跨全部页面查） |
| `MISSING_ASSET_FILE` | `assets[].file` 在磁盘上不存在 |
| `MISSING_FONT_FILE` | `fonts[].file` 在磁盘上不存在 |
| `UNKNOWN_ASSET_REF` | 图片元素引用了不存在的素材编号 |
| `UNKNOWN_FONT_REF` | 文字元素引用了不存在的字体编号 |
| `OUTLINE_RANGE` | 大纲出现 / 消失屏或精确可见屏范围无效 |
| `OUTLINE_EMPHASIS` | 强调范围重叠或超出文字 |
| `TINT_NEEDS_ALPHA` | 图片设了 `tint`，但素材是没有透明部分的 JPEG |

通过时会额外列出待排版素材。程序内用法：`import { validateProject, validateProjectData } from './src/validate.js'`。

## 12. 导出

命令：`npm run export -- <项目> [--html | --images | --pdf | --all] [--out <目录>]`，默认放在 `<数据目录>/exports/<项目编号>/`。工作台里点顶栏「导出」效果相同，导出完显示文件位置，可一键在访达中显示。导出文件夹在项目文件夹外，不会被当作 agent 的修改，也不进版本。

| 类型 | 内容 |
|---|---|
| 放映版 HTML | 一个文件，双击离线放映（不需要工作台、不联网），手机也能开。包含全部页面、`motion.source`、动效用到的库和许可证。点击 / 空格 / → 前进，← 后退，左右滑动翻页，F 全屏 |
| 图片 | 每页一张 PNG，尺寸 = 画板尺寸，文件名 `NN-页面名.png` |
| PDF | 每页一张（JPEG 质量 90 嵌入），页面尺寸 = 画板 px × 0.75 pt；文字不可选中 |

- 瘦身（放映版）：字体子集化成 woff2，只留用到该字体的文字、所有 `motion.source` 里的字符和基本 ASCII；图片缩到最大显示尺寸（不放大），透明图保留 PNG，不透明图取 JPEG（质量 85）与 PNG 中更小的；页面没用到、动效代码也没提到的素材不打包。
- 动效库：只打包 `ctx.importModule('/…')` 里**写成字面量**的路径，文件从 `web/` 取，旁边的 `LICENSE-*` 一起写进注释；拼接出来的路径打包不到（导出时给警告），路径不存在时导出报错。
- 动效代码在运行时临时写进页面的文字，最好直接出现在 `source` 里，否则字体子集里可能缺字。
- 图片 / PDF 用的是**每页动效全部播完后的最终画面**：依次执行全部 `step`，等没被 await 的动画也播完，无限循环的动画停在当前帧；`transition` 不执行。所以最后一步应停在想展示的画面上。
- 动效出错或卡住时导出失败，提示里有页码和页面编号；放映版 HTML 遇到出错的页会提示，再点一下直接去下一页。
- 放映版 HTML 超过 15 MB 时照样导出，但会给出各部分大小，需停下来报告。
- 检查导出的放映版：`npm run check-motion -- <文件.html>`。

## 13. 浏览器

动效检查、导出图片 / PDF 要在后台开一个浏览器，按顺序找：Mac 上装的 Google Chrome → Microsoft Edge → Playwright 自带的 Chromium → Playwright 自带的 WebKit（Safari 内核）。都没有时给中文提示：安装 Chrome，或在工作台文件夹运行 `npx playwright install chromium`。环境变量 `VW_BROWSER=chrome|chromium|webkit` 可只用指定的一种。

## 14. 示例


`examples/sample-deck/`：演示多元素连续联动、同一元素跨步变化、现成库效果与自定义换页，并含待排版素材、随项目存放的字体和分组。

## 15. 大纲与按大纲排版

大纲直接存入本项目 `project.json` 的每个 `pages[].outline`，与画布元素分开记录。格式仍为 v2：旧项目可以省略大纲，没有大纲时编辑器显示起始引导。大纲使用同一份项目文件，所以自动保存、版本存档、退回、复制页面与 agent 改文件后的实时刷新都会包含它。放映和导出仍只使用 `elements` 与 `motion`；大纲不自动排版。

```json
"outline": {
  "screens": 2,
  "notes": "标题稳重，第二屏突出结论",
  "rows": [
    { "id": "row_title001", "role": "title", "text": "先理解，再行动",
      "emphasis": [{ "start": 0, "end": 3 }], "from": 1, "until": null },
    { "id": "row_detail01", "role": "body", "text": "第二屏的结论",
      "emphasis": [], "from": 2, "until": null }
  ],
  "images": [
    { "id": "image_main01", "asset": "asset_city01", "caption": "这张做主图",
      "from": 1, "until": null }
  ]
}
```

### 15.1 文案、强调、图片和备注

- `screens`：至少 1 屏。大纲第 1 屏是动效初始化完成、`step(0)` 尚未执行的画面；第 k+1 屏是第 k 步完成后的画面。N 屏排版后写 N−1 个 `motion.steps`。编辑器的「全部显示」另外保留，用于摆放所有静态元素。
- `rows`：有稳定 `row_…` 编号的行；`role` 是 `title` 大标题 / `subtitle` 小标题 / `english` 英文副标题 / `body` 正文 / `note` 注释。层级表达文案关系，字体和样式由 agent 排版决定。
- `emphasis`：不重叠的 `{start,end}` 范围，索引按 JavaScript 字符串的 UTF-16 代码单元计，左闭右开；例如 0–3 选中前三个普通汉字。高亮只提示 agent 这段要突出，不规定画布上的强调写法。
- `images`：稳定 `image_…` 编号、项目已登记的 `asset`、`caption` 说明。取公共素材库图片时先复制进项目，再登记引用；只放进大纲不会自动放进画布。复制页面时也带走大纲引用的素材。
- `notes`：整页感觉或要求，不参与渲染。
- `from`：开始出现的屏，包含该屏；`until`：开始消失的屏，不包含该屏，`null` 表示不消失。添加下一屏默认沿用前一屏；新行从当前屏开始。特殊动效可使用 `visibleOn: [1,3]` 明确在第 1、3 屏显示，优先于范围；空数组表示所有屏都隐藏。新增屏沿用上一屏实际可见的条目。

### 15.2 与画布条目对上

排版后在条目上填写 `elementId`，指向本页文字或图片元素（含组内子元素）；文字条目与文字元素一对一。留下条目的 `baseline`（落实后的 text/role/emphasis/from/until/visibleOn；图片为 asset/caption/from/until/visibleOn），并在 `outline.baseline` 保存 `{screens,rows,images}` 的完整条目快照，快照不包含条目内的 baseline。它们记录上次真正落实的内容，不能随大纲编辑自动更新；重新排版后由 agent 更新。

「把文字改动应用到画布」先自动存版，只更新已经对应的文字元素 `text` 和相应文字基准。任何坐标、尺寸、字体、颜色、描边、层级等原封不动。新增或删行、改层级、强调、屏数、显示范围、图片和找不到的对应关系会列出，交给 agent 处理。画布文字与基准不符时保留画布上的改字并列出冲突，避免悄悄覆盖エイ 的修改。没有基准的对应关系不能盲目覆盖。

「从画布提取大纲」先在隔离画板实际初始化动效并依次捕捉每一屏的可见元素，成功后自动存版，再覆盖所选页大纲。文字从项目元素取，图片从其素材引用取；优先沿用已对应条目的层级，没有对应关系时按字号等推断。分组中的文字图片同样提取，祖先 display:none、透明度为 0 或元素继承不可见时也视为隐藏；子元素明确覆盖 visibility 为 visible 时按浏览器实际规则显示。动效运行失败会中止提取，保留原大纲。复杂裁切、遮罩和画板外运动不等于结构上的隐藏，提取不做像素识别。

### 15.3 保存、协作与接口

普通大纲编辑沿用 `PUT /api/projects/:id` 的项目保存与 revision 冲突保护；外部修改由原有监听和三方合并同步。两个覆盖操作使用 `POST /api/projects/:id/outline/extract`（`{revision,outlines:{pageId:outline}}`）和 `POST /api/projects/:id/outline/apply`（`{revision,pageIds}`），写入前核对 revision、校验并存版。返回最新 project、revision、备份信息及应用 / 未应用结果。「复制给 agent」用 `GET /api/projects/:id/outline/brief?pageIds=…`，指定稳定页面编号，返回项目文件绝对路径和可粘贴的排版要求；省略页号表示全部页。

校验大纲的字段、编号、层级、强调范围、屏范围和图片素材引用。旧对应元素被删除时允许打开项目，但应用文字会报告未落实项；这不是自动删掉条目的理由。大纲屏数和 motion.steps 尚未对上是「待排版」状态，不阻止エイ 写大纲。agent 完成排版后必须自行核对 N 屏 = N−1 步并运行结构、动效检查。
