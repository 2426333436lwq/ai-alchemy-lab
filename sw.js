/* AI 炼丹房 · Service Worker
 * 策略：
 *   - 页面导航：网络优先，离线回退缓存（保证内容更新能被看到）
 *   - 站内静态资源（css/js/png/webmanifest）：陈旧优先 + 后台更新
 *     —— 所以改了 JS/CSS 后必须同时做两件事：index.html 里资源 URL 的 ?v= 换新值，
 *        以及把下面的 VERSION bump 一位（旧缓存在 activate 时整体删除）
 *   - 云数据接口与跨域请求：不拦截
 */
const VERSION = 'v7';
const SHELL_CACHE = 'alchemy-shell-' + VERSION;
const ASSET_CACHE = 'alchemy-assets-' + VERSION;

const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () { /* 预缓存失败不影响安装 */ })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== ASSET_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isAsset(url) {
  return /\.(css|js|png|jpg|jpeg|svg|woff2?|webmanifest)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 跨域（含云数据接口）不拦
  if (url.pathname.indexOf('/api/') === 0) return;

  // 页面导航：网络优先
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  if (!isAsset(url)) return;

  // 静态资源：陈旧优先 + 后台更新
  event.respondWith(
    caches.match(req).then(function (hit) {
      const network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    })
  );
});
