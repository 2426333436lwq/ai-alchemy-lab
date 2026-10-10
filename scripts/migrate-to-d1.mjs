/* 把仓库里的静态数据导出成 D1 可执行的 seed.sql
 *
 * 用法： node scripts/migrate-to-d1.mjs
 * 产物： scripts/seed.sql
 * 执行： npx wrangler d1 execute ai_alchemy --remote --file=./scripts/seed.sql
 *
 * 覆盖：articles（DROP+重建，保原 id / created_at / series_order）、series、site_settings 数据，
 *       以及 users/sessions/admins/attachments/storage_files/user_preferences/otp_codes 建表。
 * 全部 INSERT OR REPLACE，可重复执行；comments 表只建不删，保留真实评论。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC_ARTICLES = resolve(root, 'data/articles.json');
const SRC_SERIES = resolve(root, 'data/series.json');
const SRC_SITE = resolve(root, 'data/site.json');
const OUT = resolve(root, 'scripts/seed.sql');

const articles = JSON.parse(readFileSync(SRC_ARTICLES, 'utf8'));
let series = [];
let site = {};
try { series = JSON.parse(readFileSync(SRC_SERIES, 'utf8')); } catch (e) { /* 可选 */ }
try { site = JSON.parse(readFileSync(SRC_SITE, 'utf8')); } catch (e) { /* 可选 */ }

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
-- ============ 文章 ============
-- articles 用 DROP + 重建：确保表结构与 _worker.js 一致
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

-- ============ 评论 ============
-- 已存在就不动，避免清掉真实评论
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

-- ============ 账号体系 ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY,
  role TEXT DEFAULT 'admin',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  code TEXT,
  purpose TEXT,
  used INTEGER DEFAULT 0,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER PRIMARY KEY,
  theme TEXT,
  updated_at TEXT
);

-- ============ 系列 / 设置 ============
CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  icon TEXT,
  summary TEXT,
  sort_order INTEGER DEFAULT 99,
  status TEXT DEFAULT 'published',
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ============ 附件 / 素材存储（base64 落 D1） ============
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER,
  name TEXT,
  path TEXT,
  size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS storage_files (
  path TEXT PRIMARY KEY,
  owner_id INTEGER,
  kind TEXT,
  name TEXT,
  mime TEXT,
  size INTEGER,
  data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

/* ---- 文章 ---- */
const artCols = 'id, title, summary, content, cover, tags, views, series_id, series_order, status, created_at, updated_at';
const artRows = articles.map(function (a) {
  const values = [
    num(a.id, 0),
    q(a.title),
    q(a.summary || ''),
    q(a.content || ''),
    q(a.cover || ''),
    q(tagsToStr(a.tags)),
    num(a.views, 0),
    a.series_id == null ? 'NULL' : num(a.series_id, 0),
    a.series_order == null ? 'NULL' : num(a.series_order, 0),
    q(a.status || 'published'),
    a.created_at ? q(a.created_at) : "datetime('now')",
    a.updated_at ? q(a.updated_at) : (a.created_at ? q(a.created_at) : "datetime('now')"),
  ];
  return 'INSERT OR REPLACE INTO articles (' + artCols + ') VALUES (' + values.join(', ') + ');';
});

/* ---- 系列 ---- */
const serRows = series.map(function (s) {
  return 'INSERT OR REPLACE INTO series (id, name, slug, icon, summary, sort_order, status, updated_at) VALUES (' +
    [num(s.id, 0), q(s.name), q(s.slug || ''), q(s.icon || ''), q(s.summary || ''), num(s.sort_order, 99), q(s.status || 'published'), "datetime('now')"].join(', ') + ');';
});

/* ---- 站点设置 ---- */
const setRows = Object.keys(site).map(function (k) {
  return 'INSERT OR REPLACE INTO site_settings (key, value) VALUES (' + q(k) + ', ' + q(site[k]) + ');';
});

const sql = DDL + '\n' + artRows.join('\n') + '\n\n' + serRows.join('\n') + '\n\n' + setRows.join('\n') + '\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql, 'utf8');

console.log('[migrate-to-d1] 已生成 ' + OUT);
console.log('[migrate-to-d1] 文章 ' + artRows.length + ' / 系列 ' + serRows.length + ' / 设置 ' + setRows.length +
  '，SQL ' + (Buffer.byteLength(sql) / 1024).toFixed(1) + ' KB');
