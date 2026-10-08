/* 应用入口：路由、页头、会话状态 */
(function () {
  'use strict';

  const App = {};
  let adminFlag = false; // 缓存站长身份，控制导航可见性
  let ownerFlag = false; // 是否超级管理员（站点所有者）

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

  App.loadSettings = async function () {
    if (!window.cloud) { App.applySettings(); return; }
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

  async function route() {
    const parts = parseHash();
    const root = mainEl();
    /* 离开文章页时卸掉目录高亮与进度条的滚动监听 */
    if (window.ReadingAssist) ReadingAssist.detach();
    document.title = App.settings.site_title || 'AI 炼丹房';
    setActiveNav(parts);
    updateAdminEntries(parts);
    if (window.Theme) Theme.syncRoute(parts);

    if (window.CLOUD_SDK_MISSING) {
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
    adminFlag = window.cloud ? await Api.isAdmin() : false;
    ownerFlag = adminFlag ? await Api.isOwner() : false;
    updateAdminEntries(parseHash());
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

  function boot() {
    if (window.Theme) Theme.init();
    App.loadSettings();
    App.renderHeader();
    registerSW();

    if (window.cloud && cloud.auth && cloud.auth.onAuthStateChange) {
      cloud.auth.onAuthStateChange(function (event) {
        App.renderHeader();
        // 登录态变化时，仅重渲染与身份强相关的页面，避免打断阅读/编辑
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
