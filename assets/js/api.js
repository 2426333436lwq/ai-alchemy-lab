/* 数据访问层（Cloudflare Workers + D1，含账号体系与后台）
 *
 * 公开读：同域 /api/*（文章/评论/系列/设置），失败时回落静态 data/*.json。
 * 需登录：/api/admin/*、/api/storage/*、/api/me/*，带 Authorization: Bearer（token 在 localStorage）。
 * 契约对齐旧云端版 api.js，所以 admin.js / views.js / theme.js 不需要改。 */
(function () {
  'use strict';

  const API_BASE = '/api';
  const TOKEN_KEY = 'alch.token';
  const SOURCES = { articles: 'data/articles.json', series: 'data/series.json', site: 'data/site.json' };

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function urlOf(rel) {
    try { return new URL(rel, document.baseURI).href; } catch (e) { return rel; }
  }

  /* 统一请求：成功返回 data 字段，失败抛错（带服务端消息，供 toast 展示） */
  async function req(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const tk = token();
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    const res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
    let payload = {};
    try { payload = await res.json(); } catch (e) { /* 忽略非 JSON */ }
    if (!res.ok) {
      const msg = (payload && payload.error && payload.error.message) || ('请求失败（HTTP ' + res.status + '）');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return payload.data;
  }

  const jsonCache = {};
  async function loadJson(key) {
    if (jsonCache[key]) return jsonCache[key];
    const res = await fetch(urlOf(SOURCES[key]), { cache: 'no-cache' });
    if (!res.ok) throw new Error('加载 ' + SOURCES[key] + ' 失败（HTTP ' + res.status + '）');
    jsonCache[key] = await res.json();
    return jsonCache[key];
  }

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

  function base64FromBlob(blob) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取文件失败')); };
      fr.onload = function () {
        const s = String(fr.result || '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------- 全量文章（接口优先，静态兜底） ---------- */

  async function apiList(query) {
    const res = await fetch(API_BASE + '/articles' + (query ? '?' + query : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return { rows: (json.data || []).map(norm), total: Number(json.total) || 0 };
  }

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

  function localList(rows, opts) {
    const page = opts.page, pageSize = opts.pageSize;
    let list = rows.slice();
    if (opts.tag) list = list.filter(function (a) { return (a.tags || []).indexOf(String(opts.tag)) >= 0; });
    if (opts.search) {
      const s = String(opts.search).trim().toLowerCase();
      if (s) list = list.filter(function (a) {
        return String(a.title || '').toLowerCase().indexOf(s) >= 0 || String(a.summary || '').toLowerCase().indexOf(s) >= 0;
      });
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
      q.set('page', String(page)); q.set('pageSize', String(pageSize));
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
        return json && json.data ? norm(json.data) : null;
      }
    } catch (e) { /* 落静态兜底 */ }
    const list = await loadJson('articles');
    const t = list.find(function (a) { return Number(a.id) === Number(id) && a.status === 'published'; });
    return t ? norm(t) : null;
  };

  Api.listTags = async function () {
    const rows = await allArticles();
    const counter = {};
    rows.forEach(function (row) { (row.tags || []).forEach(function (t) { counter[t] = (counter[t] || 0) + 1; }); });
    return Object.keys(counter).map(function (name) { return { name: name, count: counter[name] }; })
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
    const rows = await allArticles();
    return rows.filter(function (a) { return a.id !== excludeId; })
      .sort(function (a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); })
      .slice(0, limit || 5);
  };

  Api.relatedArticles = async function (article, limit) {
    const rows = await allArticles();
    const myTags = ((article && article.tags) || []).map(String);
    return rows.filter(function (a) { return a.id !== article.id; })
      .map(function (a) {
        let score = 0;
        if (article.series_id && a.series_id === article.series_id) score += 5;
        (a.tags || []).forEach(function (t) { if (myTags.indexOf(String(t)) >= 0) score += 2; });
        return { a: a, score: score };
      })
      .filter(function (x) { return x.score > 0; })
      .sort(function (x, y) { return y.score !== x.score ? y.score - x.score : byNewest(x.a, y.a); })
      .slice(0, limit || 3)
      .map(function (x) { return x.a; });
  };

  Api.adjacentArticles = async function (article) {
    const rows = (await allArticles()).slice().sort(byNewest);
    const idx = rows.findIndex(function (a) { return Number(a.id) === Number(article.id); });
    if (idx < 0) return { prev: null, next: null };
    return { prev: rows[idx + 1] || null, next: rows[idx - 1] || null };
  };

  Api.incrementViews = function () { /* 详情接口在服务端自增 */ };

  /* ---------------- 系列（公开读，REST + 静态兜底） ---------------- */

  Api.listSeries = async function () {
    try { return await req('/series'); } catch (e) { /* 兜底 */ }
    const series = await loadJson('series');
    const rows = await allArticles();
    const counter = {};
    rows.forEach(function (a) { if (a.series_id) counter[a.series_id] = (counter[a.series_id] || 0) + 1; });
    return series.map(function (s) { return Object.assign({}, s, { article_count: counter[s.id] || 0 }); })
      .sort(function (a, b) { return (a.sort_order || 99) - (b.sort_order || 99) || a.id - b.id; });
  };

  Api.getSeries = async function (id) {
    try { return await req('/series/' + encodeURIComponent(id)); } catch (e) { /* 兜底 */ }
    const series = await loadJson('series');
    return series.find(function (s) { return Number(s.id) === Number(id); }) || null;
  };

  Api.listSeriesArticles = async function (seriesId) {
    try { return (await req('/series/' + encodeURIComponent(seriesId) + '/articles')).map(norm); } catch (e) { /* 兜底 */ }
    const rows = await allArticles();
    return rows.filter(function (a) { return Number(a.series_id) === Number(seriesId); })
      .sort(function (a, b) {
        const so = (a.series_order || 99) - (b.series_order || 99);
        return so || (new Date(a.created_at) - new Date(b.created_at));
      });
  };

  /* ---------------- 站点设置（公开读，REST + 静态兜底） ---------------- */

  Api.getSiteSettings = async function () {
    try { return await req('/site-settings'); } catch (e) { /* 兜底 */ }
    return loadJson('site');
  };

  /* ---------------- 评论（匿名） ---------------- */

  Api.listComments = async function (articleId) {
    try {
      const res = await fetch(API_BASE + '/comments?article_id=' + encodeURIComponent(articleId), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      return (json.data || []).map(function (c) {
        return { id: Number(c.id), nick: c.nick, content: c.content, created_at: c.created_at };
      });
    } catch (e) { return []; }
  };

  Api.addComment = async function (payload) {
    const res = await fetch(API_BASE + '/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
    });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error((json.error && json.error.message) || (json.error) || '发表失败');
    return json.data || null;
  };

  Api.countComments = async function () { return {}; };

  /* ---------------- 站长 / 权限 ---------------- */

  Api.isAdmin = async function () { try { return !!(await req('/admin/is-admin')); } catch (e) { return false; } };
  Api.isOwner = async function () { try { return !!(await req('/admin/is-owner')); } catch (e) { return false; } };
  Api.claimAdmin = async function () { return !!(await req('/admin/claim', { method: 'POST' })); };
  Api.adminsCount = async function () { try { return Number(await req('/admin/admins/count')) || 0; } catch (e) { return 0; } };
  Api.listAdmins = async function () { return (await req('/admin/admins')) || []; };
  Api.addAdmin = async function (uid, note) { await req('/admin/admins', { method: 'POST', body: { uid: uid, note: note || '' } }); };
  Api.removeAdmin = async function (uid) { await req('/admin/admins/' + encodeURIComponent(uid), { method: 'DELETE' }); };

  /* ---------------- 文章（站长写） ---------------- */

  Api.adminListArticles = async function () { return ((await req('/admin/articles')) || []).map(norm); };
  Api.createArticle = async function (payload) { return await req('/admin/articles', { method: 'POST', body: payload }); };
  Api.updateArticle = async function (id, payload) { return await req('/admin/articles/' + encodeURIComponent(id), { method: 'PUT', body: payload }); };
  Api.deleteArticle = async function (id) { await req('/admin/articles/' + encodeURIComponent(id), { method: 'DELETE' }); };
  Api.updateArticleStatus = async function (id, status) {
    return await req('/admin/articles/' + encodeURIComponent(id) + '/status', { method: 'POST', body: { status: status } });
  };

  Api.renameTag = async function (oldName, newName) { return Number(await req('/admin/tags/rename', { method: 'POST', body: { old: oldName, new: newName } })) || 0; };
  Api.deleteTag = async function (name) { return Number(await req('/admin/tags/delete', { method: 'POST', body: { tag: name } })) || 0; };

  Api.updateSiteSetting = async function (key, value) { await req('/admin/settings', { method: 'PUT', body: { key: key, value: value } }); };

  /* ---------------- 系列（站长写） ---------------- */

  Api.adminListSeries = async function () { return (await req('/admin/series')) || []; };
  Api.createSeries = async function (payload) { return await req('/admin/series', { method: 'POST', body: payload }); };
  Api.updateSeries = async function (id, patch) { return await req('/admin/series/' + encodeURIComponent(id), { method: 'PUT', body: patch }); };
  Api.deleteSeries = async function (id) { await req('/admin/series/' + encodeURIComponent(id), { method: 'DELETE' }); };

  /* ---------------- 评论管理 ---------------- */

  Api.adminListComments = async function (limit) { return (await req('/admin/comments?limit=' + (limit || 200))) || []; };
  Api.deleteComment = async function (id) { await req('/admin/comments/' + encodeURIComponent(id), { method: 'DELETE' }); };

  /* ---------------- 附件 ---------------- */

  Api.listAttachments = async function (articleId) {
    try {
      const res = await fetch(API_BASE + '/attachments?article_id=' + encodeURIComponent(articleId), { cache: 'no-store' });
      const json = await res.json();
      return json.data || [];
    } catch (e) { return []; }
  };
  Api.addAttachment = async function (articleId, name, path, size) {
    return await req('/attachments', { method: 'POST', body: { article_id: articleId, name: name, path: path, size: size } });
  };
  Api.deleteAttachment = async function (id, path) {
    await req('/attachments/' + encodeURIComponent(id), { method: 'DELETE' });
  };
  Api.adminListAttachments = async function () { return (await req('/admin/attachments')) || []; };

  Api.downloadAttachment = async function (path) {
    return API_BASE + '/storage/blob?path=' + encodeURIComponent(path);
  };

  /* ---------------- 存储（图片 / 附件素材，base64 落 D1） ---------------- */

  Api.uploadImage = async function (uid, blob) {
    const data = await base64FromBlob(blob);
    const r = await req('/storage', { method: 'POST', body: { kind: 'image', name: Util.uuid() + '.jpg', mime: 'image/jpeg', data: data } });
    return r && r.path;
  };

  Api.uploadFile = async function (uid, file) {
    const data = await base64FromBlob(file);
    const safeName = String(file.name || 'file').replace(/[\\/:*?"<>|#%\s]+/g, '_');
    const r = await req('/storage', { method: 'POST', body: { kind: 'file', name: safeName, mime: file.type || 'application/octet-stream', data: data } });
    return r && r.path;
  };

  Api.listStorageFiles = async function (uid) { return (await req('/storage/list')) || []; };
  Api.deleteStorageFiles = async function (paths) { await req('/storage/delete', { method: 'POST', body: { paths: paths || [] } }); };

  /* ---------------- 用户偏好（主题） ---------------- */

  Api.getMyTheme = async function () { try { return await req('/me/theme'); } catch (e) { return null; } };
  Api.saveMyTheme = async function (theme) { try { await req('/me/theme', { method: 'POST', body: { theme: theme } }); } catch (e) { /* 未登录忽略 */ } };

  window.Api = Api;
})();
