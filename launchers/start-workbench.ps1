$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
try {
  $node = (Get-Command node -ErrorAction Stop).Source
  $version = & $node -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0 -or [int]($version.Split('.')[0]) -lt 22) { throw 'old node' }
} catch {
  Write-Host '未找到 Node.js 22 或更新版本。请先安装：https://nodejs.org/zh-cn/download ，然后重新双击启动。'
  Read-Host '按回车关闭窗口'
  exit 1
}
& $node 'src/launcher.js'
$code = $LASTEXITCODE
Read-Host '按回车关闭窗口'
exit $code
