/* 极简 CDP 客户端：无依赖，Node 22 内置 WebSocket */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const URL = process.argv[2] || 'http://127.0.0.1:8080/#/login';
const PRE = process.argv[3] || ''; // 形如 key=val;key2=val2 预置 localStorage

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcdp-'));
const child = spawn(EDGE, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + udd,
  '--no-first-run',
  '--disable-gpu',
  '--window-size=480,900',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 未就绪');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else {
      this.events.push(msg);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }
}

async function main() {
  const wsUrl = await getWs();
  const ws = new WebSocket(wsUrl);
  const cdp = new Cdp(ws);
  ws.addEventListener('message', (e) => cdp.onMessage(e.data));
  await new Promise((r) => ws.addEventListener('open', r));

  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const session = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = session.sessionId;
  const raw = (method, params) => {
    const id = ++cdp.id;
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
    return new Promise((resolve, reject) => {
      cdp.pending.set(id, { resolve, reject });
      setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  };

  await raw('Page.enable', {});
  await raw('Runtime.enable', {});
  await raw('Log.enable', {});

  // 预置 localStorage
  if (PRE) {
    await raw('Page.navigate', { url: 'http://127.0.0.1:8080/' });
    await sleep(2500);
    for (const pair of PRE.split(';;')) {
      const idx = pair.indexOf('=');
      const k = pair.slice(0, idx);
      const v = pair.slice(idx + 1);
      await raw('Runtime.evaluate', {
        expression: 'localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ')',
      });
    }
  }

  await raw('Page.navigate', { url: URL });
  await sleep(6000);

  const evalx = async (expr) => {
    const r = await raw('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text || JSON.stringify(r.exceptionDetails) };
    return r.result.value;
  };

  const out = {};
  out.tabs = await evalx(`Array.from(document.querySelectorAll('.tabs button')).map(b=>b.textContent)`);
  out.rememberBox = await evalx(`!!document.querySelector('#pwd-remember')`);
  out.rememberLabel = await evalx(`(document.querySelector('.check-line span')||{}).textContent`);
  out.forgotText = await evalx(`(document.querySelector('#forgot-link')||{}).textContent`);
  out.switchText = await evalx(`(document.querySelector('.form-switch')||{}).textContent`);
  out.pwdVisible = await evalx(`!document.querySelector('#pwd-form').classList.contains('hidden')`);
  out.signupHidden = await evalx(`document.querySelector('#signup-form').classList.contains('hidden')`);
  out.prefillEmail = await evalx(`document.querySelector('#pwd-email').value`);
  out.prefillPwd = await evalx(`document.querySelector('#pwd-password').value`);
  out.rememberChecked = await evalx(`document.querySelector('#pwd-remember').checked`);
  out.hintHidden = await evalx(`document.querySelector('#remember-hint').classList.contains('hidden')`);

  // 切到注册
  await evalx(`document.querySelector('#go-signup-link').click()`);
  await sleep(400);
  out.afterSignupClick = await evalx(`({
    pwd: document.querySelector('#pwd-form').classList.contains('hidden'),
    su: !document.querySelector('#signup-form').classList.contains('hidden'),
    fields: Array.from(document.querySelectorAll('#signup-form .form-label')).map(l=>l.textContent),
    back: (document.querySelector('#su-back-link')||{}).textContent
  })`);

  // 返回登录
  await evalx(`document.querySelector('#su-back-link').click()`);
  await sleep(400);
  out.afterBack = await evalx(`({
    pwd: !document.querySelector('#pwd-form').classList.contains('hidden'),
    su: document.querySelector('#signup-form').classList.contains('hidden')
  })`);

  // 忘记密码
  await evalx(`document.querySelector('#forgot-link').click()`);
  await sleep(400);
  out.afterForgot = await evalx(`({
    pwd: document.querySelector('#pwd-form').classList.contains('hidden'),
    fg: !document.querySelector('#forgot-form').classList.contains('hidden')
  })`);
  await evalx(`document.querySelector('#fg-back-link').click()`);
  await sleep(300);

  // 勾选记住密码 → 写入 localStorage
  await evalx(`(()=>{
    const e=document.querySelector('#pwd-email'), p=document.querySelector('#pwd-password'), c=document.querySelector('#pwd-remember');
    e.value='test@example.com'; p.value='secret123'; c.checked=true;
    c.dispatchEvent(new Event('change'));
    return true;
  })()`);
  await sleep(300);
  out.saved = await evalx(`localStorage.getItem('alch.login.remember')`);
  out.hintVisibleAfterCheck = await evalx(`!document.querySelector('#remember-hint').classList.contains('hidden')`);

  // 取消勾选 → 清除
  await evalx(`(()=>{const c=document.querySelector('#pwd-remember');c.checked=false;c.dispatchEvent(new Event('change'));return true;})()`);
  await sleep(300);
  out.afterUncheck = await evalx(`localStorage.getItem('alch.login.remember')`);

  // 布局体检
  out.layout = await evalx(`(()=>{
    const card=document.querySelector('.login-card').getBoundingClientRect();
    const row=document.querySelector('.pwd-row').getBoundingClientRect();
    const cb=document.querySelector('#pwd-remember').getBoundingClientRect();
    const link=document.querySelector('#forgot-link').getBoundingClientRect();
    return {cardW:Math.round(card.width), rowW:Math.round(row.width),
      cbSize:Math.round(cb.width)+'x'+Math.round(cb.height),
      gap:Math.round(link.left-cb.right),
      sameLine:Math.abs(cb.top-link.top)<8};
  })()`);

  // 控制台错误
  out.consoleErrors = cdp.events.filter((e) => e.method === 'Log.entryAdded')
    .map((e) => e.params.entry.text).slice(0, 10);

  console.log(JSON.stringify(out, null, 2));

  // 截图
  const shot = await raw('Page.captureScreenshot', { format: 'png' });
  const file = process.argv[4] || path.join(os.tmpdir(), 'wb-login.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('SHOT ' + file);

  child.kill();
  process.exit(0);
}

main().catch((e) => { console.error('FAIL', e); child.kill(); process.exit(1); });
