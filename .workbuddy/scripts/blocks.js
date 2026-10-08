const fs=require('fs'),crypto=require('crypto');
const file=process.argv[2], n=Number(process.argv[3]);
const raw=fs.readFileSync('articles/'+file,'utf8');
const c=raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)[1].replace(/^\n/,'');
const half=c.slice(0,n);
const W=200, out=[];
for(let i=0;i<half.length;i+=W) out.push((Math.floor(i/W)+1)+':'+crypto.createHash('md5').update(half.slice(i,i+W),'utf8').digest('hex').slice(0,8));
console.log(out.join(' '));
