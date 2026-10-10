/* 验证：机器人按钮可拖动 + 位置持久化 + 面板贴着按钮 + 主题配色 */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = Number(process.argv[2] || 9335);
const THEME = process.argv[3] || '';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, ['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+udd,'--no-first-run','--disable-gpu','--window-size=1280,900','about:blank'], {stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function getWs(){
  for(let i=0;i<60;i++){
    try{const j=await (await fetch('http://127.0.0.1:'+PORT+'/json/version')).json(); if(j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;}catch(e){}
    await sleep(500);
  } throw new Error('cdp not ready');
}
class Cdp{constructor(ws){this.ws=ws;this.id=0;this.p=new Map();} send(m,pr={}){const id=++this.id;this.ws.send(JSON.stringify({id,method:m,params:pr}));return new Promise((res,rej)=>{this.p.set(id,{res,rej});setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('to '+m));}},30000);});} onm(r){const m=JSON.parse(r); if(m.id&&this.p.has(m.id)){const q=this.p.get(m.id);this.p.delete(m.id); m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}}}

(async()=>{
  const ws=new WebSocket(await getWs()); const cdp=new Cdp(ws);
  ws.addEventListener('message',e=>cdp.onm(e.data));
  await new Promise(r=>ws.addEventListener('open',r));
  const t=await cdp.send('Target.createTarget',{url:'about:blank'});
  const s=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true});
  const sid=s.sessionId;
  const raw=(m,pr={})=>{const id=++cdp.id;ws.send(JSON.stringify({id,method:m,params:pr,sessionId:sid}));return new Promise((res,rej)=>{cdp.p.set(id,{res,rej});setTimeout(()=>{if(cdp.p.has(id)){cdp.p.delete(id);rej(new Error('to '+m));}},30000);});};
  await raw('Page.enable',{}); await raw('Runtime.enable',{});
  await raw('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});

  // 主题预置
  await raw('Page.navigate',{url:'http://127.0.0.1:8080/'});
  await sleep(2500);
  if (THEME) await raw('Runtime.evaluate',{expression:`localStorage.setItem('site-theme',${JSON.stringify(THEME)})`});
  await raw('Page.navigate',{url:'http://127.0.0.1:8080/#/'});
  await sleep(4500);

  const ev = async (expr) => {
    const r = await raw('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if (r.exceptionDetails) return {__err: r.exceptionDetails.text};
    return r.result.value;
  };
  const mouse = async (type, x, y, btn='left', clicks=1) =>
    raw('Input.dispatchMouseEvent',{type,x,y,button:btn,clickCount:clicks,buttons: btn==='left'&&type!=='mouseReleased'?1:0});

  const out = {};
  out.theme = await ev(`document.documentElement.getAttribute('data-theme')||'ink'`);
  out.fabExists = await ev(`!!document.querySelector('#ask-fab')`);
  const r0 = await ev(`(()=>{const b=document.querySelector('#ask-fab').getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width)}})()`);
  out.startRect = r0;

  // 拖动到 (300, 400)
  const cx = r0.x + r0.w/2, cy = r0.y + r0.w/2;
  await mouse('mousePressed', cx, cy);
  await mouse('mouseMoved', cx-40, cy-40);
  await mouse('mouseMoved', 300, 400);
  await mouse('mouseReleased', 300, 400);
  await sleep(300);
  out.afterDrag = await ev(`(()=>{const b=document.querySelector('#ask-fab').getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y)}})()`);
  out.saved = await ev(`localStorage.getItem('alch.ask.fabPos')`);
  out.panelOpenedByDrag = await ev(`document.querySelector('#ask-panel').classList.contains('open')`);

  // 刷新后是否记住位置
  await raw('Page.navigate',{url:'http://127.0.0.1:8080/#/'});
  await sleep(4500);
  out.afterReload = await ev(`(()=>{const b=document.querySelector('#ask-fab').getBoundingClientRect();return {x:Math.round(b.x),y:Math.round(b.y)}})()`);

  // 单击（不移动）应打开面板，并贴在按钮旁
  const rr = await ev(`(()=>{const b=document.querySelector('#ask-fab').getBoundingClientRect();return {cx:b.x+b.width/2, cy:b.y+b.height/2}})()`);
  await mouse('mousePressed', rr.cx, rr.cy);
  await mouse('mouseReleased', rr.cx, rr.cy);
  await sleep(500);
  out.panelOpen = await ev(`document.querySelector('#ask-panel').classList.contains('open')`);
  out.panelPos = await ev(`(()=>{const p=document.querySelector('#ask-panel').getBoundingClientRect();const f=document.querySelector('#ask-fab').getBoundingClientRect();return {panel:{x:Math.round(p.x),y:Math.round(p.y),w:Math.round(p.width),h:Math.round(p.height)}, fab:{x:Math.round(f.x),y:Math.round(f.y)}, gap:Math.round(f.y-p.bottom), inViewport: p.x>=0 && p.y>=0 && p.right<=innerWidth && p.bottom<=innerHeight}})()`);

  // 发一条消息，产生用户气泡（联网失败也无妨，气泡会先渲染出来）
  await ev(`(()=>{const i=document.querySelector('#ask-panel .ask-input input'); if(!i) return false; i.value='测试一下'; document.querySelector('#ask-panel .ask-input button').click(); return true})()`);
  await sleep(800);
  out.userBubble = await ev(`!!document.querySelector('.ask-msg.user')`);

  // 主题配色
  out.colors = await ev(`(()=>{
    const cs=n=>{const el=document.querySelector(n); return el?getComputedStyle(el):null;};
    const pick=(el,k)=>el?el[k]:null;
    const p=cs('#ask-panel'), f=cs('#ask-fab'), h=cs('.ask-head'), b=cs('.ask-msg.bot'), u=cs('.ask-msg.user'), i=cs('.ask-input input'), s=cs('.ask-input button');
    return {panelBg:pick(p,'backgroundColor'), panelBorder:pick(p,'borderTopColor'), panelColor:pick(p,'color'),
      fabBg:pick(f,'backgroundColor'), fabColor:pick(f,'color'), headBg:pick(h,'backgroundColor'),
      botBg:pick(b,'backgroundColor'), botColor:pick(b,'color'), userBg:pick(u,'backgroundColor'), userColor:pick(u,'color'),
      inputBg:pick(i,'backgroundColor'), inputColor:pick(i,'color'), sendBg:pick(s,'backgroundColor'),
      cardVar:getComputedStyle(document.documentElement).getPropertyValue('--card').trim()};
  })()`);

  const shot = await raw('Page.captureScreenshot',{format:'png'});
  const file = path.join(os.tmpdir(), 'wb-ask-' + out.theme + '.png');
  fs.writeFileSync(file, Buffer.from(shot.data,'base64'));
  out.shot = file;
  console.log(JSON.stringify(out,null,2));
  child.kill(); process.exit(0);
})().catch(e=>{console.error('FAIL',e); child.kill(); process.exit(1);});
