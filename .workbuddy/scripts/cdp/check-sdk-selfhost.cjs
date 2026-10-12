/* 验证：修好之后，即使 jsdelivr 不可达，首页也必须正常渲染 */
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9381;
const BASE=process.env.VBASE||'http://127.0.0.1:8080/';
const {spawn}=require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ws; for(let i=0;i<60;i++){try{const j=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl){ws=new WebSocket(j.webSocketDebuggerUrl);break;}}catch(e){} await sleep(500);}
  let id=0; const pending=new Map(); const ev2=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}else ev2.push(m);});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params={},sessionId)=>{const i=++id;const msg={id:i,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((res,rej)=>{pending.set(i,{res,rej});setTimeout(()=>{if(pending.has(i)){pending.delete(i);rej(new Error('to '+method));}},90000);});};
  const t=await send('Target.createTarget',{url:'about:blank'});
  const s=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid); await send('Network.enable',{},sid);
  /* 模拟国内被墙：阻断所有 jsdelivr 请求 */
  await send('Network.setBlockedURLs',{urls:['*cdn.jsdelivr.net*','*unpkg.com*','*vercel.app*']},sid);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid); if(r.exceptionDetails) return 'ERR '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text); return r.result.value;};
  const t0=Date.now();
  await send('Page.navigate',{url:BASE},sid); await sleep(9000);
  const out={};
  out.elapsedMs=Date.now()-t0;
  out.cloudLoaded = await ev('typeof window.cloud');
  out.cloudMissingFlag = await ev('window.CLOUD_SDK_MISSING===true');
  out.sdkGlobal = await ev('typeof window.WorkBuddyCloud');
  out.homeCards = await ev('document.querySelectorAll(".article-card").length');
  out.appStuckOnLoading = await ev('document.getElementById("app").textContent.includes("炉火初燃")');
  out.documentTitle = await ev('document.title');
  out.exceptions = ev2.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>((e.params.exceptionDetails||{}).exception||{}).description||(e.params.exceptionDetails||{}).text).slice(0,4);
  out.sdkRequestStatus = (()=>{ const r=ev2.filter(e=>e.method==='Network.loadingFailed').map(e=>e.params.errorText); const ok=ev2.filter(e=>e.method==='Network.responseReceived'&&e.params.response.url.includes('workbuddy-cloud-sdk')); return {failures:r.slice(0,3), selfHostedOk: ok.map(x=>x.params.response.status)}; })();
  console.log(JSON.stringify(out,null,2)); child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
