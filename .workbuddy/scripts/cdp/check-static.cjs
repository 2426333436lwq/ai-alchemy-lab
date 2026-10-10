/* 静态托管版验收：本地 http://127.0.0.1:8080 上跑一遍主要页面与接口
   覆盖：首页列表 / 文章详情 / 搜索 / 标签 / 系列 / 关于页 / 评论区挂载 / 问答面板 /
        登录与后台的降级提示 / JS 报错 */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9363;
const BASE = 'http://127.0.0.1:8080/';
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch (e) {}
    await sleep(500);
  }
  throw new Error('cdp not ready');
}
class C {
  constructor(w) { this.ws = w; this.id = 0; this.p = new Map(); this.ev = []; }
  send(m, pr = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: pr })); return new Promise((res, rej) => { this.p.set(id, { res, rej }); setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('to ' + m)); } }, 60000); }); }
  onm(r) { const m = JSON.parse(r); if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } else this.ev.push(m); }
}
(async () => {
  const ws = new WebSocket(await getWs()); const c = new C(ws); ws.addEventListener('message', e => c.onm(e.data));
  await new Promise(r => ws.addEventListener('open', r));
  const t = await c.send('Target.createTarget', { url: 'about:blank' });
  const s = await c.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }); const sid = s.sessionId;
  const raw = (m, pr = {}) => { const id = ++c.id; ws.send(JSON.stringify({ id, method: m, params: pr, sessionId: sid })); return new Promise((res, rej) => { c.p.set(id, { res, rej }); setTimeout(() => { if (c.p.has(id)) { c.p.delete(id); rej(new Error('to ' + m)); } }, 60000); }); };
  await raw('Page.enable', {}); await raw('Runtime.enable', {}); await raw('Network.enable', {});
  const ev = async e => { const r = await raw('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? ('ERR ' + (r.exceptionDetails.text || '') + ' ' + ((r.exceptionDetails.exception || {}).description || '')) : r.result.value; };
  const go = async hash => { await raw('Page.navigate', { url: BASE + hash }); await sleep(4500); };

  const out = {};

  await go('#/');
  out.homeCards = await ev(`document.querySelectorAll('.article-card').length`);
  out.homeFirstTitle = await ev(`(document.querySelector('.article-card .card-title')||document.querySelector('.article-card h3')||{}).textContent||null`);
  out.siteTitle = await ev(`document.title`);
  out.cloudSdkLoaded = await ev(`!!window.cloud`);

  /* 接口直测 */
  out.apiList = await ev(`(async()=>{const r=await Api.listArticles({page:1,pageSize:9}); return {total:r.total, len:r.list.length, first:r.list[0].title}})()`);
  out.apiSearch = await ev(`(async()=>{const r=await Api.listArticles({search:'LoRA'}); return {total:r.total, first:r.list[0]&&r.list[0].title}})()`);
  out.apiTag = await ev(`(async()=>{const tags=await Api.listTags(); const r=await Api.listArticles({tag:tags[0].name}); return {tag:tags[0].name, total:r.total}})()`);
  out.apiStats = await ev(`(async()=>await Api.siteStats())()`);
  out.apiSeries = await ev(`(async()=>{const s=await Api.listSeries(); return s.slice(0,3).map(x=>x.name+':'+x.article_count)})()`);

  /* 文章详情 */
  await go('#/article/35');
  out.articleTitle = await ev(`document.title`);
  out.articleBodyLen = await ev(`(document.querySelector('#article-content')||{textContent:''}).textContent.length`);
  out.tocItems = await ev(`document.querySelectorAll('#toc-box button, #toc-box a').length`);
  out.walineBoxExists = await ev(`!!document.querySelector('#waline')`);
  out.commentBoxRemoved = await ev(`!document.querySelector('#comment-box')`);
  out.walineBoxText = await ev(`(document.querySelector('#waline')||{}).textContent||null`);

  /* 标签页 / 系列页 / 关于页 */
  await go('#/tag/LoRA');
  out.tagPageCards = await ev(`document.querySelectorAll('.article-card').length`);
  await go('#/series/1');
  out.seriesTitle = await ev(`(document.querySelector('.series-hero h1, #app h1')||{}).textContent||null`);
  out.seriesItems = await ev(`document.querySelectorAll('.article-card, .series-item').length`);
  await go('#/about');
  out.aboutLen = await ev(`(document.querySelector('#about-content')||{textContent:''}).textContent.length`);

  /* 降级页 */
  await go('#/login');
  out.loginNotice = await ev(`(document.querySelector('#app .login-title')||{}).textContent||null`);
  await go('#/admin');
  out.adminNotice = await ev(`(document.querySelector('#app .login-title')||{}).textContent||null`);

  /* 问答面板 */
  await go('#/');
  await ev(`document.querySelector('#ask-fab').click()`); await sleep(600);
  out.askPanelOpen = await ev(`document.querySelector('#ask-panel').classList.contains('open')`);

  out.consoleErrors = c.ev.filter(e => e.method === 'Runtime.exceptionThrown').map(e => ((e.params.exceptionDetails || {}).exception || {}).description || (e.params.exceptionDetails || {}).text).slice(0, 6);
  out.failedRequests = c.ev.filter(e => e.method === 'Network.loadingFailed').map(e => (e.params || {}).errorText).slice(0, 6);

  console.log(JSON.stringify(out, null, 2));
  child.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e); child.kill(); process.exit(1); });
