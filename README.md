# 视觉工作台

一个在你自己的 Mac 上运行的设计小工具：让 AI 助手（Claude Code 或 Codex）生成课件、海报等设计，你来微调，它再接着做。所有内容都只存在本机。

## 需要什么
- macOS
- Node 22 或更高版本

## 安装
在本文件夹里打开终端，运行：

```
npm install
```

## 常用命令
- `npm run init-data`：创建数据文件夹（默认 `~/Projects/visual-workbench-data`）。
- `npm run validate`：检查项目文件有没有问题。后面可以加项目路径，例如 `npm run validate examples/sample-deck`。
- `npm run save-version -- <项目> -m "备注"`：给项目存一个版本，随时可以回头找。
- `npm run copy-pages -- <源项目> <页码> --to <新编号>`：把某个项目的页面复制到一个新项目，素材一并复制。
- `npm test`：运行自带测试（一般只有开发时才用）。

## 数据放哪
默认在 `~/Projects/visual-workbench-data`，位置可以在 `workbench.config.json` 里修改。里面有：
- `projects/<项目编号>/`：每个项目一个文件夹（项目文件、图片、字体、历史版本）。
- `library/`：公共素材库，所有项目都能取用（取用时会复制一份进项目，互不影响）。

## 遇到问题
先跑一下 `npm run validate`。它会用中文告诉你哪里不对。把提示原样发给 AI 助手，它就知道怎么修。

更多说明：产品基准见 `PLAN.md`，项目格式见 `docs/format.md`。
