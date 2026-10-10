/* 生成「创建/重置某个账号并（可选）授予站长」的 D1 SQL
 *
 * 用法： node scripts/set-owner.mjs <email> <password> [--owner]
 * 产物： scripts/seed-owner.sql （含密码哈希，已 gitignore，勿提交）
 * 执行： npx wrangler d1 execute ai_alchemy --remote --file=./scripts/seed-owner.sql
 *
 * 哈希算法与 _worker.js 完全一致：PBKDF2-SHA256 / 100000 次 / 32 字节，
 * salt 是 16 字节随机数的 hex 字符串（按 UTF-8 取字节）。
 */
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = resolve(root, 'scripts/seed-owner.sql');

const args = process.argv.slice(2);
const email = String(args[0] || '').trim().toLowerCase();
const password = String(args[1] || '');
const asOwner = args.indexOf('--owner') >= 0 || args.indexOf('-o') >= 0;

if (!email || password.length < 6) {
  console.error('用法: node scripts/set-owner.mjs <email> <password> [--owner]  (密码至少 6 位)');
  process.exit(1);
}

function q(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');

const sql =
  '-- 由 scripts/set-owner.mjs 生成，含密码哈希，勿提交 / 勿外传\n' +
  'CREATE TABLE IF NOT EXISTS users (\n' +
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
  '  email TEXT UNIQUE NOT NULL,\n' +
  '  password_hash TEXT NOT NULL,\n' +
  '  salt TEXT NOT NULL,\n' +
  "  created_at TEXT DEFAULT (datetime('now'))\n" +
  ');\n' +
  'CREATE TABLE IF NOT EXISTS admins (\n' +
  '  user_id INTEGER PRIMARY KEY,\n' +
  "  role TEXT DEFAULT 'admin',\n" +
  '  note TEXT,\n' +
  "  created_at TEXT DEFAULT (datetime('now'))\n" +
  ');\n\n' +
  '-- 账号不存在则创建\n' +
  'INSERT OR IGNORE INTO users (email, password_hash, salt) VALUES (' + q(email) + ', ' + q(hash) + ', ' + q(salt) + ');\n' +
  '-- 已存在则重置密码\n' +
  'UPDATE users SET password_hash = ' + q(hash) + ', salt = ' + q(salt) + ' WHERE email = ' + q(email) + ';\n' +
  (asOwner
    ? '\n-- 授予站长（owner）\n' +
      'INSERT OR REPLACE INTO admins (user_id, role, note)\n' +
      "  SELECT id, 'owner', 'owner' FROM users WHERE email = " + q(email) + ';\n'
    : '');

writeFileSync(OUT, sql, 'utf8');
console.log('[set-owner] 已生成 ' + OUT);
console.log('[set-owner] 账号: ' + email + (asOwner ? '（已授予 owner）' : ''));
console.log('[set-owner] 执行: npx wrangler d1 execute ai_alchemy --remote --file=./scripts/seed-owner.sql');
