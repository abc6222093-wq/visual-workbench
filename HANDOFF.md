# 当前移交 · 第 14 轮（基本操作补齐）

分支 `claude/round13-organize`（第 13 轮的分支上继续；**没有合并进 main**）。规则见 `CLAUDE.md`（= `AGENTS.md`），格式见 `docs/format.md`，内部约定见 `docs/round12-contract.md`、`docs/round13-contract.md`，桌面应用见 `docs/desktop.md`。本轮只补基本操作，不加新功能。

## 本轮做了什么
- **编辑画布的基本操作**（`web/page-runtime.js` 编辑部分重写，逻辑照第 11 轮 `web/editor-hit-test.js`、`element-operations.js`、`app.js` 的 selectCanvas / startMarquee / nudge 搬过来）：
  - 点选：从这一点上从上到下找有标记的元素；整页背景层（只带底色能力、铺满页面）当空白；看不见的（透明）不算；原页面写了 `pointer-events:none` 的元素按几何位置补上（取最小的框）。
  - 多选：Shift / Cmd + 点加选减选；页内空白处拖框选（完全框住才选）；画布四周空白处拖框选（父页面盖透明挡板画框，坐标换算后交给运行时）；Cmd+A 全选；外层和里层都选中时只留外层。
  - 移动：单个、多个一起拖；方向键 1px、Shift 10px（多选一起）。
  - 缩放：拖角等比（文字字号一起等比，Shift 自由）；拖左右边改宽度（文字高度跟内容走时不钉高度）；拖上下边改高度；多选拖角整体等比。先叠尺寸再量实际的框、用位移把对边钉住（流式布局也对）。元素伸出页面时把手收进页面里；很窄的一边把手挪到框外。
  - 删除：Delete / Backspace / 右键「删除」，修改单记 `remove`（`before {removed:false}` → `after {removed:true}`，画面上 `visibility:hidden !important`），不改源码；贴的图直接去掉 addImage。不再弹确认。改字时 Backspace 只删字。
  - 一次操作改的几处（多选拖动、缩放的尺寸 + 位置 + 字号、一起删除、裁切）用 `edit-batch` 一条消息告诉父页面，撤销一步撤回。
  - 拖动中鼠标出了页面范围：运行时发 `drag on/off`，父页面把外面的移动 / 松开转进来（消息 `pointer`）。
  - 工具条：多选时字号 / 颜色 / 底色一起改（`set` 带 `targets`）；「页面底色」改看得见的那层整页背景（marks 里的 `main`）。
- **旧项目标记自动升级**（`src/upgrade-marks.js`，打开项目时在 `GET /api/projects/<id>` 里做）：`marksRule` 不到 2 时先自动存版（「按新规则补标记前自动存版」），再按新规则补：文字 `text move resize color`、图片 `move resize crop`、色块 `move resize background`、整页背景只 `background`，没标的纯色色块补标 `b<n>`；只在源码上改 / 插属性，不动设计。导入和 v2 转换同步新规则并写 `marksRule: 2`。打开项目时界面丢掉这个项目的页面文本缓存（总览缩略图取的是升级前的）。
- 草稿页：去掉「文字超出页面 N px」（只留虚线）；分页、合并进撤销 / 重做（`web/drafts.js` 操作栈，`src/drafts.js` 可选参数）。
- 放映：同一手势只推进一次（`playback.tap`；运行时 Ctrl+单击不发 click 的 nav）；桌面应用里点「放映」在应用窗口内全屏放映（`playInApp`），Esc 或放完再点一下回到编辑器原来的页面，不再开系统浏览器。
- 总览「复制给 agent」：从零开始做设计 / 请整理文件夹。
- 规则文档：CLAUDE / AGENTS / format.md 写明文字、图片、色块都标 move resize，修改单 `remove` 的含义。
- Mac 桌面应用重新制作并装进 `~/Applications`（壳代码没变，仍是 0.2.0）。

## 已知限制与未做
- 文字拖角时只等比改元素自己的字号：页面里写死 px 的行高、子元素自己的 px 字号不跟着变。
- 退回到升级前的版本后，下次打开会再升级一次；44 页的项目第一次打开要多等约 10 秒，没有进度提示。
- 色块补标靠「标签名 + 第几个 + id/class」对应源码，对不上的跳过（少标，不会标错）。静态排版下的尺寸为准：靠动效铺满页面的条（例如会议项目第 11 页第 1 屏的色带）会被当成色块。
- 放映去重没有在 WebKit（Safari 内核）里实测（本机没装 Playwright 的 WebKit）。
- 因为界面改动跳过的 5 个旧测试（见报告），等用户对界面满意后统一补测试。
- Windows 电脑本轮不更新。

## 下一步
- 用户在 Mac 上用自己的项目验收基本操作清单 1–11 和 A–F。
- 满意后补测试（跳过的 5 个 + 新操作），再由统筹窗口决定合并进 main、更新 Windows。

## 需要用户决定
- 第 1 屏被动效铺满的色带算色块（能拖）还是整页背景（只能改色）。现在按静态排版算色块。
