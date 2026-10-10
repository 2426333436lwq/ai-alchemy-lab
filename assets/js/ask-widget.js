/* 问炼丹房：右下角悬浮 AI 问答 */
(function () {
  'use strict';

  /* 兜底：境外 Vercel 上的自建接口（智谱，按量计费；且境内可能访问不到）
     默认关闭，改成 true 才会启用 —— 现阶段只用免费模型 */
  const FALLBACK_TO_REMOTE = false;
  const API = 'https://ai-alchemy-waline.vercel.app/api/ask';
  const SYSTEM = '你是「AI 炼丹房」（一个讲大模型原理、微调、部署与工具选型的中文技术博客）的问答助手。'
    + '回答用简体中文，简洁实用，能给出可动手验证的命令或步骤就给；不确定的事情直说不确定，不要编造具体数字。';

  function hasCloudLlm() {
    return !!(window.cloud && cloud.llm && cloud.llm.chat && cloud.llm.chat.completions);
  }

  /* 只走免费档（官方 credits 倍率：hy3 = x0.00；hunyuan-chat 未标价；hunyuan-2.0-thinking = x0.04）
     用户量上来之后再考虑 deepseek-v4-flash(x0.17) / deepseek-v4-pro(x0.51) 这类付费档 */
  const MODELS = ['hy3', 'hunyuan-chat', 'hunyuan-2.0-thinking'];

  /* 主通道：WorkBuddy 云服务大模型，域名与本站一致（国内直连可达） */
  async function askCloud(q, onDelta) {
    let lastErr = null;
    for (let i = 0; i < MODELS.length; i++) {
      try {
        const stream = await cloud.llm.chat.completions.create({
          model: MODELS[i],
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: q }
          ],
          stream: true
        });
        let full = '';
        for await (const chunk of stream) {
          const choices = (chunk && chunk.choices) || [];
          const delta = choices[0] && choices[0].delta;
          const piece = delta && (delta.content || delta.text);
          if (piece) {
            full += piece;
            if (onDelta) onDelta(full);
          }
        }
        if (full.trim()) return full;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('云服务暂时没有可用模型');
  }

  /* 备用通道：境外自建接口 */
  function askRemote(q) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) { return data.answer || data.error || '出错了'; });
  }
  const POS_KEY = 'alch.ask.fabPos'; // 拖动后的位置，存本机
  const EDGE = 10;     // 距离视口边缘的最小留白
  const DRAG_MIN = 5;  // 超过这个位移才算拖动，否则视为点击

  function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

  function loadPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { return null; }
  }
  function savePos(x, y) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (e) { /* 忽略 */ }
  }

  /* 把按钮放回可视范围内（换设备、缩放窗口后位置可能越界） */
  function applyFabPos(fab, x, y, persist) {
    const size = fab.offsetWidth || 52;
    const maxX = window.innerWidth - size - EDGE;
    const maxY = window.innerHeight - size - EDGE;
    const nx = clamp(x, EDGE, Math.max(EDGE, maxX));
    const ny = clamp(y, EDGE, Math.max(EDGE, maxY));
    fab.classList.add('moved');
    fab.style.left = nx + 'px';
    fab.style.top = ny + 'px';
    if (persist !== false) savePos(nx, ny);
  }

  /* 面板贴着按钮展开：优先放上方，上方放不下就放下方，左右做边界收敛 */
  function placePanel(fab, panel) {
    const f = fab.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    if (!w || !h) return;
    const left = clamp(f.left + f.width / 2 - w / 2, EDGE, Math.max(EDGE, window.innerWidth - w - EDGE));
    let top = f.top - h - 10;
    if (top < EDGE) top = f.bottom + 10;
    top = clamp(top, EDGE, Math.max(EDGE, window.innerHeight - h - EDGE));
    panel.classList.add('positioned');
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

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

    /* 恢复上次拖动的位置 */
    const saved = loadPos();
    if (saved) applyFabPos(fab, saved.x, saved.y, false);
    window.addEventListener('resize', function () {
      const p = loadPos();
      if (p) applyFabPos(fab, p.x, p.y, false);
      if (panel.classList.contains('open')) placePanel(fab, panel);
    });

    /* 事件：可拖动，松手没怎么动就当点击 */
    let drag = null;
    let suppressClick = false;

    fab.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const rect = fab.getBoundingClientRect();
      drag = {
        id: ev.pointerId,
        dx: ev.clientX - rect.left,
        dy: ev.clientY - rect.top,
        startX: ev.clientX,
        startY: ev.clientY,
        moved: false,
      };
      try { fab.setPointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
    });

    fab.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const dist = Math.abs(ev.clientX - drag.startX) + Math.abs(ev.clientY - drag.startY);
      if (!drag.moved && dist > DRAG_MIN) {
        drag.moved = true;
        fab.classList.add('dragging');
      }
      if (!drag.moved) return;
      ev.preventDefault();
      applyFabPos(fab, ev.clientX - drag.dx, ev.clientY - drag.dy, false);
    });

    function endDrag(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      fab.classList.remove('dragging');
      try { fab.releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
      if (moved) {
        suppressClick = true;
        savePos(parseFloat(fab.style.left) || 0, parseFloat(fab.style.top) || 0);
        if (panel.classList.contains('open')) placePanel(fab, panel);
      }
    }
    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', endDrag);

    fab.addEventListener('click', function () {
      if (suppressClick) { suppressClick = false; return; }
      const willOpen = !panel.classList.contains('open');
      if (willOpen) placePanel(fab, panel);
      panel.classList.toggle('open');
      if (willOpen) { panel.querySelector('input').focus(); }
    });
    panel.querySelector('.ask-close').addEventListener('click', function () {
      panel.classList.remove('open');
    });

    const input = panel.querySelector('input');
    const sendBtn = panel.querySelector('.ask-input button');
    async function run(q) {
      const bubble = addMsg('思考中…', 'bot', true);
      const finish = function (text) {
        bubble.classList.remove('loading');
        bubble.textContent = text;
        panel.querySelector('.ask-msgs').scrollTop = 99999;
      };
      try {
        if (!hasCloudLlm()) throw new Error('云服务不可用');
        const answer = await askCloud(q, function (partial) {
          bubble.textContent = partial;
          panel.querySelector('.ask-msgs').scrollTop = 99999;
        });
        if (answer && answer.trim()) { finish(answer); return; }
        throw new Error('云服务返回空内容');
      } catch (err) {
        if (FALLBACK_TO_REMOTE) {
          try {
            finish(await askRemote(q));
            return;
          } catch (e2) { /* 落到下面的提示 */ }
        }
        finish('问答服务现在有点忙，过一会儿再试试；也可以直接翻文章找答案。');
      }
    }

    function send() {
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      addMsg(q, 'user');
      run(q);
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
