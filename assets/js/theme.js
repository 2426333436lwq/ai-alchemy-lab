/* 主题换肤系统：五套主题一键切换
 * 记忆策略：所有访客存浏览器 localStorage；登录用户额外同步到云端（跨设备生效）
 * 应用范围：全站（含管理后台），前后台主题保持一致
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'site-theme';

/* auto 解析用的两套兜底主题：系统深色 → 暗夜黑，系统浅色 → 墨金 */
  var AUTO_DARK = 'dark';
  var AUTO_LIGHT = 'ink';

  var THEMES = [
    {
      id: 'auto',
      name: '跟随系统',
      desc: '随系统明暗自动切换 · 深色用暗夜黑，浅色用墨金',
      dark: false,
      auto: true,
      /* 色卡画成半明半暗，一眼看出它会跟着系统变 */
      sw: {
        bg: 'linear-gradient(135deg, #f6f1e6 0%, #f6f1e6 48%, #0d1117 52%, #0d1117 100%)',
        card: '#fffdf7', accent: '#b8860b', text: '#211d18'
      }
    },
    {
      id: 'ink',
      name: '墨金古风',
      desc: '默认 · 宣纸墨字配朱砂，炼丹房本色',
      dark: false,
      sw: { bg: '#f6f1e6', card: '#fffdf7', accent: '#b23a2a', text: '#211d18' }
    },
    {
      id: 'light',
      name: '极简白',
      desc: 'NexT / Medium 风 · 白底黑字专注阅读',
      dark: false,
      sw: { bg: '#ffffff', card: '#f4f5f7', accent: '#20242a', text: '#20242a' }
    },
    {
      id: 'dark',
      name: '暗夜黑',
      desc: 'GitHub Dark 风 · 深夜码字伴侣',
      dark: true,
      sw: { bg: '#0d1117', card: '#161b22', accent: '#58a6ff', text: '#e6edf3' }
    },
    {
      id: 'sepia',
      name: '护眼纸',
      desc: 'Kindle 纸张色 · 长时间阅读不刺眼',
      dark: false,
      sw: { bg: '#f1e5cd', card: '#faf3e0', accent: '#9a5b2e', text: '#4a3b28' }
    },
    {
      id: 'cyber',
      name: '赛博蓝紫',
      desc: '霓虹夜色 · 科技感拉满',
      dark: true,
      sw: { bg: '#0a0e24', card: '#151b3d', accent: '#7c5cff', text: '#dfe6ff' }
    }
  ];

  var current = 'ink';
  var syncTimer = null;

  function isValid(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return true;
    return false;
  }

  function themeOf(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }

  function readLocal() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      return isValid(v) ? v : 'ink';
    } catch (e) {
      return 'ink';
    }
  }

  function writeLocal(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* 忽略 */ }
  }

  /* 代码高亮主题跟随：暗色系用 github-dark，其余用 github */
  function syncHljs(isDark) {
    var light = document.getElementById('hljs-light');
    var dark = document.getElementById('hljs-dark');
    if (light) light.disabled = !!isDark;
    if (dark) dark.disabled = !isDark;
  }

  /* 系统是否偏好深色（老浏览器没有 matchMedia 时一律按浅色处理） */
  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /* auto 不是真的主题，要先解析成实际生效的那套 */
  function resolveId(id) {
    if (id !== 'auto') return id;
    return prefersDark() ? AUTO_DARK : AUTO_LIGHT;
  }

  function applyDom(id) {
    /* current 记的是用户选的那个（可能是 auto），真正上到 DOM 的是解析后的 */
    current = id;
    var real = resolveId(id);
    var root = document.documentElement;
    /* 切换瞬间加过渡类，结束后移除，避免常驻 !important 过渡拖累性能 */
    root.classList.add('theme-fading');
    if (real === 'ink') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', real);
    syncHljs(themeOf(real).dark);
    markActiveCard();
    setTimeout(function () { root.classList.remove('theme-fading'); }, 320);
  }

  /* 系统明暗变化时实时跟随，不刷新页面；只在用户选了 auto 时才有动作 */
  function watchSystem() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () {
      if (current === 'auto') applyDom('auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* 登录用户把主题同步到云端（防抖 600ms，未登录自动跳过） */
  function syncCloud(id) {
    if (!window.Util || !window.Api || !Api.saveMyTheme) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      Util.getSession().then(function (session) {
        if (!session) return null;
        return Api.saveMyTheme(id);
      }).catch(function () { /* 云端同步失败不影响本地使用 */ });
    }, 600);
  }

  var Theme = {
    THEMES: THEMES,

    current: function () { return current; },

    /* 切换主题。opts.save=false 不写本地；opts.sync=false 不同步云端 */
    apply: function (id, opts) {
      if (!isValid(id)) return;
      opts = opts || {};
      applyDom(id);
      if (opts.save !== false) writeLocal(id);
      if (opts.sync !== false) syncCloud(id);
    },

    /* 路由联动：前后台均保持访客所选主题，切换器全站可用 */
    syncRoute: function () {
      Theme.closePanel();
      applyDom(readLocal());
    },

    /* 登录态就绪后：拉取云端主题，若与本地不同则以云端为准（跨设备同步） */
    onAuth: function (session) {
      if (!session || !window.Api || !Api.getMyTheme) return;
      Api.getMyTheme().then(function (cloudTheme) {
        if (!cloudTheme || !isValid(cloudTheme)) return;
        if (cloudTheme === readLocal()) return;
        writeLocal(cloudTheme);
        applyDom(cloudTheme);
      }).catch(function () { /* 表未就绪或网络异常时静默 */ });
    },

    togglePanel: function () {
      var panel = document.getElementById('theme-panel');
      if (panel) panel.classList.toggle('hidden');
    },

    closePanel: function () {
      var panel = document.getElementById('theme-panel');
      if (panel) panel.classList.add('hidden');
    },

    init: function () {
      applyDom(readLocal());
      buildPanel();
      watchSystem();
    }
  };

  /* ---------------- 主题选择面板 ---------------- */

  function swatchHtml(t) {
    return '<span class="theme-swatch" style="--sw-bg:' + t.sw.bg + ';--sw-card:' + t.sw.card +
      ';--sw-accent:' + t.sw.accent + ';--sw-text:' + t.sw.text + '">' +
      '<i class="sw-card"></i><i class="sw-accent"></i><i class="sw-line"></i><i class="sw-line short"></i></span>';
  }

  function buildPanel() {
    var panel = document.getElementById('theme-panel');
    var btn = document.getElementById('theme-btn');
    if (!panel || !btn) return;

    var cards = THEMES.map(function (t) {
      return '<button type="button" class="theme-card" data-theme-id="' + t.id + '" role="menuitem">' +
        swatchHtml(t) +
        '<span class="theme-card-body">' +
          '<span class="theme-card-name">' + t.name + '</span>' +
          '<span class="theme-card-desc">' + t.desc + '</span>' +
        '</span>' +
        '<svg class="theme-check" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>' +
      '</button>';
    }).join('');

    panel.innerHTML =
      '<div class="theme-panel-head"><span>主题风格 · 一键切换</span><span class="tp-sync">登录后跨设备同步</span></div>' +
      '<div class="theme-list">' + cards + '</div>';

    markActiveCard();

    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      Theme.togglePanel();
    });

    panel.addEventListener('click', function (ev) {
      var card = ev.target.closest ? ev.target.closest('.theme-card') : null;
      if (!card) return;
      ev.stopPropagation();
      Theme.apply(card.getAttribute('data-theme-id'));
      Theme.closePanel();
    });

    document.addEventListener('click', function (ev) {
      if (panel.classList.contains('hidden')) return;
      if (ev.target.closest && ev.target.closest('.theme-wrap')) return;
      Theme.closePanel();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') Theme.closePanel();
    });
  }

  function markActiveCard() {
    var panel = document.getElementById('theme-panel');
    if (!panel) return;
    var cards = panel.querySelectorAll('.theme-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('active', cards[i].getAttribute('data-theme-id') === current);
    }
  }

  window.Theme = Theme;
})();
