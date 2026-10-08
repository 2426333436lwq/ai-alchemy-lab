const fs = require('fs');
const path = require('path');
const dir = 'E:/student/project/AI Training Lab/articles';

const known = new Set(('the and for you are with this that from have will can not but all use new more than ' +
  'one two three four first next last same best most least per time day hour week month year ' +
  'model price input output context window token tokens cache caching batch flex priority standard ' +
  'api url key base http https json sdk docs doc org com ai openai anthropic google gemini claude deepseek ' +
  'qwen glm kimi minimax grok moonshot zai xai gpt solaris luna sol astra fable opus sonnet haiku pro flash flash lite ' +
  'prompts prompt system user assistant role content messages role function tools tool calls calling ' +
  'thinking thinking budget effort low medium high reasoning beta fim prefix completion beta responses ' +
  'benchmark benchmarks score scores eval evals swe verified terminal gpqa browsecomp aime hle osworld mmmu live code ' +
  'elo arc agi mcp atlas python node openai compatible import from print print create model max ' +
  'migration retired deprecated shut down released launched announced schedule scheduling queue run ' +
  'moonshot dashscope bigmodel huggingface weights quantised quantised server gpu tpu tpm concurrency limit ' +
  'README title summary tags cover status owner articles').split(/\s+/));

const files = fs.readdirSync(dir).filter(function (f) { return f.startsWith('M-') && f.endsWith('.md'); });

for (const f of files) {
  const txt = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = txt.split(/\r?\n/);
  const hits = new Map();
  let inFence = false;
  lines.forEach(function (l) {
    if (l.trim().startsWith('```')) { inFence = !inFence; return; }
    if (inFence) return;
    if (l.trim().startsWith('|')) return;
    const words = l.match(/[A-Za-z][A-Za-z']{2,}/g) || [];
    words.forEach(function (w) {
      const low = w.toLowerCase();
      if (known.has(low)) return;
      if (/[一-鿿]/.test(w)) return;
      hits.set(w, (hits.get(w) || 0) + 1);
    });
  });
  if (hits.size) {
    console.log('--- ' + f);
    console.log('    ' + [...hits.keys()].join(', '));
  } else {
    console.log('clean  ' + f);
  }
}
