#!/usr/bin/env python3
"""统计回收站里「本项目无头浏览器验证留下的临时 profile」占了多少。

背景：CDP 脚本每次运行会新建 Edge 临时 profile（%TEMP%/wbcdp-*、%TEMP%/cdp-*），
跑完不自动删除，攒多了很占空间。Windows 的删除会先进回收站，空间不会立刻释放。

用途：按「原始路径」精确识别哪些回收站条目是本项目的 —— $I* 元数据里存着 UTF-16
编码的原路径，命中白名单的才算我们的。这样你能知道该清多少、以及清掉的是不是只有项目垃圾。

**注意（实测结论）**：直接删 `$Recycle.Bin` 里的 $R/$I 文件会被系统拒绝（WinError 5 拒绝访问），
回收站只能由资源管理器 / `Clear-RecycleBin` 清空。所以这个脚本只做统计，要真正释放空间请：
  1. 桌面右键「回收站」→「清空回收站」（清空前能自己看一眼里面还有什么）；或
  2. PowerShell 执行 `Clear-RecycleBin -DriveLetter C -Force`（会连里面所有别的东西一起清，不可逆）。

用法：
    python purge-cdp-trash.py            # 预演，只统计不删
    python purge-cdp-trash.py --apply    # 尝试删除（通常仍会因权限失败，保留只是为了排查）
"""

import os
import sys

RB = r"C:\$Recycle.Bin"
# 原路径里，紧跟着 "...\Local\Temp\" 的这一段目录名命中即算我们的
PREFIXES = ("wbcdp-", "cdp-", "wb-cdp", "waline-repo")
MARKER = "Local\\Temp\\"
# 中文用户名会让删除钩子失效，实践中会先搬到 C:\wbclean 再删，所以这一批也要认
STAGING = "wbclean\\"
STAGE_OK = ("wbcdp-", "cdp-", "wb-cdp", "waline-repo", "")

apply = "--apply" in sys.argv

hit_files = 0
hit_bytes = 0
scanned = 0

for root, _dirs, files in os.walk(RB):
    for name in files:
        if not name.startswith("$I"):
            continue
        scanned += 1
        meta = os.path.join(root, name)
        try:
            with open(meta, "rb") as fh:
                data = fh.read()
        except OSError:
            continue
        txt = data.decode("utf-16-le", errors="ignore")
        pos = txt.find(MARKER)
        if pos >= 0:
            seg = txt[pos + len(MARKER):].split("\\")[0]
            if not seg.startswith(PREFIXES):
                continue
        else:
            pos2 = txt.find(STAGING)
            if pos2 < 0:
                continue
        payload = os.path.join(root, "$R" + name[2:])
        for target in (meta, payload):
            if not os.path.exists(target):
                continue
            try:
                size = os.path.getsize(target)
            except OSError:
                size = 0
            if apply:
                try:
                    os.remove(target)
                except OSError as exc:
                    print("  删除失败 %s :: %s" % (target, exc))
                    continue
            hit_files += 1
            hit_bytes += size

print("扫描 $I 元数据: %d 个" % scanned)
print("命中本项目临时目录: %d 个文件, %.2f GB" % (hit_files, hit_bytes / 1073741824))
print("模式: %s" % ("已删除" if apply else "预演（加 --apply 才真删）"))
