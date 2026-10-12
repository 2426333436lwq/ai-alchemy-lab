const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9411;
const BASE='http://127.0.0.1:8080/';
const {spawn}=require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ws; for(let i=0;i<60;i++){try{const j=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl){ws=new WebSocket(j.webSocketDebuggerUrl);break;}}catch(e){} await sleep(500);}
  let id=0; const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params={},sessionId)=>{const i=++id;const msg={id:i,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((res,rej)=>{pending.set(i,{res,rej});setTimeout(()=>{if(pending.has(i)){pending.delete(i);rej(new Error('to '+method));}},90000);});};
  const t=await send('Target.createTarget',{url:'about:blank'});
  const s=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid); if(r.exceptionDetails) return 'ERR '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text); return r.result.value;};
  await send('Page.navigate',{url:BASE},sid); await sleep(8000);
  const out = await ev(`(async()=>{
    const r={};
    /* 1. 普通搜索 */
    try { const a=await Api.listArticles({search:'LoRA'}); r.normal={total:a.total,first:a.list[0]&&a.list[0].title}; } catch(e){ r.normal='ERR '+e.message; }
    /* 2. 含 % 的搜索 —— escapeLike 应该让它变成字面量 %，但 or() 语法里 \ 是否被正确解析？ */
    try { const b=await Api.listArticles({search:'%'}); r.percent={total:b.total}; } catch(e){ r.percent='ERR '+e.message; }
    /* 3. 含逗号的搜索 —— 可能破坏 or() 的语法 */
    try { const c=await Api.listArticles({search:'a,b'}); r.comma={total:c.total}; } catch(e){ r.comma='ERR '+e.message; }
    /* 4. 含中文顿号/空格的搜索 */
    try { const d=await Api.listArticles({search:'上下文 工程'}); r.space={total:d.total}; } catch(e){ r.space='ERR '+e.message; }
    /* 5. 含单引号的搜索 */
    try { const e2=await Api.listArticles({search:"it's"}); r.quote={total:e2.total}; } catch(e){ r.quote='ERR '+e.message; }
    return r;
  })()`);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
