const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const PORT=9401;
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
  const send=(method,params={},sessionId)=>{const i=++id;const msg={id:i,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));return new Promise((res,rej)=>{pending.set(i,{res,rej});setTimeout(()=>{if(pending.has(i)){pending.delete(i);rej(new Error('to '+method));}},60000);});};
  const t=await send('Target.createTarget',{url:'about:blank'});
  const s=await send('Target.attachToTarget',{targetId:t.targetId,flatten:true}); const sid=s.sessionId;
  await send('Page.enable',{},sid); await send('Runtime.enable',{},sid); await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},sid);
  const ev=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},sid); if(r.exceptionDetails) return 'ERR '+((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text); return r.result.value;};
  await send('Page.navigate',{url:BASE+'#/'},sid); await sleep(8000);
  /* 首页前 6 张卡片：检查高度是否一致、摘要是否溢出、有没有压到 meta */
  const grid = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.article-grid .article-card')).slice(0,6);
    var over=[];
    cards.forEach(function(c){
      var s=c.querySelector('.card-summary'), m=c.querySelector('.card-meta');
      if(!s||!m) return;
      var sr=s.getBoundingClientRect(), mr=m.getBoundingClientRect();
      if(sr.bottom > mr.top + 1) over.push({title:(c.querySelector('.card-title')||{}).textContent.slice(0,16), overBy:Math.round(sr.bottom-mr.top)});
    });
    var heights=cards.map(function(c){return Math.round(c.getBoundingClientRect().height);});
    var g=document.querySelector('.article-grid').getBoundingClientRect();
    return {cardHeights:heights, uniformHeights: new Set(heights).size===1, overflowCount:over.length, overflows:over, gridH:Math.round(g.height), cardCount:cards.length};
  })()`);
  const rect = await ev(`(function(){var g=document.querySelector('.article-grid'); var r=g.getBoundingClientRect(); return {x:Math.round(r.left),y:Math.round(r.top+window.scrollY),w:Math.round(r.width),h:Math.round(r.height)};})()`);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:rect.x,y:rect.y,width:rect.w,height:Math.min(rect.h,900),scale:1}},sid);
  const out=path.join(os.tmpdir(),'home-cards.png');
  fs.writeFileSync(out, Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify({check:grid, screenshot:out},null,2)); child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e);child.kill();process.exit(1);});
