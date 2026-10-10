/* 用 Cloudflare D1 REST API 执行 seed.sql（无需 wrangler，只需一个 API 令牌）
 *
 * 用法：
 *   CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=yyy \
 *     node scripts/migrate-d1-api.mjs scripts/seed.sql scripts/seed-owner.sql
 *
 * 需要令牌权限：Account → D1 → Edit。
 * database_id 从 wrangler.toml 读取（[[d1_databases]] 的 database_id）。
 *
 * 说明：把 SQL 拆成单条语句逐条 POST，避免多语句/超长请求被拒；
 *       带 --dry 只打印将执行的语句数，不真正请求。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const token = process.env.CLOUDFLARE_API_TOKEN || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const dry = process.argv.indexOf('--dry') >= 0;
const files = process.argv.slice(2).filter(function (a) { return a.indexOf('--') !== 0; });
if (!files.length) files.push('scripts/seed.sql');

/* 从 wrangler.toml 解析 database_id */
const toml = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');
const m = toml.match(/database_id\s*=\s*"([^"]+)"/);
if (!m) { console.error('wrangler.toml 里没找到 database_id'); process.exit(1); }
const databaseId = m[1];

/* 把 SQL 文本拆成单条语句：正确跳过单引号字符串（'' 转义），去掉整行注释 */
function splitStatements(sql) {
  const text = sql.split('\n').filter(function (l) { return !/^\s*--/.test(l); }).join('\n');
  const out = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") { cur += "'"; i += 1; }
        else inStr = false;
      }
    } else if (ch === "'") {
      inStr = true; cur += ch;
    } else if (ch === ';') {
      const s = cur.trim();
      if (s) out.push(s);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

async function runSql(sql) {
  const url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId +
    '/d1/database/' + databaseId + '/query';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: sql }),
  });
  const json = await res.json().catch(function () { return {}; });
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map(function (e) { return e.message || JSON.stringify(e); }).join('; ');
    throw new Error('HTTP ' + res.status + ' ' + (errs || '执行失败'));
  }
  return json;
}

const allStatements = [];
for (const f of files) {
  let sql;
  try { sql = readFileSync(resolve(root, f), 'utf8'); }
  catch (e) { console.error('读不到 ' + f + '（先跑 node scripts/migrate-to-d1.mjs）'); process.exit(1); }
  const stmts = splitStatements(sql);
  console.log(f + ' → ' + stmts.length + ' 条语句');
  stmts.forEach(function (s) { allStatements.push(s); });
}

if (dry) {
  console.log('（--dry）共 ' + allStatements.length + ' 条，未执行');
  process.exit(0);
}

if (!token) { console.error('缺少 CLOUDFLARE_API_TOKEN'); process.exit(1); }
if (!accountId) { console.error('缺少 CLOUDFLARE_ACCOUNT_ID'); process.exit(1); }

let okCount = 0;
for (let i = 0; i < allStatements.length; i++) {
  const s = allStatements[i];
  const label = s.replace(/\s+/g, ' ').slice(0, 60);
  process.stdout.write('[' + (i + 1) + '/' + allStatements.length + '] ' + label + ' … ');
  try {
    await runSql(s);
    okCount += 1;
    process.stdout.write('OK\n');
  } catch (e) {
    process.stdout.write('FAIL: ' + e.message + '\n');
    process.exit(1);
  }
}

console.log('\n全部完成：成功执行 ' + okCount + ' 条语句。');
console.log('database_id: ' + databaseId);
