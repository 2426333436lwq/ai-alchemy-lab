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
| 前端 | 原生 JS + hash 路由，CDN 引入 marked / DOMPurify / highlight.js |
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
a/<id>/index.html           预渲染文章页（脚本生成，勿手改）
archive/  sitemap.xml  robots.txt   （脚本生成）
llms.txt  llms-full.txt     给 AI 读的站点索引与全文（脚本生成）
manifest.webmanifest  sw.js  icons/   PWA
articles/                   文章 Markdown 源文件
.workbuddy/scripts/         维护脚本（快照生成、内容校验等）
```

## 给 AI 协作的说明

> 如果你是接手这个项目的 AI，请先读 [`PROJECT-BRIEF.md`](PROJECT-BRIEF.md)——里面有技术栈决策、模块职责、数据模型与 RLS 策略、关键机制和已知坑。读完就不用把 3700 行代码全啃一遍。

改完代码后的标准动作：

```bash
# 1. 校验 JS 语法
for f in assets/js/*.js; do node --check "$f"; done

# 2. 如果改了文章内容，重新生成 SEO 静态快照
node .workbuddy/scripts/gen-static.mjs .workbuddy/data/articles.json "."

# 3. 提交
git add -A && git commit -m "说明改了什么" && git push
```

**四条硬约定**，违反会让站点出问题：

1. 新增样式**只能用 CSS 变量**，硬编码颜色会让其他主题破皮。
2. 目录跳转**只能用 button + `scrollTo`**，用 `#锚点` 链接会劫持 SPA 路由。
3. `a/` 目录是生成产物，改文章请走后台或数据库，然后重跑快照脚本。
4. 数据库建表要**先 GRANT 再建策略**；改策略要先 `DROP POLICY IF EXISTS`。

## 隐私说明

`.workbuddy/memory/`、`.workbuddy/data/`、`.workbuddy/applications.yaml` 已在 `.gitignore` 中排除（含管理员 UID、邮箱等本地工作数据），不会进入本仓库。

## 许可

文章版权归作者所有，转载请注明出处。
