# 第 7 轮验收记录

## 范围与设计
本机配置：用户主目录 `.visual-workbench/config.json`。总览「数据文件夹」粘贴已有路径，验证有效才保存，重启生效。CLI > VW_DATA_DIR > 本机 > 仓库；不迁移数据。Mac/Windows 启动器在 launchers。每 15 秒心跳，90 秒过期，界面每 5 秒检查；新鲜会话需确认，正常关闭删除自己的标记。项目打开时只列出疑似同步副本。

## 简化和边界
- 文件夹选择采用粘贴完整路径，没有原生选择器；保存后重启。
- Google Drive 仅作普通文件夹。同步延迟/离线无法实现强互斥，必须关闭另一台并等待同步。冲突检测是文件名启发式，不自动合并，跳过历史 versions。
- Windows 启动文件 ASCII CMD + UTF-8 BOM PowerShell；中文/日文路径覆盖单元测试，Windows CI 还实际查询端口、验证无 Node 时中文输出。中文/日文系统的人工双击验收步骤见 README。
- 本机浏览器启动被环境阻止，完整浏览器结果以三系统 Actions 为准。没有修改浏览器断言来绕过。

## 旧测试的跨系统修改（断言保留）
1. `test/check-motion-cli.test.js`：URL.pathname 在 Windows 变成 /D:/…，改为 fileURLToPath；不改错误与超时断言。
2. `test/export-images.test.js`：示例文件夹同样改为 fileURLToPath；文件名检查用 basename 去掉平台相关目录分隔符，文件名及所有渲染断言保留。
3. `test/version.test.js`：split('/') 取版本名改为 basename，编号正则不变。
4. `test/version-gc.test.js`：两个版本名提取点改为 basename，回收与退回断言不变。
5. `test/copy-pages.test.js`：快照键把本机分隔符规范为 /，逐字节比较和素材存在断言不变。
`test/browser.test.js` 原 Mac 模拟断言未改，修的是生产 browserCandidates 按指定平台使用 posix 路径；新增 Windows 各安装位置与中文说明测试。

真实代码问题：`src/export/images.js`、`src/cli/check-motion.js` 的目录边界检查写死 `/`，Windows 上正常文件全被拒绝；已改用本机 sep。浏览器超时改用 Playwright 的 kill() 清理整个进程树，避免 Windows 留下子进程；离线放映在同步装载器里立即提供 vwReady Promise，涵盖异步模块载入。离线放映测试断言未改。未改 watch 测试断言或时长。

## 本机测试原始摘要
基线非浏览器：
```
ℹ tests 188
ℹ pass 188
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```
本轮非浏览器回归：
```
ℹ tests 215
ℹ suites 0
ℹ pass 215
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
项目校验：
```
✓ 通过  /Users/a/Projects/visual-workbench/codex/examples/sample-deck/project.json
  待排版素材：asset_newpic1
共 1 个项目，通过 1，未通过 0
```
本机浏览器原始错误：
```
Error: 找不到可用的浏览器，动效检查和导出图片 / PDF 需要一个浏览器在后台打开页面。
（试过：Google Chrome：browserType.launch: Target page, context or browser has been closed）
code: 'NO_BROWSER'
```
本机 npm test 已实际执行；浏览器启动失败后旧浏览器测试有清理挂起，手动停止了挂起的进程。其余测试单独完整执行。最终提交的完整 npm test、validate、check-motion 输出与三个系统 Actions 链接见交付消息。

## 按文档实际填入示例副本
输入：`examples/outline-source.txt`。测试 `test/outline-fill-example.test.js` 将 sample-deck 复制到系统临时目录，先存版，再按文档在末尾添加两页；原有全部页面 JSON 完全相等；新段对应独立 `documentDraft:true` 文字；未添加动效，完整项目校验通过。以下为那次实际填写的大纲原始数据（随机编号来自临时副本）：

```json
[
  {
    "id": "page_1c33e5e4aac6413f",
    "name": "观察变化",
    "outline": {
      "screens": 1,
      "notes": "适合课堂提问，留出思考时间。",
      "rows": [
        {
          "id": "row_f3d0ac34257a44a3",
          "role": "title",
          "text": "观察变化",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_924be771747c4261",
          "baseline": {
            "role": "title",
            "text": "观察变化",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        },
        {
          "id": "row_6e4765ba101f41c7",
          "role": "english",
          "text": "Observe the change",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_691125b6df514e00",
          "baseline": {
            "role": "english",
            "text": "Observe the change",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        },
        {
          "id": "row_c3c77a79c3c948dc",
          "role": "body",
          "text": "先看清眼前的形状，再描述它的变化。",
          "emphasis": [
            {
              "start": 1,
              "end": 3
            }
          ],
          "from": 1,
          "until": null,
          "elementId": "el_8816be3bbe7344e2",
          "baseline": {
            "role": "body",
            "text": "先看清眼前的形状，再描述它的变化。",
            "emphasis": [
              {
                "start": 1,
                "end": 3
              }
            ],
            "from": 1,
            "until": null
          }
        }
      ],
      "images": [
        {
          "id": "image_observe",
          "asset": "asset_city01",
          "caption": "使用项目里已有的第一张图片，后续排版时作为观察对象。",
          "from": 1,
          "until": null
        }
      ],
      "mode": "document"
    }
  },
  {
    "id": "page_05a62f1e1e4c45e5",
    "name": "说出发现",
    "outline": {
      "screens": 1,
      "notes": "这一页暂时只要文案，不写动效。",
      "rows": [
        {
          "id": "row_efe225e5139a49e9",
          "role": "title",
          "text": "说出发现",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_7f2ea3b630ba407c",
          "baseline": {
            "role": "title",
            "text": "说出发现",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        },
        {
          "id": "row_efa1a94a359c4aca",
          "role": "body",
          "text": "你注意到了什么？",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_0d028fcf346840f1",
          "baseline": {
            "role": "body",
            "text": "你注意到了什么？",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        },
        {
          "id": "row_12a3a9ec6d744d66",
          "role": "body",
          "text": "试着用一句话说明理由。",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_4b464805d3354f68",
          "baseline": {
            "role": "body",
            "text": "试着用一句话说明理由。",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        },
        {
          "id": "row_b3a74890d44e4c9e",
          "role": "note",
          "text": "没有唯一答案。",
          "emphasis": [],
          "from": 1,
          "until": null,
          "elementId": "el_0fd635ff92cc4fa6",
          "baseline": {
            "role": "note",
            "text": "没有唯一答案。",
            "emphasis": [],
            "from": 1,
            "until": null
          }
        }
      ],
      "images": [],
      "mode": "document"
    }
  }
]
```

## 子智能体
3 个，均为 GPT-6.1 Sol、low：round7_config（本机配置），round7_platform（浏览器、系统操作、启动器），round7_sessions（使用标记、冲突检测）。汇总、接入、审查、提交和 Actions 检查由主智能体完成。
