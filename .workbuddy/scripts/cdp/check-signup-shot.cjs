const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:8080/#/login';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','--window-size=480,900','about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function getWs() {
  for(let i=0;i<60;i++){
    try{ const j=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; }catch(e){}
    await sleep(500);
  } throw new Error('cdp not ready');
}
class Cdp { constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();} send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res,rej)=>{this.pending.set(id,{res,rej});setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('to '+method));}},30000);});} onm(raw){const m=JSON.parse(raw); if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}} }

(async()=>{
  const ws = new WebSocket(await getWs());
  const cdp = new Cdp(ws); ws.addEventListener('message',e=>cdp.onm(e.data));
  await new Promise(r=>ws.addEventListener('open',r));
  const target=await cdp.send('Target.createTarget',{url:'about:blank'});
  const sess=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const sid=sess.sessionId;
  const raw=(method,params)=>{const id=++cdp.id;ws.send(JSON.stringify({id,method,params,sessionId:sid}));return new Promise((res,rej)=>{cdp.pending.set(id,{res,rej});setTimeout(()=>{if(cdp.pending.has(id)){cdp.pending.delete(id);rej(new Error('to '+method));}},30000);});};
  await raw('Page.enable',{}); await raw('Runtime.enable',{});
  await raw('Page.navigate',{url:URL}); await sleep(6000);
  await raw('Runtime.evaluate',{expression:`document.querySelector('#go-signup-link').click()`,returnByValue:true});
  await sleep(500);
  const shot=await raw('Page.captureScreenshot',{format:'png'});
  const file=path.join(os.tmpdir(),'wb-signup-form.png');
  fs.writeFileSync(file,Buffer.from(shot.data,'base64')); console.log('SHOT '+file);
  child.kill(); process.exit(0);
})().catch(e=>{console.error(e);child.kill();process.exit(1);});
