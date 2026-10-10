/* 公开页面视图：首页 / 文章详情 / 标签 / 关于 */
(function () {
  'use strict';

  const Views = {};
  const homeState = { page: 1, search: '' };

  /* 评论后端开关：'waline' = Waline（匿名可评），'builtin' = 站内自建评论（登录 + 审核） */
  const COMMENT_BACKEND = 'waline';

  function articleCard(a) {
    const cover = a.cover
      ? '<a class="card-cover" href="#/article/' + a.id + '"><img src="' + a.cover + '" alt="' + Util.escapeHtml(a.title) + '" loading="lazy"></a>'
      : '<a class="card-cover" href="#/article/' + a.id + '"><span class="cover-fallback">' + Util.escapeHtml((a.title || '丹')[0]) + '</span></a>';
    return (
      '<div class="card article-card">' + cover +
      '<div class="card-body">' +
      '<a class="card-title" href="#/article/' + a.id + '">' + Util.escapeHtml(a.title) + '</a>' +
      '<p class="card-summary">' + Util.escapeHtml(a.summary || '') + '</p>' +
      '<div class="card-meta"><span>' + Util.formatDate(a.created_at) + '</span><span>阅读 ' + (a.views || 0) + '</span></div>' +
      '<div class="card-tags">' + Util.tagChips(a.tags) + '</div>' +
      '</div></div>'
    );
  }

  function renderList(root, list) {
    if (!list.length) {
      return '<div class="empty-box"><h2>炉中暂无丹药</h2><p>没有找到匹配的文章，换个关键词试试。</p></div>';
    }
    return '<div class="article-grid">' + list.map(articleCard).join('') + '</div>';
  }

  /* ---------------- 首页 ---------------- */

  Views.home = async function (root) {
    const s = (window.App && App.settings) || {};
    root.innerHTML =
      '<section class="hero">' +
      '<h1>' + Util.escapeHtml(s.site_title || 'AI 炼丹房') + '</h1>' +
      '<p>' + Util.escapeHtml(s.site_slogan || '数据是药材 · 算力是炉火 · 调参是火候') + '</p>' +
      '</section>' +
      '<div class="search-bar">' +
      '<input id="search-input" class="input" type="search" placeholder="搜一搜丹方：标题 / 摘要 / 正文关键词…" value="' + Util.escapeHtml(homeState.search) + '">' +
      '</div>' +
      '<div id="article-list"></div>' +
      '<div id="pagination" class="pagination"></div>';

    const listEl = Util.$('#article-list', root);
    const pagerEl = Util.$('#pagination', root);

    async function load() {
      Util.setLoading(listEl);
      pagerEl.innerHTML = '';
      try {
        const pageSize = 9;
        const result = await Api.listArticles({ page: homeState.page, pageSize: pageSize, search: homeState.search });
        listEl.innerHTML = renderList(root, result.list);
        const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
        if (totalPages > 1) {
          pagerEl.innerHTML =
            '<button class="btn btn-sm" id="prev-page" ' + (homeState.page <= 1 ? 'disabled' : '') + '>上一页</button>' +
            '<span class="page-info">第 ' + homeState.page + ' / ' + totalPages + ' 页 · 共 ' + result.total + ' 篇</span>' +
            '<button class="btn btn-sm" id="next-page" ' + (homeState.page >= totalPages ? 'disabled' : '') + '>下一页</button>';
          const prev = Util.$('#prev-page', pagerEl);
          const next = Util.$('#next-page', pagerEl);
          if (prev) prev.addEventListener('click', function () { homeState.page -= 1; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
          if (next) next.addEventListener('click', function () { homeState.page += 1; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
        }
      } catch (err) {
        Util.setError(listEl, '文章列表加载失败', err.message || '请稍后重试');
      }
    }

    const searchInput = Util.$('#search-input', root);
    searchInput.addEventListener('input', Util.debounce(function () {
      homeState.search = searchInput.value.trim();
      homeState.page = 1;
      load();
    }, 450));

    await load();
  };

  /* ---------------- 文章详情 ---------------- */

  Views.article = async function (root, id) {
    Util.setLoading(root, '丹药出炉中…');
    let article;
    try {
      article = await Api.getArticle(id);
    } catch (err) {
      Util.setError(root, '文章加载失败', err.message || '');
      return;
    }
    if (!article) {
      Util.setError(root, '炉中无此丹', '这篇文章不存在，或尚未发布。');
      return;
    }

    const siteName = (window.App && App.settings && App.settings.site_title) || 'AI 炼丹房';
    const siteOrigin = (window.APP_CONFIG && APP_CONFIG.siteUrl) || location.origin;
    Util.setPageMeta({
      title: article.title + ' · ' + siteName,
      description: (article.summary || article.title || '').slice(0, 160),
      image: article.cover || '',
      url: location.href,
      canonical: siteOrigin + '/a/' + article.id + '/'
    });
    Api.incrementViews(article.id);

    const coverHtml = article.cover
      ? '<div class="detail-cover"><img src="' + article.cover + '" alt="' + Util.escapeHtml(article.title) + '"></div>'
      : '';

    /* 阅读时长：与静态快照同一套算法——先抠掉代码块，再按字数 / 400 取整，最少 1 分钟 */
    const readMinutes = Math.max(1, Math.round(
      String(article.content || '').replace(/```[\s\S]*?```/g, '').length / 400
    ));

    root.innerHTML =
      '<article class="article-detail" data-url="' + Util.escapeHtml(siteOrigin + '/a/' + article.id + '/') + '">' + coverHtml +
      '<h1 class="detail-title">' + Util.escapeHtml(article.title) + '</h1>' +
      '<div class="detail-meta">' +
      '<span>' + Util.formatDate(article.created_at) + '</span>' +
      '<span>约 ' + readMinutes + ' 分钟读完</span>' +
      '<span>阅读 <span id="view-count">' + ((article.views || 0) + 1) + '</span></span>' +
      '<span id="series-badge"></span>' +
      '<span class="detail-tags">' + Util.tagChips(article.tags) + '</span>' +
      '</div>' +
      '<div id="resume-bar-slot"></div>' +
      '<div id="article-content" class="article-body"></div>' +
      '<div id="toc-box"></div>' +
      '<div id="share-box" class="card share-box"></div>' +
      '<div id="attachments-area"></div>' +
      '<div id="series-nav"></div>' +
      '<div id="post-nav"></div>' +
      '<div id="related-box"></div>' +
      '<div id="hot-box"></div>' +
      '<div id="comment-box" class="card comment-box"></div>' +
      '<div id="waline" class="waline-box"></div>' +
      '<div class="detail-actions"><a class="btn" href="#/">返回丹房</a></div>' +
      '</article>';

    const contentEl = Util.$('#article-content', root);
    renderMarkdown(contentEl, article.content, { codeCopy: true });
    setupReadingAssist(root, contentEl, article);

    /* 所属系列：徽章 + 系列内上一篇 / 下一篇 */
    if (article.series_id) {
      (async function () {
        try {
          const series = await Api.getSeries(article.series_id);
          const list = await Api.listSeriesArticles(article.series_id);
          if (series) {
            const badge = Util.$('#series-badge', root);
            if (badge) {
              badge.innerHTML =
                '<a class="series-badge" href="#/series/' + series.id + '">' +
                '<span class="series-icon sm">' + Util.escapeHtml(series.icon || '') + '</span>' +
                Util.escapeHtml(series.name) + '</a>';
            }
          }
          const idx = list.findIndex(function (a) { return a.id === article.id; });
          if (idx >= 0) {
            const prev = idx > 0 ? list[idx - 1] : null;
            const next = idx < list.length - 1 ? list[idx + 1] : null;
            const nav = Util.$('#series-nav', root);
            if (nav && (prev || next || series)) {
              nav.innerHTML =
                '<div class="card series-nav">' +
                '<div class="series-nav-head">' +
                (series ? '本系列：' + Util.escapeHtml(series.name) : '本系列') +
                ' · 第 ' + (idx + 1) + ' / ' + list.length + ' 篇</div>' +
                '<div class="series-nav-links">' +
                (prev
                  ? '<a class="series-nav-item" href="#/article/' + prev.id + '"><span class="sn-label">上一篇</span>' + Util.escapeHtml(prev.title) + '</a>'
                  : '<span class="series-nav-item disabled"><span class="sn-label">上一篇</span>已是系列首篇</span>') +
                (next
                  ? '<a class="series-nav-item next" href="#/article/' + next.id + '"><span class="sn-label">下一篇</span>' + Util.escapeHtml(next.title) + '</a>'
                  : '<span class="series-nav-item disabled next"><span class="sn-label">下一篇</span>已是系列末篇</span>') +
                '</div>' +
                (series ? '<a class="btn btn-sm" href="#/series/' + series.id + '">查看完整系列</a>' : '') +
                '</div>';
            }
          }
        } catch (e) { /* 系列信息加载失败不影响正文阅读 */ }
      })();
    }

    /* 全站上下篇：按发布时间串联全部文章（不依赖系列） */
    (async function () {
      try {
        const adj = await Api.adjacentArticles(article);
        const box = Util.$('#post-nav', root);
        if (!box || (!adj.prev && !adj.next)) return;
        box.innerHTML =
          '<div class="card post-nav"><div class="post-nav-links">' +
          (adj.prev
            ? '<a class="post-nav-item" href="#/article/' + adj.prev.id + '"><span class="pn-label">上一篇</span>' + Util.escapeHtml(adj.prev.title) + '</a>'
            : '<span class="post-nav-item disabled"><span class="pn-label">上一篇</span>已是最早一篇</span>') +
          (adj.next
            ? '<a class="post-nav-item next" href="#/article/' + adj.next.id + '"><span class="pn-label">下一篇</span>' + Util.escapeHtml(adj.next.title) + '</a>'
            : '<span class="post-nav-item disabled next"><span class="pn-label">下一篇</span>已是最新一篇</span>') +
          '</div></div>';
      } catch (e) { /* 全站导航加载失败不影响阅读 */ }
    })();

    /* 附件区 */
    try {
      const files = await Api.listAttachments(article.id);
      if (files.length) {
        const area = Util.$('#attachments-area', root);
        const session = await Util.getSession();
        area.innerHTML =
          '<div class="card attachments-box"><h3>本文附件</h3>' +
          files.map(function (f, i) {
            return (
              '<div class="attachment-row">' +
              '<svg class="attachment-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>' +
              '<span class="attachment-name">' + Util.escapeHtml(f.name) + '</span>' +
              '<span class="attachment-size">' + Util.formatSize(f.size) + '</span>' +
              '<button class="btn btn-sm" data-idx="' + i + '">下载</button>' +
              '</div>'
            );
          }).join('') +
          (session ? '' : '<p class="form-hint" style="margin-top:12px">附件存放于云端存储，登录后即可下载。</p>') +
          '</div>';

        Util.$$('button[data-idx]', area).forEach(function (btn) {
          btn.addEventListener('click', async function () {
            const file = files[Number(btn.getAttribute('data-idx'))];
            const sess = await Util.getSession();
            if (!sess) {
              Util.toast('附件下载需要登录，请先登录', 'info');
              sessionStorage.setItem('redirectAfterLogin', '#/article/' + article.id);
              location.hash = '#/login';
              return;
            }
            btn.disabled = true;
            btn.textContent = '获取中…';
            try {
              const url = await Api.downloadAttachment(file.path);
              window.open(url, '_blank', 'noopener');
            } catch (err) {
              Util.toast(err.message || '获取下载链接失败', 'error');
            } finally {
              btn.disabled = false;
              btn.textContent = '下载';
            }
          });
        });
      }
    } catch (e) { /* 附件加载失败不影响正文阅读 */ }

    renderShare(root, article);
    mountWaline(root, article);

    try {
      const related = await Api.relatedArticles(article, 3);
      const box = Util.$('#related-box', root);
      if (box && related.length) {
        box.innerHTML =
          '<h3 class="box-title">接着炼 · 相关丹方</h3>' +
          '<div class="article-grid compact">' + related.map(articleCard).join('') + '</div>';
      }
    } catch (e) { /* 推荐失败不影响阅读 */ }

    try {
      const hot = await Api.hotArticles(5, article.id);
      const box = Util.$('#hot-box', root);
      if (box && hot.length) {
        box.innerHTML =
          '<div class="card hot-box">' +
          '<h3 class="box-title">炉火最旺 · 热门丹方</h3>' +
          '<ol class="hot-list">' +
          hot.map(function (a, i) {
            return '<li class="hot-item">' +
              '<span class="hot-rank">' + (i + 1) + '</span>' +
              '<a href="#/article/' + a.id + '">' + Util.escapeHtml(a.title) + '</a>' +
              '<span class="hot-views">' + (a.views || 0) + ' 阅读</span>' +
              '</li>';
          }).join('') +
          '</ol></div>';
      }
    } catch (e) { /* 热门榜失败不影响阅读 */ }

    /* 评论后端：'waline' 用 Waline，'builtin' 用站内自建评论（需登录 + 审核）。
       切回自建只需把这个常量改掉，两边代码都还在 */
    if (COMMENT_BACKEND === 'builtin') {
      renderComments(root, article);
    } else {
      const legacy = Util.$('#comment-box', root);
      if (legacy) legacy.remove();
    }
  };

  /* ---------------- Waline 评论 ---------------- */

  /* 后端：Vercel 托管（境外）。国内若访问不到，评论区会走降级提示，不影响正文阅读 */
  const WALINE_SERVER = 'https://ai-alchemy-waline.vercel.app';
  /* 客户端脚本本地自托管，不再走 unpkg（境外 CDN 国内不稳定） */
  const WALINE_JS = 'assets/vendor/waline.umd.js';
  let walineInstance = null;
  let walineLoader = null;

  /* 脚本按需加载，失败也只影响评论区，不拖慢首屏 */
  function loadWaline() {
    if (window.Waline) return Promise.resolve(window.Waline);
    if (walineLoader) return walineLoader;
    walineLoader = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = WALINE_JS;
      s.async = true;
      s.onload = function () {
        window.Waline ? resolve(window.Waline) : reject(new Error('Waline 未挂载到 window'));
      };
      s.onerror = function () { reject(new Error('Waline 脚本加载失败')); };
      document.head.appendChild(s);
    });
    return walineLoader;
  }

  /* 评论服务部署在境外，先探一下连通性：连不上就直接给降级提示，
     不要让用户对着一个永远加载中的空框发呆（正文阅读完全不受影响） */
  function walineReachable() {
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(function () { finish(false); }, 6000);
      fetch(WALINE_SERVER + '/api/comment?type=count&path=/ping', {
        method: 'GET',
        cache: 'no-store',
      }).then(function (r) { finish(r.ok); }).catch(function () { finish(false); });
    });
  }

  function showWalineFallback(box, article) {
    box.innerHTML =
      '<div class="card waline-fallback">' +
      '<p>评论服务暂时连不上（部署在境外，部分地区网络可能访问不到）。</p>' +
      '<p class="muted">文章正文不受影响，可以正常阅读；换个网络环境再打开就能看到评论。</p>' +
      '<button class="btn btn-sm" id="waline-retry" type="button">重试</button>' +
      '</div>';
    const btn = Util.$('#waline-retry', box);
    if (btn) {
      btn.addEventListener('click', function () {
        box.innerHTML = '<div class="card waline-fallback">正在重连…</div>';
        mountWaline(box, article);
      });
    }
  }

  function mountWaline(root, article) {
    const box = Util.$('#waline', root) || (root && root.id === 'waline' ? root : null);
    if (!box) return;
    box.innerHTML = '<div class="card waline-fallback">正在连接评论服务…</div>';
    walineReachable().then(function (ok) {
      if (!ok) { showWalineFallback(box, article); return; }
      loadWaline().then(function (Waline) {
        /* SPA 换文章：必须先销毁旧实例，否则评论区串台 */
        if (walineInstance) {
          walineInstance.destroy();
          walineInstance = null;
        }
        box.innerHTML = '';
        /* v3 的 UMD 导出是命名空间对象，入口是 init()（不是 new Waline）；
           3.16.0 认的是 serverURL 这个键，写 server 会直接抛 "Option 'serverURL' is missing!" */
        walineInstance = Waline.init({
          el: '#waline',
          serverURL: WALINE_SERVER,
          /* 每篇独立 path：SPA 是 hash 路由，不显式传会全都落在 / 上 */
          path: '/a/' + article.id + '/',
          locale: { placeholder: '留下你的炼丹心得...' },
          dark: 'auto',
          reaction: false,
          commentCount: true,
          pageSize: 10
        });
      }).catch(function () {
        showWalineFallback(box, article);
      });
    });
  }

  /* 离开文章页时销毁，避免实例残留 */
  Views.unmountWaline = function () {
    if (!walineInstance) return;
    walineInstance.destroy();
    walineInstance = null;
  };

  /* ---------------- 阅读辅助：目录 + 阅读进度条 ---------------- */

  const ReadingAssist = { detach: function () {} };
  window.ReadingAssist = ReadingAssist;

  function setupReadingAssist(root, contentEl, article) {
    ReadingAssist.detach();

    const articleId = article ? article.id : 0;

    /* —— 阅读进度（localStorage）：保存滚动位置，读完自动清除 —— */
    function progressKey() { return 'alch-progress-' + articleId; }
    function loadProgress() {
      try { return JSON.parse(localStorage.getItem(progressKey()) || 'null'); }
      catch (e) { return null; }
    }
    function clearProgress() {
      try { localStorage.removeItem(progressKey()); } catch (e) { /* 忽略 */ }
    }
    function saveProgress(pct, y) {
      if (!articleId) return;
      try {
        localStorage.setItem(progressKey(), JSON.stringify({ pct: pct, y: y, t: Date.now() }));
      } catch (e) { /* 存储不可用忽略 */ }
    }
    /* 统一提交进度：读到底视为读完并清除；靠近顶部（<5%）不写入，
       避免页面初始加载或主动回顶时用 0 覆盖掉有效的续读进度 */
    function commitProgress(pct) {
      if (!articleId) return;
      if (pct >= 0.97) { clearProgress(); return; }
      if (pct < 0.05) return;
      saveProgress(pct, window.scrollY);
    }
    /* 停止滚动 0.5s 后才写入，避免高频滚动刷 localStorage */
    const scheduleProgressSave = Util.debounce(function (pct) {
      commitProgress(pct);
    }, 500);

    const heads = Util.$$('h2, h3', contentEl);
    const box = Util.$('#toc-box', root);
    const bar = Util.$('#read-progress');
    const barFill = Util.$('#read-progress-bar');
    const showToc = heads.length >= 3;

    /* 续读提示条：仅当存在未读完的进度（5%~97%、30 天内）时出现 */
    (function setupResumeBar() {
      const slot = Util.$('#resume-bar-slot', root);
      if (!slot || !articleId) return;
      const p = loadProgress();
      if (!p || typeof p.pct !== 'number') return;
      if (p.pct < 0.05 || p.pct >= 0.97) { clearProgress(); return; }
      if (p.t && Date.now() - p.t > 30 * 24 * 3600 * 1000) { clearProgress(); return; }
      const pctText = Math.round(p.pct * 100) + '%';
      slot.innerHTML =
        '<div class="resume-bar"><span>上次读到 ' + pctText + '，要接着读吗？</span>' +
        '<span class="resume-ops">' +
        '<button class="btn btn-sm resume-go" type="button">继续阅读</button>' +
        '<button class="resume-dismiss" type="button" aria-label="清除阅读进度" title="从头开始">×</button>' +
        '</span></div>';
      /* 用百分比而不是存下来的像素值定位：换设备、改窗口大小后像素位置会偏，比例不会 */
      Util.$('.resume-go', slot).addEventListener('click', function () {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const targetY = Math.max(0, max * p.pct - 78);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
        slot.innerHTML = '';
      });
      Util.$('.resume-dismiss', slot).addEventListener('click', function () {
        clearProgress();
        slot.innerHTML = '';
        Util.toast('已清除阅读进度', 'info');
      });
    })();

    if (box) {
      if (!showToc) {
        box.innerHTML = '';
      } else {
        box.innerHTML =
          '<details class="toc-card" open>' +
          '<summary class="toc-head">本文目录<span class="toc-count">' + heads.length + ' 节</span></summary>' +
          '<ul class="toc-list">' +
          heads.map(function (h) {
            return '<li class="toc-item' + (h.tagName === 'H3' ? ' sub' : '') + '">' +
              '<button type="button" class="toc-link" data-sec="' + h.id + '">' +
              Util.escapeHtml(h.textContent) + '</button></li>';
          }).join('') +
          '</ul></details>';
        Util.$$('.toc-link', box).forEach(function (btn) {
          btn.addEventListener('click', function () {
            const target = document.getElementById(btn.getAttribute('data-sec'));
            if (!target) return;
            const y = target.getBoundingClientRect().top + window.scrollY - 78;
            window.scrollTo({ top: y, behavior: 'smooth' });
          });
        });
      }
    }

    const links = showToc ? Util.$$('.toc-link', box) : [];
    let ticking = false;

    function currentPct() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }

    function paintProgress(pct) {
      if (barFill) barFill.style.width = (pct * 100).toFixed(2) + '%';
      if (bar) bar.classList.toggle('is-zero', pct < 0.005);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        const pct = currentPct();
        paintProgress(pct);
        /* 阅读进度：接近底部视为读完并清除，否则防抖写入 */
        scheduleProgressSave(pct);

        /* 当前小节：视口顶部下方 90px 之上、最靠下的那个标题 */
        let currentId = heads.length ? heads[0].id : '';
        for (let i = 0; i < heads.length; i++) {
          if (heads[i].getBoundingClientRect().top <= 90) currentId = heads[i].id;
          else break;
        }
        links.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-sec') === currentId);
        });
      });
    }

    /* 缩放 / 横竖屏切换：只重画进度条，不写进度。
       窗口一变，同样的 scrollY 会对应完全不同的百分比，写进去就是脏数据 */
    function onResize() { paintProgress(currentPct()); }

    if (bar) bar.classList.remove('hidden');
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    onScroll();

    ReadingAssist.detach = function () {
      /* 离开文章页前立即落一次进度（顶部不覆盖、读到底清除，规则同 commitProgress） */
      if (articleId) commitProgress(currentPct());
      /* 清掉续读提示：下次进入文章页重新初始化，避免上一页的提示残留 */
      const slot = document.querySelector('#resume-bar-slot');
      if (slot) slot.innerHTML = '';

      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (bar) { bar.classList.add('hidden'); bar.classList.remove('is-zero'); }
      if (barFill) barFill.style.width = '0%';
      ReadingAssist.detach = function () {};
    };
  }

  /* ---------------- 评论 ---------------- */

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    return Util.formatDate(iso);
  }

  function commentItem(c, canDelete) {
    const name = Util.escapeHtml(c.nickname || (c.user_email ? c.user_email.split('@')[0] : '道友'));
    const initial = name.slice(0, 1).toUpperCase();
    return '<li class="comment-item" data-id="' + c.id + '">' +
      '<div class="comment-avatar">' + initial + '</div>' +
      '<div class="comment-main">' +
      '<div class="comment-head"><span class="comment-name">' + name + '</span>' +
      '<span class="comment-time">' + timeAgo(c.created_at) + '</span></div>' +
      '<div class="comment-text">' + Util.escapeHtml(c.content).replace(/\n/g, '<br>') + '</div>' +
      '<div class="comment-ops">' +
      '<button class="comment-op" data-act="reply">回复</button>' +
      (c.status && c.status !== 'published' ? '<span class="comment-flag">已隐藏</span>' : '') +
      (canDelete ? '<button class="comment-op danger" data-act="del">删除</button>' : '') +
      '</div>' +
      '</div></li>';
  }

  async function renderComments(root, article) {
    const box = Util.$('#comment-box', root);
    if (!box) return;

    let session = null;
    let isAdmin = false;
    try {
      session = await Util.getSession();
      if (session) isAdmin = await Api.isAdmin();
    } catch (e) { /* 未登录也能看评论 */ }

    let comments = [];
    try {
      comments = await Api.listComments(article.id);
    } catch (e) {
      box.innerHTML = '<h3 class="box-title">丹友留言</h3><p class="form-hint">评论加载失败，稍后再来看看。</p>';
      return;
    }

    /* 两级结构：顶层评论 + 其下的回复 */
    const tops = comments.filter(function (c) { return !c.parent_id; });
    const kids = comments.filter(function (c) { return c.parent_id; });
    const myId = session && session.user ? session.user.id : '';

    function listHtml() {
      if (!comments.length) {
        return '<p class="comment-empty">还没有人留言。第一炉丹方的第一句反馈，往往最有价值。</p>';
      }
      return '<ul class="comment-list">' + tops.map(function (c) {
        const mine = c.user_id === myId;
        const sub = kids.filter(function (k) { return k.parent_id === c.id; });
        return commentItem(c, mine || isAdmin) +
          (sub.length
            ? '<ul class="comment-list sub">' + sub.map(function (k) {
                return commentItem(k, k.user_id === myId || isAdmin);
              }).join('') + '</ul>'
            : '');
      }).join('') + '</ul>';
    }

    function paint() {
      box.innerHTML =
        '<h3 class="box-title">丹友留言 · <span id="comment-count">' + comments.length + '</span> 条</h3>' +
        '<div id="comment-form"></div>' +
        '<div id="comment-list-area">' + listHtml() + '</div>';
      bindForm();
    }

    function bindForm() {
      const form = Util.$('#comment-form', box);
      if (!form) return;
      if (!session) {
        form.innerHTML =
          '<div class="comment-login">' +
          '<span>登录后即可留言，邮箱注册只要十几秒。</span>' +
          '<a class="btn btn-gold btn-sm" href="#/login" id="comment-login-btn">去登录</a>' +
          '</div>';
        Util.$('#comment-login-btn', form).addEventListener('click', function () {
          sessionStorage.setItem('redirectAfterLogin', '#/article/' + article.id);
        });
        return;
      }
      form.innerHTML =
        '<textarea id="comment-input" class="textarea comment-input" rows="3" maxlength="1000" ' +
        'placeholder="说说你的看法、踩过的坑，或者想让我下一篇写什么…"></textarea>' +
        '<div class="comment-form-foot">' +
        '<span class="form-hint" id="comment-count-hint">还可以输入 1000 字</span>' +
        '<span class="comment-form-btns">' +
        '<button class="btn btn-sm" id="comment-cancel" style="display:none">取消回复</button>' +
        '<button class="btn btn-gold btn-sm" id="comment-submit">发表留言</button>' +
        '</span></div>';

      const input = Util.$('#comment-input', form);
      const hint = Util.$('#comment-count-hint', form);
      const cancel = Util.$('#comment-cancel', form);
      let replyTo = null;

      input.addEventListener('input', function () {
        hint.textContent = '还可以输入 ' + (1000 - input.value.length) + ' 字';
      });

      Util.$('#comment-submit', form).addEventListener('click', async function () {
        const btn = this;
        const text = input.value.trim();
        if (text.length < 2) { Util.toast('至少写 2 个字', 'error'); return; }
        btn.disabled = true;
        btn.textContent = '发送中…';
        try {
          const row = await Api.addComment(article.id, text, replyTo, session.user);
          comments.push(row);
          input.value = '';
          replyTo = null;
          cancel.style.display = 'none';
          paint();
          Util.toast('留言已发表', 'success');
        } catch (err) {
          Util.toast(err.message || '发表失败', 'error');
        } finally {
          if (btn.isConnected) { btn.disabled = false; btn.textContent = '发表留言'; }
        }
      });

      Util.$$('[data-act="reply"]', box).forEach(function (btn) {
        btn.addEventListener('click', function () {
          const li = btn.closest('.comment-item');
          const id = Number(li.getAttribute('data-id'));
          const c = comments.find(function (x) { return x.id === id; });
          if (!c) return;
          replyTo = id;
          const nm = c.nickname || (c.user_email ? c.user_email.split('@')[0] : '道友');
          input.value = '@' + nm + ' ';
          input.focus();
          cancel.style.display = '';
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });

      cancel.addEventListener('click', function () {
        replyTo = null;
        input.value = '';
        cancel.style.display = 'none';
      });

      Util.$$('[data-act="del"]', box).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const li = btn.closest('.comment-item');
          const id = Number(li.getAttribute('data-id'));
          if (!window.confirm('确定删除这条留言？')) return;
          try {
            await Api.deleteComment(id);
            comments = comments.filter(function (x) { return x.id !== id && x.parent_id !== id; });
            paint();
            Util.toast('已删除', 'success');
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
          }
        });
      });
    }

    paint();
  }

  /* 分享区：复制链接 / 生成分享图 */
  function renderShare(root, article) {
    const box = Util.$('#share-box', root);
    if (!box) return;
    const link = location.origin + location.pathname + '#/article/' + article.id;
    /* 站外分享统一用静态页地址：hash 链接在微博 / 微信里打开会丢路由 */
    const shareUrl = location.origin + '/a/' + article.id + '/';
    const faved = Util.Favorites.has(article.id);
    box.innerHTML =
      '<div class="share-head">这炉丹还不错？带出去给人看看</div>' +
      '<div class="share-actions">' +
      '<button class="btn btn-sm btn-fav' + (faved ? ' is-faved' : '') + '" id="btn-fav">' +
        (faved ? '★ 已收藏' : '☆ 收藏本文') + '</button>' +
      '<button class="btn btn-sm" id="btn-copy-link">复制链接</button>' +
      '<button class="btn btn-sm" id="btn-share-weibo">分享到微博</button>' +
      '<button class="btn btn-sm" id="btn-share-zhihu">分享到知乎</button>' +
      '<button class="btn btn-sm" id="btn-share-wechat">分享到微信</button>' +
      '<button class="btn btn-sm" id="btn-share-img">生成分享图</button>' +
      '<button class="btn btn-sm" id="btn-copy-rich">复制标题 + 链接</button>' +
      '<button class="btn btn-sm" id="btn-print">打印 / 存 PDF</button>' +
      '</div>' +
      '<div id="share-preview"></div>' +
      '<div class="vote-box">' +
      '<div class="share-head">这篇文章对你有帮助吗？</div>' +
      '<div class="share-actions">' +
      '<button class="btn btn-sm btn-vote" id="btn-vote-up" type="button">👍 有用</button>' +
      '<button class="btn btn-sm btn-vote" id="btn-vote-down" type="button">👎 没用</button>' +
      '<span class="vote-count" id="vote-count"></span>' +
      '</div>' +
      '</div>';

    Util.$('#btn-fav', box).addEventListener('click', function () {
      const nowFaved = Util.Favorites.toggle(article);
      this.textContent = nowFaved ? '★ 已收藏' : '☆ 收藏本文';
      this.classList.toggle('is-faved', nowFaved);
      Util.toast(nowFaved ? '已收入你的丹架' : '已从丹架取下', nowFaved ? 'success' : 'info');
      if (window.App && App.updateFavBadge) App.updateFavBadge();
    });

    Util.$('#btn-print', box).addEventListener('click', function () {
      window.print();
    });

    function done(ok, okMsg) {
      Util.toast(ok ? okMsg : '复制失败，请手动选取复制', ok ? 'success' : 'error');
    }

    /* 分享到站外：一律新窗口，带 noopener 避免对方页面拿到 window.opener */
    Util.$('#btn-share-weibo', box).addEventListener('click', function () {
      window.open('https://service.weibo.com/share/share.php?url=' + encodeURIComponent(shareUrl) +
        '&title=' + encodeURIComponent(article.title), '_blank', 'noopener');
    });

    /* 知乎没有公开的网页投稿入口，用「待回答」页按话题过滤，点进去即可提问/分享 */
    Util.$('#btn-share-zhihu', box).addEventListener('click', function () {
      window.open('https://www.zhihu.com/question/waiting?topic=' + encodeURIComponent(article.title),
        '_blank', 'noopener');
    });

    /* 微信没有网页分享接口，只能复制链接让用户自己粘贴 */
    Util.$('#btn-share-wechat', box).addEventListener('click', function () {
      Util.copyText(shareUrl).then(function (ok) { done(ok, '链接已复制，粘贴到微信即可'); });
    });

    /* ---- 文章反馈投票：纯前端计数，同一篇一人一票，记在 localStorage ---- */
    const voteKey = 'alch-vote-' + article.id;
    function readVote() {
      try {
        const v = localStorage.getItem(voteKey);
        return v === 'up' || v === 'down' ? v : null;
      } catch (e) { return null; }
    }
    function paintVote() {
      const my = readVote();
      const up = Util.$('#btn-vote-up', box);
      const down = Util.$('#btn-vote-down', box);
      const count = Util.$('#vote-count', box);
      if (!up || !down || !count) return;
      up.classList.toggle('is-voted', my === 'up');
      down.classList.toggle('is-voted', my === 'down');
      up.disabled = !!my && my !== 'up';
      down.disabled = !!my && my !== 'down';
      const n = my ? 1 : 0;
      count.textContent = n
        ? '已有 ' + n + ' 人反馈 · 你投了「' + (my === 'up' ? '有用' : '没用') + '」'
        : '还没有人反馈 · 投一票吧';
    }

    ['up', 'down'].forEach(function (v) {
      Util.$('#btn-vote-' + v, box).addEventListener('click', function () {
        if (readVote()) return;
        try { localStorage.setItem(voteKey, v); } catch (e) { /* 存储不可用静默 */ }
        paintVote();
        Util.toast('感谢反馈', 'success');
      });
    });
    paintVote();

    Util.$('#btn-copy-link', box).addEventListener('click', function () {
      Util.copyText(link).then(function (ok) { done(ok, '链接已复制'); });
    });

    Util.$('#btn-copy-rich', box).addEventListener('click', function () {
      const text = article.title + '\n' + (article.summary || '') + '\n' + link;
      Util.copyText(text).then(function (ok) { done(ok, '已复制标题和链接'); });
    });

    Util.$('#btn-share-img', box).addEventListener('click', function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = '绘制中…';
      try {
        const url = Util.buildShareCard({
          siteName: (window.App && App.settings && App.settings.site_title) || 'AI 炼丹房',
          title: article.title,
          summary: article.summary,
          date: Util.formatDate(article.created_at),
          url: link
        });
        Util.$('#share-preview', box).innerHTML =
          '<img class="share-img" src="' + url + '" alt="分享图预览">' +
          '<div class="share-preview-actions">' +
          '<a class="btn btn-sm" download="danfang-' + article.id + '.png" href="' + url + '">下载图片</a>' +
          '<span class="form-hint">保存到本地后可直接发到群里 · 手机上长按图片也能保存</span>' +
          '</div>';
        Util.toast('分享图已生成', 'success');
      } catch (e) {
        Util.toast('生成分享图失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '生成分享图';
      }
    });
  }

  /* ---------------- 我的收藏（本地 localStorage） ---------------- */

  Views.bookmarks = async function (root) {
    Util.setLoading(root, '整理丹架中…');
    const favs = Util.Favorites.list();

    if (!favs.length) {
      root.innerHTML =
        '<h1 class="section-title">我的丹架</h1>' +
        '<div class="empty-box"><h2>丹架空空</h2>' +
        '<p>在文章页点「☆ 收藏本文」，喜欢的丹方就会收在这里。收藏仅保存在当前浏览器。</p>' +
        '<p style="margin-top:16px"><a class="btn btn-gold" href="#/">去逛逛丹房</a></p></div>';
      return;
    }

    root.innerHTML =
      '<h1 class="section-title">我的丹架</h1>' +
      '<p class="section-sub">共收藏 ' + favs.length + ' 篇 · 仅保存在当前浏览器，清除浏览数据会丢失</p>' +
      '<div class="bookmarks-bar"><button class="btn btn-sm" id="btn-clear-fav" type="button">清空丹架</button></div>' +
      '<div class="article-grid fav-grid" id="fav-grid"></div>';

    const grid = Util.$('#fav-grid', root);
    grid.innerHTML = favs.map(function (f) {
      const a = {
        id: f.id, title: f.title, summary: f.summary,
        cover: f.cover, tags: f.tags, views: f.views, created_at: f.savedAt || f.created_at
      };
      return '<div class="fav-cell">' + articleCard(a) +
        '<button class="fav-remove" type="button" data-id="' + f.id + '" title="从丹架取下" aria-label="取消收藏">✕</button></div>';
    }).join('');

    Util.$('#btn-clear-fav', root).addEventListener('click', function () {
      if (!window.confirm('确定清空全部收藏？此操作不可恢复。')) return;
      Util.Favorites.clear();
      if (window.App && App.updateFavBadge) App.updateFavBadge();
      Util.toast('丹架已清空', 'info');
      Views.bookmarks(root);
    });

    Util.$$('.fav-remove', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        Util.Favorites.remove(btn.getAttribute('data-id'));
        if (window.App && App.updateFavBadge) App.updateFavBadge();
        Util.toast('已从丹架取下', 'info');
        const cell = btn.closest('.fav-cell');
        if (cell) cell.remove();
        const left = Util.Favorites.count();
        /* 全部取完就切回空状态，别留一个空网格 */
        if (left === 0) { Views.bookmarks(root); return; }
        const sub = Util.$('.section-sub', root);
        if (sub) sub.textContent = '共收藏 ' + left + ' 篇 · 仅保存在当前浏览器，清除浏览数据会丢失';
      });
    });
  };

  /* ---------------- 标签 ---------------- */

  Views.tags = async function (root) {
    Util.setLoading(root);
    let tags;
    try {
      tags = await Api.listTags();
    } catch (err) {
      Util.setError(root, '标签加载失败', err.message || '');
      return;
    }
    if (!tags.length) {
      Util.setError(root, '尚无标签', '发布带标签的文章后会出现在这里。');
      return;
    }
    root.innerHTML =
      '<h1 class="section-title">丹方分类</h1>' +
      '<div class="card tags-cloud">' +
      tags.map(function (t) {
        return '<a class="tag-cloud-chip" href="#/tag/' + encodeURIComponent(t.name) + '">' +
          Util.escapeHtml(t.name) + '<span class="count">' + t.count + '</span></a>';
      }).join('') +
      '</div>';
  };

  Views.tag = async function (root, name) {
    Util.setLoading(root);
    let result;
    try {
      result = await Api.listArticles({ page: 1, pageSize: 100, tag: name });
    } catch (err) {
      Util.setError(root, '加载失败', err.message || '');
      return;
    }
    root.innerHTML =
      '<h1 class="section-title">标签 · ' + Util.escapeHtml(name) + '</h1>' +
      renderList(root, result.list);
  };

  /* ---------------- 关于 ---------------- */

  Views.about = async function (root) {
    let stats = { articles: 0, views: 0, tags: 0 };
    try { stats = await Api.siteStats(); } catch (e) { /* 统计失败不阻塞页面 */ }

    const s = (window.App && App.settings) || {};
    const DEFAULT_ABOUT =
      '古人炼丹，求的是延年益寿；今人「炼丹」，求的是模型通灵。\n\n' +
      '在大模型时代，每一个训练任务都像开炉炼丹：**数据是药材**，**算力是炉火**，**调参是火候**。火候到了，丹成；火候差了，炸炉。\n\n' +
      '「AI 炼丹房」记录一个炼丹学徒的日常：\n\n' +
      '- **炼丹笔记** —— 大模型训练、微调、推理部署的实践经验；\n' +
      '- **药方研究** —— Prompt 工程、Agent 搭建、RAG 调优的方法论；\n' +
      '- **炉具评测** —— 新模型、新框架、新工具的上手体验；\n' +
      '- **炸炉实录** —— 踩坑记录，以及爬出坑的过程。\n\n' +
      '丹成不必在我，火候自有记录。如果某篇笔记恰好帮你省下几个小时的 debug 时间，这炉丹，就算没白炼。';

    root.innerHTML =
      '<div class="card about-card">' +
      '<h1>关于 ' + Util.escapeHtml(s.site_title || 'AI 炼丹房') + '</h1>' +
      '<div class="article-body" id="about-content"></div>' +
      '<div class="about-stats">' +
      '<div class="stat-box"><div class="stat-num">' + stats.articles + '</div><div class="stat-label">已出丹药</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + stats.tags + '</div><div class="stat-label">丹方分类</div></div>' +
      '<div class="stat-box"><div class="stat-num">' + stats.views + '</div><div class="stat-label">炉火热度</div></div>' +
      '</div>' +
      '<p class="muted small">本站文章数据存储于云端数据库，图片与附件存储于云端对象存储，通过邮箱登录认证保护站长写作权限。</p>' +
      '</div>';

    renderMarkdown(Util.$('#about-content', root), (s.about_content || '').trim() || DEFAULT_ABOUT);
  };

  /* ---------------- 系列 ---------------- */

  Views.series = async function (root) {
    Util.setLoading(root);
    let series;
    try {
      series = await Api.listSeries();
    } catch (err) {
      Util.setError(root, '系列加载失败', err.message || '');
      return;
    }
    if (!series.length) {
      Util.setError(root, '尚无系列', '在管理后台创建系列后会出现在这里。');
      return;
    }
    root.innerHTML =
      '<h1 class="section-title">丹方系列</h1>' +
      '<p class="section-sub">按主题成体系的系列笔记，每个系列都是一条可以一路学下来的线。</p>' +
      '<div class="series-grid">' +
      series.map(function (s) {
        return '<a class="series-card" href="#/series/' + s.id + '">' +
          '<span class="series-icon">' + Util.escapeHtml(s.icon || '丹') + '</span>' +
          '<h2>' + Util.escapeHtml(s.name) + '</h2>' +
          '<p class="series-summary">' + Util.escapeHtml(s.summary || '') + '</p>' +
          '<div class="series-meta">' + (s.article_count || 0) + ' 篇' +
          (s.article_count ? '' : ' · 待补内容') + '</div>' +
          '</a>';
      }).join('') +
      '</div>';
  };

  Views.seriesDetail = async function (root, id) {
    Util.setLoading(root, '正在展开这一系列…');
    let series, list;
    try {
      const results = await Promise.all([Api.getSeries(id), Api.listSeriesArticles(id)]);
      series = results[0];
      list = results[1];
    } catch (err) {
      Util.setError(root, '系列加载失败', err.message || '');
      return;
    }
    if (!series) {
      Util.setError(root, '没有这个系列', '它可能已被删除或未发布。');
      return;
    }
    document.title = series.name + ' · 系列 · ' + (App.settings.site_title || 'AI 炼丹房');

    root.innerHTML =
      '<div class="card series-header">' +
      '<span class="series-icon lg">' + Util.escapeHtml(series.icon || '丹') + '</span>' +
      '<div class="series-header-body">' +
      '<h1>' + Util.escapeHtml(series.name) + '</h1>' +
      '<p>' + Util.escapeHtml(series.summary || '') + '</p>' +
      '<div class="series-meta">共 ' + list.length + ' 篇</div>' +
      '</div></div>' +
      (list.length
        ? '<ol class="series-toc">' +
          list.map(function (a, i) {
            return '<li class="series-item">' +
              '<span class="series-no">' + String(i + 1).padStart(2, '0') + '</span>' +
              '<div class="series-item-body">' +
              '<a class="series-item-title" href="#/article/' + a.id + '">' + Util.escapeHtml(a.title) + '</a>' +
              '<p class="series-item-summary">' + Util.escapeHtml(a.summary || '') + '</p>' +
              '<div class="series-item-meta">' + Util.formatDate(a.created_at) +
              ' · 阅读 ' + (a.views || 0) + '</div>' +
              '</div></li>';
          }).join('') +
          '</ol>'
        : '<div class="empty-box"><h2>这一炉还没开</h2><p>该系列还没有文章，后续会陆续补充。</p></div>') +
      '<div class="detail-actions"><a class="btn" href="#/series">全部系列</a>' +
      '<a class="btn" href="#/">返回丹房</a></div>';
  };

  /* ---------------- 404 ---------------- */

  Views.notFound = function (root) {
    Util.setError(root, '迷路了', '你访问的页面不存在，回丹房坐坐吧。');
  };

  window.Views = Views;
})();
