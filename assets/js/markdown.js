/* Markdown 渲染：marked 解析 + DOMPurify 消毒 + highlight.js 代码高亮 */
(function () {
  'use strict';

  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: false,
      headerIds: false,
      mangle: false,
    });
  }

  /**
   * 把 Markdown 渲染进容器。
   * DOMPurify 默认放行 img 上的 data:image/* URI（文章内嵌图依赖这一点）。
   */
  window.renderMarkdown = function (container, mdText, opts) {
    if (!container) return;
    if (!window.marked || !window.DOMPurify) {
      container.textContent = mdText || '';
      return;
    }
    const rawHtml = marked.parse(mdText || '');
    container.innerHTML = DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel'],
    });

    /* 代码高亮 */
    if (window.hljs) {
      Util.$$('pre code', container).forEach(function (block) {
        try { hljs.highlightElement(block); } catch (e) { /* 忽略单个代码块失败 */ }
      });
    }

    /* 外链新窗口打开 */
    Util.$$('a[href^="http"]', container).forEach(function (a) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });

    /* 表格可横向滚动 */
    Util.$$('table', container).forEach(function (table) {
      const wrap = document.createElement('div');
      wrap.style.overflowX = 'auto';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });

    /* 标题锚点：给目录跳转用（序号式 id，避免中文 slug 与路由 hash 冲突） */
    let hi = 0;
    Util.$$('h2, h3', container).forEach(function (h) {
      hi += 1;
      h.id = 'sec-' + hi;
    });

    /* 代码块一键复制 */
    if (opts && opts.codeCopy) {
      Util.$$('pre', container).forEach(function (pre) {
        const wrap = document.createElement('div');
        wrap.className = 'code-wrap';
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        const btn = document.createElement('button');
        btn.className = 'code-copy';
        btn.type = 'button';
        btn.textContent = '复制';
        btn.addEventListener('click', function () {
          const code = pre.querySelector('code');
          Util.copyText(code ? code.textContent : pre.textContent).then(function (ok) {
            Util.toast(ok ? '代码已复制' : '复制失败，请手动选取', ok ? 'success' : 'error');
            if (ok) {
              btn.textContent = '已复制';
              setTimeout(function () { btn.textContent = '复制'; }, 1600);
            }
          });
        });
        wrap.appendChild(btn);
      });
    }

    /* 图片灯箱：点图放大 */
    Util.$$('img', container).forEach(function (img) {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', function () {
        openLightbox(img.src, img.alt || '');
      });
    });
  };

  /* 轻量灯箱：单例，点遮罩或 Esc 关闭 */
  let lightboxEl = null;
  function openLightbox(src, alt) {
    closeLightbox();
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox';
    lightboxEl.innerHTML =
      '<img src="' + src + '" alt="' + (alt || '').replace(/"/g,'&quot;') + '">' +
      (alt ? '<p class="lightbox-cap">' + alt + '</p>' : '');
    lightboxEl.addEventListener('click', closeLightbox);
    document.body.appendChild(lightboxEl);
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    if (lightboxEl) { lightboxEl.remove(); lightboxEl = null; }
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLightbox();
  });
})();
