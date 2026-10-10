/* 通用工具函数 */
(function () {
  'use strict';

  const Util = {};

  Util.$ = function (sel, root) { return (root || document).querySelector(sel); };
  Util.$$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  Util.escapeHtml = function (str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  Util.formatDate = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  };

  Util.formatSize = function (bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };

  Util.debounce = function (fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  };

  Util.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };

  /* ---------- Toast ---------- */
  Util.toast = function (msg, type) {
    const root = Util.$('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 320);
    }, 3200);
  };

  /* ---------- 文件选择 ---------- */
  Util.pickFile = function (accept) {
    return new Promise(function (resolve) {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        const file = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(file);
      });
      input.addEventListener('cancel', function () {
        input.remove();
        resolve(null);
      });
      input.click();
    });
  };

  /* ---------- 图片压缩：返回 { dataUrl, blob } ---------- */
  Util.compressImage = function (file, maxWidth, quality) {
    const limit = maxWidth || 1400;
    const q = quality || 0.82;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('请选择图片文件'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取图片失败')); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error('解析图片失败')); };
        img.onload = function () {
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > limit) {
            h = Math.round((h * limit) / w);
            w = limit;
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', q);
          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('压缩图片失败')); return; }
            resolve({ dataUrl: dataUrl, blob: blob });
          }, 'image/jpeg', q);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  };

  /* ---------- 登录会话 ---------- */
  Util.getSession = function () {
    if (!window.cloud) return Promise.resolve(null);
    return cloud.auth.getSession().then(function (res) {
      if (res.error || !res.data) return null;
      return res.data;
    }).catch(function () { return null; });
  };

  /* 静态托管模式下（没有云 SDK）登录 / 后台不可用，各页面复用这段说明 */
  Util.staticHostNotice = function (title, extra) {
    return (
      '<div class="card" style="max-width:640px;margin:40px auto;padding:26px 28px">' +
      '<h1 class="login-title" style="margin-bottom:10px">' + Util.escapeHtml(title || '这个功能需要服务端') + '</h1>' +
      '<p class="login-sub" style="margin-bottom:14px">本站目前只提供公开的文章、评论与问答，没有账号体系，' +
      '所以登录、后台管理、附件上传这类功能暂未开放。</p>' +
      '<p class="form-hint">' + Util.escapeHtml(extra || '文章、搜索、标签、系列、评论与 AI 问答都不受影响，照常使用。') + '</p>' +
      '<p style="margin-top:18px"><a class="btn btn-gold btn-sm" href="#/">回到丹房首页</a></p>' +
      '</div>'
    );
  };

  /* ---------- 渲染辅助 ---------- */
  Util.tagChips = function (tags) {
    if (!Array.isArray(tags)) return '';
    return tags.map(function (t) {
      return '<a class="tag-chip" href="#/tag/' + encodeURIComponent(t) + '">' + Util.escapeHtml(t) + '</a>';
    }).join('');
  };

  /* ---------- 本地收藏（localStorage，不依赖云端，换浏览器不跟随） ---------- */
  const FAV_KEY = 'alch-favorites';

  function favRead() {
    try {
      const list = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function favWrite(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* 存储不可用静默 */ }
  }

  Util.Favorites = {
    list: function () { return favRead(); },
    count: function () { return favRead().length; },
    has: function (id) {
      const n = Number(id);
      return favRead().some(function (f) { return Number(f.id) === n; });
    },
    /* 切换收藏；返回 true 表示收藏后状态，false 表示已取消 */
    toggle: function (article) {
      const list = favRead();
      const idx = list.findIndex(function (f) { return Number(f.id) === Number(article.id); });
      if (idx >= 0) {
        list.splice(idx, 1);
        favWrite(list);
        return false;
      }
      list.unshift({
        id: article.id,
        title: article.title,
        summary: article.summary || '',
        cover: article.cover || '',
        tags: Array.isArray(article.tags) ? article.tags : [],
        views: article.views || 0,
        created_at: article.created_at,
        savedAt: new Date().toISOString()
      });
      favWrite(list);
      return true;
    },
    remove: function (id) {
      const n = Number(id);
      favWrite(favRead().filter(function (f) { return Number(f.id) !== n; }));
    },
    clear: function () { favWrite([]); }
  };

  Util.setLoading = function (root, text) {
    root.innerHTML =
      '<div class="page-loading"><span class="flame-pulse"></span><p>' +
      Util.escapeHtml(text || '炉火烧炼中…') + '</p></div>';
  };

  Util.setError = function (root, title, desc) {
    root.innerHTML =
      '<div class="error-box"><h2>' + Util.escapeHtml(title) + '</h2><p>' +
      Util.escapeHtml(desc || '') + '</p><p style="margin-top:18px"><a class="btn" href="#/">回到首页</a></p></div>';
  };

  /* ---------- 页面元信息：分享卡片 / 搜索引擎可读 ---------- */
  Util.setPageMeta = function (opts) {
    if (!opts) return;
    if (opts.title) document.title = opts.title;
    function setMeta(selector, attr, val, content) {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, val);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content || '');
    }
    if (opts.description) {
      setMeta('meta[name="description"]', 'name', 'description', opts.description);
      setMeta('meta[property="og:description"]', 'property', 'og:description', opts.description);
    }
    if (opts.title) {
      setMeta('meta[property="og:title"]', 'property', 'og:title', opts.title);
      setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', opts.title);
    }
    /* 封面若是内嵌 base64 则不作为 og:image——社交平台不认 data URI */
    if (opts.image && /^https?:/i.test(opts.image)) {
      setMeta('meta[property="og:image"]', 'property', 'og:image', opts.image);
      setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', opts.image);
    }
    const ogUrl = opts.canonical || opts.url;
    if (ogUrl) {
      setMeta('meta[property="og:url"]', 'property', 'og:url', ogUrl);
      setMeta('meta[name="twitter:card"]', 'name', 'twitter:card', opts.image ? 'summary_large_image' : 'summary');
    }
    /* canonical：SPA 页面把权重指向同内容的静态快照页 /a/<id>/ */
    if (opts.canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', opts.canonical);
    }
  };

  /* ---------- 复制到剪贴板 ---------- */
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  Util.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  };

  /* ---------- 分享图：Canvas 合成，返回 dataURL ---------- */
  function drawWrap(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const chars = String(text || '').split('');
    let line = '';
    let used = 0;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        if (used + 1 >= maxLines) {
          ctx.fillText(line.slice(0, -1) + '…', x, y);
          return y + lineHeight;
        }
        ctx.fillText(line, x, y);
        y += lineHeight;
        used += 1;
        line = chars[i];
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, y);
    return y + lineHeight;
  }

  Util.buildShareCard = function (opts) {
    const W = 1200;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f6f1e6';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b23a2a';
    ctx.fillRect(0, 0, 14, H);
    ctx.strokeStyle = 'rgba(184,134,11,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(1072, 138, 94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(1072, 138, 64, 0, Math.PI * 2);
    ctx.stroke();

    const pad = 84;
    ctx.fillStyle = '#b8860b';
    ctx.font = '500 26px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(opts.siteName || 'AI 炼丹房', pad, 108);

    let y = 220;
    ctx.fillStyle = '#211d18';
    ctx.font = '600 56px "Songti SC", "STSong", "SimSun", serif';
    y = drawWrap(ctx, opts.title || '', pad, y, W - pad * 2 - 130, 76, 3);

    ctx.fillStyle = '#57503f';
    ctx.font = '400 28px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    y = drawWrap(ctx, opts.summary || '', pad, y + 24, W - pad * 2, 44, 3);

    ctx.fillStyle = '#8a8172';
    ctx.font = '400 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText((opts.date || '') + (opts.url ? '  ·  ' + opts.url.replace(/^https?:\/\//, '') : ''), pad, H - 76);

    return canvas.toDataURL('image/png');
  };

  window.Util = Util;
})();
