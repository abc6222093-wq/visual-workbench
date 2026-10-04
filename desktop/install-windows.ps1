# 视觉工作台 · Windows 应用安装（不需要管理员权限）
# 做的事：装好 desktop/ 的依赖 → 制作应用 → 记下仓库位置 → 在桌面和开始菜单放快捷方式。
# 原来桌面上的「视觉工作台」（双击启动文件）保留不动，新的叫「视觉工作台（应用）」。
# 用法：在 desktop 文件夹里右键「使用 PowerShell 运行」，或
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 [-SkipPack]
param([switch]$SkipPack)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$desktopDir = $PSScriptRoot
$repoDir = (Resolve-Path -LiteralPath (Join-Path $desktopDir '..')).Path
$appName = '视觉工作台'
$outDir = Join-Path $desktopDir "dist\$appName-win32-x64"
$exe = Join-Path $outDir "$appName.exe"

try { $null = Get-Command node -ErrorAction Stop } catch {
  Write-Host '未找到 Node.js 22 或更新版本。请先安装：https://nodejs.org/zh-cn/download ，然后重新运行。'
  exit 1
}

Push-Location -LiteralPath $desktopDir
try {
  if (-not $SkipPack) {
    if (-not (Test-Path -LiteralPath (Join-Path $desktopDir 'node_modules\electron'))) {
      Write-Host '正在安装应用壳的依赖（第一次会下载 Electron，需要几分钟）…'
      & npm.cmd install --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
    }
    Write-Host '正在制作应用…'
    & npm.cmd run pack:win
    if ($LASTEXITCODE -ne 0) { throw '制作应用失败' }
  }
} finally { Pop-Location }

if (-not (Test-Path -LiteralPath $exe)) { throw "没有找到 $exe，请先运行 npm run pack:win" }

# 记下仓库位置（工作台代码更新后不用重做应用，应用每次都从这里启动服务）
$config = Join-Path $outDir 'resources\app\app-config.json'
$json = @{ repoDir = $repoDir } | ConvertTo-Json
[System.IO.File]::WriteAllText($config, $json + "`n", [System.Text.UTF8Encoding]::new($false))

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$path) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $exe
  $lnk.WorkingDirectory = $outDir
  $lnk.IconLocation = "$exe,0"
  $lnk.Description = '打开视觉工作台（关掉窗口就是关闭工作台，会先保存）'
  $lnk.Save()
  Write-Host "已创建快捷方式：$path"
}
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName（应用）.lnk"
$startLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"
New-Shortcut $desktopLnk
New-Shortcut $startLnk
Write-Host ''
Write-Host "安装完成。应用位置：$exe"
Write-Host "工作台代码位置：$repoDir"
Write-Host '以后双击桌面上的「视觉工作台（应用）」打开；关掉窗口就是关闭工作台。'
