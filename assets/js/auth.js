/* 登录 / 注册 / 找回密码：邮箱密码 + 邮箱验证码（Web 端支持邮箱方式） */
(function () {
  'use strict';

  const Auth = {};

  /* 保存中的验证码挑战（发送与提交分离，重试错误码不重发） */
  let pendingOtp = null; // { email, verificationId, isExistingUser }

  function showMsg(el, msg, ok) {
    el.className = ok ? 'form-ok' : 'form-error';
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideMsg(el) { el.classList.add('hidden'); }

  function gotoAfterLogin() {
    const target = sessionStorage.getItem('redirectAfterLogin') || '#/';
    sessionStorage.removeItem('redirectAfterLogin');
    location.hash = target;
  }

  function startCountdown(btn, seconds) {
    let left = seconds;
    btn.disabled = true;
    const raw = btn.textContent;
    btn.textContent = left + ' 秒后重发';
    const timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = raw;
      } else {
        btn.textContent = left + ' 秒后重发';
      }
    }, 1000);
  }

  /* ---------------- 登录页 ---------------- */

  Auth.viewLogin = async function (root) {
    const session = await Util.getSession();
    if (session) { gotoAfterLogin(); return; }

    root.innerHTML =
      '<div class="login-wrap"><div class="card login-card">' +
      '<h1 class="login-title">丹房门禁</h1>' +
      '<p class="login-sub">邮箱登录 · 写作与下载附件需要身份认证</p>' +
      '<div class="tabs">' +
      '<button data-tab="password" class="active">密码登录</button>' +
      '<button data-tab="otp">验证码登录</button>' +
      '</div>' +
      '<div id="login-msg" class="hidden"></div>' +
      '<div id="tab-password"></div>' +
      '<div id="tab-otp" class="hidden"></div>' +
      '</div></div>';

    const msgEl = Util.$('#login-msg', root);
    const panes = {
      password: Util.$('#tab-password', root),
      otp: Util.$('#tab-otp', root),
    };

    Util.$$('.tabs button', root).forEach(function (btn) {
      btn.addEventListener('click', function () {
        Util.$$('.tabs button', root).forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        Object.keys(panes).forEach(function (key) {
          panes[key].classList.toggle('hidden', key !== btn.getAttribute('data-tab'));
        });
        hideMsg(msgEl);
      });
    });

    buildPasswordPane(panes.password, msgEl);
    buildOtpPane(panes.otp, msgEl);
  };

  /* ---------- 记住密码：本机保存（可逆混淆，非加密） ---------- */
  const REMEMBER_KEY = 'alch.login.remember';

  function obf(s) { try { return btoa(encodeURIComponent(s)); } catch (e) { return ''; } }
  function deobf(s) { try { return decodeURIComponent(atob(s)); } catch (e) { return ''; } }

  function saveRemembered(email, password) {
    try {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({
        email: email, pwd: obf(password), at: Date.now(),
      }));
    } catch (e) { /* 隐私模式下可能写不进去，忽略 */ }
  }

  function clearRemembered() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (e) { /* 忽略 */ }
  }

  function loadRemembered() {
    try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null'); } catch (e) { return null; }
  }

  /* ---------- 密码登录 + 注册 + 忘记密码（同一面板内切换） ---------- */
  function buildPasswordPane(pane, msgEl) {
    pane.innerHTML =
      /* 登录 */
      '<form id="pwd-form">' +
      '<div class="form-field"><label class="form-label">邮箱</label>' +
      '<input class="input" type="email" id="pwd-email" required autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="form-field"><label class="form-label">密码</label>' +
      '<input class="input" type="password" id="pwd-password" required autocomplete="current-password" placeholder="输入密码"></div>' +
      '<div class="pwd-row">' +
      '<label class="check-line"><input type="checkbox" id="pwd-remember"><span>记住密码</span></label>' +
      '<a id="forgot-link">忘记密码？</a>' +
      '</div>' +
      '<div id="remember-hint" class="form-hint hidden">邮箱与密码保存在本机浏览器（非加密），公用电脑请勿勾选</div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">开炉登录</button></div>' +
      '<div class="form-switch">还没有账号？<a id="go-signup-link">注册新账号</a></div>' +
      '</form>' +
      /* 注册 */
      '<form id="signup-form" class="hidden">' +
      '<div class="form-field"><label class="form-label">邮箱</label>' +
      '<input class="input" type="email" id="su-email" required autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="form-field"><label class="form-label">设置密码</label>' +
      '<input class="input" type="password" id="su-password" required minlength="6" autocomplete="new-password" placeholder="至少 6 位"></div>' +
      '<div class="form-field"><label class="form-label">确认密码</label>' +
      '<input class="input" type="password" id="su-password2" required minlength="6" autocomplete="new-password" placeholder="再输入一次"></div>' +
      '<div class="form-field"><label class="form-label">邮箱验证码</label>' +
      '<div class="otp-row"><input class="input" type="text" id="su-code" required placeholder="6 位验证码" maxlength="8">' +
      '<button class="btn" type="button" id="su-send">获取验证码</button></div>' +
      '<div class="form-hint">先填邮箱点「获取验证码」，收到后再提交</div></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">注册并登录</button></div>' +
      '<div class="form-switch">已有账号？<a id="su-back-link">返回密码登录</a></div>' +
      '</form>' +
      /* 忘记密码 */
      '<form id="forgot-form" class="hidden">' +
      '<div class="form-field"><label class="form-label">邮箱</label>' +
      '<input class="input" type="email" id="fg-email" required placeholder="注册时使用的邮箱"></div>' +
      '<div class="form-field"><label class="form-label">邮箱验证码</label>' +
      '<div class="otp-row"><input class="input" type="text" id="fg-code" required placeholder="6 位验证码" maxlength="8">' +
      '<button class="btn" type="button" id="fg-send">获取验证码</button></div></div>' +
      '<div class="form-field"><label class="form-label">新密码</label>' +
      '<input class="input" type="password" id="fg-password" required minlength="6" placeholder="至少 6 位"></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">重置并登录</button></div>' +
      '<div class="form-switch"><a id="fg-back-link">返回密码登录</a></div>' +
      '</form>';

    const pwdForm = Util.$('#pwd-form', pane);
    const signupForm = Util.$('#signup-form', pane);
    const forgotForm = Util.$('#forgot-form', pane);

    function showForm(form) {
      [pwdForm, signupForm, forgotForm].forEach(function (f) {
        f.classList.toggle('hidden', f !== form);
      });
      hideMsg(msgEl);
    }

    Util.$('#go-signup-link', pane).addEventListener('click', function () { showForm(signupForm); });
    Util.$('#su-back-link', pane).addEventListener('click', function () { showForm(pwdForm); });
    Util.$('#forgot-link', pane).addEventListener('click', function () { showForm(forgotForm); });
    Util.$('#fg-back-link', pane).addEventListener('click', function () { showForm(pwdForm); });

    /* ---- 记住密码 ---- */
    const rememberBox = Util.$('#pwd-remember', pane);
    const rememberHint = Util.$('#remember-hint', pane);
    const emailInput = Util.$('#pwd-email', pane);
    const pwdInput = Util.$('#pwd-password', pane);

    function syncHint() { rememberHint.classList.toggle('hidden', !rememberBox.checked); }

    const saved = loadRemembered();
    if (saved && saved.email) {
      emailInput.value = saved.email;
      if (saved.pwd) pwdInput.value = deobf(saved.pwd);
      rememberBox.checked = true;
    }
    syncHint();

    rememberBox.addEventListener('change', function () {
      syncHint();
      if (rememberBox.checked) {
        if (emailInput.value.trim() && pwdInput.value) {
          saveRemembered(emailInput.value.trim(), pwdInput.value);
        }
      } else {
        clearRemembered();
      }
    });

    pwdForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const email = emailInput.value.trim();
      const password = pwdInput.value;
      const btn = Util.$('button[type="submit"]', pwdForm);
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const res = await cloud.auth.signInWithPassword({ email: email, password: password });
        if (res.error) { showMsg(msgEl, '账号或密码不正确'); return; }
        if (rememberBox.checked) { saveRemembered(email, password); } else { clearRemembered(); }
        Util.toast('登录成功，炉火正旺', 'success');
        gotoAfterLogin();
      } catch (err) {
        showMsg(msgEl, err.message || '登录失败，请稍后重试');
      } finally {
        btn.disabled = false;
      }
    });

    /* ---- 注册 ---- */
    Util.$('#su-send', pane).addEventListener('click', async function () {
      const email = Util.$('#su-email', pane).value.trim();
      if (!email) { showMsg(msgEl, '请先输入邮箱'); return; }
      const btn = this;
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const sent = await cloud.auth.sendOtp({ email: email });
        if (sent.error) { showMsg(msgEl, sent.error.message || '验证码发送失败'); btn.disabled = false; return; }
        pendingOtp = {
          email: email,
          verificationId: sent.data.verificationId,
          isExistingUser: sent.data.isExistingUser,
        };
        showMsg(msgEl, '验证码已发送，请查收邮箱', true);
        startCountdown(btn, 60);
      } catch (err) {
        showMsg(msgEl, err.message || '验证码发送失败');
        btn.disabled = false;
      }
    });

    signupForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const email = Util.$('#su-email', pane).value.trim();
      const password = Util.$('#su-password', pane).value;
      const password2 = Util.$('#su-password2', pane).value;
      const code = Util.$('#su-code', pane).value.trim();
      if (password !== password2) { showMsg(msgEl, '两次输入的密码不一致'); return; }
      if (!pendingOtp || pendingOtp.email !== email) {
        showMsg(msgEl, '请先为当前邮箱获取验证码');
        return;
      }
      const btn = Util.$('button[type="submit"]', signupForm);
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const completed = await cloud.auth.verifyOtp({
          email: pendingOtp.email,
          verificationId: pendingOtp.verificationId,
          isExistingUser: pendingOtp.isExistingUser,
          token: code,
          password: pendingOtp.isExistingUser ? undefined : password,
        });
        if (completed.error) { showMsg(msgEl, completed.error.message || '注册失败，请检查验证码'); return; }
        pendingOtp = null;
        Util.toast('注册成功，欢迎来到丹房', 'success');
        gotoAfterLogin();
      } catch (err) {
        showMsg(msgEl, err.message || '注册失败，请稍后重试');
      } finally {
        btn.disabled = false;
      }
    });

    /* ---- 忘记密码 ---- */
    let forgotFlow = null; // resetPasswordForEmail 返回的 challenge
    Util.$('#fg-send', pane).addEventListener('click', async function () {
      const email = Util.$('#fg-email', pane).value.trim();
      if (!email) { showMsg(msgEl, '请先输入邮箱'); return; }
      const btn = this;
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const started = await cloud.auth.resetPasswordForEmail(email);
        if (started.error) { showMsg(msgEl, started.error.message || '验证码发送失败'); btn.disabled = false; return; }
        forgotFlow = started.data;
        showMsg(msgEl, '验证码已发送，请查收邮箱', true);
        startCountdown(btn, 60);
      } catch (err) {
        showMsg(msgEl, err.message || '验证码发送失败');
        btn.disabled = false;
      }
    });

    forgotForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!forgotFlow) { showMsg(msgEl, '请先获取验证码'); return; }
      const code = Util.$('#fg-code', pane).value.trim();
      const password = Util.$('#fg-password', pane).value;
      const btn = Util.$('button[type="submit"]', forgotForm);
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const completed = await forgotFlow.updateUser({ nonce: code, password: password });
        if (completed.error) { showMsg(msgEl, completed.error.message || '重置失败，请检查验证码'); return; }
        forgotFlow = null;
        Util.toast('密码已重置，已自动登录', 'success');
        gotoAfterLogin();
      } catch (err) {
        showMsg(msgEl, err.message || '重置失败，请稍后重试');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------- 验证码登录 ---------- */
  function buildOtpPane(pane, msgEl) {
    pane.innerHTML =
      '<form id="otp-form">' +
      '<div class="form-field"><label class="form-label">邮箱</label>' +
      '<input class="input" type="email" id="otp-email" required autocomplete="email" placeholder="you@example.com"></div>' +
      '<div class="form-field"><label class="form-label">邮箱验证码</label>' +
      '<div class="otp-row"><input class="input" type="text" id="otp-code" required placeholder="6 位验证码" maxlength="8">' +
      '<button class="btn" type="button" id="otp-send">获取验证码</button></div></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">登录</button></div>' +
      '</form>';

    const form = Util.$('#otp-form', pane);
    Util.$('#otp-send', pane).addEventListener('click', async function () {
      const email = Util.$('#otp-email', pane).value.trim();
      if (!email) { showMsg(msgEl, '请先输入邮箱'); return; }
      const btn = this;
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const sent = await cloud.auth.sendOtp({ email: email });
        if (sent.error) { showMsg(msgEl, sent.error.message || '验证码发送失败'); btn.disabled = false; return; }
        pendingOtp = {
          email: email,
          verificationId: sent.data.verificationId,
          isExistingUser: sent.data.isExistingUser,
        };
        showMsg(msgEl, '验证码已发送，请查收邮箱', true);
        startCountdown(btn, 60);
      } catch (err) {
        showMsg(msgEl, err.message || '验证码发送失败');
        btn.disabled = false;
      }
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const email = Util.$('#otp-email', pane).value.trim();
      const code = Util.$('#otp-code', pane).value.trim();
      if (!pendingOtp || pendingOtp.email !== email) {
        showMsg(msgEl, '请先为当前邮箱获取验证码');
        return;
      }
      const btn = Util.$('button[type="submit"]', form);
      btn.disabled = true;
      hideMsg(msgEl);
      try {
        const completed = await cloud.auth.verifyOtp({
          email: pendingOtp.email,
          verificationId: pendingOtp.verificationId,
          isExistingUser: pendingOtp.isExistingUser,
          token: code,
        });
        if (completed.error) { showMsg(msgEl, completed.error.message || '验证码不正确'); return; }
        pendingOtp = null;
        Util.toast('登录成功，炉火正旺', 'success');
        gotoAfterLogin();
      } catch (err) {
        showMsg(msgEl, err.message || '登录失败，请稍后重试');
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------------- 退出 ---------------- */
  Auth.signOut = async function () {
    try { await cloud.auth.signOut(); } catch (e) { /* 忽略 */ }
    Util.toast('已退出登录', 'info');
    if (location.hash.indexOf('#/admin') === 0 || location.hash === '#/login') {
      location.hash = '#/';
    } else if (window.App && App.renderHeader) {
      App.renderHeader();
    }
  };

  window.Auth = Auth;
})();
