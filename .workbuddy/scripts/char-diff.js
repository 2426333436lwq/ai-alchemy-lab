// 逐字符比对两个文本文件，输出差异片段。用法：node char-diff.js <文件A> <文件B> [上下文长度]
const fs = require('fs');

const a = fs.readFileSync(process.argv[2], 'utf8');
const b = fs.readFileSync(process.argv[3], 'utf8');
const pad = Number(process.argv[4] || 25);

const A = Array.from(a);
const B = Array.from(b);
const n = Math.min(A.length, B.length);

const diffs = [];
for (let i = 0; i < n; i++) {
  if (A[i] !== B[i]) diffs.push(i);
}

if (diffs.length === 0 && A.length === B.length) {
  console.log('完全一致');
} else {
  console.log(`长度：A=${A.length}  B=${B.length}   首处差异@${diffs.length ? diffs[0] : 'EOF'}`);
  // 把连续差异合并成段
  const groups = [];
  diffs.forEach((i) => {
    const g = groups[groups.length - 1];
    if (g && i - g[g.length - 1] <= 6) g.push(i);
    else groups.push([i]);
  });
  groups.forEach((g) => {
    const s = Math.max(g[0] - pad, 0);
    const e = Math.min(g[g.length - 1] + 1 + pad, n);
    console.log('---');
    console.log('A: ' + JSON.stringify(A.slice(s, e).join('')));
    console.log('B: ' + JSON.stringify(B.slice(s, e).join('')));
  });
  if (A.length !== B.length) {
    console.log('--- 长度差在尾部 ---');
    console.log('A尾: ' + JSON.stringify(A.slice(Math.max(n - pad, 0)).join('')));
    console.log('B尾: ' + JSON.stringify(B.slice(Math.max(n - pad, 0)).join('')));
  }
}
