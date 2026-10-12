/* 生产环境冒烟测试：直接跑线上域名，验证部署是否真的生效。
   与 check-regression.cjs 的区别：那个打 localhost（验代码），这个打生产（验部署）。
   用法：node .workbuddy/scripts/cdp/check-live.cjs  */
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9431;
const BASE='https://ai-alchemy-lab.app.workbuddy.host/';
const {spawn}=require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ws; for(let i=0;i<60;i++){try{const j=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl){ws=new WebSocket(j.webSocketDebuggerUrl);break;}}catch(e){} await sleep(500);}
  let id=0; const pending=new Map(); const evs=[];
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);} else evs.push(m);});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params={},sessionId)=>{const i=++id;const msg={id:i,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((res,rej)=>{pending.set(i,{res,rej});setTimeout(()=>{if(pending.has(i)){pending.delete(i);rej(new Error('to '+method));}},90000);});};
  const t=await send('Target.createTarget',{url:'about:blank'});
  const s=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid); if(r.exceptionDetails) return 'ERR '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text); return r.result.value;};
  const out={};
  await send('Page.navigate',{url:BASE},sid); await sleep(11000);
  out.home={ cloud:await ev('typeof window.cloud'), stuck:(await ev('document.getElementById("app").textContent')).includes('炉火初燃'), cards:await ev('document.querySelectorAll(".article-card").length') };
  out.pager = await ev('(document.getElementById("pagination")||{}).textContent||null');
  /* 搜索：本轮修的关键功能 */
  await ev(`(function(){var i=document.getElementById('search-input'); i.value='LoRA'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
  await sleep(4000);
  out.search={ cards:await ev('document.querySelectorAll(".article-card").length'), pager:await ev('(document.getElementById("pagination")||{}).textContent||null') };
  /* 文章页 */
  await send('Page.navigate',{url:BASE+'#/article/35'},sid); await sleep(9000);
  out.article={ title:await ev('document.title'), bodyLen:await ev('(document.querySelector("#article-content")||{textContent:""}).textContent.length'), toc:await ev('document.querySelectorAll("#toc-box button").length'), hljs:await ev('document.querySelectorAll("#article-content pre code.hljs").length'), seriesNav:await ev('(document.querySelector("#series-nav")||{}).textContent ? (document.querySelector("#series-nav").textContent.match(/第 \\d+ \\/ \\d+ 篇/)||[])[0] : null') };
  out.exceptions = evs.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>((e.params.exceptionDetails||{}).exception||{}).description||(e.params.exceptionDetails||{}).text).slice(0,5);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
