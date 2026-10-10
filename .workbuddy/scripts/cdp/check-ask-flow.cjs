/* 验证 AI 问答：主通道 cloud.llm（国内可达），并确认不再依赖境外接口 */
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9354;
const {spawn}=require('child_process'); const fs=require('fs'); const os=require('os'); const path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getWs(){for(let i=0;i<60;i++){try{const j=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();if(j.webSocketDebuggerUrl)return j.webSocketDebuggerUrl;}catch(e){} await sleep(500);} throw new Error('x');}
class C{constructor(w){this.ws=w;this.id=0;this.p=new Map();this.ev=[];}send(m,pr={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:pr}));return new Promise((res,rej)=>{this.p.set(id,{res,rej});setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('to '+m));}},60000);});}onm(r){const m=JSON.parse(r);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}else this.ev.push(m);}}
(async()=>{
  const ws=new WebSocket(await getWs()); const c=new C(ws); ws.addEventListener('message',e=>c.onm(e.data));
  await new Promise(r=>ws.addEventListener('open',r));
  const t=await c.send('Target.createTarget',{url:'about:blank'});
  const s=await c.send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  const raw=(m,pr={})=>{const id=++c.id;ws.send(JSON.stringify({id,method:m,params:pr,sessionId:sid}));return new Promise((res,rej)=>{c.p.set(id,{res,rej});setTimeout(()=>{if(c.p.has(id)){c.p.delete(id);rej(new Error('to '+m));}},60000);});};
  await raw('Page.enable',{}); await raw('Runtime.enable',{}); await raw('Network.enable',{});
  /* 模拟境外接口全断：只留云服务通道 */
  await raw('Network.setBlockedURLs',{urls:['*vercel.app*','*cdn.jsdelivr.net*','*unpkg.com*']});
  await raw('Page.navigate',{url:'http://127.0.0.1:8080/#/'}); await sleep(7000);
  const ev=async e=>{const r=await raw('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:(r.exceptionDetails.text||'')}:r.result.value;};

  await ev(`document.querySelector('#ask-fab').click()`); await sleep(600);
  await ev(`(()=>{const i=document.querySelector('#ask-panel .ask-input input'); i.value='用一句话解释什么是温度参数 temperature'; document.querySelector('#ask-panel .ask-input button').click(); return true})()`);
  await sleep(12000);
  const out = {};
  out.msgs = await ev(`Array.from(document.querySelectorAll('.ask-msg')).map(m=>({who:m.className, text:m.textContent.slice(0,120)}))`);
  out.vercelRequests = c.ev.filter(e=>e.method==='Network.requestWillBeSent' && /vercel\.app/.test((e.params.request||{}).url||'')).length;
  out.cloudLlmRequests = c.ev.filter(e=>e.method==='Network.requestWillBeSent' && /\/llm\//.test((e.params.request||{}).url||'')).map(e=>e.params.request.url).slice(0,3);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e); child.kill(); process.exit(1);});
