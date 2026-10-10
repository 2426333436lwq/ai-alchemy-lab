/* 模拟境外 CDN 全被墙：阻断 jsdelivr / unpkg / vercel，看页面是否还能正常渲染 */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9351;
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','--window-size=1280,900','about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function getWs(){
  for(let i=0;i<60;i++){
    try{const j=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;}catch(e){}
    await sleep(500);
  } throw new Error('cdp not ready');
}
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();this.ev=[];} send(m,pr={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:pr}));return new Promise((res,rej)=>{this.p.set(id,{res,rej});setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('to '+m));}},30000);});} onm(r){const m=JSON.parse(r); if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id); m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);} else this.ev.push(m);}}

(async()=>{
  const ws=new WebSocket(await getWs()); const cdp=new Cdp(ws);
  ws.addEventListener('message',e=>cdp.onm(e.data));
  await new Promise(r=>ws.addEventListener('open',r));
  const t=await cdp.send('Target.createTarget',{url:'about:blank'});
  const s=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true});
  const sid=s.sessionId;
  const raw=(m,pr={})=>{const id=++cdp.id;ws.send(JSON.stringify({id,method:m,params:pr,sessionId:sid}));return new Promise((res,rej)=>{cdp.p.set(id,{res,rej});setTimeout(()=>{if(cdp.p.has(id)){cdp.p.delete(id);rej(new Error('to '+m));}},30000);});};
  await raw('Page.enable',{}); await raw('Runtime.enable',{}); await raw('Network.enable',{});
  await raw('Network.setBlockedURLs',{urls:['*cdn.jsdelivr.net*','*unpkg.com*','*vercel.app*']});
  await raw('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await raw('Page.navigate',{url:'http://127.0.0.1:8080/#/'});
  await sleep(6000);

  const ev = async (expr) => {
    const r = await raw('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if (r.exceptionDetails) return {__err: r.exceptionDetails.text};
    return r.result.value;
  };

  const out = {};
  out.libs = await ev(`({marked: typeof window.marked, purify: typeof window.DOMPurify, hljs: typeof window.hljs, cloud: typeof window.cloud, walineCssLoaded: !!Array.from(document.styleSheets).length})`);
  out.homeCards = await ev(`document.querySelectorAll('.article-card, .card.article').length`);
  out.homeTitle = await ev(`(document.querySelector('.article-card h2, .article-card .card-title')||{}).textContent`);

  // 进入一篇文章
  await raw('Runtime.evaluate',{expression:`location.hash = '#/article/4'`});
  await sleep(6000);
  out.articleTitle = await ev(`(document.querySelector('.article-title, h1')||{}).textContent`);
  out.articleHtmlLen = await ev(`(document.querySelector('.article-body, .article-content')||{innerHTML:''}).innerHTML.length`);
  out.hljsApplied = await ev(`document.querySelectorAll('.article-body pre code.hljs, .article-content pre code.hljs, pre code.hljs').length`);
  out.headings = await ev(`document.querySelectorAll('[id^="sec-"]').length`);

  // 评论区（后端被阻断 → 应出现降级提示）
  await sleep(8000);
  out.commentFallback = await ev(`(()=>{const b=document.querySelector('#waline'); return b? b.textContent.trim().slice(0,60):'(无 #waline)';})()`);

  // 失败请求清单
  out.failed = cdp.ev.filter(e=>e.method==='Network.loadingFailed')
    .map(e=>e.params.errorText + ' ' + (cdp.ev.filter(x=>x.method==='Network.requestWillBeSent'&&x.params.requestId===e.params.requestId)[0]||{params:{request:{url:'?'}}}).params.request.url)
    .slice(0,12);

  // 控制台报错（排除被拦截导致的资源加载失败噪音）
  out.consoleErrs = cdp.ev.filter(e=>e.method==='Runtime.exceptionThrown')
    .map(e=>(e.params.exceptionDetails||{}).text).slice(0,6);

  const shot = await raw('Page.captureScreenshot',{format:'png'});
  const file=path.join(os.tmpdir(),'wb-offline-cdn-blocked.png');
  fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
  out.shot=file;
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e); child.kill(); process.exit(1);});
