/* 预渲染静态落地页（SEO）
 * 从云端导出的文章 JSON 生成：
 *   a/<id>/index.html  每篇文章一个真实 URL，正文完整落在 HTML 里
 *   archive/index.html 全站归档（爬虫枢纽页）
 *   sitemap.xml / robots.txt / feed.xml
 * 用法：
 *   node .workbuddy/scripts/gen-static.mjs <articles.json> [站点根目录]
 * 域名可用第 3 个参数或 SITE_BASE 环境变量覆盖（迁移到 Cloudflare 后默认指向 workers.dev） */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

/* marked 装在受管 Node 工作区，脚本在仓库里，用绝对路径 require */
const require = createRequire('C:/Users/刘玮琦/.workbuddy/binaries/node/workspace/');
const { marked } = require('marked');

const dumpPath = process.argv[2];
const siteDir = process.argv[3] || path.resolve(process.cwd());
const BASE = process.argv[4] || process.env.SITE_BASE || 'https://ai-alchemy-lab.2426333436.workers.dev';
const SITE = 'AI 炼丹房';
const SLOGAN = '数据是药材 · 算力是炉火 · 调参是火候';

if (!dumpPath) {
  console.error('用法: node gen-static.mjs <articles.json> [站点根目录]');
  process.exit(1);
}

const raw = fs.readFileSync(dumpPath, 'utf8');
const all = JSON.parse(raw);
const articles = all
  .filter(function (a) { return a && a.id; })
  .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

marked.setOptions({ gfm: true, breaks: false });

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* 内容由站长本人撰写，仍做一次基础清洗：去掉脚本与内联事件属性 */
function sanitize(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

function renderMarkdown(md) {
  const html = marked.parse(String(md || ''));
  const clean = sanitize(html);
  return clean.replace(/<pre><code class="language-([a-z0-9+#-]+)"/gi, '<pre><code class="language-$1 hljs"');
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

function isoDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function urlOf(a) { return BASE + '/a/' + a.id + '/'; }
function spaOf(a) { return BASE + '/#/article/' + a.id; }

function readingMinutes(md) {
  const text = String(md || '').replace(/```[\s\S]*?```/g, '');
  return Math.max(1, Math.round(text.length / 400));
}

function related(a, limit) {
  const myTags = (a.tags || []).map(String);
  return articles
    .filter(function (x) { return x.id !== a.id; })
    .map(function (x) {
      let score = 0;
      if (a.series_id && x.series_id === a.series_id) score += 5;
      (x.tags || []).forEach(function (t) { if (myTags.indexOf(String(t)) >= 0) score += 2; });
      return { x: x, score: score };
    })
    .filter(function (o) { return o.score > 0; })
    .sort(function (p, q) {
      if (q.score !== p.score) return q.score - p.score;
      return new Date(q.x.created_at) - new Date(p.x.created_at);
    })
    .slice(0, limit || 3)
    .map(function (o) { return o.x; });
}

function pageShell(opts) {
  const canonical = opts.canonical;
  const ogImage = opts.image && /^https?:/i.test(opts.image) ? opts.image : '';
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': opts.ldType || 'Article',
    headline: opts.title,
    description: opts.description,
    datePublished: opts.published || '',
    dateModified: opts.modified || opts.published || '',
    keywords: (opts.keywords || []).join(','),
    author: { '@type': 'Organization', name: SITE },
    publisher: { '@type': 'Organization', name: SITE },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical }
  }).replace(/</g, '\\u003c');

  return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(opts.title) + '</title>\n' +
    '<meta name="description" content="' + esc(opts.description) + '">\n' +
    (opts.keywords && opts.keywords.length ? '<meta name="keywords" content="' + esc(opts.keywords.join(',')) + '">\n' : '') +
    '<link rel="canonical" href="' + esc(canonical) + '">\n' +
    '<link rel="alternate" type="application/rss+xml" title="' + esc(SITE) + '" href="' + esc(BASE + '/feed.xml') + '">\n' +
    '<meta property="og:type" content="' + (opts.ldType === 'WebPage' ? 'website' : 'article') + '">\n' +
    '<meta property="og:title" content="' + esc(opts.title) + '">\n' +
    '<meta property="og:description" content="' + esc(opts.description) + '">\n' +
    '<meta property="og:url" content="' + esc(canonical) + '">\n' +
    '<meta property="og:site_name" content="' + esc(SITE) + '">\n' +
    (ogImage ? '<meta property="og:image" content="' + esc(ogImage) + '">\n' : '') +
    '<meta name="twitter:card" content="' + (ogImage ? 'summary_large_image' : 'summary') + '">\n' +
    '<meta name="twitter:title" content="' + esc(opts.title) + '">\n' +
    '<meta name="twitter:description" content="' + esc(opts.description) + '">\n' +
    '<link rel="stylesheet" href="' + opts.cssPath + '">\n' +
    /* 高亮样式同样本地自托管，快照页不依赖境外 CDN */
    '<link rel="stylesheet" href="' + (opts.hljsPath || (opts.cssPath || '').replace('css/style.css', 'vendor/hljs-github.min.css')) + '">\n' +
    '<script type="application/ld+json">' + ld + '</script>\n' +
    '<style>\n' +
    'body{padding:0 0 40px}.snap-top{max-width:820px;margin:0 auto;padding:26px 22px 0}' +
    '.snap-tip{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;' +
    'border:1px solid var(--line-strong);border-radius:8px;padding:10px 14px;margin-bottom:26px;font-size:13.5px;color:var(--ink-soft)}' +
    '.snap-wrap{max-width:820px;margin:0 auto;padding:0 22px}' +
    '.snap-title{font-family:var(--font-display);font-size:27px;line-height:1.4;margin-bottom:12px}' +
    '.snap-meta{color:var(--ink-faint);font-size:13.5px;margin-bottom:24px;display:flex;gap:14px;flex-wrap:wrap}' +
    '.snap-cover{max-width:100%;border-radius:10px;margin-bottom:20px}' +
    '.snap-foot{margin-top:36px;border-top:1px solid var(--line);padding-top:18px;font-size:13.5px;color:var(--ink-faint)}' +
    '.snap-list{margin-top:8px}' +
    '.snap-list li{padding:5px 0;border-bottom:1px dashed var(--line)}' +
    '@media (max-width:640px){.snap-title{font-size:22px}}' +
    '</style>\n' +
    '</head>\n<body>\n' +
    '<div class="snap-top"><div class="snap-tip">' +
    '<span>这是便于搜索引擎收录的静态版，完整站点支持主题切换与更多互动。</span>' +
    '<a class="btn btn-sm" href="' + esc(opts.spa) + '">进入完整站点</a>' +
    '</div></div>\n' +
    '<div class="snap-wrap" data-url="' + esc(canonical) + '">' + opts.body + '</div>\n' +
    '<div class="snap-top"><div class="snap-foot">' +
    '<a href="' + BASE + '/">' + esc(SITE) + '</a> · ' + esc(SLOGAN) +
    ' · <a href="' + BASE + '/archive/">全部文章</a>' +
    '</div></div>\n' +
    '</body>\n</html>\n';
}

function articlePage(a) {
  const rel = related(a, 3);
  /* 全站上下篇：articles 已按发布时间降序（新→旧），索引前为更晚、后为更早 */
  const idx = articles.findIndex(function (x) { return x.id === a.id; });
  const newer = idx > 0 ? articles[idx - 1] : null;   // 更晚发布 = 下一篇
  const older = (idx >= 0 && idx < articles.length - 1) ? articles[idx + 1] : null; // 更早发布 = 上一篇
  const navHtml = (older || newer)
    ? '<div class="card" style="margin-top:26px;padding:16px 20px"><div class="post-nav-links">' +
      (older
        ? '<a class="post-nav-item" href="' + urlOf(older) + '"><span class="pn-label">上一篇</span>' + esc(older.title) + '</a>'
        : '<span class="post-nav-item disabled"><span class="pn-label">上一篇</span>已是最早一篇</span>') +
      (newer
        ? '<a class="post-nav-item next" href="' + urlOf(newer) + '"><span class="pn-label">下一篇</span>' + esc(newer.title) + '</a>'
        : '<span class="post-nav-item disabled next"><span class="pn-label">下一篇</span>已是最新一篇</span>') +
      '</div></div>'
    : '';
  const cover = a.cover && a.cover.length < 300000
    ? '<img class="snap-cover" src="' + a.cover + '" alt="' + esc(a.title) + '">'
    : '';
  const tags = (a.tags || []).map(function (t) {
    return '<a class="tag-chip" href="' + BASE + '/#/tag/' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
  }).join(' ');
  const relHtml = rel.length
    ? '<div class="card" style="margin-top:32px;padding:18px 20px"><h3 class="box-title" style="margin-top:0">接着炼 · 相关丹方</h3><ul class="snap-list">' +
      rel.map(function (r) {
        return '<li><a href="' + urlOf(r) + '">' + esc(r.title) + '</a></li>';
      }).join('') + '</ul></div>'
    : '';

  const body =
    (cover || '') +
    '<h1 class="snap-title">' + esc(a.title) + '</h1>' +
    '<div class="snap-meta"><span>' + fmtDate(a.created_at) + '</span>' +
    '<span>约 ' + readingMinutes(a.content) + ' 分钟</span>' +
    (tags ? '<span class="detail-tags">' + tags + '</span>' : '') +
    '</div>' +
    '<div class="article-body">' + renderMarkdown(a.content) + '</div>' +
    navHtml +
    relHtml +
    '<p style="margin-top:28px"><a class="btn" href="' + spaOf(a) + '">在完整站点中阅读本文</a></p>';

  return pageShell({
    title: a.title + ' · ' + SITE,
    description: (a.summary || a.title || '').slice(0, 160),
    keywords: a.tags || [],
    canonical: urlOf(a),
    spa: spaOf(a),
    image: a.cover,
    cssPath: '../../assets/css/style.css',
    hljsPath: '../../assets/vendor/hljs-github.min.css',
    published: a.created_at,
    modified: a.updated_at || a.created_at,
    body: body
  });
}

function archivePage() {
  const items = articles.map(function (a) {
    return '<li><a href="' + urlOf(a) + '">' + esc(a.title) + '</a>' +
      '<span style="color:var(--ink-faint);font-size:13px"> · ' + fmtDate(a.created_at) + '</span></li>';
  }).join('');
  const body =
    '<h1 class="snap-title">全部丹方 · 共 ' + articles.length + ' 篇</h1>' +
    '<div class="snap-meta">按发布时间排列，点标题进入静态阅读页</div>' +
    '<div class="card" style="padding:18px 22px"><ul class="snap-list">' + items + '</ul></div>' +
    '<p style="margin-top:26px"><a class="btn" href="' + BASE + '/">回到丹房首页</a></p>';

  return pageShell({
    title: '全部文章 · ' + SITE,
    description: SITE + '全部文章归档：' + articles.slice(0, 6).map(function (a) { return a.title; }).join('、'),
    keywords: ['AI', '大模型', '炼丹', '文章归档'],
    canonical: BASE + '/archive/',
    spa: BASE + '/',
    ldType: 'WebPage',
    cssPath: '../assets/css/style.css',
    hljsPath: '../assets/vendor/hljs-github.min.css',
    body: body
  });
}

/* ---------- feed.xml（RSS 2.0 订阅源） ---------- */

/* RFC-822 日期：RSS 的 pubDate 只认这个格式，toUTCString 出来的就是 */
function rfc822(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toUTCString();
}

function feedXml() {
  const items = articles.map(function (a) {
    const link = urlOf(a);
    return '  <item>\n' +
      '    <title>' + esc(a.title || '') + '</title>\n' +
      '    <link>' + esc(link) + '</link>\n' +
      '    <guid isPermaLink="true">' + esc(link) + '</guid>\n' +
      '    <pubDate>' + rfc822(a.created_at) + '</pubDate>\n' +
      '    <description>' + esc(a.summary || a.title || '') + '</description>\n' +
      '  </item>';
  }).join('\n');

  /* articles 已按发布时间降序，直接按数组顺序输出即可 */
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '<channel>\n' +
    '  <title>' + esc(SITE) + '</title>\n' +
    '  <link>' + esc(BASE + '/') + '</link>\n' +
    '  <description>' + esc(SLOGAN) + '</description>\n' +
    '  <language>zh-CN</language>\n' +
    '  <atom:link href="' + esc(BASE + '/feed.xml') + '" rel="self" type="application/rss+xml"/>\n' +
    '  <lastBuildDate>' + rfc822(articles.length ? articles[0].created_at : new Date().toISOString()) + '</lastBuildDate>\n' +
    items + '\n' +
    '</channel>\n</rss>\n';
}

/* ---------- llms.txt / llms-full.txt（给 AI 读的站点说明书） ---------- */

function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function llmsTxt() {
  const intro = [
    'AI 炼丹房是一个面向初学者的 AI / 大模型教学博客。全套文章按难度分成五层学习主线，',
    '从「大模型其实在猜下一个字」这类原理直觉讲起，一路讲到模型选型、微调、推理优化和真实踩坑记录。',
    '每篇文章都先给生活化比喻再给可动手的例子，不堆术语。'
  ].join('');

  const items = articles.map(function (a) {
    return '- [' + oneLine(a.title) + '](' + urlOf(a) + '): ' + oneLine(a.summary || '').slice(0, 120);
  }).join('\n');

  return '# ' + SITE + '\n\n' +
    '> ' + SLOGAN + ' —— 一个用炼丹比喻讲大模型的中文博客：数据是药材，算力是炉火，调参是火候。\n\n' +
    intro + '\n\n' +
    '文章按「先原理、后用法、再训练、最后部署」的顺序编排，建议从《学习路线图》那篇开始读。\n\n' +
    '## 全部文章（共 ' + articles.length + ' 篇，按推荐阅读顺序）\n\n' +
    items + '\n\n' +
    '## 其他入口\n\n' +
    '- [全部文章归档](' + BASE + '/archive/): 按发布时间排列的完整列表\n' +
    '- [站点首页](' + BASE + '/): 完整站点（含主题切换、搜索、评论）\n' +
    '- [llms-full.txt](' + BASE + '/llms-full.txt): 全部文章正文的完整 Markdown，适合整份喂给 AI\n' +
    '- [RSS 订阅](' + BASE + '/feed.xml): 新文章订阅源，可用阅读器直接订阅\n';
}

function llmsFullTxt() {
  const blocks = articles.map(function (a) {
    return '## ' + oneLine(a.title) + '\n\n' +
      '- 链接: ' + urlOf(a) + '\n' +
      '- 发布: ' + fmtDate(a.created_at) + '\n' +
      (a.tags && a.tags.length ? '- 标签: ' + a.tags.join('、') + '\n' : '') +
      (a.summary ? '- 摘要: ' + oneLine(a.summary) + '\n' : '') +
      '\n' + String(a.content || '').trim() + '\n';
  }).join('\n\n---\n\n');

  return '# ' + SITE + ' · 全文\n\n' +
    '> ' + SLOGAN + '\n\n' +
    '本文件包含站内全部 ' + articles.length + ' 篇文章的完整正文（Markdown 原文），供 AI 检索与分析使用。\n' +
    '结构索引见 llms.txt，网页版见 ' + BASE + '/ 。\n\n---\n\n' + blocks;
}

/* ---------- 写文件（含变更比对与清理下线文章） ---------- */

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

/* 逐个生成，只统计真正发生变化的文件 */
const changes = { added: [], updated: [], same: [] };
let bytes = 0;
articles.forEach(function (a) {
  const file = path.join(siteDir, 'a', String(a.id), 'index.html');
  const html = articlePage(a);
  let old = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch (e) { /* 新文件 */ }
  if (old === null) changes.added.push(a.id);
  else if (md5(old) === md5(html)) changes.same.push(a.id);
  else changes.updated.push(a.id);
  write(file, html);
  bytes += Buffer.byteLength(html);
});

/* 已下线 / 已删除的文章：快照目录要跟着清掉，否则爬虫还能抓到旧页 */
const liveIds = {};
articles.forEach(function (a) { liveIds[String(a.id)] = true; });
const aRoot = path.join(siteDir, 'a');
const removed = [];
if (fs.existsSync(aRoot)) {
  fs.readdirSync(aRoot).forEach(function (name) {
    if (!/^\d+$/.test(name) || liveIds[name]) return;
    fs.rmSync(path.join(aRoot, name), { recursive: true, force: true });
    removed.push(Number(name));
  });
}

const archiveFile = path.join(siteDir, 'archive', 'index.html');
const archiveHtml = archivePage();
write(archiveFile, archiveHtml);

const urls = [{ loc: BASE + '/', lastmod: isoDate(articles[0].created_at), priority: '1.0' },
  { loc: BASE + '/archive/', lastmod: isoDate(articles[0].created_at), priority: '0.7' }].concat(
  articles.map(function (a) {
    return {
      loc: urlOf(a),
      lastmod: isoDate(a.updated_at || a.created_at),
      priority: a.id === 4 ? '0.9' : '0.8'
    };
  })
);

const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(function (u) {
    return '  <url>\n    <loc>' + u.loc + '</loc>\n    <lastmod>' + u.lastmod + '</lastmod>\n' +
      '    <changefreq>weekly</changefreq>\n    <priority>' + u.priority + '</priority>\n  </url>';
  }).join('\n') +
  '\n</urlset>\n';
write(path.join(siteDir, 'sitemap.xml'), sitemap);

const robots = 'User-agent: *\nAllow: /\n\n' +
  '# 面向 AI 的站点说明（llmstxt.org 约定）\n' +
  '# llms.txt: ' + BASE + '/llms.txt\n' +
  '# llms-full.txt: ' + BASE + '/llms-full.txt\n' +
  '# RSS 订阅: ' + BASE + '/feed.xml\n\n' +
  'Sitemap: ' + BASE + '/sitemap.xml\n';
write(path.join(siteDir, 'robots.txt'), robots);

/* RSS 订阅源：按发布时间倒序，链接指向静态页，便于阅读器抓正文 */
const feed = feedXml();
write(path.join(siteDir, 'feed.xml'), feed);

/* 给 AI 读的两个文件：llms.txt 是索引，llms-full.txt 是全文 */
const llms = llmsTxt();
const llmsFull = llmsFullTxt();
write(path.join(siteDir, 'llms.txt'), llms);
write(path.join(siteDir, 'llms-full.txt'), llmsFull);

/* 首页注入静态导航：不执行 JS 的爬虫也能从这里发现全部文章 */
function updateIndexNav() {
  const indexPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexPath)) return false;
  const html = fs.readFileSync(indexPath, 'utf8');
  const start = html.indexOf('<!-- SNAP:NAV:START -->');
  const end = html.indexOf('<!-- SNAP:NAV:END -->');
  if (start < 0 || end < 0) return false;
  const list = articles.map(function (a) {
    return '<li><a href="' + urlOf(a) + '">' + esc(a.title) + '</a> — ' + esc((a.summary || '').slice(0, 60)) + '</li>';
  }).join('\n');
  const block = '<!-- SNAP:NAV:START -->\n<noscript>\n' +
    '<div class="snap-index-nav">\n' +
    '<h2>' + esc(SITE) + ' · 全部文章</h2>\n' +
    '<p>' + esc(SLOGAN) + '</p>\n' +
    '<ul>\n' + list + '\n</ul>\n' +
    '<p><a href="' + BASE + '/archive/">查看完整归档</a></p>\n' +
    '</div>\n</noscript>\n<!-- SNAP:NAV:END -->';
  fs.writeFileSync(indexPath, html.slice(0, start) + block + html.slice(end + '<!-- SNAP:NAV:END -->'.length), 'utf8');
  return true;
}

console.log('文章快照:', articles.length, '篇');
console.log('  新增:', changes.added.length ? changes.added.join(',') : '无');
console.log('  更新:', changes.updated.length ? changes.updated.join(',') : '无');
console.log('  未变:', changes.same.length + ' 篇');
console.log('  清理下线:', removed.length ? removed.join(',') : '无');
console.log('归档页: archive/index.html');
console.log('sitemap 条目:', urls.length);
console.log('feed.xml:', articles.length + ' 条 · ' + (Buffer.byteLength(feed) / 1024).toFixed(1) + ' KB');
console.log('llms.txt:', (Buffer.byteLength(llms) / 1024).toFixed(1) + ' KB');
console.log('llms-full.txt:', (Buffer.byteLength(llmsFull) / 1024).toFixed(1) + ' KB');
console.log('首页静态导航:', updateIndexNav() ? '已更新' : '未找到标记，跳过');
console.log('快照总体积: ' + (bytes / 1024).toFixed(1) + ' KB');
console.log('输出目录:', siteDir);
console.log('同步时间戳（请写入 site_settings.seo_synced_at）:', new Date().toISOString());
