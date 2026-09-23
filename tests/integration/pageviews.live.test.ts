/**
 * Live tests against the real Wikimedia Pageviews API.
 * Not part of `npm test`; run with `npm run test:integration`.
 * They assert stable properties only (shape, known historical values), never recent data.
 */
import { describe, expect, it } from 'vitest';
import { fetchPageviews } from '../../src/wikipedia/api.js';

const options = { timeoutMs: 20_000, maxRetries: 1 };

describe('Pageviews API (live)', () => {
  it('returns daily views for an existing English article', async () => {
    const result = await fetchPageviews(
      { project: 'en.wikipedia', article: 'Astronomy', start: '2024-01-01', end: '2024-01-05' },
      options,
    );
    expect(result.noData).toBe(false);
    expect(result.points.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);
    // Historical value observed on 2026-09-23; past data is not expected to change.
    expect(result.points[0]).toEqual({ date: '2024-01-01', views: 1131 });
  });

  it('handles non-ASCII titles', async () => {
    const result = await fetchPageviews(
      { project: 'uk.wikipedia', article: 'Астрономія', start: '2024-01-01', end: '2024-01-02' },
      options,
    );
    expect(result.article).toBe('Астрономія');
    expect(result.points).toHaveLength(2);
  });

  it('handles titles containing "/" and spaces', async () => {
    const result = await fetchPageviews(
      { project: 'en.wikipedia', article: 'AC/DC', start: '2024-01-01', end: '2024-01-02' },
      options,
    );
    expect(result.points).toHaveLength(2);
  });

  it('returns noData for a nonexistent article', async () => {
    const result = await fetchPageviews(
      { project: 'pl.wikipedia', article: 'Zzzz_nonexistent_qqq_12345', start: '2024-01-01', end: '2024-01-05' },
      options,
    );
    expect(result.noData).toBe(true);
  });

  it('returns whole-month totals with monthly granularity', async () => {
    const result = await fetchPageviews(
      { project: 'en.wikipedia', article: 'Astronomy', start: '2024-01-01', end: '2024-02-29', granularity: 'monthly' },
      options,
    );
    expect(result.points).toEqual([
      { date: '2024-01-01', views: 43527 },
      { date: '2024-02-01', views: 39323 },
    ]);
    expect(result.warnings).toEqual([]);
  });
});
