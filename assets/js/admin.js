/* 管理控制台：仪表盘 / 文章 / 附件与文件 / 标签 / 管理员 / 站点设置 / 编辑器 */
(function () {
  'use strict';

  const Admin = {};

  /* 路由守卫：必须登录 + 站长身份；返回 { session, isAdmin } */
  async function guard(root) {
    const session = await Util.getSession();
    if (!session) {
      sessionStorage.setItem('redirectAfterLogin', location.hash || '#/admin');
      location.hash = '#/login';
      return null;
    }
    const isAdmin = await Api.isAdmin();
    return { session: session, isAdmin: isAdmin };
  }

  /* ---------------- 控制台布局 ---------------- */

  const NAV_ITEMS = [
    ['dashboard', '#/admin', '仪表盘'],
    ['articles', '#/admin/articles', '文章'],
    ['series', '#/admin/series', '系列'],
    ['files', '#/admin/files', '附件与文件'],
    ['tags', '#/admin/tags', '标签'],
    ['comments', '#/admin/comments', '评论'],
    ['admins', '#/admin/admins', '管理员'],
    ['settings', '#/admin/settings', '站点设置'],
  ];

  function adminLayout(active, title, contentHtml) {
    const nav = NAV_ITEMS.map(function (item) {
      return '<a href="' + item[1] + '" class="' + (item[0] === active ? 'active' : '') + '">' + item[2] + '</a>';
    }).join('');
    return (
      '<div class="admin-nav">' + nav +
      '<a class="admin-nav-plain" href="#/">← 前台首页</a>' +
      '<a class="admin-nav-cta" href="#/admin/new">+ 写文章</a></div>' +
      '<div class="admin-head"><h1 class="section-title" style="margin-bottom:0">' + Util.escapeHtml(title) + '</h1></div>' +
      contentHtml
    );
  }

  /* ---------------- SEO 静态快照同步标记 ---------------- */

  /* 文章一旦增删改，静态快照页 /a/<id>/ 与 sitemap 就过期了。
   * 这里只负责「打标记」，真正的重新生成由本地脚本 + 定时同步完成。 */
  function markSeoDirty() {
    Api.updateSiteSetting('seo_dirty', new Date().toISOString()).catch(function () {
      /* 标记失败不影响文章本身，静默 */
    });
  }

  /* ---------------- 认领站长 ---------------- */

  function renderClaimBox(root, session) {
    Util.setLoading(root);
    Api.adminsCount().then(function (count) {
      const uidRow =
        '<div class="uid-row"><span class="muted small">我的用户 ID（可发给站长以添加为管理员）：</span>' +
        '<code class="uid-code">' + Util.escapeHtml(session.user.id) + '</code>' +
        '<button class="btn btn-sm" id="copy-uid" type="button">复制</button></div>';

      if (count === 0) {
        root.innerHTML =
          '<div class="card claim-box">' +
          '<h2>认领丹房</h2>' +
          '<p>本站当前还没有管理员。如果你就是本站主人，点击下方按钮将当前账号认领为首位站长；认领后可撰写文章、管理附件与站点设置，并能把其他注册用户加为管理员。</p>' +
          '<button class="btn btn-primary" id="claim-btn">认领为本站站长</button>' +
          '<p class="form-hint" id="claim-hint"></p>' + uidRow +
          '</div>';
        Util.$('#claim-btn', root).addEventListener('click', async function () {
          const btn = this;
          btn.disabled = true;
          try {
            const ok = await Api.claimAdmin();
            if (ok) {
              Util.toast('认领成功，丹房归你了', 'success');
              App.renderHeader();
              Admin.viewDashboard(root);
            } else {
              Util.$('#claim-hint', root).textContent = '认领失败：站长席位已被其他账号认领。';
              btn.disabled = false;
            }
          } catch (err) {
            Util.$('#claim-hint', root).textContent = err.message || '认领失败，请稍后重试';
            btn.disabled = false;
          }
        });
      } else {
        root.innerHTML =
          '<div class="card claim-box">' +
          '<h2>暂无管理权限</h2>' +
          '<p>本站已有 ' + count + ' 位管理员。当前账号不是管理员，只能浏览公开内容。<br>如果你是站点成员，可把你的用户 ID 发给任意一位管理员，请 TA 在「管理员」页将你添加为管理员。</p>' +
          uidRow +
          '<p style="margin-top:18px"><a class="btn" href="#/">回到首页</a></p>' +
          '</div>';
      }

      Util.$('#copy-uid', root).addEventListener('click', function () {
        const btn = this;
        const done = function () {
          btn.textContent = '已复制';
          setTimeout(function () { btn.textContent = '复制'; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(session.user.id).then(done, function () { fallbackCopy(session.user.id); done(); });
        } else {
          fallbackCopy(session.user.id);
          done();
        }
      });
    });
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    ta.remove();
  }

  /* 静态快照同步提示：内容改过但快照还没重生成时，在后台顶部提醒 */
  function seoSyncBanner(settings) {
    const dirty = settings && settings.seo_dirty;
    const synced = settings && settings.seo_synced_at;
    if (!dirty) return '';
    if (synced && String(dirty) <= String(synced)) return '';
    return '<div class="seo-sync-tip" id="seo-sync-tip">' +
      '<strong>静态快照待更新</strong>' +
      '<span>最近一次内容改动：' + Util.formatDate(dirty) + '。搜索引擎访问的 /a/&lt;id&gt;/ 静态页仍是旧版本，' +
      '定时任务会自动重新生成并发布；想立刻生效，让我手动跑一次同步即可。</span>' +
      '</div>';
  }

  /* ---------------- 仪表盘 ---------------- */

  Admin.viewDashboard = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    let articles = [], attachments = [], admins = [], comments = [], settings = {};
    try {
      const results = await Promise.all([
        Api.adminListArticles(),
        Api.adminListAttachments().catch(function () { return []; }),
        Api.listAdmins().catch(function () { return []; }),
        Api.adminListComments(500).catch(function () { return []; }),
        Api.getSiteSettings().catch(function () { return {}; }),
      ]);
      articles = results[0];
      attachments = results[1];
      admins = results[2];
      comments = results[3];
      settings = results[4] || {};
    } catch (err) {
      Util.setError(root, '仪表盘加载失败', err.message || '');
      return;
    }

    const published = articles.filter(function (a) { return a.status === 'published'; });
    const drafts = articles.filter(function (a) { return a.status !== 'published'; });
    const totalViews = articles.reduce(function (sum, a) { return sum + (Number(a.views) || 0); }, 0);
    const tagSet = {};
    articles.forEach(function (a) { (a.tags || []).forEach(function (t) { tagSet[t] = true; }); });
    const attachSize = attachments.reduce(function (sum, f) { return sum + (Number(f.size) || 0); }, 0);
    const topArticles = published.slice().sort(function (a, b) { return (b.views || 0) - (a.views || 0); }).slice(0, 5);
    const recent = articles.slice(0, 5);

    root.innerHTML = adminLayout('dashboard', '仪表盘',
      seoSyncBanner(settings) +
      '<div class="dash-grid">' +
      dashCard(published.length, '已发布文章') +
      dashCard(drafts.length, '草稿') +
      dashCard(totalViews, '总阅读量') +
      dashCard(Object.keys(tagSet).length, '标签') +
      dashCard(attachments.length + ' <span class="dash-sub">' + Util.formatSize(attachSize) + '</span>', '附件') +
      dashCard(comments.length, '留言') +
      dashCard(admins.length, '管理员') +
      '</div>' +
      '<div class="dash-cols">' +
      '<div class="card dash-panel"><h3>阅读排行 TOP 5</h3>' +
        (topArticles.length
          ? topArticles.map(function (a, i) {
              return '<div class="dash-row"><span class="dash-rank">' + (i + 1) + '</span>' +
                '<a class="dash-link" href="#/article/' + a.id + '">' + Util.escapeHtml(a.title) + '</a>' +
                '<span class="muted small">' + (a.views || 0) + ' 阅读</span></div>';
            }).join('')
          : '<p class="muted">还没有已发布文章</p>') +
      '</div>' +
      '<div class="card dash-panel"><h3>最近更新</h3>' +
        (recent.length
          ? recent.map(function (a) {
              const chip = a.status === 'published'
                ? '<span class="status-chip status-published">已发布</span>'
                : '<span class="status-chip status-draft">草稿</span>';
              return '<div class="dash-row">' + chip +
                '<a class="dash-link" href="#/admin/edit/' + a.id + '">' + Util.escapeHtml(a.title) + '</a>' +
                '<span class="muted small">' + Util.formatDate(a.updated_at) + '</span></div>';
            }).join('')
          : '<p class="muted">还没有文章</p>') +
      '</div></div>' +
      '<div class="dash-actions">' +
      '<a class="btn btn-primary" href="#/admin/new">新炼一炉</a>' +
      '<a class="btn" href="#/admin/articles">管理文章</a>' +
      '<a class="btn" href="#/admin/settings">站点设置</a>' +
      '</div>'
    );
  };

  function dashCard(num, label) {
    return '<div class="card dash-card"><div class="stat-num">' + num + '</div><div class="stat-label">' + label + '</div></div>';
  }

  /* ---------------- 系列管理 ---------------- */

  Admin.viewSeries = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    root.innerHTML = adminLayout('series', '系列管理',
      '<div class="card dash-panel">' +
      '<h3 id="sf-form-title">新建系列</h3>' +
      '<form id="series-form" class="series-form">' +
      '<input type="hidden" id="sf-id">' +
      '<div class="sf-grid">' +
      '<div class="form-field"><label class="form-label">系列名称</label>' +
      '<input class="input" id="sf-name" placeholder="如：本地大模型部署私有化" required></div>' +
      '<div class="form-field"><label class="form-label">图标（1 个汉字）</label>' +
      '<input class="input" id="sf-icon" placeholder="炉" maxlength="2"></div>' +
      '<div class="form-field"><label class="form-label">排序（越小越靠前）</label>' +
      '<input class="input" id="sf-order" type="number" value="0"></div>' +
      '<div class="form-field"><label class="form-label">英文标识（可选）</label>' +
      '<input class="input" id="sf-slug" placeholder="local-deploy"></div>' +
      '</div>' +
      '<div class="form-field"><label class="form-label">系列简介</label>' +
      '<textarea class="textarea" id="sf-summary" rows="2" placeholder="这个系列讲什么、学完能干什么…"></textarea></div>' +
      '<div class="sf-actions">' +
      '<button class="btn btn-primary" type="submit" id="sf-submit">创建系列</button>' +
      '<button class="btn hidden" type="button" id="sf-cancel">取消编辑</button>' +
      '</div></form></div>' +
      '<div class="card table-card" style="padding:6px 18px;margin-top:20px">' +
      '<table class="admin-table"><thead><tr>' +
      '<th>图标</th><th>名称</th><th class="col-hide-sm">简介</th><th>文章</th><th>排序</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody id="series-tbody"></tbody></table></div>' +
      '<p class="form-hint" style="margin-top:14px">删除系列不会删除文章，只会解除归属；文章可在编辑器里重新归入其他系列。</p>'
    );

    const tbody = Util.$('#series-tbody', root);
    const form = Util.$('#series-form', root);
    const formTitle = Util.$('#sf-form-title', root);
    const submitBtn = Util.$('#sf-submit', root);
    const cancelBtn = Util.$('#sf-cancel', root);
    const idEl = Util.$('#sf-id', root);

    async function render() {
      let series, articles;
      try {
        const res = await Promise.all([Api.adminListSeries(), Api.adminListArticles()]);
        series = res[0];
        articles = res[1];
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:26px">加载失败：' + Util.escapeHtml(err.message || '') + '</td></tr>';
        return;
      }
      const counts = {};
      articles.forEach(function (a) {
        if (a.series_id) counts[a.series_id] = (counts[a.series_id] || 0) + 1;
      });

      if (!series.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:26px">还没有系列，用上面的表单创建第一个吧。</td></tr>';
        return;
      }

      tbody.innerHTML = series.map(function (s) {
        return '<tr>' +
          '<td><span class="series-icon sm">' + Util.escapeHtml(s.icon || '丹') + '</span></td>' +
          '<td class="row-title">' + Util.escapeHtml(s.name) +
          '<div class="muted small">' + Util.escapeHtml(s.slug || '') + '</div></td>' +
          '<td class="col-hide-sm"><span class="cell-clamp">' + Util.escapeHtml(s.summary || '') + '</span></td>' +
          '<td>' + (counts[s.id] || 0) + ' 篇</td>' +
          '<td>' + (s.sort_order || 0) + '</td>' +
          '<td><span class="status-chip ' + (s.status === 'published' ? 'status-published' : 'status-draft') + '">' +
          (s.status === 'published' ? '显示' : '隐藏') + '</span></td>' +
          '<td><div class="row-actions">' +
          '<button class="btn btn-sm" data-edit="' + s.id + '">编辑</button>' +
          '<button class="btn btn-sm" data-toggle="' + s.id + '" data-status="' + Util.escapeHtml(s.status || '') + '">' +
          (s.status === 'published' ? '隐藏' : '显示') + '</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + s.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('');

      Util.$$('button[data-edit]', tbody).forEach(function (btn) {
        btn.addEventListener('click', function () {
          const s = series.find(function (x) { return String(x.id) === btn.getAttribute('data-edit'); });
          if (!s) return;
          idEl.value = s.id;
          Util.$('#sf-name', root).value = s.name || '';
          Util.$('#sf-icon', root).value = s.icon || '';
          Util.$('#sf-order', root).value = s.sort_order || 0;
          Util.$('#sf-slug', root).value = s.slug || '';
          Util.$('#sf-summary', root).value = s.summary || '';
          formTitle.textContent = '编辑系列：' + s.name;
          submitBtn.textContent = '保存修改';
          cancelBtn.classList.remove('hidden');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });

      Util.$$('button[data-toggle]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const id = Number(btn.getAttribute('data-toggle'));
          const cur = btn.getAttribute('data-status');
          btn.disabled = true;
          try {
            await Api.updateSeries(id, { status: cur === 'published' ? 'hidden' : 'published' });
            Util.toast(cur === 'published' ? '已隐藏该系列' : '已显示该系列', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '操作失败', 'error');
            btn.disabled = false;
          }
        });
      });

      Util.$$('button[data-del]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const id = Number(btn.getAttribute('data-del'));
          const s = series.find(function (x) { return x.id === id; });
          if (!window.confirm('删除系列「' + (s ? s.name : id) + '」？\n系列下的文章不会被删除，只会解除归属。')) return;
          btn.disabled = true;
          try {
            await Api.deleteSeries(id);
            Util.toast('系列已删除', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    function resetForm() {
      form.reset();
      idEl.value = '';
      formTitle.textContent = '新建系列';
      submitBtn.textContent = '创建系列';
      cancelBtn.classList.add('hidden');
    }

    cancelBtn.addEventListener('click', resetForm);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const name = Util.$('#sf-name', root).value.trim();
      if (!name) { Util.toast('请填写系列名称', 'error'); return; }
      const payload = {
        name: name,
        icon: Util.$('#sf-icon', root).value.trim(),
        sort_order: parseInt(Util.$('#sf-order', root).value, 10) || 0,
        slug: Util.$('#sf-slug', root).value.trim() || null,
        summary: Util.$('#sf-summary', root).value.trim(),
      };
      submitBtn.disabled = true;
      try {
        if (idEl.value) {
          await Api.updateSeries(Number(idEl.value), payload);
          Util.toast('系列已更新', 'success');
        } else {
          await Api.createSeries(payload);
          Util.toast('系列已创建', 'success');
        }
        resetForm();
        render();
      } catch (err) {
        Util.toast(err.message || '保存失败', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    await render();
  };

  /* ---------------- 文章管理 ---------------- */

  Admin.viewArticles = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    let list;
    let settings = {};
    try {
      const results = await Promise.all([
        Api.adminListArticles(),
        Api.getSiteSettings().catch(function () { return {}; }),
      ]);
      list = results[0];
      settings = results[1] || {};
    } catch (err) {
      Util.setError(root, '加载失败', err.message || '');
      return;
    }

    root.innerHTML = adminLayout('articles', '文章管理',
      seoSyncBanner(settings) +
      '<div class="search-bar"><input id="aq" class="input" type="search" placeholder="搜索标题 / 摘要…"></div>' +
      '<div class="card table-card" style="padding:6px 18px"><table class="admin-table"><thead><tr>' +
      '<th>标题</th><th>状态</th><th class="col-hide-sm">阅读</th><th class="col-hide-sm">更新时间</th><th>操作</th>' +
      '</tr></thead><tbody id="admin-tbody"></tbody></table></div>'
    );

    const tbody = Util.$('#admin-tbody', root);

    function rowHtml(a) {
      const chip = a.status === 'published'
        ? '<span class="status-chip status-published">已发布</span>'
        : '<span class="status-chip status-draft">草稿</span>';
      const toggle = a.status === 'published'
        ? '<button class="btn btn-sm" data-toggle="' + a.id + '" data-to="draft">下线</button>'
        : '<button class="btn btn-sm" data-toggle="' + a.id + '" data-to="published">发布</button>';
      return (
        '<tr>' +
        '<td class="row-title">' + Util.escapeHtml(a.title) + '</td>' +
        '<td>' + chip + '</td>' +
        '<td class="col-hide-sm">' + (a.views || 0) + '</td>' +
        '<td class="col-hide-sm">' + Util.formatDate(a.updated_at) + '</td>' +
        '<td><span class="row-actions">' + toggle +
        '<a class="btn btn-sm" href="#/article/' + a.id + '">查看</a>' +
        '<a class="btn btn-sm" href="#/admin/edit/' + a.id + '">编辑</a>' +
        '<button class="btn btn-sm btn-danger" data-del="' + a.id + '">删除</button>' +
        '</span></td></tr>'
      );
    }

    function renderRows(filter) {
      const kw = (filter || '').toLowerCase();
      const filtered = kw
        ? list.filter(function (a) {
            return (a.title || '').toLowerCase().indexOf(kw) >= 0 || (a.summary || '').toLowerCase().indexOf(kw) >= 0;
          })
        : list;
      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:30px">' +
          (kw ? '没有匹配的文章' : '还没有文章，点击右上角「+ 写文章」开写。') + '</td></tr>';
        return;
      }
      tbody.innerHTML = filtered.map(rowHtml).join('');
      bindRowActions();
    }

    /* 增删改后刷新顶部提示条：已同步则移除，未同步则显示 */
    async function refreshSeoSyncTip() {
      const el = Util.$('#seo-sync-tip', root);
      if (!el) return;
      const s = await Api.getSiteSettings().catch(function () { return {}; });
      if (!s || !s.seo_dirty || (s.seo_synced_at && String(s.seo_dirty) <= String(s.seo_synced_at))) {
        el.remove();
      }
    }

    function bindRowActions() {
      Util.$$('button[data-del]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          if (!window.confirm('确定删除这篇文章吗？删除后不可恢复（附件记录会一并删除）。')) return;
          btn.disabled = true;
          try {
            await Api.deleteArticle(btn.getAttribute('data-del'));
            markSeoDirty();
            Util.toast('文章已删除', 'success');
            list = await Api.adminListArticles();
            renderRows(Util.$('#aq', root).value.trim());
            refreshSeoSyncTip();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
      Util.$$('button[data-toggle]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const to = btn.getAttribute('data-to');
          btn.disabled = true;
          try {
            await Api.updateArticleStatus(Number(btn.getAttribute('data-toggle')), to);
            markSeoDirty();
            Util.toast(to === 'published' ? '已发布上线' : '已下线为草稿', 'success');
            list = await Api.adminListArticles();
            renderRows(Util.$('#aq', root).value.trim());
            refreshSeoSyncTip();
          } catch (err) {
            Util.toast(err.message || '操作失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    Util.$('#aq', root).addEventListener('input', Util.debounce(function () {
      renderRows(this.value.trim());
    }, 250));

    renderRows('');
  };

  /* ---------------- 附件与云端文件 ---------------- */

  Admin.viewFiles = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    root.innerHTML = adminLayout('files', '附件与云端文件', '<div id="files-body"></div>');
    const body = Util.$('#files-body', root);

    let attachFiles = [];
    let storageFiles = [];

    function attachmentsHtml() {
      if (!attachFiles.length) {
        return '<div class="card dash-panel"><h3>文章附件</h3><p class="muted">还没有附件。在文章编辑器里可上传附件（读者登录后可下载）。</p></div>';
      }
      return '<div class="card dash-panel table-card"><h3>文章附件（' + attachFiles.length + '）</h3>' +
        '<table class="admin-table"><thead><tr><th>文件名</th><th>所属文章</th><th class="col-hide-sm">大小</th><th class="col-hide-sm">上传时间</th><th>操作</th></tr></thead><tbody>' +
        attachFiles.map(function (f, i) {
          return '<tr><td class="row-title">' + Util.escapeHtml(f.name) + '</td>' +
            '<td><a href="#/admin/edit/' + f.article_id + '">' + Util.escapeHtml(f._articleTitle || ('#' + f.article_id)) + '</a></td>' +
            '<td class="col-hide-sm">' + Util.formatSize(f.size) + '</td>' +
            '<td class="col-hide-sm">' + Util.formatDate(f.created_at) + '</td>' +
            '<td><span class="row-actions">' +
            '<button class="btn btn-sm" data-dl="' + i + '">下载</button>' +
            '<button class="btn btn-sm btn-danger" data-adel="' + i + '">删除</button>' +
            '</span></td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    function storageHtml() {
      if (!storageFiles.length) {
        return '<div class="card dash-panel" style="margin-top:20px"><h3>云端文件（我的上传）</h3><p class="muted">还没有上传过文件。编辑器里上传的图片与附件都会存入云端存储。</p></div>';
      }
      return '<div class="card dash-panel table-card" style="margin-top:20px"><h3>云端文件（我的上传 · ' + storageFiles.length + '）</h3>' +
        '<p class="form-hint">图片素材已压缩内嵌进文章，删除此处的素材文件不影响已发布文章的显示；删除附件文件会使对应附件无法下载。</p>' +
        '<table class="admin-table"><thead><tr><th>文件名</th><th>类型</th><th class="col-hide-sm">大小</th><th class="col-hide-sm">上传时间</th><th>操作</th></tr></thead><tbody>' +
        storageFiles.map(function (f, i) {
          return '<tr><td class="row-title" title="' + Util.escapeHtml(f.path) + '">' + Util.escapeHtml(f.name) + '</td>' +
            '<td>' + f.kind + '</td>' +
            '<td class="col-hide-sm">' + Util.formatSize(f.size) + '</td>' +
            '<td class="col-hide-sm">' + Util.formatDate(f.created_at) + '</td>' +
            '<td><button class="btn btn-sm btn-danger" data-fdel="' + i + '">删除</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    function bindActions() {
      Util.$$('button[data-dl]', body).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const f = attachFiles[Number(btn.getAttribute('data-dl'))];
          btn.disabled = true;
          try {
            const url = await Api.downloadAttachment(f.path);
            window.open(url, '_blank', 'noopener');
          } catch (err) {
            Util.toast(err.message || '获取下载链接失败', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
      Util.$$('button[data-adel]', body).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const f = attachFiles[Number(btn.getAttribute('data-adel'))];
          if (!window.confirm('删除附件「' + f.name + '」？云端文件会一并删除，读者将无法下载。')) return;
          btn.disabled = true;
          try {
            await Api.deleteAttachment(f.id, f.path);
            Util.toast('附件已删除', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
      Util.$$('button[data-fdel]', body).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const f = storageFiles[Number(btn.getAttribute('data-fdel'))];
          if (!window.confirm('删除云端文件「' + f.name + '」？此操作不可恢复。')) return;
          btn.disabled = true;
          try {
            await Api.deleteStorageFiles([f.path]);
            Util.toast('文件已删除', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    async function render() {
      Util.setLoading(body);
      try {
        const results = await Promise.all([
          Api.adminListAttachments(),
          Api.adminListArticles(),
          Api.listStorageFiles(ctx.session.user.id),
        ]);
        attachFiles = results[0];
        const titleMap = {};
        results[1].forEach(function (a) { titleMap[a.id] = a.title; });
        attachFiles.forEach(function (f) { f._articleTitle = titleMap[f.article_id]; });
        storageFiles = results[2];
        body.innerHTML = attachmentsHtml() + storageHtml();
        bindActions();
      } catch (err) {
        Util.setError(body, '加载失败', err.message || '');
      }
    }

    await render();
  };

  /* ---------------- 标签管理 ---------------- */

  Admin.viewTags = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    root.innerHTML = adminLayout('tags', '标签管理',
      '<p class="form-hint" style="margin-bottom:16px">对标签改名或删除会批量作用于所有文章（含草稿），操作立即生效。</p>' +
      '<div class="card table-card" style="padding:6px 18px"><table class="admin-table"><thead><tr>' +
      '<th>标签</th><th>文章数</th><th>操作</th></tr></thead><tbody id="tags-tbody"></tbody></table></div>'
    );
    const tbody = Util.$('#tags-tbody', root);

    async function render() {
      tbody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:26px">统计中…</td></tr>';
      let tags;
      try {
        const articles = await Api.adminListArticles();
        const counter = {};
        articles.forEach(function (a) {
          (a.tags || []).forEach(function (t) { counter[t] = (counter[t] || 0) + 1; });
        });
        tags = Object.keys(counter)
          .map(function (name) { return { name: name, count: counter[name] }; })
          .sort(function (a, b) { return b.count - a.count; });
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:26px">加载失败：' + Util.escapeHtml(err.message || '') + '</td></tr>';
        return;
      }
      if (!tags.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted" style="text-align:center;padding:26px">还没有标签</td></tr>';
        return;
      }
      tbody.innerHTML = tags.map(function (t, i) {
        return '<tr><td><a class="tag-chip" href="#/tag/' + encodeURIComponent(t.name) + '">' + Util.escapeHtml(t.name) + '</a></td>' +
          '<td>' + t.count + ' 篇</td>' +
          '<td><span class="row-actions">' +
          '<button class="btn btn-sm" data-ren="' + i + '">改名</button>' +
          '<button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button>' +
          '</span></td></tr>';
      }).join('');

      Util.$$('button[data-ren]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const t = tags[Number(btn.getAttribute('data-ren'))];
          const input = window.prompt('把标签「' + t.name + '」改名为：', t.name);
          if (input == null) return;
          const newName = input.trim();
          if (!newName || newName === t.name) return;
          btn.disabled = true;
          try {
            const affected = await Api.renameTag(t.name, newName);
            markSeoDirty();
            Util.toast('已改名，影响 ' + affected + ' 篇文章', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '改名失败', 'error');
            btn.disabled = false;
          }
        });
      });

      Util.$$('button[data-del]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const t = tags[Number(btn.getAttribute('data-del'))];
          if (!window.confirm('从所有文章中移除标签「' + t.name + '」（' + t.count + ' 篇受影响）？')) return;
          btn.disabled = true;
          try {
            const affected = await Api.deleteTag(t.name);
            markSeoDirty();
            Util.toast('已移除，影响 ' + affected + ' 篇文章', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    await render();
  };

  /* ---------------- 评论管理 ---------------- */

  Admin.viewComments = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    root.innerHTML = adminLayout('comments', '评论管理',
      '<p class="form-hint" style="margin-bottom:16px">先发后审：留言即时可见，遇到灌水或不当内容在这里删除。删除后原作者也无法再看到。</p>' +
      '<div class="card table-card" style="padding:6px 18px"><table class="admin-table"><thead><tr>' +
      '<th style="width:150px">留言者</th><th>内容</th><th style="width:230px">文章</th>' +
      '<th style="width:110px">时间</th><th style="width:80px">操作</th>' +
      '</tr></thead><tbody id="comments-tbody"></tbody></table></div>'
    );
    const tbody = Util.$('#comments-tbody', root);
    let rows = [];
    let titleMap = {};

    async function render() {
      tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">加载中…</td></tr>';
      try {
        const results = await Promise.all([
          Api.adminListComments(200),
          Api.adminListArticles().catch(function () { return []; }),
        ]);
        rows = results[0];
        titleMap = {};
        results[1].forEach(function (a) { titleMap[a.id] = a.title; });
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">加载失败：' + Util.escapeHtml(err.message || '') + '</td></tr>';
        return;
      }
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">还没有留言</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function (c, i) {
        const who = c.nickname || (c.user_email ? c.user_email.split('@')[0] : '道友');
        const title = titleMap[c.article_id] || ('#' + c.article_id);
        return '<tr>' +
          '<td><div class="comment-cell-who">' + Util.escapeHtml(who) + '</div>' +
          '<div class="muted small">' + Util.escapeHtml(c.user_email || '') + '</div></td>' +
          '<td><div class="comment-cell-text">' + Util.escapeHtml(c.content) + '</div>' +
          (c.parent_id ? '<span class="status-chip status-draft">回复</span>' : '') + '</td>' +
          '<td><a class="dash-link" href="#/article/' + c.article_id + '">' + Util.escapeHtml(title) + '</a></td>' +
          '<td class="muted small">' + Util.formatDate(c.created_at) + '</td>' +
          '<td><button class="btn btn-sm btn-danger" data-del="' + i + '">删除</button></td>' +
          '</tr>';
      }).join('');

      Util.$$('button[data-del]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const c = rows[Number(btn.getAttribute('data-del'))];
          if (!c) return;
          if (!confirm('删除这条留言？\n\n' + c.content.slice(0, 60))) return;
          btn.disabled = true;
          try {
            await Api.deleteComment(c.id);
            Util.toast('已删除', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '删除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    await render();
  };

  /* ---------------- 管理员管理 ---------------- */

  Admin.viewAdmins = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    const myUid = ctx.session.user.id;

    root.innerHTML = adminLayout('admins', '管理员帐号',
      '<div class="card dash-panel">' +
      '<h3>我的用户 ID</h3>' +
      '<div class="uid-row"><code class="uid-code">' + Util.escapeHtml(myUid) + '</code>' +
      '<button class="btn btn-sm" id="copy-uid" type="button">复制</button></div>' +
      '<p class="form-hint">把其他注册用户的 ID 添加进来，TA 就能管理本站。新成员需先在登录页注册，并把自己的用户 ID 发给你。</p>' +
      '</div>' +
      '<div class="card dash-panel" style="margin-top:20px">' +
      '<h3>添加管理员</h3>' +
      '<form id="add-admin-form" class="add-admin-form">' +
      '<input class="input" id="na-uid" placeholder="对方用户 ID（TA 登录后在任意管理页可见）" required>' +
      '<input class="input" id="na-note" placeholder="备注（可选），如：小炉工">' +
      '<button class="btn btn-primary" type="submit">添加</button>' +
      '</form><div id="aa-msg" class="hidden" style="margin-top:12px"></div>' +
      '</div>' +
      '<div class="card table-card" style="padding:6px 18px;margin-top:20px"><table class="admin-table"><thead><tr>' +
      '<th>用户 ID</th><th>角色</th><th>备注</th><th class="col-hide-sm">加入时间</th><th>操作</th>' +
      '</tr></thead><tbody id="admins-tbody"></tbody></table></div>'
    );

    const tbody = Util.$('#admins-tbody', root);
    const msgEl = Util.$('#aa-msg', root);

    Util.$('#copy-uid', root).addEventListener('click', function () {
      const btn = this;
      const done = function () {
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = '复制'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(myUid).then(done, function () { fallbackCopy(myUid); done(); });
      } else {
        fallbackCopy(myUid);
        done();
      }
    });

    async function render() {
      let admins;
      try {
        admins = await Api.listAdmins();
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">加载失败：' + Util.escapeHtml(err.message || '') + '</td></tr>';
        return;
      }
      tbody.innerHTML = admins.map(function (a) {
        const isMe = a.uid === myUid;
        const isOwner = a.role === 'owner';
        const roleChip = isOwner
          ? '<span class="status-chip status-owner">超级管理员</span>'
          : '<span class="status-chip status-admin">管理员</span>';
        let action;
        if (isMe) {
          action = '<span class="muted small">当前账号</span>';
        } else if (isOwner) {
          action = '<span class="muted small">不可移除</span>';
        } else {
          action = '<button class="btn btn-sm btn-danger" data-rm="' + Util.escapeHtml(a.uid) + '">移除</button>';
        }
        return '<tr><td class="row-title"><code class="uid-code">' + Util.escapeHtml(a.uid) + '</code>' +
          (isMe ? ' <span class="status-chip status-published">我</span>' : '') + '</td>' +
          '<td>' + roleChip + '</td>' +
          '<td>' + (a.note ? Util.escapeHtml(a.note) : '<span class="muted">—</span>') + '</td>' +
          '<td class="col-hide-sm">' + Util.formatDate(a.created_at) + '</td>' +
          '<td>' + action + '</td></tr>';
      }).join('');

      Util.$$('button[data-rm]', tbody).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const uid = btn.getAttribute('data-rm');
          if (!window.confirm('移除该管理员？TA 将立即失去所有管理权限（文章与数据不受影响）。')) return;
          btn.disabled = true;
          try {
            await Api.removeAdmin(uid);
            Util.toast('已移除该管理员', 'success');
            render();
          } catch (err) {
            Util.toast(err.message || '移除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    Util.$('#add-admin-form', root).addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const uid = Util.$('#na-uid', root).value.trim();
      const note = Util.$('#na-note', root).value.trim();
      const btn = Util.$('button[type="submit"]', this);
      btn.disabled = true;
      msgEl.classList.add('hidden');
      try {
        await Api.addAdmin(uid, note);
        Util.toast('已添加为管理员', 'success');
        Util.$('#na-uid', root).value = '';
        Util.$('#na-note', root).value = '';
        render();
      } catch (err) {
        msgEl.className = 'form-error';
        msgEl.textContent = err.message || '添加失败';
        msgEl.classList.remove('hidden');
      } finally {
        btn.disabled = false;
      }
    });

    await render();
  };

  /* ---------------- 站点设置 ---------------- */

  Admin.viewSettings = async function (root) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    let settings = {};
    try {
      settings = await Api.getSiteSettings();
    } catch (err) {
      Util.setError(root, '加载设置失败', err.message || '');
      return;
    }

    root.innerHTML = adminLayout('settings', '站点设置',
      '<div class="card dash-panel">' +
      '<div class="form-field"><label class="form-label">博客名称</label>' +
      '<input class="input" id="st-title" value="' + Util.escapeHtml(settings.site_title || '') + '" placeholder="AI 炼丹房"></div>' +
      '<div class="form-field"><label class="form-label">口号（首页副标题）</label>' +
      '<input class="input" id="st-slogan" value="' + Util.escapeHtml(settings.site_slogan || '') + '" placeholder="数据是药材 · 算力是炉火 · 调参是火候"></div>' +
      '<div class="form-field"><label class="form-label">页脚签名</label>' +
      '<input class="input" id="st-footer" value="' + Util.escapeHtml(settings.footer_note || '') + '" placeholder="丹成不必在我，火候自有记录"></div>' +
      '<div class="form-field"><label class="form-label">关于页内容（Markdown）</label>' +
      '<textarea class="textarea mono" id="st-about" rows="12">' + Util.escapeHtml(settings.about_content || '') + '</textarea>' +
      '<p class="form-hint">支持 Markdown，保存后「关于」页立即使用新内容。</p>' +
      '<button class="btn btn-sm" type="button" id="about-preview-btn">预览关于页内容</button></div>' +
      '<div class="editor-preview article-body hidden" id="about-preview" style="min-height:0;border:1px solid var(--line);border-radius:8px;margin-bottom:18px"></div>' +
      '<button class="btn btn-primary" id="settings-save">保存全部设置</button>' +
      '</div>'
    );

    Util.$('#about-preview-btn', root).addEventListener('click', function () {
      const preview = Util.$('#about-preview', root);
      if (!preview.classList.contains('hidden')) {
        preview.classList.add('hidden');
        this.textContent = '预览关于页内容';
        return;
      }
      renderMarkdown(preview, Util.$('#st-about', root).value);
      preview.classList.remove('hidden');
      this.textContent = '收起预览';
    });

    Util.$('#settings-save', root).addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        const pairs = [
          ['site_title', Util.$('#st-title', root).value.trim()],
          ['site_slogan', Util.$('#st-slogan', root).value.trim()],
          ['footer_note', Util.$('#st-footer', root).value.trim()],
          ['about_content', Util.$('#st-about', root).value],
        ];
        for (const p of pairs) {
          await Api.updateSiteSetting(p[0], p[1]);
        }
        Util.toast('设置已保存', 'success');
        App.loadSettings();
      } catch (err) {
        Util.toast(err.message || '保存失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '保存全部设置';
      }
    });
  };

  /* ---------------- 编辑器 ---------------- */

  Admin.viewEditor = async function (root, id) {
    Util.setLoading(root);
    const ctx = await guard(root);
    if (!ctx) return;
    if (!ctx.isAdmin) { renderClaimBox(root, ctx.session); return; }

    let article = null;
    if (id) {
      try {
        article = await Api.getArticle(id);
      } catch (err) {
        Util.setError(root, '加载文章失败', err.message || '');
        return;
      }
      if (!article) { Util.setError(root, '文章不存在', '它可能已被删除。'); return; }
    }

    let seriesList = [];
    try { seriesList = await Api.adminListSeries(); } catch (e) { /* 系列加载失败不阻塞编辑 */ }
    const seriesOptions = seriesList.map(function (s) {
      return '<option value="' + s.id + '"' + (article && article.series_id === s.id ? ' selected' : '') + '>' +
        Util.escapeHtml((s.icon ? s.icon + ' ' : '') + s.name) + '</option>';
    }).join('');

    root.innerHTML =
      '<div class="admin-nav">' +
      NAV_ITEMS.map(function (item) { return '<a href="' + item[1] + '">' + item[2] + '</a>'; }).join('') +
      '<a class="admin-nav-plain" href="#/">← 前台首页</a>' +
      '<a class="admin-nav-cta" href="#/admin/new">+ 写文章</a></div>' +
      '<div class="admin-head"><h1 class="section-title" style="margin-bottom:0">' + (article ? '回炉重炼' : '新炼一炉') + '</h1></div>' +
      '<div class="editor-layout">' +
      '<div class="form-field"><label class="form-label">标题</label>' +
      '<input class="input" id="ed-title" placeholder="给这炉丹起个名字…" value="' + Util.escapeHtml(article ? article.title : '') + '"></div>' +
      '<div class="form-field"><label class="form-label">摘要</label>' +
      '<textarea class="textarea" id="ed-summary" rows="2" placeholder="一两句话概括这篇笔记，会显示在文章列表。">' + Util.escapeHtml(article ? article.summary : '') + '</textarea></div>' +
      '<div class="form-field"><label class="form-label">标签（用逗号分隔）</label>' +
      '<input class="input" id="ed-tags" placeholder="如：大模型, 教程, Prompt工程" value="' + Util.escapeHtml(article ? (article.tags || []).join(', ') : '') + '"></div>' +
      '<div class="editor-row">' +
      '<div class="form-field"><label class="form-label">所属系列</label>' +
      '<select class="select" id="ed-series">' +
      '<option value="">（不归入系列）</option>' +
      seriesOptions +
      '</select>' +
      (seriesList.length ? '' : '<p class="form-hint">还没有系列，可到「系列」页创建。</p>') +
      '</div>' +
      '<div class="form-field"><label class="form-label">系列内序号</label>' +
      '<input class="input" id="ed-series-order" type="number" min="0" step="1" value="' + (article && article.series_order ? article.series_order : 0) + '">' +
      '<p class="form-hint">数字越小越靠前，决定该系列里的阅读顺序。</p>' +
      '</div></div>' +
      '<div class="form-field"><label class="form-label">封面图</label>' +
      '<div class="cover-picker">' +
      '<div class="cover-preview" id="cover-preview">' + (article && article.cover ? '<img src="' + article.cover + '" alt="封面预览">' : '暂无封面') + '</div>' +
      '<div><button class="btn" type="button" id="cover-btn">上传封面</button>' +
      '<p class="form-hint">图片会压缩后上传云端存储，并随文章公开发布。建议横版图片。</p></div>' +
      '</div></div>' +
      '<div class="form-field"><label class="form-label">正文（Markdown）</label>' +
      '<div class="editor-toolbar">' +
      '<button class="btn btn-sm" type="button" id="img-btn">插入图片</button>' +
      '<button class="btn btn-sm" type="button" id="preview-btn">预览</button>' +
      '<span class="form-hint" style="align-self:center">支持 Markdown 语法：标题、列表、代码块、表格、引用…</span>' +
      '</div>' +
      '<div class="editor-content-wrap">' +
      '<textarea class="textarea mono editor-content" id="ed-content" placeholder="起火，下药材……">' + Util.escapeHtml(article ? article.content : '') + '</textarea>' +
      '<div class="editor-preview article-body hidden" id="ed-preview"></div>' +
      '</div></div>' +
      '<div class="form-field" id="attach-field"><label class="form-label">附件（存放云端存储，读者登录后可下载）</label>' +
      '<div id="attach-list"></div>' +
      '<div><button class="btn" type="button" id="attach-btn" ' + (article ? '' : 'disabled') + '>上传附件</button>' +
      (article ? '' : '<span class="form-hint"> 保存文章后可上传附件</span>') + '</div></div>' +
      '<div class="editor-footer">' +
      '<label class="form-label" style="margin:0">状态</label>' +
      '<select class="select" id="ed-status" style="width:auto">' +
      '<option value="draft"' + (article && article.status !== 'published' ? ' selected' : '') + '>草稿（仅管理员可见）</option>' +
      '<option value="published"' + (article && article.status === 'published' ? ' selected' : (!article ? ' selected' : '')) + '>发布（公开可见）</option>' +
      '</select>' +
      '<span class="spacer"></span>' +
      '<a class="btn" href="#/admin/articles">返回文章管理</a>' +
      '<button class="btn btn-primary" type="button" id="save-btn">' + (article ? '保存修改' : '出炉') + '</button>' +
      '</div></div>';

    const state = {
      id: article ? article.id : null,
      cover: article ? article.cover : '',
      attachments: [],
    };

    const contentEl = Util.$('#ed-content', root);
    const previewEl = Util.$('#ed-preview', root);

    /* 预览切换 */
    Util.$('#preview-btn', root).addEventListener('click', function () {
      const showing = !previewEl.classList.contains('hidden');
      if (showing) {
        previewEl.classList.add('hidden');
        contentEl.classList.remove('hidden');
        this.textContent = '预览';
      } else {
        renderMarkdown(previewEl, contentEl.value);
        previewEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
        this.textContent = '继续编辑';
      }
    });

    /* 封面上传 */
    Util.$('#cover-btn', root).addEventListener('click', async function () {
      const file = await Util.pickFile('image/*');
      if (!file) return;
      const btn = this;
      btn.disabled = true;
      btn.textContent = '处理中…';
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
        const compressed = await Util.compressImage(file, 1200, 0.8);
        await Api.uploadImage(ctx.session.user.id, compressed.blob);
        state.cover = compressed.dataUrl;
        Util.$('#cover-preview', root).innerHTML = '<img src="' + state.cover + '" alt="封面预览">';
        Util.toast('封面已就绪', 'success');
      } catch (err) {
        Util.toast(err.message || '封面上传失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '上传封面';
      }
    });

    /* 正文插图：压缩 → 传云端存储 → 在光标处插入 data URI */
    Util.$('#img-btn', root).addEventListener('click', async function () {
      const file = await Util.pickFile('image/*');
      if (!file) return;
      const btn = this;
      btn.disabled = true;
      btn.textContent = '上传中…';
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('图片不能超过 10MB');
        const compressed = await Util.compressImage(file, 1400, 0.82);
        await Api.uploadImage(ctx.session.user.id, compressed.blob);
        const alt = (file.name || 'image').replace(/\.[a-zA-Z0-9]+$/, '');
        insertAtCursor(contentEl, '\n![' + alt + '](' + compressed.dataUrl + ')\n');
        Util.toast('图片已插入正文', 'success');
      } catch (err) {
        Util.toast(err.message || '图片上传失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '插入图片';
      }
    });

    /* 附件 */
    async function refreshAttachments() {
      if (!state.id) return;
      const listEl = Util.$('#attach-list', root);
      try {
        state.attachments = await Api.listAttachments(state.id);
      } catch (err) {
        listEl.innerHTML = '<p class="form-hint">附件加载失败：' + Util.escapeHtml(err.message || '') + '</p>';
        return;
      }
      if (!state.attachments.length) {
        listEl.innerHTML = '<p class="form-hint">暂无附件</p>';
        return;
      }
      listEl.innerHTML = state.attachments.map(function (f, i) {
        return (
          '<div class="admin-attach-row">' +
          '<span class="name">' + Util.escapeHtml(f.name) + '</span>' +
          '<span class="muted small">' + Util.formatSize(f.size) + '</span>' +
          '<button class="btn btn-sm btn-danger" type="button" data-adel="' + i + '">移除</button>' +
          '</div>'
        );
      }).join('');
      Util.$$('button[data-adel]', listEl).forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const f = state.attachments[Number(btn.getAttribute('data-adel'))];
          if (!window.confirm('移除附件「' + f.name + '」？云端文件会一并删除。')) return;
          btn.disabled = true;
          try {
            await Api.deleteAttachment(f.id, f.path);
            Util.toast('附件已移除', 'success');
            refreshAttachments();
          } catch (err) {
            Util.toast(err.message || '移除失败', 'error');
            btn.disabled = false;
          }
        });
      });
    }

    Util.$('#attach-btn', root).addEventListener('click', async function () {
      if (!state.id) { Util.toast('请先保存文章', 'info'); return; }
      const file = await Util.pickFile();
      if (!file) return;
      const btn = this;
      btn.disabled = true;
      btn.textContent = '上传中…';
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50MB');
        const path = await Api.uploadFile(ctx.session.user.id, file);
        await Api.addAttachment(state.id, file.name || '附件', path, file.size || 0);
        Util.toast('附件已上传', 'success');
        refreshAttachments();
      } catch (err) {
        Util.toast(err.message || '附件上传失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '上传附件';
      }
    });

    if (state.id) refreshAttachments();

    /* 保存 */
    Util.$('#save-btn', root).addEventListener('click', async function () {
      const title = Util.$('#ed-title', root).value.trim();
      const summary = Util.$('#ed-summary', root).value.trim();
      const tags = Util.$('#ed-tags', root).value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
      const content = contentEl.value;
      const status = Util.$('#ed-status', root).value;
      const seriesSel = Util.$('#ed-series', root);
      const seriesId = seriesSel ? seriesSel.value : '';
      const seriesOrderEl = Util.$('#ed-series-order', root);
      const seriesOrder = seriesOrderEl ? (parseInt(seriesOrderEl.value, 10) || 0) : 0;

      if (!title) { Util.toast('请先给文章起个标题', 'error'); return; }
      if (!content.trim()) { Util.toast('正文还是空的，先下点药材吧', 'error'); return; }

      const btn = this;
      btn.disabled = true;
      btn.textContent = '保存中…';
      try {
        const payload = { title: title, summary: summary, content: content, cover: state.cover, tags: tags, status: status };
        payload.series_id = seriesId ? Number(seriesId) : null;
        payload.series_order = seriesOrder;
        if (state.id) {
          await Api.updateArticle(state.id, payload);
          markSeoDirty();
          Util.toast('已保存', 'success');
        } else {
          const created = await Api.createArticle(payload);
          state.id = created.id;
          markSeoDirty();
          Util.toast('文章已出炉', 'success');
          location.hash = '#/admin/edit/' + created.id;
          return;
        }
      } catch (err) {
        Util.toast(err.message || '保存失败', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = state.id ? '保存修改' : '出炉';
      }
    });
  };

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
    const end = textarea.selectionEnd != null ? textarea.selectionEnd : start;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    const pos = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(pos, pos);
  }

  window.Admin = Admin;
})();
