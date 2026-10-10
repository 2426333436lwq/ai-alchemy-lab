/* 应用入口：路由、页头、会话状态 */
(function () {
  'use strict';

  const App = {};
  let adminFlag = false; // 缓存站长身份，控制导航可见性
  let ownerFlag = false; // 是否超级管理员（站点所有者）
  let lastRouteKey = null; // 上一次路由，用于判断是否需要把滚动位置归零

  App.isOwner = function () { return !!ownerFlag; };

  /* ---------------- 站点设置（标题 / 副标语 / 页脚 / 关于页） ---------------- */

  App.settings = { site_title: '', site_slogan: '', footer_note: '', about_content: '' };

  App.applySettings = function () {
    const s = App.settings;
    const title = s.site_title || 'AI 炼丹房';
    document.title = title;
    Util.$$('.brand-text').forEach(function (el) { el.textContent = title; });
    const footerBrand = Util.$('#footer-brand');
    if (footerBrand) footerBrand.textContent = title;
    const footerNote = Util.$('#footer-note');
    if (footerNote && s.footer_note) footerNote.textContent = s.footer_note;
  };

  /* 静态托管下也照样读 data/site.json（原来只在有云 SDK 时才读） */
  App.loadSettings = async function () {
    try {
      App.settings = await Api.getSiteSettings();
    } catch (e) { /* 读取失败用默认值 */ }
    App.applySettings();
  };

  function mainEl() { return Util.$('#app'); }

  /* ---------------- 路由 ---------------- */

  function parseHash() {
    let hash = location.hash || '#/';
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    if (hash.charAt(0) !== '/') hash = '/' + hash;
    const parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    return parts;
  }

  /* 路由必须串行：hashchange 连点时两个视图会并发渲染，
     慢的那个后完成，会把新页面整个覆盖掉——表现为地址栏是 A、内容却是 B
     （例如快速点「标签」再点「文章」，最后停在标签页）。改成排队执行，
     且排队期间又有新导航时，旧的直接作废 */
  let routeSeq = 0;
  let routeChain = Promise.resolve();

  function route() {
    const seq = ++routeSeq;
    routeChain = routeChain.then(function () {
      if (seq !== routeSeq) return undefined; /* 期间又点了别的导航，这次不用跑了 */
      return runRoute();
    }).catch(function (err) {
      console.error('[AI炼丹房] 路由渲染异常:', err && err.message ? err.message : '未知错误');
    });
    return routeChain;
  }

  async function runRoute() {
    const parts = parseHash();
    const root = mainEl();
    /* 离开文章页时卸掉目录高亮与进度条的滚动监听（必须在滚动重置之前，
       否则 detach 里算进度时拿到的已经是归零后的 scrollY） */
    if (window.ReadingAssist) ReadingAssist.detach();

    /* 换页必须回到顶部：否则新页面会继承上一页的滚动位置，
       表现为「打开新文章却停在半中间」+ 阅读进度被写成上一页的位置 */
    const routeKey = parts.join('/');
    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      window.scrollTo(0, 0);
    }

    document.title = App.settings.site_title || 'AI 炼丹房';
    setActiveNav(parts);
    updateAdminEntries(parts);
    App.updateFavBadge();
    if (window.Theme) Theme.syncRoute(parts);

    /* 静态托管下 window.cloud 本来就该是 null：只要文章数据用的是本地 JSON，
       这个检查就不能拦路（原来是「SDK 没加载就整站报错」，迁移后已不需要） */
    if (window.CLOUD_SDK_MISSING && !window.STATIC_DATA_MODE) {
      Util.setError(root, '云服务组件加载失败', '请检查网络连接后刷新页面。');
      return;
    }

    try {
      if (parts.length === 0) {
        await Views.home(root);
      } else if (parts[0] === 'article' && parts[1]) {
        await Views.article(root, Number(parts[1]));
      } else if (parts[0] === 'tags') {
        await Views.tags(root);
      } else if (parts[0] === 'tag' && parts[1]) {
        await Views.tag(root, parts[1]);
      } else if (parts[0] === 'series' && parts[1]) {
        await Views.seriesDetail(root, Number(parts[1]));
      } else if (parts[0] === 'series') {
        await Views.series(root);
      } else if (parts[0] === 'about') {
        await Views.about(root);
      } else if (parts[0] === 'bookmarks') {
        await Views.bookmarks(root);
      } else if (parts[0] === 'login') {
        await Auth.viewLogin(root);
      } else if (parts[0] === 'admin' && parts[1] === 'new') {
        await Admin.viewEditor(root, null);
      } else if (parts[0] === 'admin' && parts[1] === 'edit' && parts[2]) {
        await Admin.viewEditor(root, Number(parts[2]));
      } else if (parts[0] === 'admin' && parts[1] === 'series') {
        await Admin.viewSeries(root);
      } else if (parts[0] === 'admin' && parts[1] === 'articles') {
        await Admin.viewArticles(root);
      } else if (parts[0] === 'admin' && parts[1] === 'files') {
        await Admin.viewFiles(root);
      } else if (parts[0] === 'admin' && parts[1] === 'tags') {
        await Admin.viewTags(root);
      } else if (parts[0] === 'admin' && parts[1] === 'comments') {
        await Admin.viewComments(root);
      } else if (parts[0] === 'admin' && parts[1] === 'admins') {
        await Admin.viewAdmins(root);
      } else if (parts[0] === 'admin' && parts[1] === 'settings') {
        await Admin.viewSettings(root);
      } else if (parts[0] === 'admin') {
        await Admin.viewDashboard(root);
      } else {
        Views.notFound(root);
      }
    } catch (err) {
      console.error('[AI炼丹房] 路由渲染异常:', err && err.message ? err.message : '未知错误');
      Util.setError(root, '页面渲染失败', (err && err.message) || '请稍后重试');
    }
  }

  function setActiveNav(parts) {
    const path = '/' + parts.join('/');
    Util.$$('#main-nav a').forEach(function (a) {
      const nav = a.getAttribute('data-nav');
      let active = false;
      if (nav === '/') active = parts.length === 0;
      else if (nav === '/tags') active = parts[0] === 'tags' || parts[0] === 'tag';
      else active = path.indexOf(nav) === 0;
      a.classList.toggle('active', active);
    });
  }

  /* ---------------- 页头 / 登录状态 ---------------- */

  App.renderHeader = async function () {
    const area = Util.$('#auth-area');
    const session = await Util.getSession();

    if (session) {
      const email = (session.user && session.user.email) || '已登录';
      area.innerHTML =
        '<span class="auth-email" title="' + Util.escapeHtml(email) + '">' + Util.escapeHtml(email) + '</span>' +
        '<button class="btn btn-gold btn-sm" id="logout-btn">退出</button>';
      Util.$('#logout-btn', area).addEventListener('click', Auth.signOut);

      adminFlag = await Api.isAdmin();
      ownerFlag = adminFlag ? await Api.isOwner() : false;
      if (window.Theme) Theme.onAuth(session);
    } else {
      area.innerHTML = '<a class="btn btn-gold btn-sm" href="#/login">登录</a>';
      adminFlag = false;
      ownerFlag = false;
    }

    updateAdminEntries(parseHash());
  }

  /* 管理员入口：导航栏「管理」文字链接 + 前台右下角悬浮按钮 */
  function updateAdminEntries(parts) {
    const navAdmin = Util.$('#nav-admin');
    const fab = Util.$('#admin-fab');
    if (navAdmin) navAdmin.classList.toggle('hidden', !adminFlag);
    if (fab) {
      const inAdmin = !!parts && parts[0] === 'admin';
      fab.classList.toggle('hidden', !adminFlag || inAdmin);
    }
  }

  App.refreshNav = async function () {
    adminFlag = await Api.isAdmin();
    ownerFlag = adminFlag ? await Api.isOwner() : false;
    updateAdminEntries(parseHash());
  };

  /* 导航栏「收藏」角标：展示本地收藏数量 */
  App.updateFavBadge = function () {
    const badge = Util.$('#nav-fav-count');
    if (!badge) return;
    let n = 0;
    try { n = Util.Favorites.count(); } catch (e) { n = 0; }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('hidden', n === 0);
  };

  /* ---------------- 启动 ---------------- */

  /* PWA：注册 Service Worker（离线可用）。失败静默，不影响主流程 */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
    });
  }

  /* 回到顶部：下滑超过约一屏后出现，点击平滑回顶 */
  function setupBackToTop() {
    const btn = Util.$('#back-to-top');
    if (!btn) return;

    /* 统一取值：页面缩放/惯性滚动时 window.scrollY 与文档 scrollTop 可能短暂不一致，取大者 */
    function scrollTop() {
      return Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0);
    }
    function threshold() {
      return Math.max(480, window.innerHeight * 0.6);
    }

    let rafId = 0;
    function update() {
      rafId = 0;
      const y = scrollTop();
      const doc = document.documentElement;
      /* 边界兜底：已滚到底部时无条件显示，避免整数取整导致差几像素就不显示 */
      const atBottom = y + window.innerHeight >= doc.scrollHeight - 2;
      btn.classList.toggle('show', atBottom || y > threshold());
    }
    /* 取消上一次未执行的帧再安排新的：既合并高频事件，
       也不会像「标志位跳过」那样在后台标签页 rAF 挂起时把状态卡死 */
    function schedule() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    }

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', schedule, { passive: true });
    /* 缩放/横竖屏切换后一屏高度变了，阈值要重算 */
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
  }

  function boot() {
    if (window.Theme) Theme.init();
    App.loadSettings();
    App.renderHeader();
    registerSW();
    setupBackToTop();

    if (window.cloud && cloud.auth && cloud.auth.onAuthStateChange) {
      cloud.auth.onAuthStateChange(function (event) {
        App.renderHeader();
        /* 登录态变化时，仅重渲染与身份强相关的页面，避免打断阅读 / 编辑 */
        const parts = parseHash();
        if (parts[0] === 'login' || parts[0] === 'admin') route();
      });
    }

    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.App = App;
})();
