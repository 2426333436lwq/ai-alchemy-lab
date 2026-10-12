/* 导出云库全部已发布文章 → 与现有 articles.json 同构，供 gen-static 使用 */
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9439;
const BASE='https://ai-alchemy-lab.app.workbuddy.host/';
const {spawn}=require('child_process'); const fs=require('fs'),os=require('os'),path=require('path');
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'wbcdp-'));
const child=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let ws; for(let i=0;i<60;i++){try{const j=await(await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl){ws=new WebSocket(j.webSocketDebuggerUrl);break;}}catch(e){} await sleep(500);}
  let id=0; const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params={},sessionId)=>{const i=++id;const msg={id:i,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((res,rej)=>{pending.set(i,{res,rej});setTimeout(()=>{if(pending.has(i)){pending.delete(i);rej(new Error('to '+method));}},120000);});};
  const t=await send('Target.createTarget',{url:'about:blank'});
  const s=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid); if(r.exceptionDetails) return 'ERR '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text); return r.result.value;};
  await send('Page.navigate',{url:BASE},sid); await sleep(11000);
  const rows = await ev(`(async()=>{
    const out=[]; const pageSize=100; let page=1;
    for(;;){
      const r = await cloud.database.from('articles').select('id,title,summary,content,cover,tags,views,created_at,updated_at,status,series_id,series_order')
        .eq('status','published').order('id',{ascending:true}).range((page-1)*pageSize, page*pageSize-1);
      if(r.error) return 'ERR '+r.error.message;
      const d=r.data||[]; out.push(...d); if(d.length<pageSize) break; page++;
    }
    return out;
  })()`);
  if (typeof rows === 'string' && rows.startsWith('ERR')) { console.error(rows); child.kill(); process.exit(1); }
  console.log('导出行数:', rows.length);
  console.log('id=24 正文字符数:', (rows.find(r=>r.id===24)||{}).content.length);
  console.log('id=24 含核对时间:', ((rows.find(r=>r.id===24)||{}).content||'').includes('核对时间'));
  const outPath = String.raw`E:\student\project\AI Training Lab\.workbuddy\data\articles.json`;
  fs.writeFileSync(outPath, JSON.stringify(rows), 'utf8');
  console.log('已写入:', outPath, fs.statSync(outPath).size, 'bytes');
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
