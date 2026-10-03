#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo '未找到 Node.js 22 或更新版本。请先安装：https://nodejs.org/zh-cn/download ，然后重新双击启动。'
  read -r -p '按回车关闭。'
  exit 1
fi
node src/launcher.js
read -r -p '按回车关闭。'
