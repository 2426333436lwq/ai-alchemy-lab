/* 只看代码高亮在「CDN 被墙」时是否仍然生效 */
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9352, ART=process.argv[2]||'29';
const {spawn}=require('child_process'); const fs=require('fs'); const os=require('os'); const path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getWs(){for(let i=0;i<60;i++){try{const j=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json();if(j.webSocketDebuggerUrl)return j.webSocketDebuggerUrl;}catch(e){} await sleep(500);} throw new Error('x');}
class C{constructor(w){this.ws=w;this.id=0;this.p=new Map();}send(m,pr={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:pr}));return new Promise((res,rej)=>{this.p.set(id,{res,rej});setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('to '+m));}},30000);});}onm(r){const m=JSON.parse(r);if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}}}
(async()=>{
  const ws=new WebSocket(await getWs()); const c=new C(ws); ws.addEventListener('message',e=>c.onm(e.data));
  await new Promise(r=>ws.addEventListener('open',r));
  const t=await c.send('Target.createTarget',{url:'about:blank'});
  const s=await c.send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  const raw=(m,pr={})=>{const id=++c.id;ws.send(JSON.stringify({id,method:m,params:pr,sessionId:sid}));return new Promise((res,rej)=>{c.p.set(id,{res,rej});setTimeout(()=>{if(c.p.has(id)){c.p.delete(id);rej(new Error('to '+m));}},30000);});};
  await raw('Page.enable',{}); await raw('Runtime.enable',{}); await raw('Network.enable',{});
  await raw('Network.setBlockedURLs',{urls:['*cdn.jsdelivr.net*','*unpkg.com*','*vercel.app*']});
  await raw('Page.navigate',{url:`http://127.0.0.1:8080/#/article/${ART}`}); await sleep(9000);
  const ev=async e=>{const r=await raw('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:r.exceptionDetails.text}:r.result.value;};
  console.log(JSON.stringify({
    pre: await ev(`document.querySelectorAll('pre').length`),
    codeBlocks: await ev(`document.querySelectorAll('pre code').length`),
    hljsClass: await ev(`document.querySelectorAll('pre code.hljs').length`),
    langClass: await ev(`Array.from(document.querySelectorAll('pre code')).slice(0,3).map(e=>e.className)`),
    firstToken: await ev(`(()=>{const s=document.querySelector('pre code span'); return s?s.className:'(none)'})()`),
    hljsVersion: await ev(`window.hljs && hljs.versionString ? hljs.versionString : '(none)'`)
  },null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error(e);child.kill();process.exit(1);});
