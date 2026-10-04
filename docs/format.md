# 视觉工作台 · 项目格式（v2）

机器可读定义：`schema/project.schema.json`（JSON Schema 2020-12）。示例：`examples/sample-deck/`。校验：`npm run validate <项目路径>`。

本文是给 agent 和用户看的说明书。**schema 与本文冲突时以 schema 为准**，并请修正本文。

## 1. 设计原则

1. **项目文件是唯一的真相来源**：用户和 agent 读写同一份 `project.json`。放映动效不能回写编辑数据。
2. **编号稳定**：页面、元素、素材、字体的 `id` 一旦生成就不改。动效按元素编号查找，不按数组位置或名字。
3. **动效由 agent 自由写代码**：每页可内嵌一个 JavaScript ES module。没有固定动效种类；放映器只负责提供最新元素状态与点击步数。
4. **布局取实时数据**：每次放映从最新项目文件创建只读快照。代码根据元素当前的位置、尺寸、外观计算动效，用户挪动、缩放或改字后仍能从新状态出发。
5. **编辑默认全部显示**：默认按项目文件画静止状态；可以手动查看动效的第 N 屏。动效及换页只在放映、屏幕视图、预览、检查和导出时运行，不回写编辑数据。
6. **素材随项目走**：素材、字体文件都存在项目文件夹里。

## 2. 文件与目录

### 2.1 数据目录

以总览「数据文件夹」显示的路径为准。优先级：命令行 `--data-dir` > 环境变量 `VW_DATA_DIR` > 用户主目录 `.visual-workbench/config.json` > 仓库 `workbench.config.json`；无本机配置时保留仓库默认值。用 `npm run init-data` 建出初始结构：

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
  workbench-state.json      哪些项目是系列母版（用户在界面上标）
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
- `outline`：可选，页内联动文稿及排版要求；见 §15。
- `motion`：可选。`steps` 是点击推进的次数，`source` 是本页动效与离页换页代码，见 §9。没有动效可省略 `motion`。

页码 = 在 `pages` 里的位置（从 1 数）。页码会随增删变化，所以工具间传递用 `id`，只有给用户看的命令行参数用页码。

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

**用户在工作台里改的就是这些**：`x` `y` `width` `height` `rotation` `zIndex`，以及文字类的 `text` `color` `font` `fontSize` 等。agent 下一轮必须以文件里的最新值为准。

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
- 描边和阴影是**元素属性**：编辑、放映、动效检查、导出（放映版 HTML、图片、PDF）都按同一份画法显示。不要再在动效代码里临时加描边 / 阴影（那样只在放映时出现）。用户可以在工作台里改它们，改过的值 agent 不动。

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
- `tint`（可选）：重新着色，`"#RRGGBB[AA]"` 或 `null`（原色）。设了以后，图片按自己的透明度当形状，整体画成这一种颜色——用来给**单色矢量标志（SVG）**换颜色，透明底的单色 PNG / WebP 也可以。多色图片会变成一块单色剪影；JPEG 没有透明部分，会整块变成纯色，所以校验会报 `TINT_NEEDS_ALPHA`。用户可以在工作台里改颜色。

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
  "name": "用户新拖进来的照片", "width": 400, "height": 300,
  "pendingLayout": true, "addedAt": "2026-10-01T12:30:00.000Z",
  "source": { "type": "upload" } }
```

| 字段 | 说明 |
|---|---|
| `id` | 稳定编号 |
| `kind` | 目前只有 `image` |
| `file` | 相对路径，必须在 `assets/` 下；校验检查文件存在 |
| `pendingLayout` | **待排版标记**。工作台把用户拖进来的新素材登记为 `true`；agent 把它排进页面后改成 `false` |
| `source` | 来源：`upload`（用户拖入）/ `library`（从公共素材库取）/ `copied-from-project`（从别的项目复制页面带来） |

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

工作台开着时用户和 agent 同时改同一个项目，三方合并把每页 `motion`（`steps` + `source`）当作一个整体：双方都改了时取 agent 的整份并提示用户，不会把两份代码拼在一起。

从系列母版新建的项目，`series.json` 的 `motions` 里原样记录了母版各页的 `{ pageId, pageName, steps, source }`，供 agent 照着为新页面改写。

### 9.2 工作台提供的 `ctx`

| 成员 | 说明 |
|---|---|
| `ctx.project`、`ctx.page` | 放映初始化时，从最新项目文件复制并递归冻结的只读快照；包含用户最新的元素数据。 |
| `ctx.root` | 本页放映 DOM 容器；代码可在其中创建临时粒子等节点。不要修改编辑器 DOM。 |
| `ctx.element(id)` | 返回 `{ node, base }`；`node` 是本页该编号的放映 DOM 节点，`base` 是含 `x/y/width/height/rotation/opacity/颜色/字体/层级` 等属性的冻结元素快照。找不到编号会抛错，动效检查会报告。分组子元素也可查。 |
| `ctx.step` | 当前正在执行的从 0 开始的步索引；初始化时为 `-1`。 |
| `ctx.signal` | `AbortSignal`；翻页、重置时终止，用于清理异步工作。 |
| `ctx.animate(node, keyframes, options)` | 基于浏览器动画 API 播放并返回 `Animation.finished` 的 Promise；工作台登记动画并在终止时取消。 |
| `ctx.timer(ms)` | 等待毫秒数，终止时拒绝 Promise。 |
| `ctx.importModule(path)` | 导入同源本地绝对路径模块，例如 `/vendor/anime.esm.min.js`，返回模块对象。 |
| `ctx.assetUrl(file)` | 将本项目 `assets/` 或 `fonts/` 中的相对文件路径转为本地 URL。 |

动效代码在放映时运行于浏览器。可使用 DOM、Web Animations API，也可导入本地现成库，例如 `await ctx.importModule('/vendor/anime.esm.min.js')`；不依赖云端 CDN。内嵌模块使用数据 URL 加载，因此相对路径及 `/vendor/...` 这样的根路径直接 import 不支持；用 `ctx.importModule` 解析同源本地路径，或 import 完整的本地 HTTP URL。未内置的库可打包内联进 `source`（保留许可证），或由开发者放入本地 `web/vendor/`；后一方式依赖该工作台安装，不随项目存版。第三方库的额外计时器或动画须在 `dispose` 或 `ctx.signal` 中清理。代码异常由动效检查命令报告。动效代码以 `motion.source` 为准；项目文件夹里的附属 .js 不能用 `ctx.importModule` 导入，只当参考或存档。导出放映版时如何打包库见 §12。

### 9.3 从用户修改后的状态出发

每次放映，`ctx.element(id).base` 都来自项目文件的最新值；`node` 是按该值渲染的放映节点。相对平移可以用 `transform: translate(...)`，曲线路径可按 `base.width`、`base.height` 算控制点；元素间联动可同时读取两个元素的 `base` 或 DOM 尺寸。不要在代码里固化元素的画板坐标、宽高、文字、颜色、字体、层级，也不要把播放后的样式写回项目文件。若动效跨几个点击持续移动同一元素，应在放映节点上延续前一步状态，或依据 `base` 计算累计位移。

用户删除了动效代码引用的元素后，agent 必须修正 `source`；复制元素不会自动复制动效逻辑。编辑器只按文件数据显示静止状态，因此用户仍能摆放所有元素，包括放映开头会被隐藏的元素。

### 9.4 检查

首次运行真实浏览器检查或完整测试，先 `npm ci`；浏览器的查找顺序见 §13（Linux CI 用 `npx playwright install --with-deps chromium`）。每个阶段默认上限 5 秒；CLI 每页使用独立浏览器，即使该页同步死循环，也会终止它并继续检查其他页。每页总时限默认按步骤数计算（至少 10 秒）。长动效可用 `npm run check-motion -- <项目> --timeout-ms 15000 --total-timeout-ms 180000` 指定阶段和整页时限。

改完先运行 `npm run validate -- <项目>` 检查项目结构、编号、素材与字体引用，再运行 `npm run check-motion -- <项目>`。后者会实际打开每一页，初始化模块，按顺序执行所有步骤和换页效果，报告语法、导出、运行时及元素查找错误。工作台打开项目时也会提示检查失败的页面。检查通过能发现代码错误；视觉节奏和画面效果仍需在放映中预览。

检查还会在移动、尺寸及样式变体上重跑所有页，覆盖双向换页与清理；不能证明任意代码没有写死坐标。模块是受信任的本地 agent 代码，检查 iframe 只隔离画板，不是恶意代码沙箱；同步无限循环可能卡住工作台，CLI 独立浏览器可由每页总时限退出。

## 10. 版本

- 工作台自动保存：覆盖同一份 `project.json`，不产生历史。
- 产生版本的时机：用户手动"存一版"；agent 每轮**动手改之前**执行 `npm run save-version -- <项目> -m "备注"`；用户退回到旧版本前，工作台自动存一份「退回前自动存档」。
- 一个版本 = `versions/<时间戳>/` 下项目文件夹里除 `versions/` 外的全部文件（`project.json`（含 `motion.source`）、`assets/`、`fonts/`、`series.json`、附属文件）+ `meta.json`（时间、备注、谁存的）。
- 去重：文件内容按 sha256 存进 `versions/.objects/`，版本目录里是指向它的硬链接，同样的文件只占一份空间。
- 回收：用户可以在版本列表里删除版本；「退回前自动存档」只保留最近 10 条（`AUTO_BACKUP_KEEP`）。删除后，不再被任何版本用到的对象自动清掉。agent 不要手动删 `versions/` 或改 `.objects/`。
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

命令：`npm run export -- <项目> [--html | --images | --pdf | --all] [--out <目录>]`，默认放在 `<数据目录>/exports/<项目编号>/`。工作台里点顶栏「导出」效果相同，导出完显示文件位置，可一键在访达或资源管理器中显示。导出文件夹在项目文件夹外，不会被当作 agent 的修改，也不进版本。

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

动效检查、导出图片 / PDF 要在后台开一个浏览器，按顺序找：当前系统安装的 Google Chrome → Microsoft Edge（Windows 包含系统级和用户级安装） → Playwright 自带的 Chromium → Playwright 自带的 WebKit（Safari 内核）。都没有时给中文提示：安装 Chrome，或在工作台文件夹运行 `npx playwright install chromium`。环境变量 `VW_BROWSER=chrome|chromium|webkit` 可只用指定的一种。

## 14. 示例


`examples/sample-deck/`：演示多元素连续联动、同一元素跨步变化、现成库效果与自定义换页，并含待排版素材、随项目存放的字体和分组。

## 15. 当前页联动文稿与按大纲排版

右侧面板「大纲」只显示当前页；左侧换页跟着换文稿。旧的全页卡片、提取和应用按钮已移除。数据仍在本项目 `project.json` 的 `pages[].outline`，沿用格式 v2、版本存档、退回、复制页面、revision 校验与实时文件监听。放映 / 导出只读 elements 和 motion，不读取大纲来生成动画。

```json
"outline": {
  "mode": "document",
  "screens": 2,
  "notes": "第二屏突出结论",
  "rows": [
    {"id":"row_title001","elementId":"el_title1","role":"title","text":"先理解，再行动",
     "emphasis":[{"start":0,"end":3}],"from":1,"until":null},
    {"id":"row_detail01","elementId":"el_detail1","role":"body","text":"第二屏的结论",
     "emphasis":[],"from":2,"until":null}
  ],
  "images": [{"id":"image_main01","asset":"asset_city01","caption":"这张做主图","from":1,"until":null}]
}
```

### 15.1 段落与元素

`mode` 可省略以兼容第 6 轮项目；新联动文稿为 `"document"`。`rows` 的稳定 row 编号对应稳定 `elementId`，一段一个 text 元素，包含组内文字。角色 title / subtitle / english / body / note 对应大标题 / 小标题 / 英文副标题 / 正文 / 注释。正文用空行分段，单换行仍是段内换行；其他角色 Enter 新建下一段。

输入修改立即写映射元素的 text；删除段落会删除对应元素，画布改字 / 删元素也更新文稿。已有元素的几何与样式不随改字变化。通过 `PUT /api/projects/:id` 自动保存，进入原有撤销 / 重做。agent 从文件修改时，以元素 text 为文字源，同时更新对应行 text，不要只改行文案。重排保留稳定映射，避免把两个条目指向同一元素。

文字元素新增可选 `decorative: boolean`：true 表示纯装饰文字，完全排除在文稿外；默认 false。不要按大小、锁定状态排除正文。新增可选 `documentDraft: boolean`：true 表示工作台尚未排版的草稿，可按角色默认字号（64 / 40 / 28 / 28 / 20）和内容调整自身框。手动改位置、尺寸、样式时清除此标记；agent 完成排版也必须清除。没有此标记的现有文字仅改 text，绝不重排。

新草稿从 48px 安全边距找空位，依内容估算框高，尝试同列下方及其他空列，避开现有内容及旋转分组的保守边界。满画板背景 shape / image 及 decorative 文字不算内容障碍。画板确实没有空位时放在内容下方并提示移交 agent 排版，不挪动其他元素。手动摆过的元素永不自动挪开。

`emphasis` 为不重叠的 `{start,end}` UTF-16 左闭右开范围；只在文稿里显示荧光高亮，不改任何画布元素属性。改写一段的文字时清除该段旧强调范围，避免错误强调其他字。角色、强调、图片说明和 notes 是 agent 的排版要求；切角色只会改变未被手调的草稿默认样式。图片先从公共素材库复制到项目 assets，再记录 asset / caption；不会自动新增画布图片。

### 15.2 多屏

`screens` 至少 1。第 1 屏是动效初始化之后、step(0) 之前；第 k+1 屏是第 k 步完成后，N 屏对应 N−1 步。「全部显示」额外保留，用于编辑全部内容。

`from` 包含开始屏，`until` 不包含开始消失屏，null 表示不消失；`visibleOn: [1,3]` 优先于范围，空数组表示所有屏隐藏。新增屏沿用上一屏实际可见内容，新段从当前屏起出现。「从本屏消失」隐藏当前及后续所有屏；可在全部显示里找到隐藏段。

屏按钮和画布下拉双向同步。大纲期望屏数与 motion.steps 不相符时提示交给 agent；画布仍按已有源码运行到可用步骤，不代写缺失动效。每屏可删：其后重编号，跨屏段保留剩余可见屏，只在被删屏出现的段移到下一保留屏（末屏则上一屏），原本全部隐藏的段继续隐藏。删唯一屏后重建第 1 屏并保留内容，避免误删文案。删屏不改 motion.source，由 agent 同步源码。

### 15.3 兼容、版本与协作

旧项目无 outline 时按现有文字生成文稿；有动效时首次打开在隔离画板自动捕捉每屏可见性，不需要提取按钮。动效失败或单屏超过 10 秒则显示全部文案并提示交给 agent 校对。捕捉判断 DOM 可见性，不识别裁切 / 遮罩 / 移出画板的像素级可见性。无映射层级按字号和英文内容粗略推断。已有第 6 轮 outline 首次转联动前自动存版，不弹确认。已有对应文字以最新画布为准；旧大纲待应用文字若画布未变，只改 text；两边冲突时保留画布文字，将待应用文案另建草稿，避免丢字。无对应条目转为新草稿，装饰文字除外。转换完成后 canvas 是联动文字源，删掉映射元素即移除文稿段，不会重新生成已删除元素。

行 `baseline` 用作当前同步基准，随联动更新。`outline.baseline` 保留 agent 上次排版的完整 `{screens,rows,images}` 快照，不能随输入更新；agent 排版后再更新。版本、退回和复制继续包含整份 project.json 和大纲图片素材。

`GET /api/projects/:id/outline/brief?pageIds=…` 沿用现有复制接口，给出绝对文件路径与稳定页编号；省略编号表示全部页。旧 `POST /outline/extract`、`POST /outline/apply` 和隔离捕捉模块保留作为第 6 轮兼容接口，界面不再调用，也不是新工作流入口。

校验继续检查字段类型、角色、编号、强调和屏范围、图片引用及重复映射；暂时找不到的旧映射允许打开以便迁移。多屏与动效尚未一致不阻止写文稿。完成排版必须核对映射、N 屏 = N−1 步，运行 validate 与 check-motion；改工作台代码另跑 npm test。


## 本机配置、同步标记与填大纲（第 7 轮）
项目格式仍为 v2，未新增必填项目字段。本机配置位于 `~/.visual-workbench/config.json`，形如 `{"dataDir":"本机绝对路径"}`；优先级是命令行 > VW_DATA_DIR > 本机 > 仓库。设置不进入项目、存版、复制页或导出，路径必须指向已有数据目录，保存后重启生效。

数据根目录 `.workbench-sessions/*.json` 是运行状态，记录电脑、会话、开始与更新时间；15 秒心跳、90 秒过期，确认只认可当时看到的会话，新出现的会话仍需提示。标记不放进 project.json，不随项目存版/复制/导出。正常关闭删除自身标记。Google Drive 异步同步不能提供离线互斥保证。

「请填大纲」沿用 pages[].outline 的 document 模式：按文档分页与 role、emphasis、images[].caption、notes 填写，每行 elementId 对应独立草稿文字。新元素 documentDraft:true，使用默认草稿位置；已有元素只按授权改 text，不改坐标和样式，不写 motion。行 baseline 是同步基准；outline.baseline 的已排版快照不能被未排版稿替换。「请排版」阶段再设计样式与 N−1 个动效步骤。两种复制说明都包含实际数据目录及项目路径。

### 第 8 轮：不透明度与翻转

所有元素（文字、图片、形状、分组）可写 `opacity`（0–1，默认 1）、`flipX` / `flipY`（布尔值，默认 false）。翻转绕元素中心；分组翻转整个子树，子元素自己的翻转继续叠加。字段属于持久外观，编辑、放映、离线 HTML 与图片/PDF 导出使用同一渲染规则。动效 `ctx.element(id).base` 包含这些字段，并从最新项目重新创建。

翻转应用在内容内层，动效仍可修改 `ctx.element(id).node` 的外层 `transform`，不会抹掉持久翻转。`opacity` 保留在元素外层；动效若自行修改外层 opacity，应从 `base.opacity ?? 1` 计算。

编辑器吸附阈值按屏幕像素换算成画板单位，Alt 暂时关闭吸附。移动使用选中对象的整体范围；参考包含锁定元素，但排除覆盖整页的背景及正在移动的对象。缩放按当前手柄允许的尺寸方向吸附，保持对边不动；旋转和组内缩放将边框投影到页面坐标，浅角度会引起过大尺寸跳变时不强行吸附。多选一起缩放时以整体页面边框吸附，统一修正鼠标增量，各自保持对边锚点。对齐使用选中对象的整体范围，分布需要至少三个对象并均匀排列空隙；分组作为整体，子元素相对坐标不改变。

### 项目回收与完整副本（第 8 轮）
数据根目录 `.trash/trash-<UUID>/` 包含 `meta.json`（`projectId`、`name`、`deletedAt`、`master`）和原项目文件夹 `project/`。删除项目是同数据盘内的改名移动，不丢文件；恢复遇到同编号项目会拒绝覆盖。永久删除只能针对回收记录；删除时间满 7 天（包含恰好 7 天）的项目在下次未被其他电脑阻挡的启动时清理。回收站作为普通本地文件夹随网盘同步，不进入项目格式和导出。

完整复制生成新项目编号，保留素材、字体、动效、大纲及其他项目附属文件，`versions/` 为空；重命名只修改项目名称和更新时间，编号与文件夹保持。界面的页面和元素剪贴板在当前浏览器会话中保存，仅支持同项目，不向别的项目写素材引用。复制页面会重映射完整的元素编号与大纲映射；动态拼接的编号仍须 agent 校对。

关闭工作台按钮先等待当前自动保存，保存失败时不关闭；成功后 `POST /api/shutdown` 清除当前服务自己的使用标记、结束实时连接与本机服务。停止过程中尚未完整到达的写请求拒绝写入。用户可直接关闭显示「工作台已关闭，可以关掉这个窗口了」的浏览器窗口。
