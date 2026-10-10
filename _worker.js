/* Cloudflare Worker 入口：静态前端 + 文章/评论/问答 + 账号体系 + 后台（全部落 D1）
 *
 * 路由总览：
 *   -- 公开 --
 *   GET  /api/auth/config            是否有邮件服务（决定要不要邮箱验证码）
 *   GET  /api/articles               文章列表（分页/标签/搜索）
 *   GET  /api/articles/:id           文章详情（含正文，自增阅读）
 *   GET  /api/comments?article_id=   评论列表
 *   POST /api/comments               匿名发表评论
 *   POST /api/ask                    AI 问答（代理智谱）
 *   GET  /api/series                 系列（带计数）
 *   GET  /api/series/:id             单个系列
 *   GET  /api/series/:id/articles    系列内文章
 *   GET  /api/site-settings          站点设置
 *   GET  /api/storage/blob?path=     读取文件字节
 *   -- 需登录 --
 *   POST /api/auth/register|login|logout|password|otp|otp/verify|reset
 *   GET  /api/auth/session
 *   GET/POST /api/me/theme
 *   POST /api/storage                上传（base64）
 *   GET  /api/storage/list           我的素材列表
 *   POST /api/storage/delete         删除素材
 *   GET  /api/admin/is-admin|is-owner|admins|admins/count|articles|attachments|series|comments
 *   POST /api/admin/claim|articles|series|tags/rename|tags/delete|settings|admins
 *   PUT/DELETE /api/admin/articles/:id|series/:id|comments/:id|admins/:uid
 *
 * 说明：站点无邮箱服务时（未配置 RESEND_API_KEY / MAIL_WEBHOOK），注册走纯邮箱密码，
 *       /api/auth/config 返回 otpEnabled=false，前端据此隐藏验证码环节。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      /* 必须 await：routeApi 返回 Promise，不 await 的话内部 reject 会逃出 try/catch，
         变成 Cloudflare「error code: 1101」，前端只能看到笼统的失败提示 */
      const routed = await routeApi(request, env, url, cors);
      if (routed) return routed;
    } catch (err) {
      return json({ error: { message: String((err && err.message) || err) } }, 500, cors);
    }

    return env.ASSETS.fetch(request);
  },
};

/* 路由：命中返回 Response，未命中返回 null（交给静态资源） */
async function routeApi(request, env, url, cors) {
  const path = url.pathname;
  const method = request.method;

  // ---------- auth ----------
  if (path === '/api/auth/config' && method === 'GET') return authConfig(env, cors);
  if (path === '/api/auth/register' && method === 'POST') return authRegister(request, env, cors);
  if (path === '/api/auth/login' && method === 'POST') return authLogin(request, env, cors);
  if (path === '/api/auth/logout' && method === 'POST') return authLogout(request, env, cors);
  if (path === '/api/auth/session' && method === 'GET') return authSession(request, env, cors);
  if (path === '/api/auth/password' && method === 'POST') return authChangePassword(request, env, cors);
  if (path === '/api/auth/otp' && method === 'POST') return authSendOtp(request, env, cors);
  if (path === '/api/auth/otp/verify' && method === 'POST') return authVerifyOtp(request, env, cors);
  if (path === '/api/auth/reset' && method === 'POST') return authReset(request, env, cors);

  // ---------- 公开内容 ----------
  if (path === '/api/articles' && method === 'GET') return listArticles(env, url, cors);
  const artM = path.match(/^\/api\/articles\/(\d+)$/);
  if (artM && method === 'GET') return getArticle(env, artM[1], cors);
  if (path === '/api/comments') {
    if (method === 'POST') return createComment(request, env, cors);
    if (method === 'GET') return listComments(env, url, cors);
  }
  if (path === '/api/ask' && method === 'POST') return handleAsk(request, env, cors);
  if (path === '/api/series' && method === 'GET') return listSeries(env, cors);
  const serM = path.match(/^\/api\/series\/(\d+)$/);
  if (serM && method === 'GET') return getSeries(env, serM[1], cors);
  const serArtM = path.match(/^\/api\/series\/(\d+)\/articles$/);
  if (serArtM && method === 'GET') return listSeriesArticles(env, serArtM[1], cors);
  if (path === '/api/site-settings' && method === 'GET') return getSettings(env, cors);
  if (path === '/api/storage/blob' && method === 'GET') return storageBlob(env, url, cors);

  // ---------- 个人偏好 ----------
  if (path === '/api/me/theme') {
    if (method === 'GET') return themeGet(request, env, cors);
    if (method === 'POST') return themePut(request, env, cors);
  }

  // ---------- 存储 ----------
  if (path === '/api/storage' && method === 'POST') return storagePut(request, env, cors);
  if (path === '/api/storage/list' && method === 'GET') return storageList(request, env, cors);
  if (path === '/api/storage/delete' && method === 'POST') return storageDelete(request, env, cors);

  // ---------- 附件 ----------
  if (path === '/api/attachments') {
    if (method === 'GET') return listAttachments(env, url, cors);
    if (method === 'POST') return addAttachment(request, env, cors);
  }
  const attM = path.match(/^\/api\/attachments\/(\d+)$/);
  if (attM && method === 'DELETE') return deleteAttachment(request, env, attM[1], cors);

  // ---------- 后台 ----------
  // 认领站长放在守卫之前：任何已登录用户都能尝试，仅在「尚无站长」时成功
  if (path === '/api/admin/claim' && method === 'POST') return adminClaim(request, env, cors);
  if (path.indexOf('/api/admin/') === 0) return handleAdmin(request, env, url, cors);

  return null;
}

/* ============ 基础工具 ============ */

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors || {}),
  });
}

function ok(data, cors) { return json({ data: data }, 200, cors); }
function fail(msg, status, cors) { return json({ error: { message: msg } }, status || 400, cors); }

async function readBody(request) {
  try { return (await request.json()) || {}; } catch (e) { return {}; }
}

function hex(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function randomHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return hex(b.buffer);
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  return hex(bits);
}

async function verifyPassword(password, salt, hash) {
  const h = await hashPassword(password, salt);
  return h === hash;
}

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_BLOB_CHARS = 1_200_000; // base64 长度上限（约 900KB 原始）

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/* 用 token 换用户（顺便清理过期会话） */
async function getUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const s = await env.DB.prepare('SELECT token, user_id, expires_at FROM sessions WHERE token = ?').bind(token).first();
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const u = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(s.user_id).first();
  return u || null;
}

async function isAdminUser(env, userId) {
  if (!userId) return false;
  const r = await env.DB.prepare('SELECT role FROM admins WHERE user_id = ?').bind(userId).first();
  return !!r;
}

async function isOwnerUser(env, userId) {
  if (!userId) return false;
  const r = await env.DB.prepare("SELECT role FROM admins WHERE user_id = ? AND role = 'owner'").bind(userId).first();
  return !!r;
}

async function requireAdmin(request, env) {
  const u = await getUser(request, env);
  if (!u) return { error: fail('请先登录', 401, {}) };
  const admin = await isAdminUser(env, u.id);
  if (!admin) return { error: fail('需要站长权限', 403, {}) };
  return { user: u };
}

async function newSession(env, userId) {
  const token = randomHex(32);
  const exp = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, exp).run();
  return token;
}

/* ============ 认证 ============ */

function mailConfigured(env) { return !!(env.RESEND_API_KEY || env.MAIL_WEBHOOK); }

function authConfig(env, cors) {
  return ok({ otpEnabled: mailConfigured(env) }, cors);
}

async function authRegister(request, env, cors) {
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('邮箱格式不正确', 400, cors);
  if (password.length < 6) return fail('密码至少 6 位', 400, cors);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return fail('该邮箱已注册，请直接登录', 409, cors);

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const row = await env.DB.prepare('INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?) RETURNING id, email')
    .bind(email, hash, salt).first();
  const token = await newSession(env, row.id);
  return ok({ token: token, user: { id: row.id, email: row.email } }, cors);
}

async function authLogin(request, env, cors) {
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const u = await env.DB.prepare('SELECT id, email, password_hash, salt FROM users WHERE email = ?').bind(email).first();
  if (!u) return fail('账号或密码不正确', 401, cors);
  const good = await verifyPassword(password, u.salt, u.password_hash);
  if (!good) return fail('账号或密码不正确', 401, cors);
  const token = await newSession(env, u.id);
  return ok({ token: token, user: { id: u.id, email: u.email } }, cors);
}

async function authLogout(request, env, cors) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return ok(true, cors);
}

async function authSession(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return ok(null, cors);
  const admin = await isAdminUser(env, u.id);
  const owner = await isOwnerUser(env, u.id);
  return ok({ user: { id: u.id, email: u.email, isAdmin: admin, isOwner: owner } }, cors);
}

async function authChangePassword(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const body = await readBody(request);
  const password = String(body.password || '');
  if (password.length < 6) return fail('密码至少 6 位', 400, cors);
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, u.id).run();
  return ok(true, cors);
}

/* 邮箱验证码：仅在配置了邮件服务时可用 */
async function sendMail(env, to, subject, text) {
  if (env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'onboarding@resend.dev', to: to, subject: subject, text: text }),
    });
    if (!res.ok) throw new Error('邮件发送失败（' + res.status + '）');
    return;
  }
  if (env.MAIL_WEBHOOK) {
    const res = await fetch(env.MAIL_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: to, subject: subject, text: text }),
    });
    if (!res.ok) throw new Error('邮件发送失败（' + res.status + '）');
    return;
  }
  throw new Error('未配置邮件服务');
}

async function authSendOtp(request, env, cors) {
  if (!mailConfigured(env)) return fail('未配置邮件服务，请使用密码登录', 400, cors);
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return fail('请填写邮箱', 400, cors);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const exp = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await env.DB.prepare('INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .bind(email, code, 'login', exp).run();
  await sendMail(env, email, 'AI 炼丹房 · 验证码', '你的验证码是 ' + code + '，10 分钟内有效。');
  return ok({ verificationId: email, isExistingUser: !!existing }, cors);
}

async function consumeOtp(env, email, code) {
  const row = await env.DB.prepare(
    "SELECT id, expires_at FROM otp_codes WHERE email = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1"
  ).bind(email, code).first();
  if (!row) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  await env.DB.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').bind(row.id).run();
  return true;
}

async function authVerifyOtp(request, env, cors) {
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.token || '').trim();
  const password = String(body.password || '');
  if (!(await consumeOtp(env, email, code))) return fail('验证码不正确或已过期', 400, cors);
  let u = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();
  if (!u) {
    if (password.length < 6) return fail('新用户请设置至少 6 位密码', 400, cors);
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    u = await env.DB.prepare('INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?) RETURNING id, email')
      .bind(email, hash, salt).first();
  }
  const token = await newSession(env, u.id);
  return ok({ token: token, user: { id: u.id, email: u.email } }, cors);
}

async function authReset(request, env, cors) {
  if (!mailConfigured(env)) return fail('未配置邮件服务，请登录后在后台改密', 400, cors);
  const body = await readBody(request);
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.nonce || '').trim();
  const password = String(body.password || '');
  if (password.length < 6) return fail('新密码至少 6 位', 400, cors);
  if (!(await consumeOtp(env, email, code))) return fail('验证码不正确或已过期', 400, cors);
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (!u) return fail('该邮箱未注册', 404, cors);
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').bind(hash, salt, u.id).run();
  const token = await newSession(env, u.id);
  return ok({ token: token, user: { id: u.id, email: u.email } }, cors);
}

/* ============ 文章（公开） ============ */

async function listArticles(env, url, cors) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const raw = parseInt(url.searchParams.get('pageSize') || '12', 10) || 12;
  const pageSize = Math.min(Math.max(1, raw), 100);
  const tag = url.searchParams.get('tag');
  const search = url.searchParams.get('search');
  const offset = (page - 1) * pageSize;

  let where = 'status = ?';
  const params = ['published'];
  if (tag) { where += " AND ',' || tags || ',' LIKE ?"; params.push('%,' + tag + ',%'); }
  if (search) { where += ' AND (title LIKE ? OR summary LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }

  const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM articles WHERE ' + where).bind(...params).first();
  const sql = 'SELECT id, title, summary, cover, tags, views, series_id, series_order, created_at ' +
    'FROM articles WHERE ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const { results } = await env.DB.prepare(sql).bind(...params, pageSize, offset).all();
  return json({ data: results, total: (total && total.c) || 0, page, pageSize }, 200, cors);
}

async function getArticle(env, id, cors) {
  const a = await env.DB.prepare('SELECT * FROM articles WHERE id = ? AND status = ?').bind(id, 'published').first();
  if (!a) return json({ error: 'Not found' }, 404, cors);
  await env.DB.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').bind(id).run();
  return json({ data: a }, 200, cors);
}

/* ============ 评论 ============ */

async function listComments(env, url, cors) {
  const articleId = url.searchParams.get('article_id');
  if (!articleId) return json({ data: [] }, 200, cors);
  const { results } = await env.DB.prepare(
    'SELECT id, nick, content, website, created_at FROM comments WHERE article_id = ? AND status = ? ORDER BY created_at ASC'
  ).bind(articleId, 'approved').all();
  return json({ data: results }, 200, cors);
}

async function createComment(request, env, cors) {
  const body = await readBody(request);
  const articleId = parseInt(body.article_id, 10);
  const nick = String(body.nick || '').trim();
  const content = String(body.content || '').trim();
  const email = String(body.email || '').trim();
  const website = String(body.website || '').trim();
  if (!articleId || !nick || !content) return fail('昵称和内容不能为空', 400, cors);
  if (nick.length > 40 || content.length > 1000) return fail('昵称或内容太长', 400, cors);
  if (website) return ok(true, cors); // 蜜罐命中，静默丢弃
  const row = await env.DB.prepare(
    'INSERT INTO comments (article_id, nick, email, content, website) VALUES (?, ?, ?, ?, ?) RETURNING id, nick, content, created_at'
  ).bind(articleId, nick, email, content, '').first();
  return ok(row, cors);
}

/* ============ 系列 / 设置（公开） ============ */

async function listSeries(env, cors) {
  const { results } = await env.DB.prepare("SELECT * FROM series WHERE (status IS NULL OR status = 'published') ORDER BY sort_order ASC, id ASC").all();
  const counts = await env.DB.prepare(
    "SELECT series_id, COUNT(*) AS c FROM articles WHERE status = 'published' AND series_id IS NOT NULL GROUP BY series_id"
  ).all();
  const map = {};
  (counts.results || []).forEach(function (r) { map[r.series_id] = r.c; });
  return ok((results || []).map(function (s) { return Object.assign({}, s, { article_count: map[s.id] || 0 }); }), cors);
}

async function getSeries(env, id, cors) {
  const s = await env.DB.prepare('SELECT * FROM series WHERE id = ?').bind(id).first();
  return ok(s || null, cors);
}

async function listSeriesArticles(env, id, cors) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, summary, cover, tags, views, created_at, series_order FROM articles " +
    "WHERE status = 'published' AND series_id = ? ORDER BY series_order ASC, created_at ASC LIMIT 500"
  ).bind(id).all();
  return ok(results || [], cors);
}

async function getSettings(env, cors) {
  const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
  const map = {};
  (results || []).forEach(function (r) { map[r.key] = r.value; });
  return ok(map, cors);
}

/* ============ AI 问答 ============ */

/* 关键词切分：中文取 2 字滑窗 + 英文/数字词，用于站内轻量检索 */
function askGrams(s) {
  const t = String(s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ').trim();
  const out = {};
  t.split(/\s+/).forEach(function (w) { if (w.length >= 2) out[w.toLowerCase()] = 1; });
  const cjk = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) out[cjk.slice(i, i + 2)] = 1;
  return Object.keys(out);
}

/* ---- 联网检索工具 ---- */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');
}
function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function ddgUnwrap(href) {
  const m = String(href).match(/[?&]uddg=([^&]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return href; } }
  return String(href).replace(/^\/\//, 'https://');
}

/* 联网检索：DuckDuckGo lite 优先，取不到再回落中文维基百科；返回 [{title,url,snippet}] */
async function searchWeb(query) {
  const out = [];
  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlchemyLab/1.0)', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
    if (res.ok) {
      const html = await res.text();
      // 结果链接：遍历 <a>，取含 result-link 的（属性顺序/引号都容错）
      const links = [];
      const are = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = are.exec(html)) && links.length < 6) {
        if (m[1].indexOf('result-link') < 0) continue;
        const h = m[1].match(/href="([^"]*)"/);
        const title = stripTags(m[2]);
        if (title) links.push({ url: ddgUnwrap(h ? h[1] : ''), title: title });
      }
      // 摘要：result-snippet 单元格
      const snips = [];
      const sre = /<td[^>]*class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/g;
      while ((m = sre.exec(html)) && snips.length < 6) snips.push(stripTags(m[1]));
      links.forEach(function (l, i) { out.push({ title: l.title, url: l.url, snippet: snips[i] || '' }); });
    }
  } catch (e) { /* 落维基兜底 */ }

  // 维基兜底只用于「像词条名」的短查询，避免长问题被它的全文检索带偏
  if (!out.length && String(query).trim().length <= 14) {
    try {
      const res = await fetch('https://zh.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=4&srsearch=' + encodeURIComponent(query), {
        headers: { 'User-Agent': 'AlchemyLabBot/1.0 (https://ai-alchemy-lab.2426333436.workers.dev)' },
      });
      if (res.ok) {
        const j = await res.json().catch(function () { return {}; });
        ((j.query && j.query.search) || []).forEach(function (r) {
          out.push({ title: r.title, url: 'https://zh.wikipedia.org/wiki/' + encodeURIComponent(r.title), snippet: stripTags(r.snippet) });
        });
      }
    } catch (e) { /* 忽略 */ }
  }
  return out;
}

/* AI 问答：站内知识(轻量 RAG) + 站外常识 + 可选联网（web=true 时实时检索）。
   站内清单每次实时从 D1 生成 → 发/改文章后助手知识自动更新。 */
async function handleAsk(request, env, cors) {
  const body = await readBody(request);
  const question = String(body.question || '').trim();
  const webOn = body.web === true || body.web === 'true' || body.web === 1;
  if (!question) return fail('question is required', 400, cors);
  const apiKey = env.ZHIPU_API_KEY;
  if (!apiKey) return fail('ZHIPU_API_KEY 未设置', 500, cors);

  // 1) 全站已发布文章清单（不含正文，轻量）
  const arts = (await env.DB.prepare(
    "SELECT id, title, summary, tags, series_id FROM articles WHERE status = 'published' ORDER BY created_at DESC"
  ).all()).results || [];
  const series = (await env.DB.prepare('SELECT id, name FROM series').all()).results || [];
  const seriesName = {};
  series.forEach(function (s) { seriesName[s.id] = s.name; });

  const index = arts.map(function (a) {
    const tags = splitTags(a.tags).join('/');
    const ser = a.series_id && seriesName[a.series_id] ? '｜系列：' + seriesName[a.series_id] : '';
    const sum = String(a.summary || '').replace(/\s+/g, ' ').slice(0, 110);
    return '[' + a.id + '] ' + a.title + '：' + sum + (tags ? '（' + tags + '）' : '') + ser;
  }).join('\n');

  // 2) 站内检索：命中最高 1-2 篇，取正文摘录
  const grams = askGrams(question);
  const ranked = arts.map(function (a) {
    const hay = (a.title + ' ' + (a.summary || '') + ' ' + splitTags(a.tags).join(' ')).toLowerCase();
    let score = 0;
    grams.forEach(function (g) {
      if (hay.indexOf(g) >= 0) score += 1;
      if (String(a.title).toLowerCase().indexOf(g) >= 0) score += 2;
    });
    return { id: a.id, score: score };
  }).filter(function (x) { return x.score > 0; }).sort(function (x, y) { return y.score - x.score; }).slice(0, 2);

  let excerpts = '';
  if (ranked.length) {
    const ids = ranked.map(function (x) { return x.id; });
    const rows = (await env.DB.prepare(
      'SELECT id, title, content FROM articles WHERE id IN (' + ids.map(function () { return '?'; }).join(',') + ')'
    ).bind(...ids).all()).results || [];
    excerpts = '\n【站内相关文章摘录】\n' + rows.map(function (r) {
      let c = String(r.content || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`]/g, ' ').replace(/\s+/g, ' ').trim();
      if (c.length > 1000) c = c.slice(0, 1000) + '…';
      return '《' + r.title + '》：' + c;
    }).join('\n\n');
  }

  // 3) 联网检索（用户开启时）
  let webBlock = '';
  let webFailed = false;
  let webSources = [];
  if (webOn) {
    let results = [];
    try { results = await searchWeb(question); } catch (e) { results = []; }
    if (results.length) {
      webSources = results.map(function (r) { return { title: r.title, url: r.url }; });
      webBlock = '\n【实时联网搜索结果】（用户开启了联网，请优先据此回答，并注明来源域名）\n' + results.map(function (r, i) {
        return (i + 1) + '. ' + r.title + ' — ' + r.snippet + ' (' + r.url + ')';
      }).join('\n');
    } else {
      webFailed = true;
      webBlock = '\n【联网检索：本次没取到结果】\n';
    }
  }

  const system = [
    '你是「AI 炼丹房」博客的站内问答助手，同时也是一个通用的中文 AI 助手。博客是教学型中文技术博客，涵盖大模型原理、Prompt/上下文工程、RAG、微调与 LoRA、模型选型、推理优化、Agent、本地部署等。',
    '\n【本站文章清单】共 ' + arts.length + ' 篇（[id] 标题：摘要（标签）｜系列）：',
    index || '（暂无文章）',
    series.length ? '本站系列：' + series.map(function (s) { return s.name; }).join('、') : '',
    excerpts,
    webBlock,
    '\n【回答要求】',
    '1) 简体中文，口语、简洁，尽量 300 字内。',
    '2) 与本站相关的问题（如「一共几篇」「有没有讲 X 的」「X 是什么」「怎么学」）：优先依据上面的文章清单/摘录回答，并点名具体文章标题。',
    '3) 站外/通用问题：直接用你的知识回答，不要因为博客里没写就拒绝。',
    '4) 若给了联网搜索结果且与问题相关：优先依据它回答，并注明来源域名（如「据 github.com」）；若结果与问题明显无关，不要硬套，就说「这次没搜到靠谱的信息」。',
    '5) 涉及「最新/今年」等时效信息、又没有联网结果时，要说明你的知识可能不是最新的。',
    '6) 绝不编造不存在的文章标题、链接或数据。',
    webFailed ? '7) 本次联网没搜到结果，请如实说明「联网暂时没搜到」，再基于已有知识回答。' : '',
  ].filter(Boolean).join('\n');

  const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question },
      ],
      max_tokens: 800,
      temperature: 0.6,
    }),
  });
  const data = await resp.json().catch(function () { return {}; });
  const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '抱歉，暂时答不上来。';
  return json({ answer: answer, sources: webSources }, 200, cors);
}

/* ============ 个人偏好（主题） ============ */

async function themeGet(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return ok(null, cors);
  const r = await env.DB.prepare('SELECT theme FROM user_preferences WHERE user_id = ?').bind(u.id).first();
  return ok(r ? r.theme : null, cors);
}

async function themePut(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const body = await readBody(request);
  const theme = String(body.theme || '');
  await env.DB.prepare(
    'INSERT INTO user_preferences (user_id, theme, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at'
  ).bind(u.id, theme, new Date().toISOString()).run();
  return ok(true, cors);
}

/* ============ 存储（base64 落 D1） ============ */

async function storagePut(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const body = await readBody(request);
  const data = String(body.data || '');
  const name = String(body.name || 'file');
  const kind = body.kind === 'image' ? 'image' : 'file';
  const mime = String(body.mime || (kind === 'image' ? 'image/jpeg' : 'application/octet-stream'));
  if (!data) return fail('缺少文件内容', 400, cors);
  if (data.length > MAX_BLOB_CHARS) return fail('文件太大（上限约 900KB）', 413, cors);
  const path = 'shared/' + u.id + '/blog/' + (kind === 'image' ? 'images' : 'files') + '/' + randomHex(8) + '-' + name.replace(/[\\/:*?"<>|#%\s]+/g, '_');
  await env.DB.prepare(
    'INSERT INTO storage_files (path, owner_id, kind, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(path, u.id, kind, name, mime, Math.round(data.length * 0.75), data).run();
  return ok({ path: path }, cors);
}

async function storageList(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const { results } = await env.DB.prepare(
    'SELECT path, kind, name, size, created_at FROM storage_files WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500'
  ).bind(u.id).all();
  return ok((results || []).map(function (r) {
    return { name: r.name, path: r.path, size: r.size, created_at: r.created_at, kind: r.kind === 'image' ? '图片素材' : '附件文件' };
  }), cors);
}

async function storageDelete(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const body = await readBody(request);
  const paths = Array.isArray(body.paths) ? body.paths : [];
  for (const p of paths) {
    await env.DB.prepare('DELETE FROM storage_files WHERE path = ? AND owner_id = ?').bind(p, u.id).run();
  }
  return ok(true, cors);
}

async function storageBlob(env, url, cors) {
  const path = url.searchParams.get('path');
  if (!path) return new Response('Bad request', { status: 400 });
  const r = await env.DB.prepare('SELECT mime, data FROM storage_files WHERE path = ?').bind(path).first();
  if (!r) return new Response('Not found', { status: 404 });
  const bin = Uint8Array.from(atob(r.data), function (c) { return c.charCodeAt(0); });
  return new Response(bin, {
    headers: { 'Content-Type': r.mime || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000' },
  });
}

/* ============ 后台 ============ */

async function handleAdmin(request, env, url, cors) {
  const path = url.pathname;
  const method = request.method;
  const guard = await requireAdmin(request, env);
  if (guard.error) return guard.error;

  // 身份查询
  if (path === '/api/admin/is-admin' && method === 'GET') return ok(true, cors);
  if (path === '/api/admin/is-owner' && method === 'GET') return ok(await isOwnerUser(env, guard.user.id), cors);

  // 管理员列表（需 owner）
  if (path === '/api/admin/admins' && method === 'GET') {
    if (!(await isOwnerUser(env, guard.user.id))) return fail('需要所有者权限', 403, cors);
    const { results } = await env.DB.prepare(
      'SELECT a.user_id AS uid, a.role, a.note, a.created_at, u.email FROM admins a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at ASC'
    ).all();
    return ok(results || [], cors);
  }
  if (path === '/api/admin/admins/count' && method === 'GET') {
    const r = await env.DB.prepare('SELECT COUNT(*) AS c FROM admins').first();
    return ok((r && r.c) || 0, cors);
  }
  if (path === '/api/admin/admins' && method === 'POST') {
    if (!(await isOwnerUser(env, guard.user.id))) return fail('需要所有者权限', 403, cors);
    const body = await readBody(request);
    const uid = parseInt(body.uid, 10);
    if (!uid) return fail('用户 ID 无效', 400, cors);
    const u = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
    if (!u) return fail('用户不存在', 404, cors);
    await env.DB.prepare("INSERT OR IGNORE INTO admins (user_id, role, note) VALUES (?, 'admin', ?)").bind(uid, String(body.note || '')).run();
    return ok(true, cors);
  }
  const admDel = path.match(/^\/api\/admin\/admins\/(\d+)$/);
  if (admDel && method === 'DELETE') {
    if (!(await isOwnerUser(env, guard.user.id))) return fail('需要所有者权限', 403, cors);
    const uid = parseInt(admDel[1], 10);
    const row = await env.DB.prepare('SELECT role FROM admins WHERE user_id = ?').bind(uid).first();
    if (!row) return fail('该用户不是管理员', 404, cors);
    if (row.role === 'owner') return fail('不能移除所有者', 403, cors);
    await env.DB.prepare('DELETE FROM admins WHERE user_id = ?').bind(uid).run();
    return ok(true, cors);
  }

  // 文章
  if (path === '/api/admin/articles' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, title, summary, status, tags, views, created_at, updated_at, series_id, series_order FROM articles ORDER BY updated_at DESC LIMIT 500'
    ).all();
    return ok(results || [], cors);
  }
  if (path === '/api/admin/articles' && method === 'POST') {
    const b = await readBody(request);
    const row = await env.DB.prepare(
      'INSERT INTO articles (title, summary, content, cover, tags, status, series_id, series_order, created_at, updated_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')) RETURNING *"
    ).bind(b.title || '', b.summary || '', b.content || '', b.cover || '', tagsStr(b.tags), b.status || 'published',
      b.series_id == null ? null : Number(b.series_id), Number(b.series_order) || 0).first();
    return ok(row, cors);
  }
  const artId = path.match(/^\/api\/admin\/articles\/(\d+)$/);
  if (artId && method === 'PUT') {
    const b = await readBody(request);
    const row = await env.DB.prepare(
      'UPDATE articles SET title = ?, summary = ?, content = ?, cover = ?, tags = ?, status = ?, series_id = ?, series_order = ?, ' +
      "updated_at = datetime('now') WHERE id = ? RETURNING *"
    ).bind(b.title || '', b.summary || '', b.content || '', b.cover || '', tagsStr(b.tags), b.status || 'published',
      b.series_id == null ? null : Number(b.series_id), Number(b.series_order) || 0, artId[1]).first();
    if (!row) return fail('文章不存在', 404, cors);
    return ok(row, cors);
  }
  if (artId && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(artId[1]).run();
    return ok(true, cors);
  }
  const artStatus = path.match(/^\/api\/admin\/articles\/(\d+)\/status$/);
  if (artStatus && method === 'POST') {
    const b = await readBody(request);
    const row = await env.DB.prepare("UPDATE articles SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *")
      .bind(b.status || 'published', artStatus[1]).first();
    if (!row) return fail('文章不存在', 404, cors);
    return ok(row, cors);
  }

  // 标签
  if (path === '/api/admin/tags/rename' && method === 'POST') {
    const b = await readBody(request);
    const oldName = String(b.old || '').trim();
    const newName = String(b.new || '').trim();
    if (!oldName || !newName) return fail('标签名不能为空', 400, cors);
    const { results } = await env.DB.prepare('SELECT id, tags FROM articles').all();
    let affected = 0;
    for (const row of (results || [])) {
      const list = splitTags(row.tags);
      if (list.indexOf(oldName) < 0) continue;
      const next = list.map(function (t) { return t === oldName ? newName : t; });
      await env.DB.prepare("UPDATE articles SET tags = ?, updated_at = datetime('now') WHERE id = ?").bind(next.join(','), row.id).run();
      affected += 1;
    }
    return ok(affected, cors);
  }
  if (path === '/api/admin/tags/delete' && method === 'POST') {
    const b = await readBody(request);
    const name = String(b.tag || '').trim();
    const { results } = await env.DB.prepare('SELECT id, tags FROM articles').all();
    let affected = 0;
    for (const row of (results || [])) {
      const list = splitTags(row.tags);
      if (list.indexOf(name) < 0) continue;
      await env.DB.prepare("UPDATE articles SET tags = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(list.filter(function (t) { return t !== name; }).join(','), row.id).run();
      affected += 1;
    }
    return ok(affected, cors);
  }

  // 系列
  if (path === '/api/admin/series' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM series ORDER BY sort_order ASC, id ASC').all();
    return ok(results || [], cors);
  }
  if (path === '/api/admin/series' && method === 'POST') {
    const b = await readBody(request);
    const row = await env.DB.prepare(
      "INSERT INTO series (name, slug, icon, summary, sort_order, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *"
    ).bind(b.name || '', b.slug || '', b.icon || '', b.summary || '', Number(b.sort_order) || 99, b.status || 'published').first();
    return ok(row, cors);
  }
  const serId = path.match(/^\/api\/admin\/series\/(\d+)$/);
  if (serId && method === 'PUT') {
    const b = await readBody(request);
    const cur = await env.DB.prepare('SELECT * FROM series WHERE id = ?').bind(serId[1]).first();
    if (!cur) return fail('系列不存在', 404, cors);
    const merged = Object.assign({}, cur, b);
    const row = await env.DB.prepare(
      "UPDATE series SET name = ?, slug = ?, icon = ?, summary = ?, sort_order = ?, status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
    ).bind(merged.name || '', merged.slug || '', merged.icon || '', merged.summary || '', Number(merged.sort_order) || 99, merged.status || 'published', serId[1]).first();
    return ok(row, cors);
  }
  if (serId && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM series WHERE id = ?').bind(serId[1]).run();
    return ok(true, cors);
  }

  // 设置
  if (path === '/api/admin/settings' && method === 'PUT') {
    const b = await readBody(request);
    const key = String(b.key || '');
    if (!key) return fail('缺少 key', 400, cors);
    await env.DB.prepare(
      'INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(key, String(b.value == null ? '' : b.value)).run();
    return ok(true, cors);
  }

  // 评论管理
  if (path === '/api/admin/comments' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1000);
    const { results } = await env.DB.prepare(
      'SELECT id, article_id, nick, email, content, status, created_at FROM comments ORDER BY created_at DESC LIMIT ?'
    ).bind(limit).all();
    return ok(results || [], cors);
  }
  const cmtId = path.match(/^\/api\/admin\/comments\/(\d+)$/);
  if (cmtId && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(cmtId[1]).run();
    return ok(true, cors);
  }

  // 全部附件
  if (path === '/api/admin/attachments' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, article_id, name, path, size, created_at FROM attachments ORDER BY created_at DESC LIMIT 1000'
    ).all();
    return ok(results || [], cors);
  }

  return fail('未知的后台接口', 404, cors);
}

/* 认领站长：任何已登录用户可调用，仅当 admins 表为空时成功（首个用户成为 owner） */
async function adminClaim(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const any = await env.DB.prepare('SELECT COUNT(*) AS c FROM admins').first();
  if (any && any.c > 0) return fail('站长已存在，无法认领', 409, cors);
  await env.DB.prepare("INSERT INTO admins (user_id, role, note) VALUES (?, 'owner', '')").bind(u.id).run();
  return ok(true, cors);
}

function splitTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map(function (t) { return t.trim(); }).filter(Boolean);
  return String(tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
}
function tagsStr(tags) { return splitTags(tags).join(','); }

/* ============ 附件 ============ */

async function listAttachments(env, url, cors) {
  const articleId = url.searchParams.get('article_id');
  if (!articleId) return json({ data: [] }, 200, cors);
  const { results } = await env.DB.prepare(
    'SELECT id, article_id, name, path, size, created_at FROM attachments WHERE article_id = ? ORDER BY created_at ASC'
  ).bind(articleId).all();
  return json({ data: results || [] }, 200, cors);
}

async function addAttachment(request, env, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const b = await readBody(request);
  const row = await env.DB.prepare(
    'INSERT INTO attachments (article_id, name, path, size) VALUES (?, ?, ?, ?) RETURNING *'
  ).bind(parseInt(b.article_id, 10), String(b.name || ''), String(b.path || ''), Number(b.size) || 0).first();
  return ok(row, cors);
}

async function deleteAttachment(request, env, id, cors) {
  const u = await getUser(request, env);
  if (!u) return fail('请先登录', 401, cors);
  const row = await env.DB.prepare('SELECT path FROM attachments WHERE id = ?').bind(id).first();
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  if (row && row.path) {
    await env.DB.prepare('DELETE FROM storage_files WHERE path = ? AND owner_id = ?').bind(row.path, u.id).run();
  }
  return ok(true, cors);
}
