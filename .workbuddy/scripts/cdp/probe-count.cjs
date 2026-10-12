const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9413;
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
    /* total 到底怎么来的？直接看原始响应 */
    const raw = await cloud.database.from('articles')
      .select('id,title', { count: 'exact' })
      .eq('status','published')
      .or('title.ilike.%LoRA%,summary.ilike.%LoRA%,content.ilike.%LoRA%')
      .range(0,8);
    r.rawKeys = Object.keys(raw);
    r.rawCount = raw.count;
    r.rawDataLen = (raw.data||[]).length;
    r.firstTitle = raw.data && raw.data[0] && raw.data[0].title;
    /* 不带 range 的 count */
    const raw2 = await cloud.database.from('articles')
      .select('id', { count: 'exact' })
      .eq('status','published')
      .or('title.ilike.%LoRA%,summary.ilike.%LoRA%,content.ilike.%LoRA%');
    r.noRangeCount = raw2.count;
    r.noRangeLen = (raw2.data||[]).length;
    return r;
  })()`);
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
