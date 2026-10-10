/* 把仓库里的 data/articles.json 导出成 D1 可执行的 seed.sql
 *
 * 用法： node scripts/migrate-to-d1.mjs
 * 产物： scripts/seed.sql   （含建表 DDL + 全部文章的 INSERT OR REPLACE）
 * 执行： npx wrangler d1 execute ai_alchemy --remote --file=./scripts/seed.sql
 *
 * 关键点：
 *   - 显式写入原 id（articles 表用 INTEGER PRIMARY KEY 而非 AUTOINCREMENT），避免重排后
 *     /a/<id>/ 深链、sitemap、收藏全部错位；
 *   - 显式写入原 created_at / updated_at，保证首页按时间的排序与线上一致；
 *   - tags 数组 → 逗号串；与 _worker.js 的 `,tags,` 定界匹配配套；
 *   - 用 INSERT OR REPLACE，重复执行不会重置 views，也不会产生重复行。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = resolve(root, 'data/articles.json');
const OUT = resolve(root, 'scripts/seed.sql');

const articles = JSON.parse(readFileSync(SRC, 'utf8'));

/* SQLite 字符串字面量：把单引号翻倍即可；其余字符（含换行）原样保留 */
function q(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(dflt);
}
function tagsToStr(tags) {
  if (Array.isArray(tags)) return tags.map(function (t) { return String(t).trim(); }).filter(Boolean).join(',');
  return String(tags || '');
}

const DDL = `-- 由 scripts/migrate-to-d1.mjs 生成，勿手改
-- articles 用 DROP + 重建：确保表结构与 _worker.js 完全一致
-- （表若已存在但缺 series_order 列，CREATE IF NOT EXISTS 不会补列，会一直报 no such column）
DROP TABLE IF EXISTS articles;
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  cover TEXT,
  tags TEXT DEFAULT '',
  views INTEGER DEFAULT 0,
  series_id INTEGER,
  series_order INTEGER,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

-- 评论表：已存在就不动，避免清掉真实评论
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  nick TEXT NOT NULL,
  email TEXT,
  content TEXT NOT NULL,
  website TEXT,
  status TEXT DEFAULT 'approved',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id);
`;

const cols = 'id, title, summary, content, cover, tags, views, series_id, series_order, status, created_at, updated_at';

const rows = articles.map(function (a) {
  const status = a.status || 'published';
  const values = [
    num(a.id, 0),
    q(a.title),
    q(a.summary || ''),
    q(a.content || ''),
    q(a.cover || ''),
    q(tagsToStr(a.tags)),
    num(a.views, 0),
    a.series_id === null || a.series_id === undefined ? 'NULL' : num(a.series_id, 0),
    a.series_order === null || a.series_order === undefined ? 'NULL' : num(a.series_order, 0),
    q(status),
    a.created_at ? q(a.created_at) : "datetime('now')",
    a.updated_at ? q(a.updated_at) : (a.created_at ? q(a.created_at) : "datetime('now')"),
  ];
  return 'INSERT OR REPLACE INTO articles (' + cols + ') VALUES (' + values.join(', ') + ');';
});

const sql = DDL + '\n' + rows.join('\n') + '\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql, 'utf8');

console.log('[migrate-to-d1] 已生成 ' + OUT);
console.log('[migrate-to-d1] 文章数：' + rows.length + '，SQL 大小：' + (Buffer.byteLength(sql) / 1024).toFixed(1) + ' KB');
