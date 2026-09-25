/**
 * End-to-end check of the three assignment scenarios through the CLI (`run`), with the flags an
 * agent following SKILL.md uses (see evaluation/end-to-end.md). Not part of `npm test`; run with
 * `npm run test:integration`. Fixed period so results are reproducible; temp cache and output.
 * Values were observed on 2026-09-25; update them if Wikimedia data or Wikidata links change.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, type CliResult } from '../../src/cli.js';
import { FileCache } from '../../src/data/cache.js';

const dir = mkdtempSync(join(tmpdir(), 'wiki-skill-e2e-'));
const deps = { cache: new FileCache(join(dir, 'cache')), outDir: join(dir, 'out') };
const PERIOD = ['--start', '2024-09-23', '--end', '2026-09-22'];

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ok(result: CliResult): any {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

const DEMAND = /not a measure of market demand/;
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe('scenario 1: intermittent fasting, Polish vs Czech, last two years (live)', () => {
  it('analyzes cs and reports pl as missing (no linked article)', async () => {
    const data = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'pl,cs', ...PERIOD], deps));
    expect(data.period).toEqual({ start: '2024-09-23', end: '2026-09-22', days: 730 });
    expect(data.languages.map((l: any) => [l.language, l.article])).toEqual([['cs', 'Přerušovaný půst']]);
    expect(data.missing).toEqual([{ language: 'pl', status: 'not_found', reason: 'no article linked to the topic' }]);
    expect(data.languages[0]).toMatchObject({ totalViews: 6716, trend: { direction: 'decreasing' }, confidence: { level: 'medium' } });
    expect(data.limitations[0]).toMatch(DEMAND);
  });

  it('compares with a user-approved broader pl article, marked as a partial match', async () => {
    const data = ok(await run(['analyze', '--topic', 'Intermittent fasting', '--languages', 'pl,cs', '--title', 'pl=Głodówka lecznicza', ...PERIOD], deps));
    const pl = data.languages.find((l: any) => l.language === 'pl');
    expect(pl).toMatchObject({ article: 'Głodówka lecznicza', resolution: { confidence: 'medium', method: 'explicit_title' } });
    expect(pl.confidence.reasons.join(' ')).toMatch(/only partly or indirectly/);
    expect(data.missing).toEqual([]);
    expect(data.comparison.ranking).toHaveLength(2);
    expect(data.rankedBy).toBe('views_per_million');
  });
});

describe('scenario 2: astronomy in Ukrainian Wikipedia, with confidence (live)', () => {
  it('finds a decreasing trend driven by a mid-2025 step that was partly edition-wide', async () => {
    const data = ok(await run(['analyze', '--topic', 'Astronomy', '--languages', 'uk', ...PERIOD], deps));
    const uk = data.languages[0];
    expect(uk).toMatchObject({ article: 'Астрономія', trend: { direction: 'decreasing' }, levelShift: { between: ['2025-05', '2025-06'] } });
    expect(uk.levelShift.editionChangePct).toBeLessThan(-20);
    expect(uk.confidence.trend.level).toBe('medium');
    expect(data.confidence.level).toBe('medium');
  });

  it('resolves the same article from the Ukrainian topic with --source uk', async () => {
    const data = ok(await run(['resolve', '--topic', 'астрономія', '--languages', 'uk', '--source', 'uk'], deps));
    expect(data.languages[0]).toMatchObject({ status: 'resolved', article: 'Астрономія', method: 'source_article' });
  });
});

describe('scenario 3: learning English across selected editions, short report (live)', () => {
  it('flags "learning English" as ambiguous and offers the concept as a candidate', async () => {
    const result = await run(['analyze', '--topic', 'learning English', '--languages', 'de,es,tr,pl,uk', ...PERIOD], deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TOPIC_AMBIGUOUS');
    expect((result.error.details!.candidates as Array<{ title: string }>).map((c) => c.title)).toContain('English as a second or foreign language');
  });

  it('writes a one-page PDF ranking de/es/tr and listing pl/uk as missing', async () => {
    const data = ok(await run(['report', '--topic', 'English as a second or foreign language', '--languages', 'de,es,tr,pl,uk', ...PERIOD], deps));
    expect(data.languages.map((l: any) => l.language).sort()).toEqual(['de', 'es', 'tr']);
    expect(data.missing.map((m: any) => m.language)).toEqual(['pl', 'uk']);
    expect(data.comparison.ranking).toHaveLength(3);
    expect(data.findings.join(' ')).toMatch(/No data for: pl \(.*\), uk \(/);
    expect(data.limitations[0]).toMatch(DEMAND);
    const pdf = readFileSync(data.files.report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });
});
