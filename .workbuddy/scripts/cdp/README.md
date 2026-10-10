# .workbuddy/scripts/cdp · 无头浏览器验证脚本

用系统自带的 Edge + Chrome DevTools Protocol 做真机验证，不需要装任何 npm 包（Node 22 自带 `WebSocket`）。

## 前置

1. 在项目根目录起一个本地服务（SPA 需要 http 协议，不能直接开文件）：

```bash
python -m http.server 8080 --bind 127.0.0.1
```

2. 确认 Edge 路径。脚本里写的是 `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`，
   换机器如果路径不同，全局替换一下即可。

## 脚本

| 脚本 | 用途 |
|---|---|
| `check-login.cjs` | 登录页：标签页、记住密码存取、注册/找回密码切换、布局尺寸 |
| `check-offline.cjs` | **模拟境外 CDN 被墙**：阻断 jsdelivr/unpkg/vercel 后，检查首页、文章、代码高亮、评论降级 |
| `check-ask.cjs <port> <theme>` | 机器人按钮拖拽、位置持久化、面板跟随、五套主题配色取值 |
| `check-ask-flow.cjs` | 问答主通道是否走站点自带云服务（不发请求给境外接口） |
| `check-hljs.cjs <文章id>` | 代码高亮在 CDN 阻断时是否仍生效 |
| `check-cloud-llm.cjs` / `list-models.cjs` / `bench-llm.cjs` | 云服务大模型：连通性、模型清单、各模型响应速度 |
| `check-signup-shot.cjs` | 注册表单截图 |

## 用法

```bash
node .workbuddy/scripts/cdp/check-offline.cjs
node .workbuddy/scripts/cdp/check-ask.cjs 9336 dark
```

输出是 JSON + 一张 PNG（落在系统临时目录，路径会打印在最后一行）。

## 注意

- 每次运行会新建一个临时 Edge profile（放系统 Temp），跑完进程退出但**目录不自动删**，
  攒多了会占空间，可以定期清理 `Temp/wbcdp-*`。
- 端口不要撞：每个脚本用不同的调试端口，同时跑要改。
