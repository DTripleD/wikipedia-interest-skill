// node parse-session.mjs <session.jsonl> [--full]  → readable timeline + usage summary
import { readFileSync } from 'node:fs';
const [file, flag] = process.argv.slice(2);
const full = flag === '--full';
const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const seen = new Set();
const usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: new Set() };
const clip = (s, n) => (full || s.length <= n ? s : s.slice(0, n) + ` …[+${s.length - n}]`);
for (const l of lines) {
  const m = l.message;
  if (!m) continue;
  if (l.type === 'assistant') {
    if (m.usage && !seen.has(m.id)) {
      seen.add(m.id); usage.requests++; usage.models.add(m.model);
      usage.input += m.usage.input_tokens ?? 0; usage.output += m.usage.output_tokens ?? 0;
      usage.cacheRead += m.usage.cache_read_input_tokens ?? 0; usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
    }
    for (const c of m.content ?? []) {
      if (c.type === 'text' && c.text.trim()) console.log(`\n[ASSISTANT]\n${c.text}`);
      if (c.type === 'tool_use') console.log(`\n[TOOL ${c.name}] ${clip(JSON.stringify(c.input), 1500)}`);
    }
  } else if (l.type === 'user') {
    if (typeof m.content === 'string') { if (!l.isMeta) console.log(`\n[USER] ${clip(m.content, 600)}`); continue; }
    for (const c of m.content ?? []) {
      if (c.type === 'text' && !l.isMeta) console.log(`\n[USER] ${clip(c.text, 600)}`);
      if (c.type === 'tool_result') {
        const t = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join('');
        console.log(`[RESULT${c.is_error ? ' ERROR' : ''}] ${clip(t, 700)}`);
      }
    }
  }
}
console.log(`\n[USAGE] ${JSON.stringify({ ...usage, models: [...usage.models] })}`);
