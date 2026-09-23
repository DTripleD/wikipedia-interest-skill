import { describe, expect, it, vi } from 'vitest';
import { getDailySeries, RECENT_TTL_MS, type SeriesOptions, type SeriesRequest } from '../../src/data/pageviews.js';
import { WikimediaApiError } from '../../src/wikipedia/http.js';
import { MemoryCache } from '../helpers/memory-cache.js';

const NOW = new Date('2026-09-23T12:00:00Z'); // today 09-23, latest day 09-22, final through 09-20
const HOUR = 3_600_000;

/**
 * Fake Pageviews API backed by `truth(date)`: a number is reported, undefined is omitted
 * (as the real API does for days without views). Records every requested range.
 */
function fakeApi(truth: (date: string) => number | undefined, opts: { notFound?: boolean } = {}) {
  const ranges: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const parts = new URL(String(input)).pathname.split('/');
    const [project, access, agent, article, granularity, start, end] = parts.slice(-7) as string[];
    const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    ranges.push(`${iso(start!)}..${iso(end!)}`);
    if (opts.notFound) return new Response(JSON.stringify({ status: 404 }), { status: 404 });
    const items = [];
    for (let d = new Date(`${iso(start!)}T00:00:00Z`); d <= new Date(`${iso(end!)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10);
      const views = truth(date);
      if (views !== undefined) {
        items.push({ project, article, granularity, access, agent, timestamp: `${date.replaceAll('-', '')}00`, views });
      }
    }
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchMock, ranges };
}

/** Views derived from the date so values are stable across requests: day-of-month. */
const byDay = (date: string) => Number(date.slice(8, 10));

function options(fetchMock: unknown, cache: MemoryCache | null, now = NOW): SeriesOptions {
  return { fetch: fetchMock as typeof fetch, cache, now: () => now, sleep: async () => {}, maxRetries: 0, userAgent: 'test/1 (t@example.org)' };
}

const REQ: SeriesRequest = { language: 'cs', article: 'Přerušovaný půst', start: '2026-08-01', end: '2026-09-22' };

describe('getDailySeries: normalization', () => {
  it('fetches once, returns a dense series and imputes days the API omitted', async () => {
    const api = fakeApi((d) => (d === '2026-08-10' ? undefined : byDay(d)));
    const { series, apiRequests } = await getDailySeries(REQ, options(api.fetchMock, null));
    expect(apiRequests).toBe(1);
    expect(api.ranges).toEqual(['2026-08-01..2026-09-22']);
    expect(series).toMatchObject({
      language: 'cs',
      project: 'cs.wikipedia',
      article: 'Přerušovaný_půst',
      access: 'all-access',
      agent: 'user',
      start: '2026-08-01',
      end: '2026-09-22',
      warnings: [],
    });
    expect(series.points).toHaveLength(53);
    expect(series.points.find((p) => p.date === '2026-08-10')).toEqual({ date: '2026-08-10', views: 0, imputed: true });
    expect(series.coverage).toMatchObject({ expectedDays: 53, reportedDays: 52, imputedDays: 1 });
  });

  it('trims unpublished recent days instead of counting them as zero, but imputes older gaps', async () => {
    const api = fakeApi((d) => (d === '2026-09-22' || d === '2026-09-19' ? undefined : byDay(d)));
    const { series } = await getDailySeries(REQ, options(api.fetchMock, null));
    expect(series.end).toBe('2026-09-21');
    expect(series.points.at(-1)).toEqual({ date: '2026-09-21', views: 21, imputed: false });
    expect(series.points.find((p) => p.date === '2026-09-19')?.imputed).toBe(true);
    expect(series.warnings.join(' ')).toMatch(/No data yet for 2026-09-22\.\.2026-09-22/);
  });

  it('fails when no day of the range has been published yet', async () => {
    const api = fakeApi(() => undefined);
    const err = await getDailySeries({ ...REQ, start: '2026-09-21' }, options(api.fetchMock, null)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WikimediaApiError);
    expect((err as WikimediaApiError).code).toBe('INVALID_INPUT');
    expect((err as WikimediaApiError).message).toMatch(/has been published yet/);
  });

  it('clamps the range to available data, with warnings', async () => {
    const api = fakeApi(byDay);
    const { series } = await getDailySeries({ ...REQ, start: '2015-06-01', end: '2026-12-31' }, options(api.fetchMock, null));
    expect(api.ranges).toEqual(['2015-07-01..2026-09-22']);
    expect(series.start).toBe('2015-07-01');
    expect(series.end).toBe('2026-09-22');
    expect(series.warnings).toHaveLength(2);
    expect(series.warnings[0]).toMatch(/clamped to 2015-07-01/);
    expect(series.warnings[1]).toMatch(/clamped to 2026-09-22/);
  });

  it('turns a 404 into an all-zero series with a warning (past days are final)', async () => {
    const api = fakeApi(byDay, { notFound: true });
    const cache = new MemoryCache();
    const req = { ...REQ, end: '2026-08-31' };
    const { series } = await getDailySeries(req, options(api.fetchMock, cache));
    expect(series.coverage).toMatchObject({ expectedDays: 31, reportedDays: 0, imputedDays: 31 });
    expect(series.warnings.join(' ')).toMatch(/reported no views/);
    expect((await getDailySeries(req, options(api.fetchMock, cache))).apiRequests).toBe(0);
  });

  it('normalizes language aliases', async () => {
    const api = fakeApi(byDay);
    const { series } = await getDailySeries({ ...REQ, language: 'nb', article: 'Faste' }, options(api.fetchMock, null));
    expect(series.project).toBe('no.wikipedia');
  });

  it('validates the request before any network call', async () => {
    const api = fakeApi(byDay);
    const bad: SeriesRequest[] = [
      { ...REQ, language: 'not a code' },
      { ...REQ, article: '   ' },
      { ...REQ, start: '2026-02-30' },
      { ...REQ, start: '2026-09-10', end: '2026-09-01' },
      { ...REQ, start: '2026-09-23', end: '2026-09-30' },
      { ...REQ, start: '2014-01-01', end: '2015-06-30' },
    ];
    for (const req of bad) {
      const err = await getDailySeries(req, options(api.fetchMock, null)).catch((e: unknown) => e);
      expect((err as WikimediaApiError).code, JSON.stringify(req)).toBe('INVALID_INPUT');
    }
    expect(api.fetchMock).not.toHaveBeenCalled();
  });
});

describe('getDailySeries: incremental cache', () => {
  it('serves a repeated request from the cache', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    const first = await getDailySeries(REQ, options(api.fetchMock, cache));
    const second = await getDailySeries(REQ, options(api.fetchMock, cache));
    expect(second.apiRequests).toBe(0);
    expect(second.series).toEqual(first.series);
  });

  it('serves any sub-range of final days from the cache, even much later', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    await getDailySeries(REQ, options(api.fetchMock, cache));
    const later = new Date('2026-11-01T00:00:00Z');
    const { series, apiRequests } = await getDailySeries(
      { ...REQ, start: '2026-08-05', end: '2026-09-20' },
      options(api.fetchMock, cache, later),
    );
    expect(apiRequests).toBe(0);
    expect(series.points).toHaveLength(47);
    expect(series.points[0]).toEqual({ date: '2026-08-05', views: 5, imputed: false });
  });

  it('re-fetches only the non-final tail once it is older than the TTL', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    await getDailySeries(REQ, options(api.fetchMock, cache));

    const soon = new Date(NOW.getTime() + RECENT_TTL_MS - HOUR);
    expect((await getDailySeries(REQ, options(api.fetchMock, cache, soon))).apiRequests).toBe(0);

    const stale = new Date(NOW.getTime() + RECENT_TTL_MS + HOUR); // still 2026-09-23
    expect((await getDailySeries(REQ, options(api.fetchMock, cache, stale))).apiRequests).toBe(1);
    expect(api.ranges.at(-1)).toBe('2026-09-21..2026-09-22');
  });

  it('fetches only the new days when the range moves forward', async () => {
    const recent = new Set(['2026-09-22']);
    const api = fakeApi((d) => (recent.has(d) ? undefined : byDay(d))); // 09-22 not published at first
    const cache = new MemoryCache();
    const first = await getDailySeries(REQ, options(api.fetchMock, cache));
    expect(first.series.end).toBe('2026-09-21');

    recent.clear(); // a day later, 09-22 and 09-23 are published
    const nextDay = new Date('2026-09-24T12:00:00Z');
    const { series, apiRequests } = await getDailySeries({ ...REQ, end: '2026-09-23' }, options(api.fetchMock, cache, nextDay));
    expect(apiRequests).toBe(1);
    expect(api.ranges.at(-1)).toBe('2026-09-21..2026-09-23');
    expect(series.end).toBe('2026-09-23');
    expect(series.points.at(-2)).toEqual({ date: '2026-09-22', views: 22, imputed: false });
    expect(series.coverage.imputedDays).toBe(0);
  });

  it('fetches only the missing days when the range moves back', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    await getDailySeries({ ...REQ, end: '2026-09-15' }, options(api.fetchMock, cache));
    const { series, apiRequests } = await getDailySeries(
      { ...REQ, start: '2026-06-01', end: '2026-08-31' },
      options(api.fetchMock, cache),
    );
    expect(apiRequests).toBe(1);
    expect(api.ranges.at(-1)).toBe('2026-06-01..2026-07-31');
    expect(series.coverage).toMatchObject({ expectedDays: 92, reportedDays: 92 });
  });

  it('fills the gap when a later range does not touch the cached one', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    await getDailySeries({ ...REQ, start: '2024-01-01', end: '2024-01-31' }, options(api.fetchMock, cache));
    await getDailySeries({ ...REQ, start: '2026-01-01', end: '2026-01-31' }, options(api.fetchMock, cache));
    expect(api.ranges.at(-1)).toBe('2024-02-01..2026-01-31');
    expect((await getDailySeries({ ...REQ, start: '2025-05-01', end: '2025-05-31' }, options(api.fetchMock, cache))).apiRequests).toBe(0);
  });

  it('keeps separate entries per article, access and agent', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    const req = { ...REQ, end: '2026-08-31' };
    await getDailySeries(req, options(api.fetchMock, cache));
    expect((await getDailySeries({ ...req, agent: 'all-agents' }, options(api.fetchMock, cache))).apiRequests).toBe(1);
    expect((await getDailySeries({ ...req, access: 'desktop' }, options(api.fetchMock, cache))).apiRequests).toBe(1);
    expect((await getDailySeries({ ...req, article: 'Půst' }, options(api.fetchMock, cache))).apiRequests).toBe(1);
    // Spaces and underscores are the same article.
    expect((await getDailySeries({ ...req, article: 'Přerušovaný_půst' }, options(api.fetchMock, cache))).apiRequests).toBe(0);
  });

  it('re-fetches when the cached value is malformed', async () => {
    const api = fakeApi(byDay);
    const cache = new MemoryCache();
    const req = { ...REQ, end: '2026-08-31' };
    await getDailySeries(req, options(api.fetchMock, cache));
    for (const entry of cache.entries.values()) (entry.value as { points: unknown }).points = 'garbage';
    expect((await getDailySeries(req, options(api.fetchMock, cache))).apiRequests).toBe(1);
  });

  it('hits the API every time without a cache', async () => {
    const api = fakeApi(byDay);
    await getDailySeries(REQ, options(api.fetchMock, null));
    await getDailySeries(REQ, options(api.fetchMock, null));
    expect(api.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed requests', async () => {
    const cache = new MemoryCache();
    const failing = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(getDailySeries(REQ, options(failing, cache))).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    expect(cache.entries.size).toBe(0);
  });
});
