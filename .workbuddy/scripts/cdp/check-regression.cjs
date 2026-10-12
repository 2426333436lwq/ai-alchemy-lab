/* 最终回归：一次跑完关键路径
   覆盖：全路由渲染 / 卡片无溢出 / 五套主题 / 移动端宽度 /
         模拟境外 CDN 被墙 / 问答面板 / 控制台无异常
   前置：项目根目录起 http 服务（python -m http.server 8080 --bind 127.0.0.1） */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9407;
const BASE = 'http://127.0.0.1:8080/';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + udd, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(500);
  }
  throw new Error('cdp not ready');
}

(async () => {
  const ws = new WebSocket(await getWs());
  let id = 0; const pending = new Map(); const events = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const q = pending.get(m.id); pending.delete(m.id);
      m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result);
    } else events.push(m);
  });
  await new Promise(r => ws.addEventListener('open', r));
  const send = (method, params = {}, sessionId) => {
    const i = ++id; const msg = { id: i, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => {
      pending.set(i, { res, rej });
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
    });
  };

  const t = await send('Target.createTarget', { url: 'about:blank' });
  const s = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = s.sessionId;
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Network.enable', {}, sid);

  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return 'ERR ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async (hash, wait) => { await send('Page.navigate', { url: BASE + hash }, sid); await sleep(wait || 6500); };

  const out = { routes: {}, themes: {}, checks: {} };

  /* ---------- 1. 全路由 ---------- */
  const routes = [
    ['#/', 'home'], ['#/tags', 'tags'], ['#/series', 'series'], ['#/about', 'about'],
    ['#/bookmarks', 'bookmarks'], ['#/login', 'login'], ['#/article/11', 'article'],
    ['#/article/35', 'article35'], ['#/tag/Agent', 'tag'], ['#/series/6', 'seriesDetail'],
    ['#/nope-does-not-exist', 'notFound'],
  ];
  for (const [hash, key] of routes) {
    await go(hash);
    out.routes[key] = await ev(`(function(){
      var app=document.getElementById('app');
      return {
        len: (app.textContent||'').trim().length,
        stuckOnLoading: (app.textContent||'').includes('炉火初燃'),
        hasError: !!app.querySelector('.error-box'),
        h1: (app.querySelector('h1')||{}).textContent||null
      };
    })()`);
  }

  /* ---------- 2. 卡片溢出（首页 + 相关文章） ---------- */
  await go('#/');
  out.checks.homeCardsOverflow = await ev(`(function(){
    var bad=0;
    document.querySelectorAll('.article-grid .article-card').forEach(function(c){
      var s=c.querySelector('.card-summary'), m=c.querySelector('.card-meta');
      if(!s||!m) return;
      if(s.getBoundingClientRect().bottom > m.getBoundingClientRect().top+1) bad++;
    });
    return {overflowing:bad, cards:document.querySelectorAll('.article-grid .article-card').length};
  })()`);
  await go('#/article/11');
  out.checks.relatedCardsOverflow = await ev(`(function(){
    var bad=0;
    document.querySelectorAll('.article-grid.compact .article-card').forEach(function(c){
      var s=c.querySelector('.card-summary'), m=c.querySelector('.card-meta');
      if(!s||!m) return;
      if(s.getBoundingClientRect().bottom > m.getBoundingClientRect().top+1) bad++;
    });
    return {overflowing:bad, cards:document.querySelectorAll('.article-grid.compact .article-card').length};
  })()`);

  /* ---------- 3. 文章页关键模块 ---------- */
  out.checks.articleModules = await ev(`({
    toc: document.querySelectorAll('#toc-box button, #toc-box a').length,
    codeBlocks: document.querySelectorAll('#article-content pre code').length,
    highlighted: document.querySelectorAll('#article-content pre code.hljs').length,
    seriesNav: !!document.querySelector('.series-nav'),
    seriesNavText: (document.querySelector('#series-nav')||{}).textContent ? (document.querySelector('#series-nav').textContent.match(/第 \\d+ \\/ \\d+ 篇/)||[])[0] : null,
    postNav: !!document.querySelector('.post-nav'),
    readProgress: !!document.getElementById('read-progress'),
    shareBox: !!document.querySelector('.share-box'),
    commentsBox: !!document.querySelector('#waline') || !!document.querySelector('#comment-box')
  })`);

  /* ---------- 4. 五套主题 ---------- */
  await go('#/');
  const themes = ['ink', 'light', 'dark', 'sepia', 'cyber'];
  for (const th of themes) {
    await ev(`(function(){ document.documentElement.setAttribute('data-theme','${th}'); return 1; })()`);
    await sleep(700);
    out.themes[th] = await ev(`(function(){
      var b=document.body, cs=getComputedStyle(b);
      var card=document.querySelector('.article-card');
      var sum=document.querySelector('.card-summary');
      return {
        bg: cs.backgroundColor,
        ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
        cardBg: card?getComputedStyle(card).backgroundColor:null,
        summaryColor: sum?getComputedStyle(sum).color:null,
        overflowStillFixed: (function(){
          var s=sum, m=document.querySelector('.card-meta');
          if(!s||!m) return null;
          return s.getBoundingClientRect().bottom <= m.getBoundingClientRect().top+1;
        })()
      };
    })()`);
  }
  await ev(`document.documentElement.removeAttribute('data-theme')`);

  /* ---------- 5. 移动端宽度 ---------- */
  for (const [w, h, label] of [[390, 844, 'iphone'], [768, 1024, 'ipad']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sid);
    await go('#/');
    out.checks['mobile_' + label] = await ev(`(function(){
      var de=document.documentElement;
      var bad=0;
      document.querySelectorAll('.article-grid .article-card').forEach(function(c){
        var s=c.querySelector('.card-summary'), m=c.querySelector('.card-meta');
        if(s&&m&&s.getBoundingClientRect().bottom>m.getBoundingClientRect().top+1) bad++;
      });
      return {
        horizontalOverflow: de.scrollWidth > de.clientWidth + 1,
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        cardOverflow: bad
      };
    })()`);
  }
  await send('Emulation.clearDeviceMetricsOverride', {}, sid);

  /* ---------- 6. 模拟境外 CDN 被墙 + 问答面板 ---------- */
  await send('Network.setBlockedURLs', { urls: ['*cdn.jsdelivr.net*', '*unpkg.com*', '*vercel.app*'] }, sid);
  await go('#/', 8000);
  out.checks.blockedCdn = await ev(`({
    cloudLoaded: typeof window.cloud,
    stuckOnLoading: document.getElementById('app').textContent.includes('炉火初燃'),
    cards: document.querySelectorAll('.article-card').length
  })`);
  await ev(`document.querySelector('#ask-fab').click()`); await sleep(700);
  out.checks.askPanel = await ev(`(function(){
    var p=document.getElementById('ask-panel');
    return { exists: !!p, open: p?p.classList.contains('open'):null,
             hasInput: !!(p&&p.querySelector('input')) };
  })()`);

  out.exceptions = events.filter(e => e.method === 'Runtime.exceptionThrown')
    .map(e => ((e.params.exceptionDetails || {}).exception || {}).description || (e.params.exceptionDetails || {}).text).slice(0, 6);

  console.log(JSON.stringify(out, null, 2));
  child.kill();
  process.exit(0);
})().catch(e => { console.error('FAIL', e); child.kill(); process.exit(1); });
