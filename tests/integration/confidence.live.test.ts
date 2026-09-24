/**
 * Live check of the analysis + confidence model on an assignment scenario.
 * Not part of `npm test`; run with `npm run test:integration`. Uses a temp cache directory.
 * Values were observed on 2026-09-25; update them if Wikimedia data change.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeSeries } from '../../src/analysis/analyze.js';
import { assessSeries } from '../../src/analysis/confidence.js';
import { FileCache } from '../../src/data/cache.js';
import { getDailySeries, getEditionDailySeries } from '../../src/data/pageviews.js';

const dir = mkdtempSync(join(tmpdir(), 'wiki-skill-live-'));
const options = { timeoutMs: 20_000, maxRetries: 1, cache: new FileCache(dir) };

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('confidence model (live)', () => {
  it('recognizes the 2025 step in uk "Інтервальне голодування" and the edition-wide drop behind it', async () => {
    const range = { start: '2024-09-23', end: '2026-09-22' };
    const { series } = await getDailySeries({ language: 'uk', article: 'Інтервальне голодування', ...range }, options);
    const { series: edition } = await getEditionDailySeries({ language: 'uk', ...range }, options);
    const analysis = analyzeSeries(series, { editionSeries: edition });
    expect(analysis.levelShift).toMatchObject({ detected: true, lastPeriodBefore: '2025-05', firstPeriodAfter: '2025-06' });

    const a = assessSeries(analysis, { confidence: 'high', notes: [] });
    expect(a.level).toBe('medium');
    const shift = a.factors.find((f) => f.id === 'level_shift')!;
    expect(shift.status).toBe('caution');
    expect(shift.message).toMatch(/whole uk edition also shifted then/);
    expect(a.claims.trend?.level).toBe('medium');
  });
});
