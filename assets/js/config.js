/* 站点配置。Cloudflare 静态托管后不再初始化云 SDK（assets/vendor/workbuddy-cloud-sdk.js 已从
   index.html 移除），publishableKey 之类保留着，将来要接回服务端时直接恢复即可。 */
(function () {
  'use strict';

  window.APP_CONFIG = {
    endpoint: 'https://ai-alchemy-lab.app.workbuddy.host',
    publishableKey: 'wbpk_UOlK6bLIFDoZh70B0kWCBS_MkGhWxhQfBaMJ3ROdhgh6Z1ce3dJHM87',
    /* 线上 canonical 域名：静态快照页 /a/<id>/ 挂在这个域名下。
       迁移到 Cloudflare 后主域名改成了下面这个；换成自己的域名时记得同步改这里
       （canonical、og:url、分享链接都读它）。 */
    siteUrl: 'https://ai-alchemy-lab.2426333436.workers.dev',
  };

  /* 静态数据模式：文章全部来自 data/*.json，不需要云 SDK。
     想接回服务端时：① index.html 恢复云 SDK 的 script 标签 ② 把这里改成 false */
  window.STATIC_DATA_MODE = true;

  if (typeof WorkBuddyCloud === 'undefined') {
    window.cloud = null;
    window.CLOUD_SDK_MISSING = true;
    return;
  }

  window.cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: window.APP_CONFIG.endpoint,
    publishableKey: window.APP_CONFIG.publishableKey,
  });
})();
