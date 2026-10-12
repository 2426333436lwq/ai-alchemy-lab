const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9419;
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
    const t=async(label,opts)=>{ try{ const x=await Api.listArticles(opts); r[label]={total:x.total,len:x.list.length,first:x.list[0]&&x.list[0].title}; }catch(e){ r[label]='ERR '+e.message; } };
    await t('noSearch',{page:1,pageSize:9});
    await t('LoRA',{search:'LoRA'});
    await t('comma',{search:'RAG,Agent'});          /* 以前直接报错 */
    await t('percent',{search:'%'});
    await t('paren',{search:'(测试)'});
    await t('quote',{search:'"引号"'});
    await t('chinese',{search:'上下文'});
    await t('page2',{search:'RAG',page:2,pageSize:3});
    return r;
  })()`);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
