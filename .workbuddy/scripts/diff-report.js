// 逐篇比对本地 articles/*.md 与数据库摘要，判断差异是否只是首尾空白
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', 'articles');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db-digest.json'), 'utf8'));

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const local = new Map();
fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.md') && !f.startsWith('README'))
  .forEach((f) => {
    const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const tm = m[1].match(/^title:\s*(.+)$/m);
    local.set(tm[1].trim(), { file: f, body: m[2].replace(/^\n/, '') });
  });

db.forEach((row) => {
  const L = local.get(row.title);
  if (!L) {
    console.log(`[缺失] id=${row.id} ${row.title}`);
    return;
  }
  const b = L.body;
  const t = b.replace(/\n+$/, '');
  const variants = {
    原样: b,
    去尾换行: t,
    去尾加一换行: t + '\n',
    去尾加两换行: t + '\n\n',
    去首尾空白: b.trim(),
    去首尾加一换行: b.trim() + '\n',
    去首尾加两换行: b.trim() + '\n\n',
    补首换行: '\n' + b,
    双首换行: '\n\n' + b,
  };
  const hit = Object.keys(variants).find((k) => md5(variants[k]) === row.md5);
  if (hit) {
    console.log(`[仅空白差异:${hit}] id=${row.id}  ${row.title}`);
  } else {
    console.log(`[内容差异] id=${row.id}  ${row.title}  本地${b.length} vs 库${row.len} (差 ${b.length - row.len})`);
  }
});
