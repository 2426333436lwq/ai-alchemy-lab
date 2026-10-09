/* 问炼丹房：右下角悬浮 AI 问答 */
(function () {
  'use strict';

  const API = 'https://ai-alchemy-waline.vercel.app/api/ask';

  function init() {
    if (document.getElementById('ask-fab')) return;

    /* 悬浮按钮 */
    const fab = document.createElement('button');
    fab.id = 'ask-fab';
    fab.type = 'button';
    fab.title = '问炼丹房';
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7v3a3 3 0 0 1-3 3h-1v-4h4.5"/><path d="M5 12V9a7 7 0 0 1 7-7"/><rect x="3" y="12" width="4" height="7" rx="1"/><rect x="17" y="12" width="4" height="7" rx="1"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg>';
    document.body.appendChild(fab);

    /* 聊天窗口 */
    const panel = document.createElement('div');
    panel.id = 'ask-panel';
    panel.innerHTML =
      '<div class="ask-head">问炼丹房<span class="ask-close">×</span></div>' +
      '<div class="ask-msgs"><div class="ask-msg bot">你好！我是炼丹房 AI，问我任何关于大模型的问题吧。</div></div>' +
      '<div class="ask-input"><input type="text" placeholder="输入你的问题..." autocomplete="off"><button>发送</button></div>';
    document.body.appendChild(panel);

    /* 事件 */
    fab.addEventListener('click', function () {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        panel.querySelector('input').focus();
      }
    });
    panel.querySelector('.ask-close').addEventListener('click', function () {
      panel.classList.remove('open');
    });

    const input = panel.querySelector('input');
    const sendBtn = panel.querySelector('.ask-input button');
    function send() {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      addMsg(q, 'user');
      const loading = addMsg('思考中...', 'bot', true);
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          loading.remove();
          addMsg(data.answer || data.error || '出错了', 'bot');
        })
        .catch(function () {
          loading.remove();
          addMsg('网络错误，再试一次', 'bot');
        });
    }
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

    function addMsg(text, who, isLoading) {
      const div = document.createElement('div');
      div.className = 'ask-msg ' + who + (isLoading ? ' loading' : '');
      div.textContent = text;
      panel.querySelector('.ask-msgs').appendChild(div);
      panel.querySelector('.ask-msgs').scrollTop = 99999;
      return div;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
