// 把新文章（id 35）追加进 articles.json，用于 SEO 静态快照重生成
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JSON_PATH = path.join(ROOT, '.workbuddy', 'data', 'articles.json');
const MD_PATH = path.join(ROOT, 'articles', 'Agent-进阶-从会调工具到真能办事.md');

// 元数据取自数据库 articles 表（id=35），需与库内一致
const meta = {
  id: 35,
  owner_id: '2104115790440562688',
  title: 'Agent 进阶：从「会调工具」到「真能办事」',
  summary: '上一讲我们给模型装上了手（工具调用），也认识了 Agent 这个「自动跑循环」的雏形。但裸循环一碰到真实任务就露怯：不会规划、记不住事、不会知难而退。这一讲我们补上规划、记忆、兜底三道工序，再认识一下行业为了「少接一遍线」搞出来的标准插头 MCP。',
  cover: '',
  tags: ['药方研究', 'Agent', '工具调用', 'MCP', '规划', '记忆'],
  status: 'published',
  views: 0,
  created_at: '2026-10-09T16:50:53.924252+08:00',
  updated_at: '2026-10-09T16:50:53.924252+08:00',
  series_id: 6,
  series_order: 2,
};

const raw = fs.readFileSync(MD_PATH, 'utf8');
// 与上传时完全一致的正文归一化：剥 frontmatter + 去尾部空白 + 结尾补单个换行
const body = raw.replace(/^---\n[\s\S]*?\n---\n\n?/, '').replace(/\s+$/, '') + '\n';

const arr = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const before = arr.length;
const idx = arr.findIndex((x) => x.id === meta.id);
const entry = { ...meta, content: body };
if (idx >= 0) {
  arr[idx] = entry;
  console.log('replace existing id=' + meta.id);
} else {
  arr.push(entry);
  console.log('append new id=' + meta.id);
}

fs.writeFileSync(JSON_PATH, JSON.stringify(arr, null, 2), 'utf8');
console.log('articles.json: ' + before + ' -> ' + arr.length);
console.log('content length (codeUnits) = ' + body.length);
