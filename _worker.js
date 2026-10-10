/* Cloudflare Worker 入口：静态前端 + 文章/评论 API（D1）+ AI 问答（智谱代理）
 *
 * 路由：
 *   GET  /api/articles?page=&pageSize=&tag=&search=   文章列表（分页）
 *   GET  /api/articles/:id                            文章详情（含正文，自增阅读）
 *   GET  /api/comments?article_id=X                   评论列表
 *   POST /api/comments                                发表评论
 *   POST /api/ask                                      AI 问答（转发智谱 GLM-4-Flash）
 *   其它                                               交给静态资源（env.ASSETS）
 *
 * 相对 spec 的修正：
 *   1) 列表接口支持 pageSize 查询参数（上限 100），否则前端取全量做「相关/上下篇」会被卡在 12 条；
 *   2) 列表 SELECT 增加 series_order，系列内排序要用；
 *   3) 标签过滤用 `,tags,` 定界匹配，避免 "Lo" 误命中 "LoRA" 这类子串误判。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    try {
      // ---- 文章 API ----
      if (path === '/api/articles') {
        return await handleListArticles(env, url, cors);
      }
      const articleMatch = path.match(/^\/api\/articles\/(\d+)$/);
      if (articleMatch) return await handleGetArticle(env, articleMatch[1], cors);

      // ---- 评论 API ----
      if (path === '/api/comments') {
        if (request.method === 'POST') return await handleCreateComment(request, env, cors);
        return await handleListComments(env, url, cors);
      }

      // ---- AI 问答 API ----
      if (path === '/api/ask' && request.method === 'POST') {
        return await handleAsk(request, env, cors);
      }
    } catch (err) {
      return Response.json(
        { error: 'server_error', message: String((err && err.message) || err) },
        { status: 500, headers: cors }
      );
    }

    // 其它请求走静态文件
    return env.ASSETS.fetch(request);
  },
};

// ---- 文章列表（分页） ----
async function handleListArticles(env, url, cors) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const rawSize = parseInt(url.searchParams.get('pageSize') || '12', 10) || 12;
  const pageSize = Math.min(Math.max(1, rawSize), 100); // 上限 100，防全表拖库
  const tag = url.searchParams.get('tag');
  const search = url.searchParams.get('search');
  const offset = (page - 1) * pageSize;

  let where = 'status = ?';
  const params = ['published'];

  if (tag) { where += " AND ',' || tags || ',' LIKE ?"; params.push('%,' + tag + ',%'); }
  if (search) {
    where += ' AND (title LIKE ? OR summary LIKE ?)';
    params.push('%' + search + '%', '%' + search + '%');
  }

  const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM articles WHERE ' + where)
    .bind(...params)
    .first();

  const sql =
    'SELECT id, title, summary, cover, tags, views, series_id, series_order, created_at ' +
    'FROM articles WHERE ' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const { results } = await env.DB.prepare(sql).bind(...params, pageSize, offset).all();
  return Response.json(
    { data: results, total: (total && total.c) || 0, page, pageSize },
    { headers: cors }
  );
}

// ---- 文章详情（含正文，阅读量 +1） ----
async function handleGetArticle(env, id, cors) {
  const article = await env.DB.prepare(
    'SELECT * FROM articles WHERE id = ? AND status = ?'
  ).bind(id, 'published').first();

  if (!article) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });

  await env.DB.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').bind(id).run();
  return Response.json({ data: article }, { headers: cors });
}

// ---- 评论列表 ----
async function handleListComments(env, url, cors) {
  const articleId = url.searchParams.get('article_id');
  if (!articleId) return Response.json({ data: [] }, { headers: cors });

  const { results } = await env.DB.prepare(
    'SELECT id, nick, content, website, created_at FROM comments ' +
    'WHERE article_id = ? AND status = ? ORDER BY created_at ASC'
  ).bind(articleId, 'approved').all();

  return Response.json({ data: results }, { headers: cors });
}

// ---- 发表评论 ----
async function handleCreateComment(request, env, cors) {
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }

  const articleId = parseInt(body.article_id, 10);
  const nick = String(body.nick || '').trim();
  const content = String(body.content || '').trim();
  const email = String(body.email || '').trim();
  const website = String(body.website || '').trim();

  if (!articleId || !nick || !content) {
    return Response.json({ error: '昵称和内容不能为空' }, { status: 400, headers: cors });
  }
  if (nick.length > 40 || content.length > 1000) {
    return Response.json({ error: '昵称或内容太长' }, { status: 400, headers: cors });
  }
  // 蜜罐字段：正常访客不会填 website，填了就当成机器人
  if (website) return Response.json({ ok: true }, { headers: cors });

  const row = await env.DB.prepare(
    'INSERT INTO comments (article_id, nick, email, content, website) VALUES (?, ?, ?, ?, ?) RETURNING id, nick, content, website, created_at'
  ).bind(articleId, nick, email, content, '').first();

  return Response.json({ ok: true, data: row }, { headers: cors });
}

// ---- AI 问答（智谱 GLM-4-Flash） ----
async function handleAsk(request, env, cors) {
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }

  const question = String(body.question || '').trim();
  if (!question) return Response.json({ error: 'question is required' }, { status: 400, headers: cors });

  const apiKey = env.ZHIPU_API_KEY;
  if (!apiKey) return Response.json({ error: 'ZHIPU_API_KEY not set' }, { status: 500, headers: cors });

  const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'glm-4-flash',
      messages: [
        {
          role: 'system',
          content:
            '你是「AI 炼丹房」博客的问答助手。内容涵盖大模型基础、Prompt工程、RAG、微调与LoRA、模型选型、推理优化、Agent。' +
            '回答要求：1.中文通俗简洁 2.不知道就说"这个博客还没写到" 3.不要编造 4.回答控制在200字以内',
        },
        { role: 'user', content: question },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  const data = await resp.json().catch(function () { return {}; });
  const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '抱歉，暂时答不上来。';
  return Response.json({ answer }, { headers: cors });
}
