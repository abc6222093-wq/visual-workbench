# 视觉工作台 · 项目格式（v1）

机器可读定义：`schema/project.schema.json`（JSON Schema 2020-12）。示例：`examples/sample-deck/`。校验：`npm run validate <项目路径>`。

本文是给 agent 和エイ看的说明书。**schema 与本文冲突时以 schema 为准**，并请修正本文。

## 1. 设计原则

1. **一个项目一个文件**：`project.json` 是唯一的真相来源。エイ 的工作台和 agent 读写同一份。
2. **每个东西有稳定编号**：页面、元素、素材、字体、步骤都有 `id`，一旦生成就不再改。工具、动效、交接都认编号，不认名字和顺序。
3. **动效只挂编号、只写相对变化**：动效永远不说"移到 (500, 300)"，只说"向右移 120"、"放大到 0.85 倍"。エイ 把元素拖到哪里，动效都从那里开始。
4. **能用数据就不用代码**：动效用 JSON 描述，不允许 agent 写脚本。理由见 §9.9。
5. **素材随项目走**：素材、字体文件都存在项目文件夹里，项目之间不共用引用。

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
  "formatVersion": 1,
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
  "steps": [ … ]
}
```

- `background`：颜色或渐变（§7）。
- `elements`：元素列表，见 §6。画面上的叠放顺序由每个元素的 `zIndex` 决定，不由数组顺序决定。
- `steps`：动效步骤，见 §9。没有动效就写 `[]`。

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

### 6.3 图片 `image`

```json
{ "id": "el_bgphoto", "type": "image", "x": 0, "y": 0, "width": 1920, "height": 1080, "zIndex": 0,
  "asset": "asset_city01", "fit": "cover" }
```

- `asset`：引用 `assets[].id`，校验会检查它存在。
- `fit`：cover（裁满）/ contain（完整放进去）/ fill（拉伸）。

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
- 动效可以挂在分组上（整组一起动），也可以挂在子元素上。

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

这些是静态效果（页面一打开就这样）。要在动效里变化它们，见 §9.5。

### 6.7 编号规则

| 类型 | 格式 | 例子 |
|---|---|---|
| 页面 | `page_` + 4–32 位小写字母/数字/下划线 | `page_cover1` |
| 元素 | `el_…` | `el_title1` |
| 素材 | `asset_…` | `asset_city01` |
| 字体 | `font_…` | `font_inter` |
| 步骤 | `step_…` | `step_cover_in` |

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

`npm run copy-pages -- <源项目> <页码,如 1,3> --to <新项目编号>`：新建项目，只复制选中的页，以及这些页用到的素材和字体（文件一起复制，`source` 改为 `copied-from-project`）。页面、元素、步骤编号保持不变。源项目不动。

## 9. 动效

### 9.1 两条硬规则

1. **只挂元素编号**：每条轨道的 `target` 是一个本页元素的 `id`。
2. **只写相对变化**：位置/大小/旋转/透明度只能 `{"by": 数值}`，缩放只能 `{"times": 倍数}`，滤镜只能 `{"by": 数值}`。写 `{"to": …}` 或直接写数字，校验报 `RELATIVE_ONLY`。

"相对当前状态"的意思：轨道开始时元素是什么样（文件里的布局，叠加之前步骤已经做过的变化），就从那里变。エイ 把元素从 (200, 200) 拖到 (500, 500)，"向左移 120" 这条动效完全不用改。

### 9.2 结构：步骤 → 轨道 → 变化

```json
"steps": [
  {
    "id": "step_cover_bullets",
    "name": "点击：三条要点依次淡入",
    "trigger": "click",
    "delay": 0,
    "tracks": [
      { "target": "el_bullet1", "delay": 0,   "duration": 400, "easing": "ease-out", "change": { "appear": true } },
      { "target": "el_bullet2", "delay": 250, "duration": 400, "change": { "appear": true } },
      { "target": "el_bullet3", "delay": 500, "duration": 400, "change": { "appear": true } }
    ]
  }
]
```

| 层 | 字段 | 说明 |
|---|---|---|
| 步骤 `step` | `trigger` | `click`：等エイ/观众点一下才开始；`auto`：上一步结束后自动开始（第一步 `auto` = 页面一打开就播） |
| | `delay` | 触发后再等多少毫秒 |
| | `tracks` | 这一步里一起执行的轨道，至少一条 |
| 轨道 `track` | `target` | 元素编号 |
| | `delay` | 相对步骤开始的毫秒 |
| | `duration` | 毫秒，0 = 瞬间 |
| | `easing` | linear / ease / ease-in / ease-out / ease-in-out |
| | `change` | 变化内容，至少一项 |

一个步骤的时长 = 其中最晚结束的轨道（delay + duration）。

### 9.3 变化项一览

| 键 | 写法 | 含义 |
|---|---|---|
| `appear` | `true` | 从隐藏变为显示（在 duration 内淡入） |
| `disappear` | `true` | 从显示变为隐藏（淡出） |
| `x` / `y` | `{"by": 120}` | 平移（画板像素） |
| `width` / `height` | `{"by": -40}` | 宽高增减 |
| `rotation` | `{"by": 15}` | 旋转角度增减 |
| `opacity` | `{"by": -0.5}` | 透明度增减，结果夹在 0–1 |
| `scale` | `{"times": 0.85}` | 以元素中心缩放的倍数 |
| `color` | `{"to": "#ef4444"}` | 文字颜色 / 形状填充色变成这个颜色 |
| `blend` | `{"to": "multiply"}` | 混合模式切换 |
| `filters` | `{"grayscale": {"by": 1}}` | 滤镜数值增减 |
| `mask` | `{"to": {…渐变遮罩…}}` 或 `{"to": null}` | 换遮罩 / 去掉遮罩 |
| `clip` | `{"to": {…多边形…}}` 或 `{"to": null}` | 换裁切形状 / 去掉裁切 |

同一条轨道里不能同时 `appear` 和 `disappear`。

**为什么 color / blend / mask / clip 用 `to`**：这几项不含任何位置、大小信息，エイ 挪动元素不会影响它们；而"颜色相对变化"（色相偏移多少度）agent 几乎无法精确控制，所以用目标值。裁切顶点和遮罩都按元素框百分比/比例表达，本身就是相对元素的。

### 9.4 初始可见性

页面打开时：某元素在本页步骤里的**第一次**可见性变化若是 `appear`，它初始隐藏；否则初始显示。
所以"点击才出现"的元素，在工作台编辑时是正常可见的（エイ 要能摆它），播放时才隐藏到出现。

### 9.5 效果变化

静态 `effects`（§6.6）给的是起点；动效里 `filters.*.by` 从起点加减，`blend/mask/clip.to` 直接替换。裁切用相同顶点数时可以做形状渐变（示例第 3 页菱形 → 六边形）。

### 9.6 要求表达的效果，各怎么写

| 效果 | 写法 | 示例位置 |
|---|---|---|
| 依次淡入 | 一个步骤里多条 `appear` 轨道，`delay` 递增 | 第 1 页 `step_cover_bullets` |
| 点击才出现 | 步骤 `trigger: "click"` + `appear` | 同上 |
| 点一下画面连续推进一段 | `click` 步骤后面跟一个或多个 `auto` 步骤 | 第 2 页 `step_scene_push1` → `step_scene_push2` |
| 多个元素联动平移缩放 | 同一步骤里多条轨道，各自 `x/y.by` + `scale.times` | 第 2 页 `step_scene_push1` |
| 同一元素在不同步骤之间移动并变色 | 多个步骤各有一条指向同一元素的轨道，`x.by` + `color.to` | 第 2 页 `step_scene_marker1` / `marker2` |
| 渐变遮罩 | 静态 `effects.mask`；动效 `mask.to` | 第 1 页 `el_bgphoto` / `step_cover_mask` |
| 颜色混合（multiply 等） | 静态 `effects.blend`；动效 `blend.to` | 第 2 页 `el_tint2` |
| 黑白等滤镜 | 静态 `effects.filters.grayscale`；动效 `filters.grayscale.by` | 第 2 页 `step_scene_gray` |
| 多边形裁切 | 静态 `effects.clip`；动效 `clip.to` | 第 3 页 `el_clipimg3` / `step_clip_morph` |

### 9.7 做不到 / 不做的

- **沿曲线路径运动**：目前只有直线平移。要拐弯就拆成多个 `auto` 步骤。
- **逐字出现的文字动效**：没有。要的话把文字拆成多个元素。
- **循环/往返动效**：没有。写两个步骤。
- **元素之间的"跟随/吸附"关系**：没有。
- 这些都是故意不做的，为了格式简单、エイ挪元素不出事。以后真需要再加，并升 `formatVersion`。

### 9.8 agent 写动效的检查单

1. `target` 是本页存在的元素编号。
2. 几何只写 `by`，缩放只写 `times`，没有 `to`、没有裸数字。
3. 多步骤连续推进时，心里算一下累计位移，别把元素推出画板。
4. 写完 `npm run validate <项目>`。

### 9.9 为什么用数据而不是让 agent 写代码

- 校验器能检查数据（编号存在、只用相对变化）；代码检查不了。
- 工作台渲染数据是安全的，执行 agent 写的代码有风险，也更难做"エイ挪动后动效照跑"。
- エイ 不看代码；数据至少能在工作台里列成"第几步、哪个元素、做什么"。
- 代价：表达力有上限（§9.7）。接受。

## 10. 版本

- 工作台自动保存：覆盖同一份 `project.json`，不产生历史。
- 产生版本只有两种时机：エイ 手动"存一版"；agent 每轮**动手改之前**执行 `npm run save-version -- <项目> -m "备注"`。
- 一个版本 = `versions/<时间戳>/` 下的 `project.json` + `assets/` + `fonts/` 完整快照 + `meta.json`（时间、备注、谁存的）。
- 版本目录不进 git（整个数据目录都不进）。

## 11. 校验

`npm run validate [项目路径或 project.json …]`，不给参数就校验 `examples/` 下全部示例。退出码 0 = 全部通过。

| 错误码 | 含义 |
|---|---|
| `INVALID_JSON` | 文件不存在或不是合法 JSON |
| `SCHEMA` | 不符合 `schema/project.schema.json`（缺字段、类型不对、多了未知字段、编号格式不对……） |
| `DUPLICATE_ID` | 页面 / 元素 / 素材 / 字体 / 步骤编号重复（元素、步骤跨全部页面查） |
| `MISSING_ASSET_FILE` | `assets[].file` 在磁盘上不存在 |
| `MISSING_FONT_FILE` | `fonts[].file` 在磁盘上不存在 |
| `UNKNOWN_ASSET_REF` | 图片元素引用了不存在的素材编号 |
| `UNKNOWN_FONT_REF` | 文字元素引用了不存在的字体编号 |
| `UNKNOWN_ANIMATION_TARGET` | 动效指向的元素不在本页 |
| `RELATIVE_ONLY` | 动效用了绝对值描述位置、大小、旋转、透明度、缩放或滤镜 |

通过时会额外列出待排版素材。程序内用法：`import { validateProject, validateProjectData } from './src/validate.js'`。

## 12. 示例

`examples/sample-deck/`：3 页，覆盖 §9.6 全部效果，含一个待排版素材（`asset_newpic1`）、一个随项目存放的字体（Inter，OFL 许可证）、一个分组。
