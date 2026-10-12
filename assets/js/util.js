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
  /* 手机竖拍的照片方向存在 EXIF Orientation 里：浏览器显示 <img> 时会自动转正，
     但 drawImage 画进 canvas 时不会——不处理的话压缩后就被「烤死」成躺倒的。
     优先用 createImageBitmap 的 imageOrientation:'from-image'（原生按 EXIF 转正），
     不支持时回退到老路子，并在解码前取一次 EXIF 方向手动做同样的变换。 */
  Util.compressImage = function (file, maxWidth, quality) {
    const limit = maxWidth || 1400;
    const q = quality || 0.82;

    if (!file || !/^image\//.test(file.type)) {
      return Promise.reject(new Error('请选择图片文件'));
    }

    function toBlob(canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error('压缩图片失败')); return; }
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', q), blob: blob });
        }, 'image/jpeg', q);
      });
    }

    function draw(source, sw, sh, orientation) {
      const canvas = document.createElement('canvas');
      const rotated = orientation >= 5 && orientation <= 8; // 5~8 表示旋转了 90°
      const dw = rotated ? sh : sw;
      const dh = rotated ? sw : sh;
      const scale = dw > limit ? limit / dw : 1;
      canvas.width = Math.round(dw * scale);
      canvas.height = Math.round(dh * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      /* 按 EXIF 方向把画布变换到「已经是正的」状态，再整幅画上去 */
      switch (orientation) {
        case 2: ctx.transform(-1, 0, 0, 1, canvas.width, 0); break;
        case 3: ctx.transform(-1, 0, 0, -1, canvas.width, canvas.height); break;
        case 4: ctx.transform(1, 0, 0, -1, 0, canvas.height); break;
        case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
        case 6: ctx.transform(0, 1, -1, 0, canvas.height, 0); break;
        case 7: ctx.transform(0, -1, -1, 0, canvas.height, canvas.width); break;
        case 8: ctx.transform(0, -1, 1, 0, 0, canvas.width); break;
        default: break;
      }
      if (rotated) ctx.drawImage(source, 0, 0, sh, sw, 0, 0, canvas.height, canvas.width);
      else ctx.drawImage(source, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
      return toBlob(canvas);
    }

    /* 路径 A：createImageBitmap 原生按 EXIF 转正，最省事也最准 */
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(function (bmp) {
          const out = draw(bmp, bmp.width, bmp.height, 1);
          return out.then(function (r) { bmp.close && bmp.close(); return r; });
        })
        .catch(function () { return legacy(); });
    }
    return legacy();

    /* 路径 B：老浏览器，自己读 EXIF 方向再手动画 */
    function legacy() {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onerror = function () { reject(new Error('读取图片失败')); };
        reader.onload = function () {
          const buf = reader.result;
          const img = new Image();
          /* object URL 用完必须释放，否则大图反复选择会一直占内存 */
          const objUrl = URL.createObjectURL(file);
          const cleanup = function () {
            try { URL.revokeObjectURL(objUrl); } catch (e) { /* 忽略 */ }
          };
          img.onerror = function () { cleanup(); reject(new Error('解析图片失败')); };
          img.onload = function () {
            draw(img, img.naturalWidth, img.naturalHeight, readExifOrientation(buf))
              .then(function (r) { cleanup(); resolve(r); },
                    function (e) { cleanup(); reject(e); });
          };
          img.src = objUrl;
        };
        reader.readAsArrayBuffer(file);
      });
    }
  };

  /* 只读 JPEG 的 EXIF Orientation（1~8）；读不到就返回 1（不旋转）。
     刻意不做完整 EXIF 解析：只需要 APP1 段里 TIFF 头之后的第一个 Orientation 标签。 */
  function readExifOrientation(buffer) {
    try {
      const view = new DataView(buffer);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return 1; // 不是 JPEG
      let offset = 2;
      while (offset + 4 < view.byteLength) {
        if (view.getUint8(offset) !== 0xFF) { offset += 1; continue; }
        const marker = view.getUint8(offset + 1);
        const size = view.getUint16(offset + 2);
        /* APP1 且以 "Exif\0\0" 开头 */
        if (marker === 0xE1 && offset + 4 + 6 <= view.byteLength) {
          const tag = String.fromCharCode(
            view.getUint8(offset + 4), view.getUint8(offset + 5),
            view.getUint8(offset + 6), view.getUint8(offset + 7));
          if (tag === 'Exif') {
            const tiff = offset + 10;
            const little = view.getUint16(tiff) === 0x4949;
            const ifd0 = tiff + view.getUint32(tiff + 4, little);
            const count = view.getUint16(ifd0, little);
            for (let i = 0; i < count; i++) {
              const entry = ifd0 + 2 + i * 12;
              if (entry + 12 > view.byteLength) break;
              if (view.getUint16(entry, little) === 0x0112) {
                const v = view.getUint16(entry + 8, little);
                return v >= 1 && v <= 8 ? v : 1;
              }
            }
          }
        }
        if (marker === 0xDA) break; // 到了图像数据，后面不会再有 EXIF
        offset += 2 + size;
      }
    } catch (e) { /* 解析失败按不旋转处理 */ }
    return 1;
  }

  /* ---------- 登录会话 ---------- */
  Util.getSession = function () {
    if (!window.cloud) return Promise.resolve(null);
    return cloud.auth.getSession().then(function (res) {
      if (res.error || !res.data) return null;
      return res.data;
    }).catch(function () { return null; });
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
