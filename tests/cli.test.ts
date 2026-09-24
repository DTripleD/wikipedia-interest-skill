import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, type CliResult } from '../src/cli.js';
import { parseAnalysisArgs } from '../src/commands/args.js';
import { baseName } from '../src/commands/commands.js';
import type { CliDeps } from '../src/commands/pipeline.js';
import { TOOL_VERSION } from '../src/config.js';
import { fakeWikimedia, type FakeWikimediaOptions } from './helpers/fake-wikimedia.js';
import { MemoryCache } from './helpers/memory-cache.js';

const NOW = new Date('2026-09-25T12:00:00Z'); // default period: 2024-09-25 .. 2026-09-24
const ENV = { WIKI_SKILL_CONTACT: 'tests@example.org' };
const outDir = mkdtempSync(join(tmpdir(), 'wiki-cli-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/** en "Intermittent fasting" links to cs and uk; pl has no article; xx does not exist. */
const WIKI: FakeWikimediaOptions = {
  editions: ['en', 'cs', 'uk', 'pl'],
  pages: {
    'en|Intermittent fasting': { qid: 'Q1666254', langlinks: { cs: 'Přerušovaný půst', uk: 'Інтервальне голодування' } },
    'cs|Přerušovaný půst': { qid: 'Q1666254' },
    'uk|Інтервальне голодування': { qid: 'Q1666254' },
    'en|Mercury': { qid: 'Q1', disambig: true },
    'en|Lonely topic': { qid: 'Q9', langlinks: {} },
  },
  search: { 'en|Mercury': ['Mercury (planet)', 'Mercury (element)'] },
  views: (project, article, date) => {
    if (article === null) return project === 'cs.wikipedia' ? 1_000_000 : 2_000_000;
    const base = project === 'cs.wikipedia' ? 100 : 60;
    return date === '2025-04-14' ? 5000 : base + (Number(date.slice(8, 10)) % 3); // one spike
  },
};

function deps(extra: Partial<CliDeps> = {}, wiki: FakeWikimediaOptions = WIKI): CliDeps & { calls: string[] } {
  const fake = fakeWikimedia(wiki);
  return { fetch: fake.fetch, env: ENV, now: () => NOW, cache: null, sleep: async () => {}, outDir, calls: fake.calls, ...extra };
}

function ok(result: CliResult): Record<string, any> {
  if (!result.ok) throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  return result.data as Record<string, any>;
}

describe('cli: envelope and arguments', () => {
  it('returns version and help', async () => {
    expect(ok(await run(['version']))).toMatchObject({ version: TOOL_VERSION });
    expect(Object.keys(ok(await run(['help'])).commands)).toEqual(['resolve', 'analyze', 'report', 'version']);
  });

  it('returns structured errors for unknown commands and bad arguments', async () => {
    expect(await run(['nope'])).toMatchObject({ ok: false, command: 'nope', error: { code: 'UNKNOWN_COMMAND' } });
    expect(await run([])).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
    const cases: Array<[string[], RegExp]> = [
      [['analyze', '--languages', 'cs'], /Missing --topic/],
      [['analyze', '--topic', 'x'], /Missing --languages/],
      [['analyze', '--topic', 'x', '--languages', 'cs', '--months', '0'], /--months must be a whole number/],
      [['analyze', '--topic', 'x', '--languages', 'cs', '--start', '2024-01-01', '--months', '3'], /either --start or --months/],
      [['analyze', '--topic', 'x', '--languages', 'cs', '--end', '2024-13-01'], /--end must be a date/],
      [['analyze', '--topic', 'x', '--languages', 'cs', '--title', 'Post'], /Invalid --title "Post"/],
      [['resolve', '--topic', 'x', '--languages', 'cs', '--months', '3'], /Unknown option '--months'/],
      [['analyze', '--topic', 'x', '--languages', 'cs', '--start', '2026-01-02', '--end', '2026-01-01'], /is after --end/],
    ];
    for (const [argv, message] of cases) {
      const result = await run(argv, deps());
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
      if (!result.ok) expect(result.error.message).toMatch(message);
    }
  });

  it('computes the default period and month windows', () => {
    const base = ['--topic', 'x', '--languages', 'cs'];
    expect(parseAnalysisArgs(base, NOW)).toMatchObject({ start: '2024-09-25', end: '2026-09-24' });
    expect(parseAnalysisArgs([...base, '--end', '2026-09-22', '--months', '24'], NOW)).toMatchObject({ start: '2024-09-23' });
    expect(parseAnalysisArgs([...base, '--end', '2026-03-31', '--months', '1'], NOW)).toMatchObject({ start: '2026-03-01' });
    expect(parseAnalysisArgs([...base, '--title', 'pl=Post przerywany', '--title', 'cs=A=B'], NOW).titles).toEqual({ pl: 'Post przerywany', cs: 'A=B' });
  });

  it('builds safe file names', () => {
    expect(baseName({ topic: 'Intermittent fasting!', languages: ['uk', 'cs'], start: '2024-09-25', end: '2026-09-24' })).toBe('intermittent-fasting_cs-uk_2024-09-25_2026-09-24');
    expect(baseName({ topic: 'Астрономія', languages: ['uk'], start: 'a', end: 'b' })).toBe('астрономія_uk_a_b');
    expect(baseName({ topic: '???', languages: ['uk'], start: 'a', end: 'b' })).toBe('topic_uk_a_b');
  });
});

describe('cli: resolve', () => {
  it('reports per-language status, request count and the contact warning', async () => {
    const d = deps({ env: {} });
    const data = ok(await run(['resolve', '--topic', 'Intermittent fasting', '--languages', 'cs,pl,xx'], d));
    expect(data.source).toMatchObject({ language: 'en', status: 'found', article: 'Intermittent fasting' });
    expect(data.languages.map((l: any) => [l.language, l.status, l.article])).toEqual([
      ['cs', 'resolved', 'Přerušovaný půst'],
      ['pl', 'not_found', null],
      ['xx', 'language_unavailable', null],
    ]);
    expect(data.apiRequests).toBe(d.calls.length);
    expect(data.warnings[0]).toMatch(/WIKI_SKILL_CONTACT is not set/);
    expect(data.cache).toBe('off');
  });
});

describe('cli: analyze', () => {
  it('returns compact, rounded metrics, confidence and findings for resolved languages', async () => {
    const d = deps();
    const result = await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs,uk,pl'], d);
    const data = ok(result);
    expect(data.period).toEqual({ start: '2024-09-25', end: '2026-09-24', days: 730 });
    expect(data.rankedBy).toBe('views_per_million');
    // cs: ~101/day in 1M/day → ~101 per million (+ the spike); uk: ~61/day in 2M/day → ~30.5.
    expect(data.languages.map((l: any) => [l.rank, l.language, l.article])).toEqual([
      [1, 'cs', 'Přerušovaný půst'],
      [2, 'uk', 'Інтервальне голодування'],
    ]);
    const cs = data.languages[0];
    expect(cs).toMatchObject({ resolution: { confidence: 'high', method: 'interlanguage_link' }, imputedDays: 0, seasonality: 'not_detected', levelShift: null });
    expect(cs.viewsPerMillion).toBeCloseTo(107.7, 0); // (730 days · ≈101 + 4900 spike excess) / 730 M
    expect(cs.spikes.largest).toEqual({ date: '2025-04-14', views: 5000, typical: 101 });
    expect(Number.isInteger(cs.yoyChangePct * 10)).toBe(true); // rounded to 0.1
    expect(cs.trend).toMatchObject({ basis: 'monthly', periods: 23 });
    expect(cs.confidence.level).toMatch(/high|medium|low/);
    expect(data.comparison.ranking[0]).toMatchObject({ language: 'cs', relativeToLeaderPct: 100 });
    expect(data.missing).toEqual([{ language: 'pl', status: 'not_found', reason: 'no article linked to the topic' }]);
    expect(data.findings[0]).toMatch(/^Highest interest relative to edition size: cs/);
    expect(data.limitations[0]).toMatch(/not a measure of market demand/);
    expect(data.apiRequests).toBe(d.calls.length);
    // Compact: no raw series or long arrays.
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/"(points|movingAverages|monthly|outliers|values)":/);
    expect(text.length).toBeLessThan(8000);
  });

  it('serves a repeated analysis from the cache', async () => {
    const cache = new MemoryCache();
    const first = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs'], deps({ cache })));
    const second = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs'], deps({ cache })));
    expect(first.apiRequests).toBeGreaterThan(0);
    expect(second.apiRequests).toBe(0);
    expect(second.cache).toBe('on');
    expect(second.languages).toEqual(first.languages);
    const noCache = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs', '--no-cache'], deps({ cache })));
    expect(noCache.apiRequests).toBe(first.apiRequests);
    expect(noCache.cache).toBe('off');
  });

  it('writes chart SVGs with --charts', async () => {
    const data = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs', '--months', '12', '--charts'], deps()));
    expect(data.files.charts.map((p: string) => p.slice(outDir.length + 1))).toEqual([
      'intermittent-fasting_cs_2025-09-25_2026-09-24-timeline.svg',
      'intermittent-fasting_cs_2025-09-25_2026-09-24-yoy.svg',
    ].slice(0, data.files.charts.length));
    for (const path of data.files.charts) expect(readFileSync(path, 'utf8').startsWith('<svg')).toBe(true);
  });

  it('stops with candidates when the topic is ambiguous or not found', async () => {
    const ambiguous = await run(['analyze', '--topic', 'Mercury', '--languages', 'cs'], deps());
    expect(ambiguous).toMatchObject({
      ok: false,
      error: { code: 'TOPIC_AMBIGUOUS', details: { candidates: [{ title: 'Mercury (planet)' }, { title: 'Mercury (element)' }] } },
    });
    const notFound = await run(['analyze', '--topic', 'No such thing', '--languages', 'cs'], deps());
    expect(notFound).toMatchObject({ ok: false, error: { code: 'TOPIC_NOT_FOUND', details: { candidates: [] } } });
    if (!notFound.ok) expect(notFound.error.message).toMatch(/re-run with --source <that language code>/);
    const none = await run(['analyze', '--topic', 'Lonely topic', '--languages', 'cs,xx'], deps());
    expect(none).toMatchObject({ ok: false, error: { code: 'NO_ARTICLES', details: { missing: [{ language: 'cs' }, { language: 'xx', reason: 'edition does not exist' }] } } });
  });

  it('passes Wikimedia error codes through', async () => {
    const result = await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'cs'], deps({}, { ...WIKI, pageviewsStatus: 429 }));
    expect(result).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('cli: report', () => {
  it('writes a one-page PDF and returns its path with the analysis', async () => {
    const data = ok(await run(['report', '--topic', 'Intermittent fasting', '--languages', 'cs,uk,pl', '--note', 'Czech readers look relatively more interested.'], deps()));
    expect(data.files.report).toBe(join(outDir, 'intermittent-fasting_cs-pl-uk_2024-09-25_2026-09-24.pdf'));
    expect(existsSync(data.files.report)).toBe(true);
    expect(readFileSync(data.files.report).subarray(0, 5).toString()).toBe('%PDF-');
    expect(data.languages).toHaveLength(2);
    expect(data.files.charts).toBeUndefined();
  });

  it('rejects an over-long analyst note', async () => {
    const result = await run(['report', '--topic', 'Intermittent fasting', '--languages', 'cs', '--note', 'x'.repeat(601)], deps());
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });
});
