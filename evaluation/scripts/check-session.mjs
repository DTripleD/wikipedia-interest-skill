// node check-session.mjs <session.jsonl>: numbers in assistant text that are absent from every CLI result of the session.
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let answer = '', outputs = '';
for (const l of lines) {
  for (const c of Array.isArray(l.message?.content) ? l.message.content : []) {
    if (l.type === 'assistant' && c.type === 'text') answer += c.text + '\n';
    if (l.type === 'user' && c.type === 'tool_result') {
      const t = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join('');
      if (t.includes('"ok":')) outputs += t + '\n';
    }
  }
}
const norm = (s) => s.replace(/[\u2212\u2013]/g, '-').replace(/(\d)[\s\u00a0\u202f,](?=\d{3}\b)/g, '$1');
const nums = (s) => (norm(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => String(Number(n.replace(',', '.'))));
const known = new Set(nums(outputs));
const missing = [...new Set(nums(answer))].filter((n) => !known.has(n));
console.log(missing.length ? `NOT IN CLI OUTPUT: ${missing.join(', ')}` : 'all numbers found');
