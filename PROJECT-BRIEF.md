# AI 炼丹房 · 项目简报（给 AI 看的技术上下文）

> 这份文件是给其他 AI 助手读的。把它的内容（或文件路径）提供给 AI，就能让对方在不读全部源码的情况下理解这个项目的架构、数据模型和工程约定。

## 1. 这个项目是什么

一个面向初学者的 **AI / 大模型中文教学博客**。不是随笔集，内容是按难度分层编排的成体系教程：从「大模型其实在猜下一个字」这类原理直觉，一路讲到模型选型、微调、推理优化和真实踩坑记录。

- 线上地址：https://ai-alchemy-lab.app.workbuddy.host/
- 本地路径：`E:\student\project\AI Training Lab`
- 当前规模：31 篇已发布文章、约 3700 行 JS、1700 行 CSS、7 张数据表
- 定位关键词：教学型博客、零构建、纯前端、云端数据库

## 2. 技术栈与架构决策

| 层 | 选型 | 为什么这么选 |
|---|---|---|
| 前端 | 原生 JS + hash 路由 SPA，**无框架、无打包、无构建步骤** | 改一个文件刷新就能看到效果；不引入 npm/构建链，避免升级地狱 |
| Markdown | marked（解析）+ DOMPurify（消毒）+ highlight.js（高亮），全部走 CDN | 内容由站长本人撰写，但仍做消毒 |
| 数据 | WorkBuddy 云数据库（PostgreSQL）+ 对象存储 + 邮箱认证，经浏览器 SDK 访问 | 不自建后端；权限靠 PostgreSQL RLS 而不是应用层判断 |
| 样式 | CSS 变量 + `<html data-theme>`，5 套主题 | 换肤不重排、不重绘，新增样式只能用变量否则会破皮 |
| 托管 | 纯静态托管 | 与「零构建」一致 |

**两条贯穿全项目的硬约束**，理解它们才能不改错代码：

1. **前端不能直接改数据**：所有写操作要么走云端 SDK 受 RLS 约束，要么走数据库 RPC。权限判断在数据库，不在 JS。
2. **静态托管没有服务端**：做不到服务端渲染。SEO 靠预渲染快照（见第 5 节），发布新内容后快照需要重新生成。

## 3. 目录结构

```
AI Training Lab/
├── index.html                 唯一入口页（SPA 外壳 + 主题防闪烁脚本）
├── assets/
│   ├── css/style.css          全部样式；:root 定义变量，4 个主题覆盖块
│   └── js/
│       ├── config.js          云服务 endpoint / publishableKey / 站点域名
│       ├── util.js            DOM 助手、转义、剪贴板、分享卡片绘制、页面 meta 注入
│       ├── markdown.js        Markdown → HTML（含标题锚点、代码块复制按钮）
│       ├── api.js             全部数据访问，唯一与云端打交道的文件
│       ├── theme.js           5 套主题切换 + 登录用户云端同步
│       ├── views.js           前台页面：首页 / 文章 / 标签 / 系列 / 关于
│       ├── auth.js            邮箱登录、注册、验证码、找回密码
│       ├── admin.js           后台：仪表盘 / 文章 / 系列 / 评论 / 标签 / 管理员 / 设置 / 编辑器
│       └── app.js             路由分发、页头渲染、PWA 注册
├── a/<id>/index.html          预渲染的文章静态页（SEO 用，由脚本生成，勿手改）
├── archive/index.html         归档枢纽页（脚本生成）
├── sitemap.xml / robots.txt   （脚本生成）
├── llms.txt / llms-full.txt   给 AI 读的站点索引与全文（脚本生成）
├── manifest.webmanifest / sw.js / icons/   PWA
├── articles/                  文章 Markdown 源文件（本地存档，不参与运行）
└── .workbuddy/
    ├── scripts/gen-static.mjs 预渲染脚本（唯一「构建」步骤）
    ├── data/articles.json     云端文章导出，脚本的输入
    └── memory/                项目工作日志与长期笔记
```

## 4. 数据模型

7 张表，全部启用 RLS（Row Level Security）。权限规则写在数据库策略里，不是 JS 里。

| 表 | 用途 | 关键策略 |
|---|---|---|
| `articles` | 文章正文与元数据 | 公开读「已发布」；增删改仅管理员 |
| `series` | 主题系列（本地部署、模型选型、微调……） | 公开读；写仅管理员 |
| `comments` | 文章评论，支持两级回复 | 公开读；**登录用户才能发**；本人或管理员可删 |
| `attachments` | 文章附件记录 | 公开读；仅管理员写 |
| `site_admins` | 管理员 UID，`role` 区分 owner / admin | 仅管理员可读 |
| `site_settings` | 站点设置的 key/value | 公开读；写走 `update_site_setting` RPC |
| `user_preferences` | 用户偏好（目前存主题） | 仅本人读写 |

**改这类代码时最容易踩的两个坑：**

- 建表后必须 **先 GRANT 再建策略**，只建策略会得到 `42501`，看起来像策略写错，其实是缺 grant。
- PostgreSQL 没有 `CREATE POLICY IF NOT EXISTS`，要幂等就必须先 `DROP POLICY IF EXISTS`。

## 5. 几个关键机制

**SEO 预渲染**（本项目唯一「构建」步骤）
纯 hash 路由 SPA 对爬虫不可见，所以脚本把每篇文章渲染成真实 URL 的静态页 `/a/<id>/index.html`，正文完整落在 HTML 里。SPA 页通过 `canonical` 把权重指向静态页。后台任何改内容的动作会写 `site_settings.seo_dirty` 打标记，定时任务消费这个标记重新生成并发布。

```bash
node .workbuddy/scripts/gen-static.mjs .workbuddy/data/articles.json "E:/student/project/AI Training Lab"
```

**主题系统**
`style.css` 的 `:root` 是默认主题（墨金），后面 4 个 `[data-theme]` 块覆盖变量。新增样式**一律用变量**，硬编码颜色会让其他主题破皮。登录用户的主题存云端，跨设备同步。

**评论区**
登录后可评论、先发后审。支持两级回复，本人或管理员可删。后台 `#/admin/comments` 做 moderation。

**阅读增强**
文章页自动生目录（`sec-N` 锚点，用 button + `scrollTo` 跳转，**不能用 `#锚点` 链接否则会劫持 SPA 路由**）、顶部阅读进度条、代码块一键复制。

**PWA**
`manifest.webmanifest` + Service Worker。策略：页面导航网络优先（保证能看到更新），站内静态资源 stale-while-revalidate，跨域请求不拦截。

## 6. 给 AI 的请求建议

- **想让我读懂站内文章内容** → 读 `llms.txt`（索引）或 `llms-full.txt`（全文）
- **想让我分析代码、改 bug、加功能** → 给它这份文件 + 具体文件路径
- **想让我写新文章** → 先读 `articles/README-系列总表与上传清单.md` 了解分层体系，再读风格约定

## 7. 已知限制

- 静态托管无服务端，文章发布后静态快照最快要等一个定时周期才更新，做不到即时。
- 本目录所在的 git 仓库实际是父目录 `E:/student/project`（另一个项目），炼丹房自身未被该仓库跟踪，也没有独立远端。
- 云数据库的文章正文单次写入有大小上限，长文必须分块 append。
