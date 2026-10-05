# 示例课件（格式 v3）

每页是 `pages/` 里的一个网页文件，`project.json` 只登记页面、素材、字体、点击次数（`motion.steps`）和修改单（`edits`）。格式说明见 `docs/format.md`。

| 页 | 文件 | 演示 |
|---|---|---|
| 1 封面 | `pages/page_cover1.html` | 标题淡入、三条要点逐条出现（2 次点击）；副标题和要点里有局部加粗、变色（`<b>`、`<span style="color:…">`），用户改字时保留 |
| 2 连续推进 | `pages/page_scene2.html` | 一次点击里多个元素联动；同一个标记点跨步移动变色；用本地 Anime.js（`ctx.importModule('/vendor/anime.esm.min.js')`）放粒子，`dispose` 和 `ctx.signal` 里清理 |
| 3 裁切与分组 | `pages/page_clip3.html` | 可裁切的图片（`data-vw="move resize crop"`，用户双击裁切）；卡片里的标题、图形、文字随卡片一起移动 |

用户能动的地方都写了 `data-vw-id`（稳定编号）和 `data-vw`（能力：`text` 改字、`move` 拖动、`resize` 改大小、`color` 文字颜色、`background` 底色、`crop` 裁切）。背景照片这类装饰不标，用户点不中。

动效写在页面末尾的 `<script type="module">` 里，用 `window.vw?.motion({ init, step, leave, dispose })` 登记：位移都是相对当前位置的 `transform`，用户拖动过的元素从新位置出发；等待和动画用 `ctx.animate` / `ctx.timer`，往回翻页时能快进。直接用浏览器打开页面文件也能看静态画面（没有 `vw` 时不跑动效）。

试一试：在工作台里拖动第 2 页的标记点或卡片、改第 1 页副标题的字，再放映；然后运行 `npm run validate -- examples/sample-deck` 和 `npm run check-motion -- examples/sample-deck`。
