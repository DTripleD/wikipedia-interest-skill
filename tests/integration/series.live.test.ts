/**
 * Live tests for the cached daily-series layer and the resolver cache.
 * Not part of `npm test`; run with `npm run test:integration`. Uses a temp cache directory.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FileCache } from '../../src/data/cache.js';
import { getDailySeries, getEditionDailySeries } from '../../src/data/pageviews.js';
import { resolveTopic } from '../../src/wikipedia/resolver.js';

const dir = mkdtempSync(join(tmpdir(), 'wiki-skill-live-'));
const cache = new FileCache(dir);
const options = { timeoutMs: 20_000, maxRetries: 1, cache };

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('getDailySeries (live)', () => {
  it('fetches a month once, then serves it from the file cache', async () => {
    const req = { language: 'en', article: 'Astronomy', start: '2024-01-01', end: '2024-01-31' };
    const first = await getDailySeries(req, options);
    expect(first.apiRequests).toBe(1);
    expect(first.series.coverage).toMatchObject({ expectedDays: 31, reportedDays: 31, imputedDays: 0 });
    // Historical value observed on 2026-09-23 (same as pageviews.live.test.ts).
    expect(first.series.points[0]).toEqual({ date: '2024-01-01', views: 1131, imputed: false });

    const second = await getDailySeries(req, options);
    expect(second.apiRequests).toBe(0);
    expect(second.series).toEqual(first.series);
  });

  it('imputes the days a low-traffic article has no data for', async () => {
    // cs Hvězdná astronomie, January 2024: 13 of 31 days reported (observed 2026-09-23).
    const { series } = await getDailySeries(
      { language: 'cs', article: 'Hvězdná astronomie', start: '2024-01-01', end: '2024-01-31' },
      options,
    );
    expect(series.coverage).toMatchObject({ expectedDays: 31, reportedDays: 13, imputedDays: 18 });
  });
});

describe('getEditionDailySeries (live)', () => {
  it('returns edition-wide totals from the aggregate endpoint', async () => {
    const { series } = await getEditionDailySeries({ language: 'cs', start: '2024-01-01', end: '2024-01-03' }, options);
    expect(series.article).toBeNull();
    // Historical values observed on 2026-09-24.
    expect(series.points.map((p) => p.views)).toEqual([2660435, 2810429, 2677346]);
  });
});

describe('resolveTopic with cache (live)', () => {
  it('answers a repeated resolve without network requests', async () => {
    const request = { topic: 'Astronomy', languages: ['uk'] };
    const first = await resolveTopic(request, options);
    const fetchSpy = vi.fn(globalThis.fetch);
    const second = await resolveTopic(request, { ...options, fetch: fetchSpy });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    expect(second.results[0]).toMatchObject({ status: 'resolved', article: 'Астрономія' });
  });
});
