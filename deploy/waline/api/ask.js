/* 问炼丹房 · AI 问答后端
 * 注意：本仓库 package.json 无 "type":"module"，.js 一律按 CommonJS 解析，
 * 所以这里用 module.exports 而不是 export default（否则部署后会报 Unexpected token 'export'）。
 */
module.exports = async function handler(req, res) {
  const allowed = ['https://ai-alchemy-lab.app.workbuddy.host', 'http://localhost:8080'];
  const origin = req.headers.origin || '';
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { question } = body;
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' });
  }

  const API_KEY = process.env.ZHIPU_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ZHIPU_API_KEY not set' });

  try {
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          {
            role: 'system',
            content:
              '你是「AI 炼丹房」博客的问答助手。这个博客记录大模型时代的炼丹笔记，内容涵盖：大模型基础、Prompt工程、RAG、微调与LoRA、模型选型（GPT/Claude/Gemini/DeepSeek/Qwen/GLM/Kimi/MiMo）、推理优化（量化/并发/Ollama部署）、Agent与工具调用。回答要求：1.中文通俗简洁 2.不知道就说"这个博客还没写到" 3.不要编造 4.回答控制在200字以内',
          },
          { role: 'user', content: question },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content || '抱歉，我暂时答不上来。';
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: 'AI 服务暂时不可用' });
  }
};
