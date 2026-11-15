import { readFileSync, writeFileSync } from 'node:fs';
const buf = readFileSync('E:/DSH_Env/DesktopApp/resources/app.asar');
const needles = [Buffer.from('conversation.session'), Buffer.from('conversation.view'), Buffer.from('conversation.chat'), Buffer.from('dsh-edit-turn'), Buffer.from('dsh-quick-toolbar')];
const results = {};
for (const n of needles) {
  let idx = buf.indexOf(n);
  const hits = [];
  while (idx !== -1 && hits.length < 4) { hits.push(idx); idx = buf.indexOf(n, idx + 1); }
  results[n.toString()] = hits;
}
let out = '';
for (const [k, hits] of Object.entries(results)) {
  for (const h of hits) {
    const start = Math.max(0, h - 300);
    const end = Math.min(buf.length, h + 700);
    out += '\n===== ' + k + ' @' + h + ' =====\n' + buf.subarray(start, end).toString('utf8') + '\n';
  }
}
writeFileSync('E:/software/corsj-workspace/.tmp-conv-slots.txt', out);
console.log('done len=' + out.length);
