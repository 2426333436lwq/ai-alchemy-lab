# AI 炼丹房

> 数据是药材 · 算力是炉火 · 调参是火候

一个面向初学者的 **AI / 大模型中文教学博客**。不是随笔集，内容按难度分层编排成体系：从「大模型其实在猜下一个字」这类原理直觉，一路讲到模型选型、微调、推理优化和真实踩坑记录。

- **线上站点**：https://ai-alchemy-lab.app.workbuddy.host/
- **代码仓库**：https://github.com/2426333436lwq/ai-alchemy-lab
- **当前规模**：31 篇已发布文章 · 约 3700 行 JS · 1700 行 CSS · 7 张数据表

```bash
git clone git@github.com:2426333436lwq/ai-alchemy-lab.git
```

## 技术栈

纯静态 SPA，**零框架、零打包、零构建步骤**。

| 层 | 选型 |
|---|---|
| 前端 | 原生 JS + hash 路由，第三方库**全部本地自托管**在 `assets/vendor/`（marked / DOMPurify / highlight.js / Waline 客户端），不依赖任何境外 CDN，国内外网络都能加载 |
| 数据 | 云数据库（PostgreSQL）+ 对象存储 + 邮箱认证，经浏览器 SDK 访问 |
| 权限 | PostgreSQL RLS（行级安全），判断在数据库而非前端 |
| 样式 | CSS 变量 + `<html data-theme>`，5 套主题 |
| 托管 | 纯静态托管 |

## 目录结构

```
index.html                  唯一入口页
assets/css/style.css        全部样式（:root 定义变量，4 个主题覆盖块）
assets/js/
  config.js  util.js  markdown.js  api.js  theme.js
  views.js   auth.js  admin.js     app.js
  ask-widget.js              右下角可拖拽的 AI 问答浮窗
assets/vendor/              第三方库本地副本（不依赖 CDN）
articles/                   文章 Markdown 源文件
deploy/waline/              备用评论后端（Waline，部署在 Vercel，当前未启用，见 DEPLOY-NOTES.md）
a/<id>/index.html           预渲染文章页（脚本生成，勿手改）
archive/  sitemap.xml  robots.txt  feed.xml   （脚本生成）
llms.txt  llms-full.txt     给 AI 读的站点索引与全文（脚本生成）
manifest.webmanifest  sw.js  icons/   PWA
.workbuddy/scripts/         维护脚本（快照生成、内容校验等）
.workbuddy/scripts/cdp/     无头浏览器验证脚本（不装依赖，直接用系统 Edge）
```

## 换一台电脑怎么继续

整个项目是自包含的，只需要仓库里的东西：

1. `git clone`（或整目录拷贝）到新机器；
2. 装 Node 18+（只用于跑维护脚本，站点本身不需要构建）；
3. 本地预览：在项目根目录起任意静态服务，例如 `python -m http.server 8080`，
   然后打开 `http://127.0.0.1:8080/`（**必须走 http，直接双击 index.html 不行**，
   SPA 与云服务 SDK 都需要正确 origin；登录功能只在已发布域名上可用）。

> 注：`gen-static.mjs` 需要 `marked`。它会依次在项目内 `node_modules/`、
> 受管 Node 工作区（按当前用户 home 推导）里找；都没有就用 `MARKED_PATH`
> 指定，或直接在项目里 `npm i -D marked`。找不到时会打印已尝试的路径。

运行时依赖只有一处是外部的：

- 云数据库 / 存储 / 认证：WorkBuddy 云服务（配置在 `assets/js/config.js`）。
  评论、问答、主题同步都走它，国内可达、零额外托管成本。
- 备用评论后端（**当前未启用**）：`deploy/waline/` 部署在 Vercel，地址在
  `assets/js/views.js` 的 `WALINE_SERVER`。注意该文件顶部 `COMMENT_BACKEND`
  **现在生效的值是 `'waline'`**，想切回站内自建评论（云端 `comments` 表）才改成
  `'builtin'`。境外后端大陆网络访问不到，所以国内访客看到的是降级提示，不是故障。

## 给 AI 协作的说明

> 如果你是接手这个项目的 AI，请先读 [`PROJECT-BRIEF.md`](PROJECT-BRIEF.md)——里面有技术栈决策、模块职责、数据模型与 RLS 策略、关键机制和已知坑。读完就不用把 3700 行代码全啃一遍。

改完代码后的标准动作：

```bash
# 1. 校验 JS 语法
for f in assets/js/*.js; do node --check "$f"; done

# 2. 如果改了文章内容，重新生成 SEO 静态快照
#    输出末尾会给出「★ 有变更，需要发布」或「无变更，可跳过发布」的明确结论
node .workbuddy/scripts/gen-static.mjs .workbuddy/data/articles.json "."

# 3. 改了 JS/CSS 必须同时做两件事（少一件用户就会看到旧版）：
#    index.html 里全部资源的 ?v= 换新值 + sw.js 的 VERSION bump 一位

# 4. 提交
git add -A && git commit -m "说明改了什么" && git push
```

## 部署：必须从 dist/ 发布，不要直接发布项目目录

**部署是把「工作目录」整体上传，不是上传 git 的跟踪内容**，所以 `.gitignore` 管不住线上。
2026-10-12 实测发现线上可直接读到这些**本应私有**的文件（还开了目录列表）：

| 线上 URL | 泄露内容 |
|---|---|
| `/.workbuddy/` | 目录列表 |
| `/.workbuddy/memory/MEMORY.md` | 管理员邮箱、GitHub 仓库、SSH 配置 |
| `/.workbuddy/applications.yaml` | 应用 locator |
| `/.workbuddy/data/articles.json` | 310KB 全量正文 |

正确做法是先构建一个只含「该公开文件」的目录，再把它作为站点目录部署：

```powershell
# 只把 git 跟踪的、且不在排除清单里的文件复制到 dist/，并自检
.\\.workbuddy\scripts\make-dist.ps1

# 然后把站点目录指向 dist/ 去发布
```

`make-dist.ps1` 会跳过 `.workbuddy/`、`deploy/`、`articles/` 等，并在结束时断言
「输出里没有敏感目录 + 关键入口文件齐全」，不通过就直接失败，避免又发一版带泄露的站点。

> 脚本是 UTF-8 **with BOM**（Windows PowerShell 5.1 读无 BOM 的中文会乱码报错）。
> 用编辑器改完请确认 BOM 还在。

**五条硬约定**，违反会让站点出问题：

1. 新增样式**只能用 CSS 变量**，硬编码颜色会让其他主题破皮。
2. 目录跳转**只能用 button + `scrollTo`**，用 `#锚点` 链接会劫持 SPA 路由。
3. `a/` 目录是生成产物，改文章请走后台或数据库，然后重跑快照脚本。
4. 数据库建表要**先 GRANT 再建策略**；改策略要先 `DROP POLICY IF EXISTS`。
5. **云 SDK 必须自托管**（`assets/vendor/workbuddy-cloud-sdk.js`），绝不能改回 CDN——
   jsdelivr 在国内 DNS 经常解析失败，会让整站卡在「炉火初燃」的 loading 上。
   同理第三方库一律放 `assets/vendor/`，不引任何境外 CDN。

## 隐私说明

`.workbuddy/memory/`、`.workbuddy/data/`、`.workbuddy/applications.yaml` 已在 `.gitignore` 中排除（含管理员 UID、邮箱等本地工作数据），不会进入本仓库。

## 许可

文章版权归作者所有，转载请注明出处。
