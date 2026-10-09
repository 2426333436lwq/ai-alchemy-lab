/* 数据访问层：文章 / 标签 / 附件 / 站点信息，全部经由云服务 SDK */
(function () {
  'use strict';

  function unwrap(res, fallbackMsg) {
    if (res && res.error) {
      const err = new Error((res.error && res.error.message) || fallbackMsg || '请求失败');
      err.raw = res.error;
      throw err;
    }
    return res ? res.data : null;
  }

  function requireCloud() {
    if (!window.cloud) throw new Error('云服务组件未能加载，请检查网络后刷新');
  }

  function escapeLike(str) {
    return String(str).replace(/[\\%_]/g, function (ch) { return '\\' + ch; });
  }

  const Api = {};

  /* ---------------- 文章（公开读） ---------------- */

  Api.listArticles = async function (opts) {
    requireCloud();
    const page = (opts && opts.page) || 1;
    const pageSize = (opts && opts.pageSize) || 9;
    const tag = opts && opts.tag;
    const search = opts && opts.search;

    let query = cloud.database
      .from('articles')
      .select('id,title,summary,cover,tags,views,created_at', { count: 'exact' })
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (tag) query = query.contains('tags', [tag]);
    if (search) {
      const s = escapeLike(search.trim());
      /* 全文检索范围：标题 + 摘要 + 正文 */
      if (s) query = query.or('title.ilike.%' + s + '%,summary.ilike.%' + s + '%,content.ilike.%' + s + '%');
    }

    const from = (page - 1) * pageSize;
    const res = await query.range(from, from + pageSize - 1);
    const data = unwrap(res, '加载文章列表失败');
    return { list: data || [], total: res.count || 0 };
  };

  Api.getArticle = async function (id) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return unwrap(res, '加载文章失败');
  };

  Api.listTags = async function () {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('tags')
      .eq('status', 'published')
      .limit(1000);
    const rows = unwrap(res, '加载标签失败') || [];
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
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('views,tags')
      .eq('status', 'published')
      .limit(5000);
    const rows = unwrap(res, '加载站点统计失败') || [];
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
    requireCloud();
    const size = limit || 5;
    const res = await cloud.database
      .from('articles')
      .select('id,title,views,created_at')
      .eq('status', 'published')
      .order('views', { ascending: false })
      .limit(size + 1);
    const rows = unwrap(res, '加载热门文章失败') || [];
    return rows.filter(function (a) { return a.id !== excludeId; }).slice(0, size);
  };

  /* 相关文章：同系列 +5 分、每个共有标签 +2 分，取分数最高的若干篇 */
  Api.relatedArticles = async function (article, limit) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('id,title,summary,cover,tags,views,series_id,created_at')
      .eq('status', 'published')
      .limit(500);
    const rows = unwrap(res, '加载相关文章失败') || [];
    const myTags = (article.tags || []).map(String);
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
        return new Date(y.a.created_at) - new Date(x.a.created_at);
      })
      .slice(0, limit || 3)
      .map(function (x) { return x.a; });
  };

  /* 全站相邻文章：按发布时间定位当前文章的上一篇 / 下一篇（与系列内导航无关）
     prev = 更早发布的紧邻一篇；next = 更晚发布的紧邻一篇 */
  Api.adjacentArticles = async function (article) {
    requireCloud();
    const cols = 'id,title,created_at';
    const [prevRes, nextRes] = await Promise.all([
      cloud.database.from('articles').select(cols).eq('status', 'published')
        .lt('created_at', article.created_at)
        .order('created_at', { ascending: false }).limit(1),
      cloud.database.from('articles').select(cols).eq('status', 'published')
        .gt('created_at', article.created_at)
        .order('created_at', { ascending: true }).limit(1)
    ]);
    const prevRows = unwrap(prevRes, '加载上一篇失败') || [];
    const nextRows = unwrap(nextRes, '加载下一篇失败') || [];
    return { prev: prevRows[0] || null, next: nextRows[0] || null };
  };

  Api.incrementViews = function (id) {
    if (!window.cloud) return;
    /* 同一会话内同一篇只计一次，避免刷新刷阅读量 */
    try {
      const key = 'alch-viewed-' + id;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (e) { /* 隐私模式下 sessionStorage 不可用，照常计数 */ }
    cloud.database.rpc('increment_views', { p_article_id: id }).then(function () {
      /* 浏览量自增失败不影响阅读 */
    }).catch(function () { /* 忽略 */ });
  };

  /* ---------------- 附件 ---------------- */

  Api.listAttachments = async function (articleId) {
    requireCloud();
    const res = await cloud.database
      .from('attachments')
      .select('id,article_id,name,path,size,created_at')
      .eq('article_id', articleId)
      .order('created_at', { ascending: true });
    return unwrap(res, '加载附件失败') || [];
  };

  Api.addAttachment = async function (articleId, name, path, size) {
    requireCloud();
    const res = await cloud.database
      .from('attachments')
      .insert({ article_id: articleId, name: name, path: path, size: size })
      .select();
    const rows = unwrap(res, '保存附件记录失败');
    if (!rows || rows.length === 0) throw new Error('保存附件记录失败：没有写入权限');
    return rows[0];
  };

  Api.deleteAttachment = async function (id, path) {
    requireCloud();
    const res = await cloud.database.from('attachments').delete().eq('id', id).select();
    unwrap(res, '删除附件失败');
    if (path) {
      try { await cloud.storage.remove([path]); } catch (e) { /* 云端文件清理失败可忽略 */ }
    }
  };

  Api.downloadAttachment = async function (path) {
    requireCloud();
    const res = await cloud.storage.createSignedUrl(path, 600);
    const url = unwrap(res, '获取下载链接失败');
    return url;
  };

  /* ---------------- 存储 ---------------- */

  Api.uploadImage = async function (uid, blob) {
    requireCloud();
    const path = cloud.storage.sharedPath(uid, 'blog/images/' + Util.uuid() + '.jpg');
    const res = await cloud.storage.upload(path, blob, { contentType: 'image/jpeg' });
    unwrap(res, '上传图片失败');
    return path;
  };

  Api.uploadFile = async function (uid, file) {
    requireCloud();
    const safeName = String(file.name || 'file').replace(/[\\/:*?"<>|#%\s]+/g, '_');
    const path = cloud.storage.sharedPath(uid, 'blog/files/' + Util.uuid() + '-' + safeName);
    const res = await cloud.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
    unwrap(res, '上传附件失败');
    return path;
  };

  /* ---------------- 站长与权限 ---------------- */

  Api.isAdmin = async function () {
    requireCloud();
    try {
      const res = await cloud.database.rpc('is_admin');
      return !!unwrap(res);
    } catch (e) {
      return false;
    }
  };

  Api.claimAdmin = async function () {
    requireCloud();
    const res = await cloud.database.rpc('claim_admin');
    return !!unwrap(res, '认领站长失败');
  };

  /* 是否超级管理员（站点所有者） */
  Api.isOwner = async function () {
    requireCloud();
    try {
      const res = await cloud.database.rpc('is_owner');
      return !!unwrap(res);
    } catch (e) {
      return false;
    }
  };

  /* ---------------- 文章（站长写） ---------------- */

  Api.adminListArticles = async function () {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('id,title,summary,status,tags,views,created_at,updated_at,series_id,series_order')
      .order('updated_at', { ascending: false })
      .limit(500);
    return unwrap(res, '加载文章管理列表失败') || [];
  };

  Api.createArticle = async function (payload) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .insert({
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        cover: payload.cover,
        tags: payload.tags,
        status: payload.status,
        updated_at: new Date().toISOString(),
      })
      .select();
    const rows = unwrap(res, '创建文章失败');
    if (!rows || rows.length === 0) throw new Error('创建失败：当前账号没有站长权限');
    return rows[0];
  };

  Api.updateArticle = async function (id, payload) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .update({
        title: payload.title,
        summary: payload.summary,
        content: payload.content,
        cover: payload.cover,
        tags: payload.tags,
        status: payload.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select();
    const rows = unwrap(res, '保存文章失败');
    if (!rows || rows.length === 0) throw new Error('保存失败：文章不存在或当前账号无权修改');
    return rows[0];
  };

  Api.deleteArticle = async function (id) {
    requireCloud();
    const res = await cloud.database.from('articles').delete().eq('id', id).select();
    const rows = unwrap(res, '删除文章失败');
    if (!rows || rows.length === 0) throw new Error('删除失败：文章不存在或当前账号无权删除');
  };

  /* ---------------- 站点设置（公开读） ---------------- */

  Api.getSiteSettings = async function () {
    requireCloud();
    const res = await cloud.database.from('site_settings').select('key,value');
    const rows = unwrap(res, '加载站点设置失败') || [];
    const map = {};
    rows.forEach(function (r) { map[r.key] = r.value; });
    return map;
  };

  Api.updateSiteSetting = async function (key, value) {
    requireCloud();
    const res = await cloud.database.rpc('update_site_setting', { p_key: key, p_value: value });
    const ok = !!unwrap(res, '保存设置失败');
    if (!ok) throw new Error('保存失败：当前账号没有站长权限');
  };

  /* ---------------- 管理员管理 ---------------- */

  Api.adminsCount = async function () {
    requireCloud();
    try {
      const res = await cloud.database.rpc('admins_count');
      return Number(unwrap(res)) || 0;
    } catch (e) {
      return 0;
    }
  };

  Api.listAdmins = async function () {
    requireCloud();
    const res = await cloud.database
      .from('site_admins')
      .select('uid,note,role,created_at')
      .order('created_at', { ascending: true });
    return unwrap(res, '加载管理员列表失败') || [];
  };

  Api.addAdmin = async function (uid, note) {
    requireCloud();
    const res = await cloud.database.rpc('add_admin', { p_uid: uid, p_note: note || '' });
    const ok = !!unwrap(res, '添加管理员失败');
    if (!ok) throw new Error('添加失败：用户 ID 无效或当前账号没有站长权限');
  };

  Api.removeAdmin = async function (uid) {
    requireCloud();
    const res = await cloud.database.rpc('remove_admin', { p_uid: uid });
    const ok = !!unwrap(res, '移除管理员失败');
    if (!ok) throw new Error('移除失败：不能移除自己或最后一位管理员');
  };

  /* ---------------- 标签批量管理 ---------------- */

  Api.renameTag = async function (oldName, newName) {
    requireCloud();
    const res = await cloud.database.rpc('rename_tag', { p_old: oldName, p_new: newName });
    return Number(unwrap(res, '标签改名失败')) || 0;
  };

  Api.deleteTag = async function (name) {
    requireCloud();
    const res = await cloud.database.rpc('delete_tag', { p_tag: name });
    return Number(unwrap(res, '删除标签失败')) || 0;
  };

  /* ---------------- 文章状态切换 ---------------- */

  Api.updateArticleStatus = async function (id, status) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    const rows = unwrap(res, '更新状态失败');
    if (!rows || rows.length === 0) throw new Error('操作失败：文章不存在或没有权限');
    return rows[0];
  };

  /* ---------------- 全部附件（管理用） ---------------- */

  Api.adminListAttachments = async function () {
    requireCloud();
    const res = await cloud.database
      .from('attachments')
      .select('id,article_id,name,path,size,created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    return unwrap(res, '加载附件列表失败') || [];
  };

  /* ---------------- 云端文件（对象存储） ---------------- */

  Api.listStorageFiles = async function (uid) {
    requireCloud();
    const prefixes = ['shared/' + uid + '/blog/images', 'shared/' + uid + '/blog/files'];
    const out = [];
    for (const prefix of prefixes) {
      try {
        const page = await cloud.storage.list(prefix, {
          limit: 200,
          sortBy: { column: 'created_at', order: 'desc' },
        });
        const entries = (page && page.data) || [];
        entries.forEach(function (e) {
          if (!e || !e.name) return;
          out.push({
            name: e.name,
            path: prefix + '/' + e.name,
            size: (e.metadata && e.metadata.size) || e.size || 0,
            created_at: e.created_at || e.updated_at || '',
            kind: prefix.indexOf('/images') >= 0 ? '图片素材' : '附件文件',
          });
        });
      } catch (err) { /* 前缀不存在时跳过 */ }
    }
    return out;
  };

  Api.deleteStorageFiles = async function (paths) {
    requireCloud();
    const res = await cloud.storage.remove(paths);
    unwrap(res, '删除文件失败');
  };

  /* ---------------- 系列（公开读） ---------------- */

  Api.listSeries = async function () {
    requireCloud();
    const res = await cloud.database.rpc('series_with_counts');
    return unwrap(res, '加载系列失败') || [];
  };

  Api.getSeries = async function (id) {
    requireCloud();
    const res = await cloud.database
      .from('series')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    return unwrap(res, '加载系列失败');
  };

  Api.listSeriesArticles = async function (seriesId) {
    requireCloud();
    const res = await cloud.database
      .from('articles')
      .select('id,title,summary,cover,tags,views,created_at,series_order')
      .eq('status', 'published')
      .eq('series_id', seriesId)
      .order('series_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500);
    return unwrap(res, '加载系列文章失败') || [];
  };

  /* ---------------- 系列（站长写） ---------------- */

  Api.adminListSeries = async function () {
    requireCloud();
    const res = await cloud.database
      .from('series')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    return unwrap(res, '加载系列失败') || [];
  };

  Api.createSeries = async function (payload) {
    requireCloud();
    const res = await cloud.database.from('series').insert(payload).select();
    const rows = unwrap(res, '创建系列失败');
    if (!rows || !rows.length) throw new Error('创建失败：当前账号没有站长权限');
    return rows[0];
  };

  Api.updateSeries = async function (id, patch) {
    requireCloud();
    const res = await cloud.database
      .from('series')
      .update(Object.assign({ updated_at: new Date().toISOString() }, patch))
      .eq('id', id)
      .select();
    const rows = unwrap(res, '更新系列失败');
    if (!rows || !rows.length) throw new Error('更新失败：系列不存在或没有权限');
    return rows[0];
  };

  Api.deleteSeries = async function (id) {
    requireCloud();
    const res = await cloud.database.from('series').delete().eq('id', id).select();
    const rows = unwrap(res, '删除系列失败');
    if (!rows || !rows.length) throw new Error('删除失败：系列不存在或没有权限');
  };

  /* ---------------- 用户偏好（主题，登录用户云端同步） ---------------- */
  /* user_preferences 表启用 RLS：仅能读写本人的一行，无需传 uid（服务端 auth.uid() 自动填充） */

  Api.getMyTheme = async function () {
    requireCloud();
    const res = await cloud.database
      .from('user_preferences')
      .select('theme')
      .maybeSingle();
    if (res && res.error) {
      /* 表不存在 / 无权限时视为「无云端偏好」，不打扰使用 */
      return null;
    }
    return res.data ? res.data.theme : null;
  };

  Api.saveMyTheme = async function (theme) {
    requireCloud();
    const res = await cloud.database
      .from('user_preferences')
      .upsert({ theme: theme, updated_at: new Date().toISOString() });
    unwrap(res, '同步主题失败');
  };

  /* ---------------- 评论 ---------------- */
  /* RLS：公开可读（status='published'）；登录用户可发（user_id 服务端填充）；本人或管理员可删 */

  Api.listComments = async function (articleId) {
    requireCloud();
    const res = await cloud.database
      .from('comments')
      .select('id,article_id,parent_id,user_id,user_email,nickname,content,status,created_at')
      .eq('article_id', articleId)
      .order('created_at', { ascending: true })
      .limit(300);
    if (res && res.error) throw new Error(res.error.message || '加载评论失败');
    return res.data || [];
  };

  Api.countComments = async function (ids) {
    requireCloud();
    if (!ids || !ids.length) return {};
    const res = await cloud.database
      .from('comments')
      .select('article_id')
      .in('article_id', ids);
    if (res && res.error) return {};
    const map = {};
    (res.data || []).forEach(function (r) {
      map[r.article_id] = (map[r.article_id] || 0) + 1;
    });
    return map;
  };

  Api.addComment = async function (articleId, content, parentId, user) {
    requireCloud();
    const text = String(content || '').trim();
    if (text.length < 2) throw new Error('评论至少 2 个字');
    if (text.length > 1000) throw new Error('评论最多 1000 字');
    const email = (user && user.email) || '';
    const payload = {
      article_id: articleId,
      parent_id: parentId || null,
      user_email: email,
      nickname: email ? email.split('@')[0] : '道友',
      content: text,
      status: 'published'
    };
    const res = await cloud.database.from('comments').insert(payload).select();
    const rows = unwrap(res, '发表评论失败');
    if (!rows || !rows.length) throw new Error('发表失败：请确认已登录');
    return rows[0];
  };

  Api.deleteComment = async function (id) {
    requireCloud();
    const res = await cloud.database.from('comments').delete().eq('id', id).select();
    const rows = unwrap(res, '删除评论失败');
    if (!rows || !rows.length) throw new Error('删除失败：不是你的评论或没有权限');
  };

  /* 后台评论管理：最近 N 条，跨文章 */
  Api.adminListComments = async function (limit) {
    requireCloud();
    const res = await cloud.database
      .from('comments')
      .select('id,article_id,parent_id,user_id,user_email,nickname,content,status,created_at')
      .order('created_at', { ascending: false })
      .limit(limit || 100);
    return unwrap(res, '加载评论管理列表失败') || [];
  };

  window.Api = Api;
})();
