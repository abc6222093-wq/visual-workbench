# 交接 · HANDOFF

每轮结束由当轮 agent 更新。最新的一轮写在最上面。

## 第 2 轮 · 编辑器套用玻璃样张（2026-10-02）

分支 `design/round2-visual`。只动了 `web/`，没有改服务代码、格式、测试。

### 做了什么
- 编辑器背后铺背景图（默认 `web/assets/backgrounds/default.jpg`）。左侧导航条里的「更换背景」可以选自己电脑上的图片，也可以换回默认；选过的图记在浏览器里（IndexedDB），下次打开还是它。
- 玻璃质感照样张：真玻璃由 LiquidGlass（`web/vendor/liquidglass.esm.js`，MIT）用 WebGL 折射背景，边缘细白亮边，下方单色投影往右下稍微错开。
- 按エイ 反馈调整为「两边透明玻璃、中间磨砂、整体偏白」：只有 4 块真玻璃——右上操作条、左侧页面面板、右侧图层/属性面板（透明玻璃），中间画布那一块（磨砂玻璃，糊一点、白一点）。背景上再蒙一层白纱（`GLASS.backgroundVeil`）。弹窗打开时另起一层玻璃。其余按钮、输入框、列表不垫玻璃。
- 「放映」、加页面、弹窗主要按钮、勾选框改为白色圆钮（参考 05 和エイ 发的教程）：浅白渐变底、淡蓝到淡粉描边、左上白色柔光、右下淡阴影、背后一点粉蓝光、图标浅灰紫带 1px 白色投影。去掉了所有鲜艳的紫色。
- 默认背景换成エイ 提供的新图。
- 形状按用途：面板圆角方形（26px），细长的条和按钮是胶囊，小按钮是圆形。
- 小兔保留在：左上角标志、项目名旁 agent 状态、右侧没选中元素时的空状态。

### 组件在哪
| 组件 | 文件 |
|---|---|
| 玻璃层（背景图、真玻璃片、投影、弹窗玻璃、更换背景）+ 全部参数 `GLASS` | `web/ui/glass.js` |
| 界面样式（导航条、操作条、面板、按钮、输入框、列表、弹窗） | `web/glass.css` |
| 哪些元素垫真玻璃：界面元素上写 `data-glass="名字"`，`data-glass-layer="panel"` 放在背景上，`control` 放在别的玻璃上 | `web/app.js` 的 `glassAttr()` |

### 下一轮怎么套到其他页面
1. 在 `shell()` 里给总览页、素材库也加 `glass-mode`，并在渲染后调用 `syncGlass(app)`。
2. 想垫玻璃的元素写 `data-glass`；圆角跟元素自己的 `border-radius` 走。
3. 真玻璃控制在 10 块以内；会随操作增减的小东西不要垫真玻璃（每次增减都要重新启动玻璃）。

## 第 2 轮 · 视觉轮（2026-10-02）：编辑器整页玻璃界面 —— 已完成

分支 `design/round2-visual`，基于 `codex/round2-ui`。只动了 `web/` 和文档，功能逻辑、本地服务、格式、测试都没改。

### 做了什么
- **编辑器整页换成玻璃界面**（参考 P3）：浅灰底，不放彩色背景光；顶栏、工具栏、按钮、输入框、标签页、选中的图层行都是几乎透明的胶囊或圆形玻璃，靠厚一点的亮白边 + 两端粉蓝紫虹彩 + 下方柔和投影出玻璃感。整块上色的只有「放映」紫色按钮和加页面的蓝色小圆钮（都带同色投影）。画布区是不透明的中性灰，作品缩略图也不透明。
- **弹窗**（存一版、版本列表、复制到新项目、保存冲突）和**放映控制条**一起换了。
- **文字**：删掉「VISUAL WORKBENCH / EDITOR」等装饰英文、口号和解释句；按钮只留功能名（「页面栏」→「页面」，「选中复制引用」→「复制引用」）。
- **图标**：▧ ◯ ▣ ↶ ▶ 这类符号全部换成统一线宽的线性图标（Lucide）。
- **小兔**（原创几何小动物，扁平白色剪影 + 圆点眼睛，只有脑袋：圆脑袋 + 胶囊耳朵，垫浅浅的粉紫蓝圆底）按エイ要求只用三处：左上角标志、顶栏 agent 状态（agent 改过文件后醒着约 15 秒，之后睡着）、右侧未选元素时的空状态。
- **保存成功**：状态胶囊里的小圆点变成紫色小对勾轻轻跳一下。**放映前**约 1 秒的加载画面：深色底上一个粉蓝紫光圈在转。
- **动画**一律用 anime.js（`web/vendor/`，MIT），没有手写逐帧动画；系统开了「减少动态效果」时不跑循环动画。
- 液态玻璃开源项目评估：nikdelvin/liquid-glass（MIT，CSS+SVG 滤镜）、dashersw/liquid-glass-js（MIT，WebGL，需整页截图）、Mael-667/Liquid-Glass-CSS（GPL-3.0）都是「折射玻璃后面的内容」，在浅灰底上几乎看不出，本轮没引入；亮白边写法借鉴 nikdelvin。以后要在图片上方做真折射，优先用 nikdelvin 的 SVG 滤镜。
- 顺手：`web/app.js`、`web/index.html` 先整理成正常分行格式（单独一个提交）。

### 视觉组件在哪
| 组件 | 文件 | 类名 / 函数 |
|---|---|---|
| 颜色、玻璃底色、亮白边、虹彩边、投影等变量 | `web/glass.css` 开头 `:root` | `--g-page` `--g-glass` `--g-rim` `--g-iris` `--g-drop` … |
| 玻璃表面（胶囊） | `web/glass.css` | `.g-glass` |
| 胶囊按钮 / 彩色玻璃按钮 / 透明按钮 | `web/glass.css` | `.g-btn` `.g-btn--prism` `.g-btn--ghost` `.g-btn--sm` `.g-btn--wide` |
| 圆形按钮（细白高光 + 柔光） | `web/glass.css` | `.g-round` `.g-round--sm/--lg` `.g-round--blue` `.is-active` |
| 状态小胶囊、小圆点 | `web/glass.css` | `.g-chip` `.g-chip--quiet/--pink` `.g-dot` |
| 分段标签页 | `web/glass.css` | `.g-seg` |
| 列表行（图层、素材、版本） | `web/glass.css` | `.g-row` `.g-row__icon` `.g-row__text` `.g-row__thumb` |
| 输入胶囊、多行文字、圆形勾选框 | `web/glass.css` | `.g-field` `.g-field--stack` `.g-area` `.g-check` |
| 弹窗 | `web/glass.css` | `.g-backdrop` `.g-sheet` |
| 线性图标 | `web/ui/icons.js` | `icon("play", 18)` |
| 小兔 | `web/ui/mascot.js` | `mascot({ pose, size, badge })` |
| 动画（呼吸、眨眼、跳一下、加载光圈） | `web/ui/motion.js` | `liven()` `hop()` `loaderLoop()` `stopLoops()` |
| 编辑器自己的布局 | `web/glass.css` 后半 | `.ed-*` |
| 写界面的小工具 | `web/app.js` | `gbtn()` `round()` `TYPE_ICON` |

整套只在 `<html class="glass-mode">` 时换浅灰底、字体和提示条样式。`shell("editor", …)` 会自动加上这个类，`shell("home"/"library", …)` 会去掉。

### 下一轮怎么套用到其他页面
1. 在 `shell()` 里把 `glass` 的条件放宽到 `home`、`library`（左侧栏已经是玻璃版）。
2. 用 `.g-*` 组件重写 `home()`、`library()`、`newDialog()` 的标记；旧的 `style.css` 规则在全部页面换完后可以删掉。
3. 小兔不要再加新位置（エイ 要求收敛）。
4. 项目卡片、素材卡片是作品缩略图，按编辑器的做法保持不透明，只给外面的名称做胶囊。
5. 还没删的装饰英文 / 口号在其他页面：新建项目弹窗的「NEW PROJECT」「选择画板尺寸，开始一份新的设计。」、素材库的「随时取用的灵感」「公共素材会在使用时复制到项目中。」。

### 需要エイ拍板的
见本轮报告第 6 节。

## 第 1 轮（2026-10-01）：项目格式与仓库初始化 —— 已完成

### 做了什么
- **项目格式 v1**：`schema/project.schema.json`（机器定义）+ `docs/format.md`（说明书）。画板 → 页面 → 元素（文字 / 图片 / 形状 / 分组），每个东西有稳定编号；动效 = 步骤 → 轨道 → 变化，挂在元素编号上，只用相对变化（`{"by": n}` / `{"times": n}`）。
- **示例项目** `examples/sample-deck/`：3 页，覆盖全部要求的动效（依次淡入、点击出现、连续推进、联动平移缩放、跨步骤移动变色、渐变遮罩、multiply 混合、黑白滤镜、多边形裁切），含一个待排版素材、一个随项目存放的字体（Inter，OFL）、一个分组。
- **校验** `npm run validate [项目]`：schema + 9 种语义错误（编号重复、素材/字体文件缺失、引用不存在、动效目标不存在、动效用了绝对值……），通过时列出待排版素材。
- **数据目录**：`workbench.config.json` 的 `dataDir`（默认 `~/Projects/visual-workbench-data`），`npm run init-data` 建 `projects/`、`library/assets/`、`library/fonts/`。已在エイ的电脑上建好。
- **存一版** `npm run save-version -- <项目> -m "备注"`：快照 project.json + assets + fonts 到 `versions/<时间>/`，带 meta.json。
- **复制页面** `npm run copy-pages -- <源项目> <页码> --to <新编号>`：新建项目，只带用到的素材和字体，源项目不动。
- **测试** `npm test`：46 个，全部通过。GitHub Actions 在 push 时跑 `npm test` + `npm run validate`。
- **文档**：`CLAUDE.md` = `AGENTS.md`（agent 规则）、`PLAN.md`（产品基准）、`README.md`（给エイ）、`QUOTA.md`（额度账本）。

### 没做的（都是本轮明确不做的）
- 任何界面、编辑器、本地服务器。
- 从公共素材库取素材的脚本（格式里已定义 `source.type = "library"`，复制规则写在 `docs/format.md` §8.3，脚本留给做界面那一轮）。
- 动效的实际播放（渲染器）。本轮只定义了数据和校验，§9.4「初始可见性」等规则要在渲染时实现。

### 下一轮从哪接
1. 读 `CLAUDE.md`、`docs/format.md`、`PLAN.md`。
2. 第 2 轮建议目标：本地服务器 + 实时连接（监听数据目录里 `project.json` 的变化并推送到页面；页面保存时写回同一份文件）。注意：エイ 的工作台和 agent 同时写同一份文件时要避免互相覆盖，建议"谁最后写谁赢 + 写之前比对 `updatedAt`"。
3. 渲染动效时按 `docs/format.md` §9 实现：步骤顺序、`auto` 衔接、`appear` 初始隐藏、相对变化累加、`scale` 绕元素中心。
4. 示例里 `asset_newpic1` 是待排版素材，可作为"agent 发现待排版素材并排版"的演练。

### 需要エイ拍板的
见本轮报告第 5 节（也整理在下面，附建议）：
- 动效里"变色"用目标颜色（`{"to": "#…"}`）还是相对色相偏移？**建议目标颜色**（已这样实现）。
- 画板预设的网页宽度（电脑 1440、手机 390）是否合适？**建议先这样**，做界面时再调。
- 版本目录名用本地时间（`20261001-233213`）还是备注做文件夹名？**建议时间 + meta.json 里放备注**（已这样实现）。
