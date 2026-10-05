# 视觉工作台 · 项目格式（v3）

第 12 轮起的格式。**每一页 = agent 自由写的网页**（HTML + CSS + 可选 JS 动效）；用户在工作台里做的少量修改记在这一页的**修改单**里，叠在页面上显示，不改 agent 写的源码。旧版 v2 的说明保留在 `docs/format-v2.md`，只供旧项目转换时参考。

## 1. 设计原则
- agent 是设计师，工作台是用户的审稿桌和资料柜。工作台不限制页面怎么写，也不对设计做任何判断或提示。
- 用户只做四类修改：改文案 / 字号；已有元素的位置、大小、颜色、图片裁切；页面与项目整理；把剪贴板里的图片贴进页面。修改全部进修改单。
- 修改单和页面源码分开存：源码只由 agent 写；修改单只由工作台写（agent 用命令列出 / 清除）。
- 每页自带资源：图片、字体、脚本都登记在项目里，复制到别的项目一起带走。
- 页面之间、页面和工作台界面之间互相隔离显示；页面里的脚本碰不到工作台和用户数据。

## 2. 文件与目录

```
<数据目录>/projects/<项目编号>/
  project.json          项目文件（工作台和 agent 共同读写）
  pages/<页面编号>.html  每页一个独立的 HTML 文件（agent 写）
  assets/               图片、脚本、样式等资源（登记在 project.json 的 assets）
  fonts/                字体文件（登记在 fonts）
  versions/             存版（工作台管理，agent 不手动改）
  import/               从旧 HTML / 网页导入时的原文件与基准（只读参考）
  series.json           从系列母版新建的项目才有
```

页面文件里的相对路径**相对页面文件本身**：图片写 `../assets/photo.png`，字体写 `../fonts/x.woff2`。这样页面文件直接用浏览器打开也能看（但动效要在工作台里才跑，见 §6）。

## 3. 顶层结构

```json
{
  "format": "visual-workbench/project",
  "formatVersion": 3,
  "id": "sample-deck",
  "name": "示例课件",
  "description": "可选",
  "kind": "deck",
  "folder": "",
  "designCard": null,
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
| `format` / `formatVersion` | 固定 `"visual-workbench/project"` / `3` |
| `id` | 项目编号 = 项目文件夹名。小写字母、数字、连字符，2–64 位 |
| `kind` | `"deck"`（课件 / 海报，默认）或 `"web"`（网页） |
| `folder` | 可选，项目所在的文件夹名（第 13 轮做界面；本轮只登记，空字符串或省略表示未分类） |
| `designCard` | 可选，设计卡片（第 13 轮做显示）：`{ "direction": "方向名", "concept": "一句话概念", "colors": ["#rrggbb", …], "fonts": ["字体名", …], "traits": ["特征", …] }`；没有写 `null` 或省略 |
| `artboard` | 画板：课件项目每页的尺寸；网页项目只是默认窗口。`width`、`height` 必填，`preset` 是标签（`slide-16x9` / `web-desktop` / `web-mobile` / `poster-a4` / `poster-a3` / `custom`） |
| `assets` / `fonts` | 资源登记表，见 §5 |
| `pages` | 页面列表，至少一页，见 §4 |

## 4. 页面

```json
{
  "id": "page_cover",
  "name": "封面",
  "file": "pages/page_cover.html",
  "notes": "给 agent 看的备注，不显示在页面上",
  "motion": { "steps": 2 },
  "edits": [ … ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 页面编号 `page_…`，稳定，不随页序变 |
| `name` | 给人看的页名 |
| `file` | 页面文件，相对项目根，固定在 `pages/` 下。校验会检查文件存在 |
| `notes` | 可选，给 agent 看的备注。第 13 轮草稿分页的【辅助信息】【动效】放这里；旧项目转换、旧 HTML 导入的「迁移说明」也写这里 |
| `motion` | 可选。`steps` 是点击推进次数（非负整数）。页面里的动效代码见 §6；没有动效省略 |
| `edits` | 修改单，见 §7。没有修改时为 `[]` 或省略 |
| `device` / `size` | 只在网页项目出现：`device` 为 `"desktop"`（窗口 1440×900）或 `"mobile"`（窗口 390×844）；`size: { width, height }`，宽 = 窗口宽，高 = 整页内容长度。工作台在窗口里用滚轮浏览整页 |
| `origin` | 可选，导入来源 `{ "url"?, "file"?, "capturedAt"? }` |

页码 = 在 `pages` 里的位置（从 1 数），会随增删变化；工具间传递用 `id`。

### 4.1 页面文件怎么写
- 一个完整的 HTML 文档，样式、脚本随意，可以用任何库（库文件复制进 `assets/`，用 `../assets/x.js` 引用；工作台 `web/vendor/` 里的本地库也能用 `/vendor/x.js` 引用，导出时会打包进去）。不能引用网络地址（导出的文件不能依赖网络）。
- **课件项目**：`<body>` 就是画板。工作台显示时把文档固定成画板尺寸（`html, body { margin: 0; width: W px; height: H px; overflow: hidden }` 由工作台注入），agent 不用自己设。
- **网页项目**：文档宽度 = 设备窗口宽；高度随内容；工作台按 `size.height` 给滚动范围。
- 页面在工作台里始终通过一个**隔离的 iframe** 显示（无同源权限）：页面脚本不能访问工作台、`/api/`、其他页面。
- 工作台会在页面顶部注入自己的运行时脚本和少量样式（`data-vw-runtime`、`data-vw-base`），页面不要用同名属性；不要依赖 `window.parent`。

### 4.2 标出用户可以动的地方
在元素上写两个属性：

```html
<h1 data-vw-id="title" data-vw="text move color">把想法排成网页</h1>
<img data-vw-id="hero" data-vw="move resize crop" src="../assets/hero.png">
<div data-vw-id="card1" data-vw="move resize background">…</div>
```

| 能力 | 用户能做什么 | 修改单记什么 |
|---|---|---|
| `text` | 就地改文案、改字号；agent 写的局部加粗 / 变色等行内格式会保留 | `text`（改前改后的 HTML 与纯文字）、`fontSize`（像素） |
| `move` | 拖动位置 | `move`（相对原位置的偏移 `dx` / `dy`，像素） |
| `resize` | 拖角 / 拖边改大小 | `resize`（`width` / `height`，像素） |
| `color` | 改文字颜色 | `color` |
| `background` | 改底色 | `background` |
| `crop` | 裁切图片（只对 `<img>`） | `crop`（源图比例 0–1 的矩形） |

- `data-vw-id`：稳定编号，字母开头，只含字母、数字、`-`、`_`，**一页内唯一**。agent 改版面时编号不变，修改单靠它对应。
- `data-vw`：空格分隔的能力列表。没有这两个属性的元素用户动不了。
- 用户贴进来的图片由工作台加到 `<body>` 末尾，编号 `u_…`（记在修改单的 `addImage` 条目里，不写进页面文件）。
- 没有「删除」能力：用户只能删除自己贴进来的图片。形状、装饰、排版结构都由 agent 改。
- **纯色色块也要标**：有底色、没有自己的文字也不是图片的块（色条、卡片底、印章底、装饰圆点等）标 `move resize background`，用户可以挪、缩放、换色，但改不了形状（圆角、边框、旋转都由 agent 定）；**整页背景**（`<body>` 或铺满整页的最外层容器）只标 `background`。结构性容器（只为布局存在的 `<div>`）、线条、纹理不标。导入旧 HTML / 网页和 v2 转换会自动按同样规则标色块。
- 用户在画布上看到的：可动的元素鼠标移上去有清楚的边框，选中后有 8 个把手；带 `text` 的元素点在字上改字、抓边框移动；图片、色块点哪都能拖。

## 5. 资源登记

```json
"assets": [
  { "id": "asset_hero", "kind": "image", "file": "assets/hero.png", "name": "主图", "width": 1600, "height": 900, "addedAt": "…" },
  { "id": "asset_anime", "kind": "file", "file": "assets/anime.esm.min.js", "name": "anime.js" }
],
"fonts": [
  { "id": "font_display", "family": "Noto Serif SC", "file": "fonts/NotoSerifSC-Bold.woff2", "weight": 700, "style": "normal", "license": "fonts/OFL.txt" }
]
```

- `assets[].kind`：`image`（图片，`width`、`height` 可选）或 `file`（脚本、样式、视频等任何文件）。`file` 相对项目根，必须在 `assets/` 下。
- `fonts[].file` 必须在 `fonts/` 下。页面里用 `@font-face` 自己声明（`src: url(../fonts/x.woff2)`）。
- 校验：页面文件里引用的相对路径必须存在；`assets/`、`fonts/` 下被引用的文件必须登记。
- 公共素材库 `<数据目录>/library/`：取用时复制进项目再登记。复制页面到别的项目（`npm run copy-pages`）会把页面文件引用的资源一起复制并登记。

## 6. 动效与放映

页面里用工作台提供的 `vw.motion(...)` 登记动效（运行时脚本在页面顶部注入，页面脚本执行时 `vw` 已存在）：

```html
<script type="module">
  const { animate } = await import('../assets/anime.esm.min.js'); // 任何库都行
  vw.motion({
    async init(ctx) { /* 放映前的初始状态，例如把要逐项出现的东西先藏起来 */ },
    async step(index, ctx) { /* 第 index 次点击（0 起）；可以串联多个 await */ },
    async leave(ctx, { direction }) { /* 可选：离开本页前的退场；direction 1 前进 −1 后退 */ },
    dispose() { /* 可选：清理 */ }
  });
</script>
```

- `project.json` 的 `motion.steps` 是点击次数的唯一依据；`steps > 0` 时必须登记 `step`。放完最后一步再点才翻页。
- `ctx`：`root`（`document.body`）、`signal`（翻页 / 重置时终止）、`step`（当前步，初始化时 −1）、`fast`（是否在快进）、`animate(node, keyframes, options)`（Web Animations，返回 finished）、`timer(ms)`、`importModule(path)`（导入 `/vendor/…` 或 `../assets/…` 模块）。
- 往回翻到上一页时，工作台**快进**：`init` 和所有 `step` 连续执行，`ctx.animate` / `ctx.timer` 立即完成，页面停在最后一步的画面。用库自带计时（anime.js 等）的动效，快进时按真实时长等；建议用 `ctx.animate` / `ctx.timer` 或 Web Animations。
- 修改单在 `init` 之前已经叠到页面上；动效从用户修改后的状态出发（例如用户拖动过的元素，`getBoundingClientRect()` 拿到的就是新位置）。不要在代码里写死坐标。
- 工作台自己不生成任何动效。编辑画布上点击永远不触发动效：edit 模式下运行时拦住用户的鼠标 / 键盘事件，页面自己的脚本收不到（自动播放的 CSS / JS 动画照常）；缩略图不跑脚本。
- 编辑时的「第 N 屏」：带 `motion.steps` 的页面，用户可以在画布上方选第 1 屏（初始化后、`step(0)` 前）到第 `steps + 1` 屏（最后一步完成后）；工作台以快进方式跑 `init` 和前面的步骤，然后停住让用户改。所以每一步结束时都要停在合理的画面（和往回翻页、导出图片的要求相同）。
- 图片裁切（修改单 `crop`）在 Chromium 内核用 `object-view-box` 显示；其他浏览器（Safari、Firefox，包括 iPhone 上打开导出的放映版）运行时自动改用背景图方式显示，画面一致，元素框不变。
- 直接用浏览器打开页面文件时没有 `vw`：想让页面也能单独打开，写 `window.vw?.motion({...})`。
- 检查：`npm run validate -- <项目>` 查结构；`npm run check-motion -- <项目>` 真浏览器逐页跑 `init`、每一步、快进和 `leave`。

## 7. 修改单 `edits`

每条记录一个目标、一种修改，**同一目标同一种修改只有一条**：`before` 是第一次改之前的原样，`after` 是最新值；改回原样就删掉这条。

```json
"edits": [
  { "id": "ed_7f3a2c", "target": "title", "kind": "text", "at": "2026-10-06T03:00:00.000Z",
    "before": { "html": "把想法排成<b>网页</b>", "text": "把想法排成网页" },
    "after":  { "html": "把想法排成<b>网页</b>！", "text": "把想法排成网页！" } },
  { "id": "ed_90ab11", "target": "title", "kind": "fontSize", "before": { "fontSize": 64 }, "after": { "fontSize": 72 } },
  { "id": "ed_c0ffee", "target": "hero", "kind": "move", "before": { "x": 120, "y": 320, "width": 900, "height": 96 }, "after": { "dx": 60, "dy": -40 } },
  { "id": "ed_1234ab", "target": "hero", "kind": "resize", "before": { "width": 900, "height": 96 }, "after": { "width": 1000, "height": 110 } },
  { "id": "ed_abc123", "target": "title", "kind": "color", "before": { "color": "#ffffff" }, "after": { "color": "#ffd166" } },
  { "id": "ed_def456", "target": "card1", "kind": "background", "before": { "background": "#f1f5f9" }, "after": { "background": "#fde68a" } },
  { "id": "ed_777777", "target": "hero", "kind": "crop", "before": { "crop": null }, "after": { "crop": { "x": 0.1, "y": 0, "width": 0.8, "height": 1 } } },
  { "id": "ed_888888", "target": "u_3f9a1c2e", "kind": "addImage", "before": null,
    "after": { "asset": "asset_paste_1", "x": 760, "y": 340, "width": 400, "height": 300 } }
]
```

| `kind` | `before` / `after` | 说明 |
|---|---|---|
| `text` | `{ html, text }` | `html` 是元素的 innerHTML（只保留行内格式标签），`text` 是纯文字 |
| `fontSize` | `{ fontSize }` | 像素；工作台把它写成元素的 `style.font-size` |
| `move` | before `{ x, y, width, height }`（原来在页面里的位置）；after `{ dx, dy }` | 叠加为 `transform: translate(dx, dy)`，不改原来的 left/top |
| `resize` | `{ width, height }` | 写成 `style.width/height` |
| `color` | `{ color }` | 文字颜色 |
| `background` | `{ background }` | 底色 |
| `crop` | `{ crop }` | `crop` 为 `{ x, y, width, height }`（源图比例），`null` 表示不裁 |
| `addImage` | before `null`；after `{ asset, x, y, width, height }` | 用户贴进来的图片；`asset` 是本项目素材编号；删除这张图 = 删掉这条和它的 `move` / `resize` / `crop` 条目 |

- 颜色一律 `#rrggbb` 或 `#rrggbbaa`。坐标、尺寸都是页面 CSS 像素。
- `status` 不存文件，读的时候算：目标编号在页面里找不到、或页面已不允许这种修改时为「对不上」（stale）。工作台显示时跳过对不上的条目，不报错；agent 读修改单时会列出来。
- agent 的用法：开工先 `npm run edits -- <项目>` 看修改单（含对不上的），把用户的意思融进设计（例如用户把标题拖大了，顺手调和周围），然后 `npm run edits -- <项目> --clear [--page <页面编号>] [<条目编号>…]` 清掉已处理的条目。清掉以后页面按源码显示，所以要先把改动真正写进页面。
- 放映、导出、缩略图、交接包都按「页面 + 修改单」显示；交接包里的改动清单就是修改单的内容。

## 8. 编号规则
- 项目 `id`：小写字母、数字、连字符。
- 页面 `page_…`、素材 `asset_…`、字体 `font_…`、修改单条目 `ed_…`：字母、数字、下划线、连字符。
- 页面里的 `data-vw-id`：字母开头，字母、数字、`-`、`_`，一页内唯一；用户贴图的编号 `u_` 开头，agent 不要用。

## 9. 版本
存版把项目文件夹里 `versions/` 之外的所有普通文件（含 `pages/`、`assets/`、`fonts/`、`import/`）按内容去重存一份。用户可以在工作台里退回；agent 动手前 `npm run save-version -- <项目> -m "<说明>"`。

## 10. 校验 `npm run validate -- <项目>`
工作台自己保存、退回、复制项目时只查结构（schema 与编号），不查页面内容——修改单对不上、资源缺失都不会挡住用户保存；`npm run validate` 做完整检查。完整检查查：JSON 结构（`schema/project.schema.json`）；页面、素材、字体、修改单编号重复；页面文件缺失；页面内 `data-vw-id` 重复、格式不对；修改单指向不存在的编号或页面没给的能力（报「对不上」，是错误）；页面引用的相对资源缺失、`assets/` `fonts/` 下的引用未登记；`assets[].file` / `fonts[].file` 文件缺失；网页项目页面缺 `device` / `size`。

## 11. 导出
- 放映版 HTML：一个文件，每页一个隔离 iframe，资源内嵌，不依赖网络；点击推进、方向键翻页、往回翻停在上一页最后一步，和工作台里的放映一致；内嵌同一套运行时。
- 导出时服务端报进度（`POST /api/projects/:id/export` 可带 `progressId`，`GET …/export/progress/:progressId` 是 SSE：`progress { current, total, label }`、`done`；`POST …/export/cancel/:progressId` 取消），界面显示「正在导出第 3 / 15 页」并可取消；命令行也打印进度。
- 每页图片 / PDF：真浏览器按「页面 + 修改单」跑完全部步骤后截图；网页页面按整页高度截。
- 交接包（网页项目）：改动清单 = 修改单（按页、按目标，写明原网页定位 `data-vw-origin`、改前改后），加每页改前改后对比图和「复制给 agent」文字。

## 12. 旧项目转换（v2 → v3）
v2 项目第一次被工作台打开时：先自动存版「转换为 v3 前自动存版」，再把每页元素转成绝对定位的 HTML（`pages/<页面编号>.html`），文字标 `text move color`（能改字、挪动、改色）、图片标 `move resize crop`、形状等纯色色块标 `move resize background`、整页底色标 `background`；v2 的 `motion.source` 包一层兼容层照搬（`ctx.element(id)` 仍可用，`transition` 换页效果搬不了，写进该页 `notes`）。转换后画面与原来一致。转换失败的项目保持原样，并给出中文说明。命令行：`npm run convert -- <项目>`。

## 13. 旧 HTML 导入
`总览 → 导入 HTML / 网页`：按页切开后**保留原来的 HTML、CSS 和动画**，自动把看得出的文字（标题、段落、列表项、按钮等）标成 `text move color`、图片标成 `move resize crop`、纯色色块标成 `move resize background`（整页背景只标 `background`），编号 `t1`、`t2`…、`i1`…；原文件原样放进 `import/`，绝不修改。细节见 `docs/import-html.md`。

## 14. 示例
`examples/sample-deck/`：三页，有动效、局部加粗变色的文字、可裁切图片；`examples/sample-web/`：网页项目，电脑端、手机端各一页。
