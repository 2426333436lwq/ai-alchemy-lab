/* 云服务客户端初始化 —— endpoint / publishableKey 来自云服务开通时返回的 publicConfig */
(function () {
  'use strict';

  window.APP_CONFIG = {
    endpoint: 'https://ai-alchemy-lab.app.workbuddy.host',
    publishableKey: 'wbpk_UOlK6bLIFDoZh70B0kWCBS_MkGhWxhQfBaMJ3ROdhgh6Z1ce3dJHM87',
    /* 线上 canonical 域名：静态快照页 /a/<id>/ 挂在这个域名下 */
    siteUrl: 'https://ai-alchemy-lab.app.workbuddy.host',
  };

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
