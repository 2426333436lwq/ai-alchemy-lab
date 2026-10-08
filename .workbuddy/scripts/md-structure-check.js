const fs = require('fs');
const path = require('path');
const dir = 'E:/student/project/AI Training Lab/articles';

const allow = new RegExp(
  '[' +
    '\\u4e00-\\u9fff' +
    '\\u3000-\\u303f' +
    '\\uff00-\\uffef' +
    '\\u00a5\\u20ac\\u2192\\u00d7\\u2248\\u25bc\\u2705\\u274c\\u2014\\u2013\\u2026\\u00b7' +
  ']'
);

const files = fs.readdirSync(dir).filter(function (f) { return f.endsWith('.md'); });
let bad = 0;

function countPipes(line) {
  let n = 0;
  for (const ch of line) if (ch === '|') n++;
  return n;
}

function isSeparator(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  const body = t.slice(1, -1);
  if (body.length === 0) return false;
  for (const ch of body) {
    if (ch === '|' || ch === '-' || ch === ':' || ch === ' ') continue;
    return false;
  }
  return true;
}

for (const f of files) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = txt.split(/\r?\n/);

  let fences = 0;
  lines.forEach(function (l) { if (l.trim().startsWith('```')) fences++; });
  if (fences % 2 !== 0) { console.log('[FENCE] 代码块未配对:', f, fences); bad++; }

  let block = [];
  const problems = [];
  function flush(b) {
    if (b.length >= 2 && isSeparator(lines[b[0].idx])) {
      const want = b[0].cnt;
      b.forEach(function (r) { if (r.cnt !== want) problems.push(r.idx + 1); });
    }
  }
  lines.forEach(function (l, i) {
    const t = l.trim();
    if (t.startsWith('|') && t.endsWith('|') && t.length > 1) {
      block.push({ idx: i, cnt: countPipes(l) });
    } else {
      if (block.length) { flush(block); block = []; }
    }
  });
  if (block.length) flush(block);
  if (problems.length) { console.log('[TABLE] 列数不一致:', f, '行', problems.join(',')); bad++; }

  const weird = new Set();
  for (const ch of txt) {
    const c = ch.codePointAt(0);
    if (c < 128) continue;
    if (allow.test(ch)) continue;
    weird.add(ch);
  }
  if (weird.size) { console.log('[CHAR] 异常字符:', f, [...weird].join(' ')); bad++; }

  console.log('OK   ' + f + '  | 行数 ' + lines.length + ' | 字符 ' + txt.length);
}

console.log(bad ? '\n发现 ' + bad + ' 处问题' : '\n全部通过');
