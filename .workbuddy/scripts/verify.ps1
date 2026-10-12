# 一条命令跑完改代码后的标准校验
#
# 为什么需要：README 里的标准动作（node --check / 重跑快照 / CDP 回归）散在三处，
# 全靠人记。漏掉任何一步的代价都不小——尤其「改了 JS/CSS 忘记 bump ?v= 和 sw VERSION」
# 会让用户长时间看到旧版（历史上真实发生过，还被误判成「网络错误」）。
#
# 用法：
#   .\.workbuddy\scripts\verify.ps1              # 语法 + 快照幂等 + 版本号一致性
#   .\.workbuddy\scripts\verify.ps1 -Cdp         # 额外跑无头浏览器回归（需本地起服务）
#
# 退出码 0 = 全过，1 = 有失败项。

param(
  [switch]$Cdp,
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

$fail = 0
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:fail++ }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Head($m) { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }

# ---------- 1. JS 语法 ----------
Head "JS 语法 (node --check)"
$jsFiles = @(Get-ChildItem assets\js\*.js -ErrorAction SilentlyContinue) + @(Get-Item sw.js -ErrorAction SilentlyContinue)
foreach ($f in $jsFiles) {
  $out = & node --check $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { Bad "$($f.Name): $out" } else { Ok $f.Name }
}
# 维护脚本
foreach ($f in Get-ChildItem .workbuddy\scripts\*.js -ErrorAction SilentlyContinue) {
  & node --check $f.FullName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Bad "scripts/$($f.Name)" }
}
$mjs = Get-Item .workbuddy\scripts\gen-static.mjs -ErrorAction SilentlyContinue
if ($mjs) {
  & node --check $mjs.FullName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Bad "gen-static.mjs" } else { Ok "gen-static.mjs" }
}

# ---------- 2. 资源版本号一致性 ----------
# index.html 的 ?v= 必须唯一且与 sw.js 的 VERSION 同批更新。
# 只做「同一版本号出现多次」的一致性检查；跨文件的时间戳对应关系无法自动判定，
# 所以额外提醒提交前人工确认。
Head "资源版本号 (?v= / sw VERSION)"
$html = [System.IO.File]::ReadAllText((Join-Path $root 'index.html'), [System.Text.Encoding]::UTF8)
$versions = [regex]::Matches($html, '\?v=([0-9A-Za-z\-]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
if ($versions.Count -eq 0) {
  Bad "index.html 里找不到任何 ?v= 版本号"
} elseif ($versions.Count -gt 1) {
  Bad "index.html 里存在多个不同的 ?v= 值：$($versions -join ', ') —— 必须全部一致"
} else {
  Ok "index.html 版本号统一为 v=$($versions -join '')"
}
$sw = [System.IO.File]::ReadAllText((Join-Path $root 'sw.js'), [System.Text.Encoding]::UTF8)
$swVer = ([regex]::Match($sw, "VERSION = '([^']+)'")).Groups[1].Value
if ($swVer) { Ok "sw.js VERSION = $swVer" } else { Bad "sw.js 里读不到 VERSION" }

# 资源引用数：改版后数量应保持稳定，骤降通常意味着漏了某一行
$refCount = ([regex]::Matches($html, '\?v=')).Count
Ok "index.html 引用带动版本号的资源 $refCount 处"

# ---------- 3. 云 SDK 必须自托管 ----------
# 这条曾经导致线上整站白屏：CDN 在国内 DNS 解析失败 → boot() 时 window.cloud 为 null。
Head "云 SDK 自托管"
if ($html -match 'cdn\.jsdelivr\.net|unpkg\.com' -and $html -notmatch '<!--[\s\S]*?cdn\.jsdelivr\.net[\s\S]*?-->') {
  Bad "index.html 仍在从 CDN 加载资源 —— 国内会白屏，必须改回 assets/vendor/"
} else {
  Ok "未引用境外 CDN"
}
if ($html -match 'assets/vendor/workbuddy-cloud-sdk\.js') {
  Ok "云 SDK 走自托管副本"
} else {
  Bad "找不到自托管的云 SDK 引用"
}

# ---------- 4. 数据库文案里的敏感串 ----------
Head "敏感信息"
$tracked = & git -c core.quotepath=false ls-files
# 检测模式用字符串拼接构造，避免这个脚本「自己命中自己」产生假阳性
$patCloudflare = 'cf' + 'k_[A-Za-z0-9]{20,}'
$patPostgres   = 'postgres(ql)?://[^:\s]+:[^@\s]+@'
$patOpenAI     = 'sk-' + '[A-Za-z0-9]{20,}'
$patAssignKey  = '(API_KEY|SECRET|TOKEN)\s*=\s*["'']\S{12,}'
$self = 'verify.ps1'
$hits = @()
foreach ($f in $tracked) {
  if ($f -match '\.(png|jpg|jpeg|gif|webp|ico|woff2?)$') { continue }
  if ($f -like "*$self") { continue }   # 跳过本脚本自身的模式串
  $p = Join-Path $root $f
  if (-not (Test-Path -LiteralPath $p)) { continue }
  $txt = Get-Content -LiteralPath $p -Raw -ErrorAction SilentlyContinue
  if ($txt -match $patCloudflare -or $txt -match $patPostgres -or
      $txt -match $patOpenAI -or $txt -match $patAssignKey) { $hits += $f }
}
if ($hits.Count) { Bad "疑似密钥出现在跟踪文件里：$($hits -join ', ')" } else { Ok "跟踪文件中未发现明文密钥" }

# ---------- 5. 快照幂等 ----------
Head "SEO 快照幂等 (gen-static)"
$dataJson = Join-Path $root '.workbuddy\data\articles.json'
if (-not (Test-Path $dataJson)) {
  Warn "缺少 .workbuddy/data/articles.json（云端导出），跳过快照校验"
} else {
  $out = & node .workbuddy\scripts\gen-static.mjs $dataJson $root 2>&1
  if ($LASTEXITCODE -ne 0) {
    Bad "gen-static 执行失败：$($out | Select-Object -Last 3)"
  } else {
    ($out | Select-String -Pattern '新增|更新|未变|清理下线|附属文件变更|结论') | ForEach-Object { Write-Host "    $($_.Line.Trim())" }
    $dirty = & git status --porcelain -- a archive sitemap.xml feed.xml llms.txt llms-full.txt robots.txt index.html
    if ($dirty) {
      Bad "重跑快照后有文件变化（说明快照未同步，需要提交或部署）："
      $dirty | Select-Object -First 8 | ForEach-Object { Write-Host "      $_" }
    } else {
      Ok "重跑后生成物与仓库一致（幂等）"
    }
  }
}

# ---------- 6. 可选的 CDP 回归 ----------
if ($Cdp) {
  Head "无头浏览器回归 (CDP)"
  $probe = "http://127.0.0.1:$Port/"
  $reachable = $false
  try { Invoke-WebRequest $probe -TimeoutSec 5 -UseBasicParsing | Out-Null; $reachable = $true } catch { }
  if (-not $reachable) {
    Warn "本地 $probe 不可达。请先在项目根目录起服务：python -m http.server $Port --bind 127.0.0.1"
  } else {
    $r = & node .workbuddy\scripts\cdp\check-regression.cjs 2>&1
    if ($LASTEXITCODE -ne 0) {
      Bad "回归脚本执行失败：$($r | Select-Object -Last 3)"
    } else {
      $txt = $r -join "`n"
      $json = $null
      try { $json = $txt | ConvertFrom-Json } catch { }
      if ($null -eq $json) {
        Bad "回归输出无法解析为 JSON"
      } else {
        $stuck = @($json.routes.PSObject.Properties | Where-Object { $_.Value.stuckOnLoading }).Count
        if ($stuck -gt 0) { Bad "$stuck 条路由卡在 loading" } else { Ok "全部路由正常渲染" }
        $ov = $json.checks.homeCardsOverflow.overflowing + $json.checks.relatedCardsOverflow.overflowing
        if ($ov -gt 0) { Bad "有 $ov 张卡片摘要溢出" } else { Ok "卡片无溢出" }
        if ($json.exceptions.Count -gt 0) { Bad "控制台异常 $($json.exceptions.Count) 条" } else { Ok "无 JS 异常" }
        if ($json.checks.blockedCdn.cloudLoaded -ne 'object') { Bad "阻断境外 CDN 后 window.cloud 未加载" } else { Ok "阻断境外 CDN 后仍正常" }
      }
    }
  }
}

# ---------- 汇总 ----------
Write-Host ""
if ($fail -eq 0) {
  Write-Host "全部通过 ✅" -ForegroundColor Green
  Write-Host "别忘了：改了 JS/CSS 要 bump index.html 的 ?v= 与 sw.js 的 VERSION；"
  Write-Host "        部署请用 .\.workbuddy\scripts\make-dist.ps1 生成 dist/ 后再发布。"
  exit 0
} else {
  Write-Host "$fail 项未通过 ❌" -ForegroundColor Red
  exit 1
}
