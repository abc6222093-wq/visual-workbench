# 示例课件：自由代码动效

打开 `project.json`，三页中的 `motion.source` 分别演示逐项出现和擦拭换页、一次点击触发多元素联动的连续推进、同一个标记点跨步骤移动变色、使用本地 Anime.js 的粒子，以及裁切和分组动效。静态元素的位置、大小、文字、颜色、字体与层级留在 `elements`，编辑器只显示这些静态值。第一页的三条要点对应现在的用法：双击文字直接改、拖动元素不闪；agent 写动效，用户只管微调；挪了位置，动效从新位置接着播。

验证“用户挪动后依然能播”：先运行 `npm run save-version -- examples/sample-deck -m "测试动效起点"`；在工作台编辑器里把第二页的 `el_marker2` 或卡片拖到新位置，保存后放映。标记点从新位置移动，照片和卡片也从各自新位置联动。`motion.source` 不读取或改写固定的 `x`、`y`、`width`、`height`，相对位移叠加在工作台的最新布局上。最后运行 `npm run validate -- examples/sample-deck` 和 `npm run check-motion -- examples/sample-deck`。

动效库通过工作台提供的 `ctx.importModule('/vendor/anime.esm.min.js')` 加载仓库里的本地文件；播放结束或中止时，`dispose()` 取消粒子动画并清除临时粒子 DOM。
