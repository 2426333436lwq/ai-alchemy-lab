// 输出 articles/ 下每篇文章的 title / content md5 / length，用于与数据库逐篇比对
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', 'articles');

fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.md') && !f.startsWith('README'))
  .sort()
  .forEach((f) => {
    const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) {
      console.log('NO_FRONTMATTER | ' + f);
      return;
    }
    const tm = m[1].match(/^title:\s*(.+)$/m);
    const title = tm ? tm[1].trim() : '';
    const c = m[2].replace(/^\n/, '');
    console.log([title, crypto.createHash('md5').update(c, 'utf8').digest('hex'), c.length].join(' | '));
  });
