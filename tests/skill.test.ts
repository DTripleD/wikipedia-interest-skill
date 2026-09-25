/**
 * SKILL.md consistency: valid Agent Skills frontmatter, size within the recommended budget, and
 * every command, flag, error code and output field it names exists in the CLI. Catches drift
 * between the instructions and the code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { REPORT_OPTIONS } from '../src/commands/args.js';
import { PROJECT_ROOT } from '../src/config.js';

const skill = readFileSync(join(PROJECT_ROOT, 'SKILL.md'), 'utf8');
const reference = readFileSync(join(PROJECT_ROOT, 'references', 'output-fields.md'), 'utf8');
const docs = [skill, reference];

function sourceText(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
    .join('\n');
}
const src = sourceText(join(PROJECT_ROOT, 'src'));
const cliOutputSrc = ['cli.ts', 'commands/present.ts', 'commands/pipeline.ts', 'commands/commands.ts']
  .map((f) => readFileSync(join(PROJECT_ROOT, 'src', f), 'utf8'))
  .join('\n');

/** Simple `key: value` frontmatter (single-line values only, as used in SKILL.md). */
function frontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error('SKILL.md has no frontmatter');
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (m) fields[m[1]!] = m[2]!.trim();
  }
  return fields;
}

const unique = (xs: Iterable<string>) => [...new Set(xs)];
const matches = (re: RegExp, texts: string[]) => unique(texts.flatMap((t) => [...t.matchAll(re)].map((m) => m[1]!)));

describe('SKILL.md', () => {
  it('has valid Agent Skills frontmatter', () => {
    const fm = frontmatter(skill);
    // agentskills.io: name 1-64 chars, lowercase letters/digits/hyphens, no leading/trailing/double hyphen, equals the folder name.
    expect(fm.name).toBe('wikipedia-interest-skill');
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fm.name!.length).toBeLessThanOrEqual(64);
    expect(fm.description!.length).toBeGreaterThan(0);
    expect(fm.description!.length).toBeLessThanOrEqual(1024);
    expect(fm.compatibility!.length).toBeLessThanOrEqual(500);
  });

  it('stays within the recommended size (< 500 lines, ~5000 tokens)', () => {
    expect(skill.split('\n').length).toBeLessThan(500);
    expect(skill.length / 4).toBeLessThan(5000); // rough chars-per-token estimate
  });

  it('links only to files that exist', () => {
    for (const link of matches(/\]\(([^)#]+)\)/g, docs)) {
      expect(existsSync(join(PROJECT_ROOT, link)), link).toBe(true);
    }
  });

  it('names only real commands', async () => {
    const commands = matches(/node dist\/cli\.js ([a-z]+)/g, docs);
    expect(commands).toEqual(expect.arrayContaining(['resolve', 'analyze', 'report', 'help']));
    for (const command of commands) {
      const result = await run([command], { env: {}, cache: null, fetch: () => Promise.reject(new Error('no network in tests')) });
      if (!result.ok) expect(result.error.code, command).not.toBe('UNKNOWN_COMMAND');
    }
  });

  it('names only real CLI flags', () => {
    const flags = matches(/(?<![\w-])--([a-z][a-z-]*)/g, docs);
    expect(flags.length).toBeGreaterThan(5);
    for (const flag of flags) expect(Object.keys(REPORT_OPTIONS), `--${flag}`).toContain(flag);
  });

  it('names only real error codes', () => {
    const codes = matches(/`([A-Z][A-Z_]{3,})`/g, docs).filter((c) => c !== 'WIKI_SKILL_CONTACT');
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect(src, code).toContain(`'${code}'`);
  });

  it('names only real output fields and values', () => {
    // camelCase segments of backticked names (e.g. `languages[].confidence.yearOverYear`).
    const fields = unique(
      matches(/`([^`]+)`/g, docs)
        .flatMap((token) => token.split(/[^A-Za-z0-9_]+/))
        .filter((seg) => /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(seg)),
    );
    expect(fields).toEqual(expect.arrayContaining(['viewsPerMillion', 'yoyChangePct', 'recent90ChangePct', 'peakDay', 'relativeToLeaderPct', 'editionChangePct']));
    for (const field of fields) expect(cliOutputSrc, field).toContain(field);

    // snake_case enum values (e.g. `views_per_million`, `no_significant_trend`).
    const values = matches(/`([a-z]+(?:_[a-z]+)+)`/g, docs);
    expect(values.length).toBeGreaterThan(3);
    for (const value of values) expect(src, value).toContain(value);
  });

  it('always carries the attention-not-demand distinction', () => {
    expect(skill).toMatch(/not market demand/);
    expect(skill).toMatch(/limitations\[0\]/);
  });
});
