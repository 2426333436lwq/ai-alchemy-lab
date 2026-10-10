/* 验证评论后端已切回站内自建：
   1) 文章页出现 #comment-box（站内评论区）
   2) #waline 节点被移除（不会同时出现两个留言框）
   3) 全程零 vercel.app 请求（不再依赖境外后端）
   4) 无 JS 报错 */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9361;
const SITE = 'https://ai-alchemy-lab.app.workbuddy.host/';
const ART = 4;

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch (e) {}
    await sleep(500);
  }
  throw new Error('CDP 未起来');
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
  /* 故意把境外后端全断掉：如果评论还能正常渲染，说明确实不再依赖它 */
  await raw('Network.setBlockedURLs', { urls: ['*vercel.app*'] });
  await raw('Page.navigate', { url: SITE + '#/article/' + ART }); await sleep(9000);

  const ev = async e => {
    const r = await raw('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { __err: (r.exceptionDetails.text || '') + ' ' + ((r.exceptionDetails.exception || {}).description || '') } : r.result.value;
  };

  const out = {};
  out.commentBoxExists = await ev(`!!document.querySelector('#comment-box')`);
  out.walineNodeRemoved = await ev(`!document.querySelector('#waline')`);
  out.commentTitle = await ev(`(document.querySelector('#comment-box .box-title')||{}).textContent || null`);
  out.commentCount = await ev(`(document.querySelector('#comment-count')||{}).textContent || null`);
  out.anonymousLoginTip = await ev(`(document.querySelector('.comment-login')||{}).textContent || null`);
  out.emptyHint = await ev(`(document.querySelector('.comment-empty')||{}).textContent || null`);
  out.vercelRequests = c.ev.filter(e => e.method === 'Network.requestWillBeSent' && /vercel\.app/.test((e.params.request || {}).url || '')).length;
  out.cloudDbRequests = c.ev.filter(e => e.method === 'Network.requestWillBeSent' && /\/database\/|\/\.cloud\//.test((e.params.request || {}).url || '')).length;
  out.consoleErrors = c.ev.filter(e => e.method === 'Runtime.exceptionThrown').map(e => (e.params.exceptionDetails || {}).text).slice(0, 5);

  console.log(JSON.stringify(out, null, 2));
  child.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e); child.kill(); process.exit(1); });
