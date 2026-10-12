# 生成「可安全部署」的干净目录
#
# 为什么需要这个：
#   部署是把「工作目录」整体上传，而不是上传 git 的跟踪内容。于是 .gitignore 管不住线上，
#   实测线上能直接读到 /.workbuddy/（带目录列表）、memory/MEMORY.md（管理员邮箱、
#   GitHub 仓库、SSH 配置）、data/articles.json（310KB 全量正文）等本地工作数据。
#
# 做法：只把 `git ls-files` 认为该公开的文件复制到 dist/，然后把 dist/ 作为部署目录。
#   这样「哪些文件会公开」由 git 的跟踪列表单一决定，不再依赖托管方的忽略规则。
#
# 用法：
#   pwsh .workbuddy/scripts/make-dist.ps1              # 输出到 dist/
#   pwsh .workbuddy/scripts/make-dist.ps1 -OutDir D:\out
# 之后把 -OutDir 指向的目录作为站点目录部署即可。

param(
  [string]$OutDir = "dist"
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

if (-not (Test-Path (Join-Path $root '.git'))) {
  throw "找不到 .git，此脚本要求项目是独立 git 仓库：$root"
}

$out = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }

# 安全检查：别把输出目录设在项目内部又递归复制自己
if ($out.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar) -and
    (Split-Path $out -Leaf) -ne 'dist') {
  throw "输出目录必须位于项目外，或使用默认的 dist/：$out"
}

Write-Host "项目根：$root"
Write-Host "输出到：$out"

# 1. 取 git 跟踪的文件列表（唯一真源）
Push-Location $root
try {
  $files = & git -c core.quotepath=false ls-files
  if ($LASTEXITCODE -ne 0) { throw "git ls-files 失败" }
} finally {
  Pop-Location
}

if (-not $files -or $files.Count -eq 0) { throw "git 没有跟踪任何文件，拒绝生成空站点" }

# 2. 兜底：即使有人误把敏感文件 commit 了，也不发布（双保险）
$denyPatterns = @(
  '^\.workbuddy/',
  '^\.wbapp_',
  '^deploy/',
  '^articles/',
  '^\.git',
  '^node_modules/'
)

# 3. 重建输出目录
if (Test-Path $out) {
  Write-Host "清空已有输出目录…"
  Remove-Item $out -Recurse -Force
}
New-Item -ItemType Directory -Path $out -Force | Out-Null

$copied = 0; $skipped = @()
foreach ($rel in $files) {
  $relNorm = $rel -replace '\\', '/'
  $denied = $false
  foreach ($p in $denyPatterns) {
    if ($relNorm -match $p) { $denied = $true; break }
  }
  if ($denied) { $skipped += $relNorm; continue }

  $src = Join-Path $root $rel
  if (-not (Test-Path -LiteralPath $src)) { continue }
  $dst = Join-Path $out $rel
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $copied++
}

# 4. 自检：确认输出里没有任何敏感路径
$problems = @()
foreach ($bad in @('.workbuddy', '.git', 'deploy', 'articles')) {
  if (Test-Path (Join-Path $out $bad)) { $problems += $bad }
}

Write-Host ""
Write-Host "已复制 $copied 个文件到 $out"
if ($skipped.Count) {
  Write-Host "按策略跳过 $($skipped.Count) 个（预期包含 .workbuddy/、deploy/、articles/）："
  $skipped | Select-Object -First 10 | ForEach-Object { Write-Host "  - $_" }
  if ($skipped.Count -gt 10) { Write-Host "  … 其余 $($skipped.Count - 10) 个" }
}

if ($problems.Count -gt 0) {
  Write-Host ""
  Write-Host "❌ 自检失败：输出目录里仍有敏感目录：$($problems -join ', ')" -ForegroundColor Red
  exit 1
}

# 5. 关键入口必须存在，否则部署出去就是白页
$required = @('index.html', 'sw.js', 'manifest.webmanifest', 'sitemap.xml', 'robots.txt', 'feed.xml')
$missing = $required | Where-Object { -not (Test-Path (Join-Path $out $_)) }
if ($missing.Count -gt 0) {
  Write-Host ""
  Write-Host "⚠️ 缺少关键入口文件：$($missing -join ', ')" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "✅ 自检通过：无 .workbuddy/.git/deploy/articles，关键入口齐全" -ForegroundColor Green
Write-Host "   部署时把站点目录指向：$out"
