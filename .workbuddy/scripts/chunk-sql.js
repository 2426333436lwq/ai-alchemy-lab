// 把文章正文切成若干块，每块生成一条 ASCII-only 的 UPDATE SQL（append 方式），并给出累积 md5 用于校验
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', 'articles');

function contentOf(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  return m[2].replace(/^\n/, '');
}

const target = process.argv[2]; // insert | m00 | m07 | roadmap
const nChunks = Number(process.argv[3] || 4);

const fileMap = {
  insert: 'M-08-小米MiMo-把全模态卖成白菜价的那家.md',
  m00: 'M-00-模型选型总纲-给每个工种请对师傅.md',
  m07: 'M-07-其他玩家-Kimi-MiniMax-Grok与一群偏科天才.md',
  roadmap: '00-学习路线图-从零到能自己炼一炉丹.md',
  d01: 'D-01-显存这道算术题-买卡之前必须算的三笔账.md',
  d02: 'D-02-量化到底牺牲了什么-把精度换成显存的那笔交易.md',
  d03: 'D-03-Ollama-从玩具到服务-交出11434端口之前的七件事.md',
  d04: 'D-04-引擎选型与并发压测-同一个模型换个框架吞吐差一个数量级.md',
  d05: 'D-05-数据怎么不出门-内网的那道门该堵在哪.md',
};
const idMap = { insert: 27, m00: 18, m07: 25, roadmap: 4, d01: 29, d02: 30, d03: 31, d04: 32, d05: 33 };

const content = contentOf(fileMap[target]);
const buf = Buffer.from(content, 'utf8');

// 按「字符」切块，保证不切断多字节字符
const chars = Array.from(content);
const per = Math.ceil(chars.length / nChunks);
const parts = [];
for (let i = 0; i < chars.length; i += per) parts.push(chars.slice(i, i + per).join(''));

let acc = '';
const outDir = path.join(__dirname, 'chunks');
fs.mkdirSync(outDir, { recursive: true });

// PostgreSQL 的 base64 解码会忽略空白字符，这里按 1200 字符折行，
// 保证每条 SQL 单行的长度不会把读取工具的输出截断
function wrapB64(b64, width = 1200) {
  const out = [];
  for (let i = 0; i < b64.length; i += width) out.push(b64.slice(i, i + width));
  return out.join('\n');
}

parts.forEach((p, i) => {
  acc += p;
  const b64 = wrapB64(Buffer.from(p, 'utf8').toString('base64'));
  const sql = `UPDATE articles SET content = content || convert_from(decode('${b64}','base64'),'UTF8') WHERE id=${idMap[target]} RETURNING id, length(content) AS len;`;
  fs.writeFileSync(path.join(outDir, `${target}_${i + 1}.sql`), sql, 'utf8');
  console.log(
    `chunk ${i + 1}/${parts.length}  chars=${p.length}  sqlBytes=${Buffer.byteLength(sql)}  cumulative_md5=${crypto.createHash('md5').update(acc, 'utf8').digest('hex')}`
  );
});
console.log(`TOTAL_CHARS=${content.length}  TOTAL_MD5=${crypto.createHash('md5').update(content, 'utf8').digest('hex')}`);
