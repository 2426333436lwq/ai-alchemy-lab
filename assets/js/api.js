/* 数据访问层（Cloudflare Workers + D1 版）
 *
 * 主通道：同域自建接口（_worker.js）
 *   GET  /api/articles?...   列表（分页 / 标签 / 搜索）
 *   GET  /api/articles/:id   详情（含正文）
 *   GET  /api/comments?article_id=X
 *   POST /api/comments
 * 兜底：接口不可用（如 D1 还没 seed、部署未生效）时回落静态 data/articles.json，
 *       保证站点永远不白屏。series / site 设置继续读静态 JSON。
 * 登录、后台、上传这类需要账号体系的功能仍然不可用，对应接口统一抛「不支持」。 */
(function () {
  'use strict';

  const API_BASE = '/api';

  const SOURCES = {
    articles: 'data/articles.json',
    series: 'data/series.json',
    site: 'data/site.json',
  };

  /* 用 document.baseURI 解析静态路径：即便页面 URL 在子目录下也能取到根目录的 data/ */
  function urlOf(rel) {
    try { return new URL(rel, document.baseURI).href; } catch (e) { return rel; }
  }

  const jsonCache = {};

  async function loadJson(key) {
    if (jsonCache[key]) return jsonCache[key];
    const res = await fetch(urlOf(SOURCES[key]), { cache: 'no-cache' });
    if (!res.ok) throw new Error('加载 ' + SOURCES[key] + ' 失败（HTTP ' + res.status + '）');
    jsonCache[key] = await res.json();
    return jsonCache[key];
  }

  /* tags 在 D1 里是逗号串、在静态 JSON 里是数组，这里统一成数组，供 Util.tagChips 使用 */
  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map(String).map(function (t) { return t.trim(); }).filter(Boolean);
    if (typeof tags === 'string') return tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    return [];
  }

  function norm(row) {
    if (!row) return row;
    const a = Object.assign({}, row);
    a.id = Number(a.id);
    a.tags = normalizeTags(a.tags);
    a.views = Number(a.views) || 0;
    if (a.series_id !== null && a.series_id !== undefined) a.series_id = Number(a.series_id);
    if (a.series_order !== null && a.series_order !== undefined) a.series_order = Number(a.series_order);
    return a;
  }

  function byNewest(a, b) { return new Date(b.created_at) - new Date(a.created_at); }

  /* 静态站点没有账号体系，写操作一律拒绝；消息统一，方便 UI 提示 */
  function unsupported(what) {
    return new Error((what || '这个操作') + '需要账号体系，当前站点未开放，暂不可用');
  }

  /* ---------- 取数：接口优先，静态兜底 ---------- */

  async function apiList(query) {
    const res = await fetch(API_BASE + '/articles' + (query ? '?' + query : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return { rows: (json.data || []).map(norm), total: Number(json.total) || 0 };
  }

  /* 全量已发布文章（列表字段，含 content 与否取决于来源） */
  let allCache = null;
  async function allArticles() {
    if (allCache) return allCache;
    try {
      const r = await apiList('page=1&pageSize=100');
      if (r.rows.length) { allCache = r.rows; return allCache; }
      throw new Error('empty');
    } catch (e) {
      const list = await loadJson('articles');
      allCache = list.filter(function (a) { return a.status === 'published'; }).map(norm);
      return allCache;
    }
  }

  /* 本地分页 + 过滤：与 _worker.js 的语义保持一致（搜索命中标题 / 摘要） */
  function localList(rows, opts) {
    const page = opts.page;
    const pageSize = opts.pageSize;
    let list = rows.slice();
    if (opts.tag) {
      list = list.filter(function (a) { return (a.tags || []).indexOf(String(opts.tag)) >= 0; });
    }
    if (opts.search) {
      const s = String(opts.search).trim().toLowerCase();
      if (s) {
        list = list.filter(function (a) {
          return String(a.title || '').toLowerCase().indexOf(s) >= 0 ||
            String(a.summary || '').toLowerCase().indexOf(s) >= 0;
        });
      }
    }
    list.sort(byNewest);
    const from = (page - 1) * pageSize;
    return { list: list.slice(from, from + pageSize), total: list.length };
  }

  const Api = {};

  /* ---------------- 文章（公开读） ---------------- */

  Api.listArticles = async function (opts) {
    const page = (opts && opts.page) || 1;
    const pageSize = (opts && opts.pageSize) || 9;
    const tag = opts && opts.tag;
    const search = opts && opts.search;

    try {
      const q = new URLSearchParams();
      q.set('page', String(page));
      q.set('pageSize', String(pageSize));
      if (tag) q.set('tag', tag);
      if (search) q.set('search', search);
      const r = await apiList(q.toString());
      if (r.total > 0 || r.rows.length > 0) return { list: r.rows, total: r.total };
    } catch (e) { /* 落本地兜底 */ }

    return localList(await allArticles(), { page: page, pageSize: pageSize, tag: tag, search: search });
  };

  Api.getArticle = async function (id) {
    try {
      const res = await fetch(API_BASE + '/articles/' + encodeURIComponent(id), { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json && json.data) return norm(json.data);
        return null;
      }
    } catch (e) { /* 落静态兜底 */ }

    const list = await loadJson('articles');
    const t = list.find(function (a) { return Number(a.id) === Number(id) && a.status === 'published'; });
    return t ? norm(t) : null;
  };

  Api.listTags = async function () {
    const rows = await allArticles();
    const counter = {};
    rows.forEach(function (row) {
      (row.tags || []).forEach(function (t) { counter[t] = (counter[t] || 0) + 1; });
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

  Api.hotArticles = async function (limit, excludeId) {
    const size = limit || 5;
    const rows = await allArticles();
    return rows
      .filter(function (a) { return a.id !== excludeId; })
      .sort(function (a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); })
      .slice(0, size);
  };

  Api.relatedArticles = async function (article, limit) {
    const rows = await allArticles();
    const myTags = ((article && article.tags) || []).map(String);
    return rows
      .filter(function (a) { return a.id !== article.id; })
      .map(function (a) {
        let score = 0;
        if (article.series_id && a.series_id === article.series_id) score += 5;
        (a.tags || []).forEach(function (t) { if (myTags.indexOf(String(t)) >= 0) score += 2; });
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

  Api.adjacentArticles = async function (article) {
    const rows = (await allArticles()).slice().sort(byNewest);
    const idx = rows.findIndex(function (a) { return Number(a.id) === Number(article.id); });
    if (idx < 0) return { prev: null, next: null };
    return { prev: rows[idx + 1] || null, next: rows[idx - 1] || null };
  };

  /* 浏览量：详情接口在服务端自增（/api/articles/:id），前端不再单独上报 */
  Api.incrementViews = function () { /* 服务端已计数 */ };

  /* ---------------- 评论（同域 D1） ---------------- */

  Api.listComments = async function (articleId) {
    try {
      const res = await fetch(API_BASE + '/comments?article_id=' + encodeURIComponent(articleId), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return (json.data || []).map(function (c) {
        return { id: Number(c.id), nick: c.nick, content: c.content, created_at: c.created_at };
      });
    } catch (e) {
      return [];
    }
  };

  /* payload: { article_id, nick, email, content } */
  Api.addComment = async function (payload) {
    const res = await fetch(API_BASE + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.error || '发表失败');
    return json.data || null;
  };

  Api.countComments = async function () { return {}; };
  Api.deleteComment = async function () { throw unsupported('删除评论'); };
  Api.adminListComments = async function () { throw unsupported('评论管理'); };

  /* ---------------- 附件 / 存储（未开放） ---------------- */

  Api.listAttachments = async function () { return []; };
  Api.addAttachment = async function () { throw unsupported('上传附件'); };
  Api.deleteAttachment = async function () { throw unsupported('删除附件'); };
  Api.downloadAttachment = async function () { throw unsupported('下载附件'); };
  Api.uploadImage = async function () { throw unsupported('上传图片'); };
  Api.uploadFile = async function () { throw unsupported('上传文件'); };

  /* ---------------- 登录 / 站长权限（未开放） ---------------- */

  Api.isAdmin = async function () { return false; };
  Api.isOwner = async function () { return false; };
  Api.claimAdmin = async function () { throw unsupported('认领站长'); };

  /* ---------------- 文章（站长写，未开放） ---------------- */

  Api.adminListArticles = async function () { throw unsupported('后台文章管理'); };
  Api.createArticle = async function () { throw unsupported('新建文章'); };
  Api.updateArticle = async function () { throw unsupported('编辑文章'); };
  Api.deleteArticle = async function () { throw unsupported('删除文章'); };

  /* ---------------- 站点设置（公开读静态 JSON） ---------------- */

  Api.getSiteSettings = async function () { return loadJson('site'); };
  Api.updateSiteSetting = async function () { throw unsupported('保存站点设置'); };

  /* ---------------- 管理员（未开放） ---------------- */

  Api.adminsCount = async function () { return 0; };
  Api.listAdmins = async function () { throw unsupported('管理员管理'); };
  Api.addAdmin = async function () { throw unsupported('添加管理员'); };
  Api.removeAdmin = async function () { throw unsupported('移除管理员'); };

  /* ---------------- 标签（站长写，未开放） ---------------- */

  Api.renameTag = async function () { throw unsupported('重命名标签'); };
  Api.deleteTag = async function () { throw unsupported('删除标签'); };
  Api.updateArticleStatus = async function () { throw unsupported('上下线文章'); };

  /* ---------------- 存储文件（未开放） ---------------- */

  Api.adminListAttachments = async function () { throw unsupported('附件管理'); };
  Api.listStorageFiles = async function () { throw unsupported('素材库'); };
  Api.deleteStorageFiles = async function () { throw unsupported('删除素材'); };

  /* ---------------- 系列（公开读静态 JSON） ---------------- */

  Api.listSeries = async function () {
    const series = await loadJson('series');
    const rows = await allArticles();
    const counter = {};
    rows.forEach(function (a) { if (a.series_id) counter[a.series_id] = (counter[a.series_id] || 0) + 1; });
    return series
      .map(function (s) { return Object.assign({}, s, { article_count: counter[s.id] || 0 }); })
      .sort(function (a, b) { return (a.sort_order || 99) - (b.sort_order || 99) || a.id - b.id; });
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

  /* ---------------- 系列（站长写，未开放） ---------------- */

  Api.adminListSeries = async function () { throw unsupported('系列管理'); };
  Api.createSeries = async function () { throw unsupported('新建系列'); };
  Api.updateSeries = async function () { throw unsupported('编辑系列'); };
  Api.deleteSeries = async function () { throw unsupported('删除系列'); };

  /* ---------------- 用户偏好（主题）：只存本机 ---------------- */

  Api.getMyTheme = async function () { return null; };
  Api.saveMyTheme = async function () { /* 无云端同步 */ };

  window.Api = Api;
})();
