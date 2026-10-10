/* 数据访问层（静态托管版）
 * 站点已迁移到 Cloudflare 静态托管，不再依赖 WorkBuddy 云服务：
 *   data/articles.json —— 全部已发布文章（含正文）
 *   data/series.json   —— 系列（名称 / 图标 / 简介 / 排序）
 *   data/site.json     —— 站点设置（标题 / 口号 / 页脚 / 关于页正文）
 * 需要登录、后台、上传、站内评论等能力的功能在静态站点上不可用，
 * 对应接口统一抛「静态站点不支持」，调用方做降级展示。 */
(function () {
  'use strict';

  const SOURCES = {
    articles: 'data/articles.json',
    series: 'data/series.json',
    site: 'data/site.json',
  };

  /* 用 document.baseURI 解析路径：即便页面 URL 在子目录下也能取到根目录的 data/ */
  function urlOf(rel) {
    try { return new URL(rel, document.baseURI).href; } catch (e) { return rel; }
  }

  const cache = {};

  async function loadJson(key) {
    if (cache[key]) return cache[key];
    const res = await fetch(urlOf(SOURCES[key]), { cache: 'no-cache' });
    if (!res.ok) throw new Error('加载 ' + SOURCES[key] + ' 失败（HTTP ' + res.status + '）');
    cache[key] = await res.json();
    return cache[key];
  }

  /* 全部文章（已按 created_at 倒序存放，这里再排一次保险） */
  async function allArticles() {
    const list = await loadJson('articles');
    return list.filter(function (a) { return a.status === 'published'; });
  }

  function byNewest(a, b) { return new Date(b.created_at) - new Date(a.created_at); }

  /* 静态站点没有后端，写操作一律拒绝；消息统一，方便 UI 提示 */
  function unsupported(what) {
    return new Error((what || '这个操作') + '需要服务端支持，当前是静态托管站点，暂不可用');
  }

  const Api = {};

  /* ---------------- 文章（公开读） ---------------- */

  Api.listArticles = async function (opts) {
    const page = (opts && opts.page) || 1;
    const pageSize = (opts && opts.pageSize) || 9;
    const tag = opts && opts.tag;
    const search = opts && opts.search;

    let rows = await allArticles();

    if (tag) {
      rows = rows.filter(function (a) {
        return (a.tags || []).map(String).indexOf(String(tag)) >= 0;
      });
    }
    if (search) {
      const s = String(search).trim().toLowerCase();
      if (s) {
        rows = rows.filter(function (a) {
          return (
            String(a.title || '').toLowerCase().indexOf(s) >= 0 ||
            String(a.summary || '').toLowerCase().indexOf(s) >= 0 ||
            String(a.content || '').toLowerCase().indexOf(s) >= 0
          );
        });
      }
    }

    rows = rows.slice().sort(byNewest);
    const from = (page - 1) * pageSize;
    return { list: rows.slice(from, from + pageSize), total: rows.length };
  };

  Api.getArticle = async function (id) {
    const rows = await allArticles();
    const target = rows.find(function (a) { return Number(a.id) === Number(id); });
    return target || null;
  };

  Api.listTags = async function () {
    const rows = await allArticles();
    const counter = {};
    rows.forEach(function (row) {
      (row.tags || []).forEach(function (t) {
        counter[t] = (counter[t] || 0) + 1;
      });
    });
    return Object.keys(counter)
      .map(function (name) { return { name: name, count: counter[name] }; })
      .sort(function (a, b) { return b.count - a.count; });
  };

  Api.siteStats = async function () {
    const rows = await allArticles();
    const tagSet = {};
    let views = 0;
    rows.forEach(function (row) {
      views += Number(row.views) || 0;
      (row.tags || []).forEach(function (t) { tagSet[t] = true; });
    });
    return { articles: rows.length, views: views, tags: Object.keys(tagSet).length };
  };

  /* 热门文章：按阅读量排序，可排除当前文章 */
  Api.hotArticles = async function (limit, excludeId) {
    const size = limit || 5;
    const rows = await allArticles();
    return rows
      .filter(function (a) { return a.id !== excludeId; })
      .sort(function (a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); })
      .slice(0, size);
  };

  /* 相关文章：同系列 +5 分、每个共有标签 +2 分，取分数最高的若干篇 */
  Api.relatedArticles = async function (article, limit) {
    const rows = await allArticles();
    const myTags = (article && article.tags || []).map(String);
    return rows
      .filter(function (a) { return a.id !== article.id; })
      .map(function (a) {
        let score = 0;
        if (article.series_id && a.series_id === article.series_id) score += 5;
        (a.tags || []).forEach(function (t) {
          if (myTags.indexOf(String(t)) >= 0) score += 2;
        });
        return { a: a, score: score };
      })
      .filter(function (x) { return x.score > 0; })
      .sort(function (x, y) {
        if (y.score !== x.score) return y.score - x.score;
        return byNewest(x.a, y.a);
      })
      .slice(0, limit || 3)
      .map(function (x) { return x.a; });
  };

  /* 全站相邻文章：prev = 更早发布的紧邻一篇；next = 更晚发布的紧邻一篇 */
  Api.adjacentArticles = async function (article) {
    const rows = (await allArticles()).slice().sort(byNewest);
    const idx = rows.findIndex(function (a) { return Number(a.id) === Number(article.id); });
    if (idx < 0) return { prev: null, next: null };
    /* rows 是倒序：后面的是更早发布的（prev），前面的是更晚发布的（next） */
    return {
      prev: rows[idx + 1] || null,
      next: rows[idx - 1] || null,
    };
  };

  /* 浏览量：静态站点没有写库通道，这里什么都不做，数字取 data/articles.json 里的快照值 */
  Api.incrementViews = function () { /* 静态站点不支持计数 */ };

  /* ---------------- 附件 / 存储 ---------------- */

  /* 静态站点没有附件库，返回空列表，文章页的附件区就不会渲染 */
  Api.listAttachments = async function () { return []; };

  Api.addAttachment = async function () { throw unsupported('上传附件'); };
  Api.deleteAttachment = async function () { throw unsupported('删除附件'); };
  Api.downloadAttachment = async function () { throw unsupported('下载附件'); };
  Api.uploadImage = async function () { throw unsupported('上传图片'); };
  Api.uploadFile = async function () { throw unsupported('上传文件'); };

  /* ---------------- 登录 / 站长权限 ---------------- */

  Api.isAdmin = async function () { return false; };
  Api.isOwner = async function () { return false; };
  Api.claimAdmin = async function () { throw unsupported('认领站长'); };

  /* ---------------- 文章（站长写） ---------------- */

  Api.adminListArticles = async function () { throw unsupported('后台文章管理'); };
  Api.createArticle = async function () { throw unsupported('新建文章'); };
  Api.updateArticle = async function () { throw unsupported('编辑文章'); };
  Api.deleteArticle = async function () { throw unsupported('删除文章'); };

  /* ---------------- 站点设置（公开读） ---------------- */

  Api.getSiteSettings = async function () {
    return loadJson('site');
  };

  Api.updateSiteSetting = async function () { throw unsupported('保存站点设置'); };

  /* ---------------- 管理员 ---------------- */

  Api.adminsCount = async function () { return 0; };
  Api.listAdmins = async function () { throw unsupported('管理员管理'); };
  Api.addAdmin = async function () { throw unsupported('添加管理员'); };
  Api.removeAdmin = async function () { throw unsupported('移除管理员'); };

  /* ---------------- 标签（站长写） ---------------- */

  Api.renameTag = async function () { throw unsupported('重命名标签'); };
  Api.deleteTag = async function () { throw unsupported('删除标签'); };
  Api.updateArticleStatus = async function () { throw unsupported('上下线文章'); };

  /* ---------------- 存储文件（站长写） ---------------- */

  Api.adminListAttachments = async function () { throw unsupported('附件管理'); };
  Api.listStorageFiles = async function () { throw unsupported('素材库'); };
  Api.deleteStorageFiles = async function () { throw unsupported('删除素材'); };

  /* ---------------- 系列（公开读） ---------------- */

  /* 系列列表带每系列的已发布文章数（原来由云端 series_with_counts 提供） */
  Api.listSeries = async function () {
    const [series, rows] = await Promise.all([loadJson('series'), allArticles()]);
    const counter = {};
    rows.forEach(function (a) {
      if (a.series_id) counter[a.series_id] = (counter[a.series_id] || 0) + 1;
    });
    return series
      .map(function (s) {
        return Object.assign({}, s, { article_count: counter[s.id] || 0 });
      })
      .sort(function (a, b) {
        return (a.sort_order || 99) - (b.sort_order || 99) || a.id - b.id;
      });
  };

  Api.getSeries = async function (id) {
    const series = await loadJson('series');
    return series.find(function (s) { return Number(s.id) === Number(id); }) || null;
  };

  Api.listSeriesArticles = async function (seriesId) {
    const rows = await allArticles();
    return rows
      .filter(function (a) { return Number(a.series_id) === Number(seriesId); })
      .sort(function (a, b) {
        const so = (a.series_order || 99) - (b.series_order || 99);
        if (so) return so;
        return new Date(a.created_at) - new Date(b.created_at);
      });
  };

  /* ---------------- 系列（站长写） ---------------- */

  Api.adminListSeries = async function () { throw unsupported('系列管理'); };
  Api.createSeries = async function () { throw unsupported('新建系列'); };
  Api.updateSeries = async function () { throw unsupported('编辑系列'); };
  Api.deleteSeries = async function () { throw unsupported('删除系列'); };

  /* ---------------- 用户偏好（主题） ---------------- */
  /* 静态站点无处同步：主题只存本机 localStorage，theme.js 已按这个逻辑走 */

  Api.getMyTheme = async function () { return null; };
  Api.saveMyTheme = async function () { /* 静态站点不做云端同步 */ };

  /* ---------------- 评论 ---------------- */
  /* 评论交给 Waline（Vercel），站内自建评论需要数据库，静态站点上不可用 */

  Api.listComments = async function () { return []; };
  Api.countComments = async function () { return {}; };
  Api.addComment = async function () { throw unsupported('发表站内评论'); };
  Api.deleteComment = async function () { throw unsupported('删除评论'); };
  Api.adminListComments = async function () { throw unsupported('评论管理'); };

  window.Api = Api;
})();
