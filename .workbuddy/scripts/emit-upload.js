// 用法：node emit-upload.js <id> <md文件名>
// 输出：一条（或多条）把 md 正文写入 articles.content 的 SQL，并打印本地 md5 供核对
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const id = process.argv[2];
const file = process.argv[3];
const chunks = parseInt(process.argv[4] || '1', 10);

const dir = path.resolve(__dirname, '..', '..', 'articles');
let body = fs.readFileSync(path.join(dir, file), 'utf8');

// 去掉 frontmatter
body = body.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
// 与既有文章保持一致：正文末尾保留一个换行
body = body.replace(/\s+$/, '') + '\n';

const md5 = crypto.createHash('md5').update(body, 'utf8').digest('hex');
console.log('-- FILE:', file);
console.log('-- LOCAL_MD5:', md5, 'LEN:', body.length);
console.log('UPDATE articles SET content = \'\' WHERE id = ' + id + ';');

const size = Math.ceil(body.length / chunks);
for (let i = 0; i < chunks; i++) {
  const piece = body.slice(i * size, (i + 1) * size);
  const b64 = Buffer.from(piece, 'utf8').toString('base64');
  console.log(
    `UPDATE articles SET content = content || convert_from(decode('${b64}','base64'),'UTF8') WHERE id = ${id} RETURNING id, length(content) AS len;`
  );
}
console.log('SELECT id, length(content) AS len, md5(content) AS md5 FROM articles WHERE id = ' + id + ';');
