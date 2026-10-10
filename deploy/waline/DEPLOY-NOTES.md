# deploy/waline · 评论与问答后端

这份是部署在 **Vercel** 上的 Waline 服务端源码，博客前台的评论区（`assets/js/views.js` 里的 `WALINE_SERVER`）指向它。

## 现况

| 项 | 值 |
|---|---|
| 线上地址 | `https://ai-alchemy-waline.vercel.app` |
| 后台管理 | `https://ai-alchemy-waline.vercel.app/ui/login` |
| 数据来源 | Neon PostgreSQL（由 `PG_DB` / `POSTGRES_DATABASE` 等环境变量决定） |
| 源仓库 | `git@github.com:2426333436lwq/ai-alchemy-waline`（Vercel 从这个仓库自动部署） |

## 目录内容

- `index.cjs` —— Waline 主入口（`@waline/vercel`），所有 `/api/*` 评论/用户接口都走这里
- `api/ask.js` —— 我们自己加的 AI 问答接口（智谱 GLM-4-Flash）
  > 注意：博客前台的问答现在主走站点自带的云服务通道，这个接口只作境外备用
- `vercel.json` —— 构建与路由。**关键**：rewrite 必须保留最前面那条 `/api/ask`，
  其余全部交给 catch-all `/((?!robots\.txt$).*) → index.cjs`。
  千万不要改成排除整个 `api/` 目录 —— Waline 自己的登录、用户、评论接口全在 `/api/*` 下，
  排除掉会导致后台登不进、评论全挂（这个坑踩过一次）。
- `.env.example` —— 数据库连接环境变量示例（真实值填在 Vercel 项目设置里，不入库）

## Vercel 需要配置的环境变量

- 数据库：`PG_DB` 或 `POSTGRES_DATABASE`（还有 USER / HOST / PASSWORD / SSL 等，见 `.env.example`）
- 问答：`ZHIPU_API_KEY`

> 环境变量是**部署时注入**的，新增或修改后必须重新部署才生效（手动 Redeploy，或 push 一个空提交）。

## 这个文件是怎么来的

原本克隆在 `C:/Users/刘玮琦/AppData/Local/Temp/waline-repo/`，为方便迁移已搬进本项目（嵌套的 `.git` 没有带走，它以 `3c1eba7` 完整同步在 GitHub 上）。

要单独维护并推送回它自己的仓库：

```bash
cd deploy/waline
git init && git remote add origin git@github.com:2426333436lwq/ai-alchemy-waline.git
git add -A && git commit -m "update"
git push -f origin main
```

Windows 走 443 端口时需要：

```bash
git config core.sshCommand "ssh -F /dev/null -o HostName=ssh.github.com -p 443 -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519_github"
```

## 已知问题

`vercel.app` 在中国大陆访问不到，国内用户看不到评论（前台已做降级提示）。
要彻底解决需迁移到国内可直连的托管，迁移后改 `assets/js/views.js` 的 `WALINE_SERVER` 常量即可。
