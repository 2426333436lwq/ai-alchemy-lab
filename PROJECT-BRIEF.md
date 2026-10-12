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
│   ├── css/style.css          全部样式；:root 定义变量，5 个主题覆盖块
│   ├── vendor/                第三方库本地副本（不依赖任何 CDN，见下方「网络约束」）
│   └── js/
│       ├── config.js          云服务 endpoint / publishableKey / 站点域名
│       ├── util.js            DOM 助手、转义、剪贴板、图片压缩（含 EXIF 方向）、分享卡片、页面 meta
│       ├── markdown.js        Markdown → HTML（含标题锚点、代码块复制按钮、图片灯箱）
│       ├── api.js             全部数据访问，唯一与云端打交道的文件
│       ├── theme.js           主题切换（含跟随系统）+ 登录用户云端同步
│       ├── views.js           前台页面：首页 / 文章 / 标签 / 系列 / 关于 / 收藏
│       ├── ask-widget.js      右下角可拖拽 AI 问答浮窗（多模型轮询 + 失败重试 + 客户端节流）
│       ├── auth.js            邮箱登录、注册、验证码、找回密码
│       ├── admin.js           后台：仪表盘 / 文章 / 系列 / 评论 / 标签 / 管理员 / 设置 / 编辑器
│       └── app.js             路由分发、页头渲染、PWA 注册
├── a/<id>/index.html          预渲染的文章静态页（SEO 用，由脚本生成，勿手改）
├── archive/index.html         归档枢纽页（脚本生成）
├── sitemap.xml / robots.txt   （脚本生成）
├── feed.xml                   RSS 订阅源（脚本生成）
├── llms.txt / llms-full.txt   给 AI 读的站点索引与全文（脚本生成）
├── manifest.webmanifest / sw.js / icons/   PWA
├── articles/                  文章 Markdown 源文件（本地存档，不参与运行）
├── deploy/waline/             备用评论后端源码（部署在 Vercel，当前未启用）
└── .workbuddy/
    ├── scripts/gen-static.mjs 预渲染脚本（唯一「构建」步骤）
    ├── scripts/cdp/           无头 Edge 验证脚本（不装依赖）
    ├── data/articles.json     云端文章导出，脚本的输入
    └── memory/                项目工作日志与长期笔记

### 三条容易踩的网络约束（2026-10-12 实测）

1. **云 SDK 必须自托管**，不能用 jsdelivr CDN。它在 `index.html` 里是阻塞式 `<script>`，
   国内 DNS 解析失败时要等浏览器超时（约 7s），期间本地脚本虽会执行，但 `boot()` 跑的时候
   `window.cloud` 还是 `null`，页面会永远停在「炉火初燃」的 loading 上。
   这条曾经真实导致过线上全站白屏，改回去务必三思。
2. **`*.vercel.app` 在中国大陆访问不到**，所以 Waline 评论后端与 `/api/ask` 对国内用户不可用。
3. **本机（开发沙箱）连不上 `cdn.jsdelivr.net`**（DNS 解析失败）也不通
   `ssh.github.com:443`（SSH 握手被 reset）——前者正好是验证第 1 条的天然环境，
   后者意味着**提交只能在本地做，push 需要你在自己机器上执行**。
```

## 4. 数据模型

7 张表，全部启用 RLS（Row Level Security）。权限规则写在数据库策略里，不是 JS 里。
（表名由 `assets/js/api.js` 里的 `.from('…')` 调用反查得到，改表请同步更新此表。）

| 表 | 用途 | 关键策略 |
|---|---|---|
| `articles` | 文章正文与元数据 | 公开读「已发布」；增删改仅管理员 |
| `series` | 主题系列（本地部署、模型选型、微调……） | 公开读；写仅管理员 |
| `comments` | 文章评论，支持两级回复 | 公开读；**登录用户才能发**；本人或管理员可删 |
| `attachments` | 文章附件记录 | 公开读；仅管理员写 |
| `site_admins` | 管理员 UID，`role` 区分 owner / admin | 仅管理员可读 |
| `site_settings` | 站点设置的 key/value | 公开读；写走 `update_site_setting` RPC |
| `user_preferences` | 用户偏好（目前存主题） | 仅本人读写 |

数据库 RPC（全部经 `cloud.database.rpc()` 调用）：
`is_admin` / `is_owner` / `claim_admin` / `admins_count` / `add_admin` / `remove_admin` /
`rename_tag` / `delete_tag` / `increment_views` / `series_with_counts` / `update_site_setting`

对象存储路径约定（`cloud.storage`）：
`shared/<uid>/blog/images/<uuid>.jpg`（正文配图与封面）与
`shared/<uid>/blog/files/<uuid>-<name>`（附件）。

**改这类代码时最容易踩的三个坑：**

- 建表后必须 **先 GRANT 再建策略**，只建策略会得到 `42501`，看起来像策略写错，其实是缺 grant。
- PostgreSQL 没有 `CREATE POLICY IF NOT EXISTS`，要幂等就必须先 `DROP POLICY IF EXISTS`。
- **对象存储不是公开桶**（2026-10-12 实测）：wrapper 只暴露 `from/userPath/sharedPath`，
  没有 `getPublicUrl`；手拼 `/.cloud/storage/object/public/...` 匿名访问返回
  `401 invalid_client`；`createSignedUrl` 上限硬卡 3600 秒且需要凭据。
  所以**文章配图只能以 base64 内嵌正文**，未登录读者才看得到图——
  想改成外链必须先有「公开读桶」或「服务端代理」。

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
- **本目录是独立的 git 仓库**，远端 `git@github.com:2426333436lwq/ai-alchemy-lab.git`（分支 `main`）。
  注意：它父目录 `E:/student/project` 是**另一个**项目，两者互不跟踪，别提交错仓库。
- 云数据库的文章正文单次写入有大小上限，长文必须分块 append。
- 文章配图以 base64 内嵌正文，正文体积随图片线性增长（见第 4 节「对象存储不是公开桶」）。
