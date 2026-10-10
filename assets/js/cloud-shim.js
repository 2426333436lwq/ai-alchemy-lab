/* cloud.auth 兼容层：把登录态接口映射到本站 /api/auth/*（Cloudflare D1）。
 *
 * 站点已彻底脱离 WorkBuddy 云 SDK，但 auth.js / util.js / app.js 仍然按
 * `cloud.auth.*` 的调用习惯写的，这里补一个最小实现（只做 auth），
 * 这样这些文件一行都不用改。数据层（文章/后台/存储）由 api.js 直接对接 REST。
 *
 * 会话 token 存 localStorage('alch.token')，随请求带 Authorization: Bearer。 */
(function () {
  'use strict';

  const TOKEN_KEY = 'alch.token';
  let listeners = [];

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
  }

  async function call(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const tk = getToken();
    if (tk) headers['Authorization'] = 'Bearer ' + tk;
    let res;
    try {
      res = await fetch('/api' + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, payload: { error: { message: '网络异常，请稍后重试' } } };
    }
    let payload = {};
    try { payload = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
    return { ok: res.ok, status: res.status, payload: payload || {} };
  }

  function errOf(r, fallback) {
    return { message: (r.payload && r.payload.error && r.payload.error.message) || fallback };
  }

  function emit(event, session) {
    listeners.forEach(function (cb) { try { cb(event, session); } catch (e) { /* 忽略回调异常 */ } });
  }

  const auth = {
    /* 是否启用邮箱验证码（由后端是否有邮件服务决定） */
    async getConfig() {
      const r = await call('/auth/config');
      return (r.payload && r.payload.data) || { otpEnabled: false };
    },

    async getSession() {
      if (!getToken()) return { data: null };
      const r = await call('/auth/session');
      if (!r.ok) {
        if (r.status === 401) setToken('');
        return { data: null };
      }
      return { data: r.payload.data || null };
    },

    async signInWithPassword(creds) {
      const r = await call('/auth/login', { method: 'POST', body: creds });
      if (!r.ok) return { error: errOf(r, '登录失败') };
      setToken(r.payload.data.token);
      emit('SIGNED_IN', r.payload.data);
      return { data: r.payload.data };
    },

    /* 无邮件服务时的纯密码注册（auth.js 在 otpEnabled=false 时调用） */
    async signUp(creds) {
      const r = await call('/auth/register', { method: 'POST', body: creds });
      if (!r.ok) return { error: errOf(r, '注册失败') };
      setToken(r.payload.data.token);
      emit('SIGNED_IN', r.payload.data);
      return { data: r.payload.data };
    },

    async signOut() {
      try { await call('/auth/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
      setToken('');
      emit('SIGNED_OUT', null);
      return { error: null };
    },

    async sendOtp(payload) {
      const r = await call('/auth/otp', { method: 'POST', body: payload });
      if (!r.ok) return { error: errOf(r, '验证码发送失败') };
      return { data: r.payload.data };
    },

    async verifyOtp(payload) {
      const r = await call('/auth/otp/verify', { method: 'POST', body: payload });
      if (!r.ok) return { error: errOf(r, '验证码校验失败') };
      setToken(r.payload.data.token);
      emit('SIGNED_IN', r.payload.data);
      return { data: r.payload.data };
    },

    async resetPasswordForEmail(email) {
      const r = await call('/auth/otp', { method: 'POST', body: { email: email } });
      if (!r.ok) return { error: errOf(r, '验证码发送失败') };
      return {
        data: {
          updateUser: async function (opts) {
            const rr = await call('/auth/reset', {
              method: 'POST',
              body: { email: email, nonce: opts.nonce, password: opts.password },
            });
            if (!rr.ok) return { error: errOf(rr, '重置失败') };
            setToken(rr.payload.data.token);
            emit('SIGNED_IN', rr.payload.data);
            return { data: rr.payload.data };
          },
        },
      };
    },

    onAuthStateChange(cb) {
      listeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: function () { listeners = listeners.filter(function (x) { return x !== cb; }); },
          },
        },
      };
    },
  };

  window.cloud = { auth: auth, llm: null };
})();
