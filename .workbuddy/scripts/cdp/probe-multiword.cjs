const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9421;
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
  /* 多词搜索：现在是整串当一个子串匹配，几乎必然 0 结果。看各方案的表现 */
  const out = await ev(`(async()=>{
    const r={};
    const q=async(label,orExpr)=>{ try{ const x=await cloud.database.from('articles').select('id,title',{count:'exact'}).eq('status','published').or(orExpr); r[label]=(x.data||[]).length; }catch(e){ r[label]='ERR '+e.message; } };
    /* 现状：整串 "RAG Agent" 当子串 */
    await q('wholeString','title.ilike.%RAG Agent%');
    /* 方案：两个词各自 OR */
    await q('perWordOR','title.ilike.%RAG%,title.ilike.%Agent%');
    /* 方案：两个词 AND（更精确） */
    await q('perWordAND','and(title.ilike.%RAG%,title.ilike.%Agent%)');
    /* 直接测用户会输入什么 */
    const ui = async(label,term)=>{ try{ const x=await Api.listArticles({search:term}); r[label]={total:x.total,len:x.list.length}; }catch(e){ r[label]='ERR '+e.message; } };
    await ui('ui_RAG Agent','RAG Agent');
    await ui('ui_上下文 工程','上下文 工程');
    await ui('ui_微调 LoRA','微调 LoRA');
    return r;
  })()`);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
