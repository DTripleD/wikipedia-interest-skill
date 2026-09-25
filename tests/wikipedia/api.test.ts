import { describe, expect, it, vi } from 'vitest';
import { WikimediaApiError } from '../../src/wikipedia/http.js';
import {
  buildPageviewsUrl,
  buildProjectPageviewsUrl,
  fetchPageviews,
  fetchProjectPageviews,
  normalizeArticleTitle,
  parseRetryAfter,
  wikipediaProject,
  type PageviewsClientOptions,
  type PageviewsQuery,
} from '../../src/wikipedia/api.js';

const NOW = new Date('2026-09-23T12:00:00Z');

function item(timestamp: string, views: number, extra: Record<string, unknown> = {}) {
  return {
    project: 'pl.wikipedia',
    article: 'Post_przerywany',
    granularity: 'daily',
    timestamp,
    access: 'all-access',
    agent: 'user',
    views,
    ...extra,
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json', ...headers },
  });
}

const NOT_FOUND_BODY = {
  detail: 'The date(s) you used are valid, but we either do not have data for those date(s), or the project you asked for is not loaded yet.',
  status: 404,
  title: 'Not Found',
};

/** Client options with a scripted fetch and a recording, instant sleep. */
function setup(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('fetch called more times than scripted');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const options: PageviewsClientOptions = {
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
    userAgent: 'test-agent/1.0 (test@example.org)',
  };
  return { fetchMock, sleeps, options };
}

const QUERY: PageviewsQuery = { project: 'pl.wikipedia', article: 'Post przerywany', start: '2024-01-01', end: '2024-01-03' };

async function expectError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WikimediaApiError);
  expect((err as WikimediaApiError).code).toBe(code);
  return err as WikimediaApiError;
}

describe('helpers', () => {
  it('wikipediaProject builds project ids and rejects junk', () => {
    expect(wikipediaProject('pl')).toBe('pl.wikipedia');
    expect(wikipediaProject(' UK ')).toBe('uk.wikipedia');
    expect(wikipediaProject('zh-min-nan')).toBe('zh-min-nan.wikipedia');
    expect(wikipediaProject('simple')).toBe('simple.wikipedia');
    for (const bad of ['', 'p l', 'pl.wikipedia', '-pl', 'pl_PL']) {
      expect(() => wikipediaProject(bad), bad).toThrow(WikimediaApiError);
    }
  });

  it('normalizeArticleTitle converts whitespace to underscores and keeps case', () => {
    expect(normalizeArticleTitle('  Intermittent fasting ')).toBe('Intermittent_fasting');
    expect(normalizeArticleTitle('AC/DC')).toBe('AC/DC');
  });

  it('buildPageviewsUrl encodes titles (including "/" and non-ASCII)', () => {
    const base = { project: 'en.wikipedia', start: '2024-01-01', end: '2024-01-02', granularity: 'daily', access: 'all-access', agent: 'user' } as const;
    expect(buildPageviewsUrl({ ...base, article: 'AC/DC' })).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/AC%2FDC/daily/20240101/20240102',
    );
    expect(buildPageviewsUrl({ ...base, article: 'Астрономія' })).toContain(
      '/user/%D0%90%D1%81%D1%82%D1%80%D0%BE%D0%BD%D0%BE%D0%BC%D1%96%D1%8F/daily/',
    );
  });

  it('parseRetryAfter handles seconds, HTTP dates and garbage', () => {
    expect(parseRetryAfter('7', NOW)).toBe(7000);
    expect(parseRetryAfter(new Date(NOW.getTime() + 3000).toUTCString(), NOW)).toBe(3000);
    expect(parseRetryAfter(new Date(NOW.getTime() - 3000).toUTCString(), NOW)).toBe(0);
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter('soon', NOW)).toBeNull();
  });
});

describe('fetchPageviews: success', () => {
  it('parses, sorts and returns points with request metadata', async () => {
    const { fetchMock, options } = setup(json({ items: [item('2024010300', 30), item('2024010100', 10), item('2024010200', 0)] }));

    const result = await fetchPageviews(QUERY, options);

    expect(result).toEqual({
      project: 'pl.wikipedia',
      article: 'Post_przerywany',
      granularity: 'daily',
      access: 'all-access',
      agent: 'user',
      start: '2024-01-01',
      end: '2024-01-03',
      points: [
        { date: '2024-01-01', views: 10 },
        { date: '2024-01-02', views: 0 },
        { date: '2024-01-03', views: 30 },
      ],
      noData: false,
      warnings: [],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pl.wikipedia/all-access/user/Post_przerywany/daily/20240101/20240103');
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe('test-agent/1.0 (test@example.org)');
  });

  it('does not fill missing days (gaps are left to normalization)', async () => {
    const { options } = setup(json({ items: [item('2024010100', 5), item('2024010300', 6)] }));
    const result = await fetchPageviews(QUERY, options);
    expect(result.points.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-03']);
  });

  it('passes access, agent and granularity through', async () => {
    const { fetchMock, options } = setup(json({ items: [item('2024010100', 5, { granularity: 'monthly' })] }));
    await fetchPageviews({ ...QUERY, end: '2024-01-31', granularity: 'monthly', access: 'mobile-web', agent: 'all-agents' }, options);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/pl.wikipedia/mobile-web/all-agents/Post_przerywany/monthly/20240101/20240131');
  });

  it('treats 404 as "no data" rather than an error', async () => {
    const { options } = setup(json(NOT_FOUND_BODY, 404));
    const result = await fetchPageviews(QUERY, options);
    expect(result.noData).toBe(true);
    expect(result.points).toEqual([]);
  });
});

describe('fetchPageviews: input validation (no request is sent)', () => {
  const cases: Array<[string, Partial<PageviewsQuery>]> = [
    ['bad project', { project: 'plwiki' }],
    ['non-wikipedia project', { project: 'pl.wiktionary' }],
    ['empty article', { article: '   ' }],
    ['bad start format', { start: '20240101' }],
    ['impossible end date', { end: '2024-02-30' }],
    ['start after end', { start: '2024-02-01', end: '2024-01-01' }],
    ['range entirely before data start', { start: '2014-01-01', end: '2015-06-30' }],
    ['start in the future', { start: '2026-10-01', end: '2026-10-05' }],
    ['bad granularity', { granularity: 'hourly' as never }],
    ['bad agent', { agent: 'robot' as never }],
    ['bad access', { access: 'tablet' as never }],
  ];

  it.each(cases)('%s → INVALID_INPUT', async (_name, patch) => {
    const { fetchMock, options } = setup();
    await expectError(fetchPageviews({ ...QUERY, ...patch }, options), 'INVALID_INPUT');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchPageviews: warnings', () => {
  it('clamps start dates before 2015-07-01', async () => {
    const { fetchMock, options } = setup(json({ items: [] }));
    const result = await fetchPageviews({ ...QUERY, start: '2015-01-01', end: '2015-07-10' }, options);
    expect(result.start).toBe('2015-07-01');
    expect(result.warnings[0]).toMatch(/clamped to 2015-07-01/);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/20150701/20150710');
  });

  it('warns when the range reaches today (data lag)', async () => {
    const { options } = setup(json({ items: [] }));
    const result = await fetchPageviews({ ...QUERY, start: '2026-09-01', end: '2026-09-23' }, options);
    expect(result.warnings.some((w) => /lags/.test(w))).toBe(true);
  });

  it('warns about partial months with monthly granularity', async () => {
    const { options } = setup(json({ items: [] }));
    const result = await fetchPageviews({ ...QUERY, start: '2024-01-15', end: '2024-04-20', granularity: 'monthly' }, options);
    expect(result.warnings.some((w) => /partial/.test(w))).toBe(true);
  });

  it('does not warn for whole months', async () => {
    const { options } = setup(json({ items: [] }));
    const result = await fetchPageviews({ ...QUERY, start: '2024-01-01', end: '2024-02-29', granularity: 'monthly' }, options);
    expect(result.warnings).toEqual([]);
  });
});

describe('fetchPageviews: HTTP errors and retries', () => {
  it('fails fast on 400 and surfaces the API detail', async () => {
    const { fetchMock, options } = setup(json({ detail: 'start timestamp is invalid' }, 400));
    const err = await expectError(fetchPageviews(QUERY, options), 'BAD_REQUEST');
    expect(err.message).toContain('start timestamp is invalid');
    expect(err.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 403 to FORBIDDEN and hints at the User-Agent', async () => {
    const { options } = setup(new Response('forbidden', { status: 403 }));
    const err = await expectError(fetchPageviews(QUERY, options), 'FORBIDDEN');
    expect(err.message).toMatch(/User-Agent/);
  });

  it('retries 5xx with exponential backoff and then succeeds', async () => {
    const { fetchMock, sleeps, options } = setup(
      json({}, 500),
      json({}, 502),
      json({ items: [item('2024010100', 1)] }),
    );
    const result = await fetchPageviews(QUERY, options);
    expect(result.points).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after maxRetries with SERVER_ERROR', async () => {
    const { fetchMock, sleeps, options } = setup(json({}, 500), json({}, 500), json({}, 500));
    await expectError(fetchPageviews(QUERY, { ...options, maxRetries: 2 }), 'SERVER_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('honours Retry-After on 429', async () => {
    const { sleeps, options } = setup(json({}, 429, { 'retry-after': '3' }), json({ items: [] }));
    await fetchPageviews(QUERY, options);
    expect(sleeps).toEqual([3000]);
  });

  it('waits at least 5 s on 429 without Retry-After', async () => {
    const { sleeps, options } = setup(json({}, 429), json({ items: [] }));
    await fetchPageviews(QUERY, options);
    expect(sleeps).toEqual([5000]);
  });

  it('reports RATE_LIMITED when 429 persists', async () => {
    const { options } = setup(json({}, 429, { 'retry-after': '1' }), json({}, 429, { 'retry-after': '1' }));
    await expectError(fetchPageviews(QUERY, { ...options, maxRetries: 1 }), 'RATE_LIMITED');
  });

  it('gives up immediately when Retry-After exceeds the limit', async () => {
    const { fetchMock, sleeps, options } = setup(json({}, 429, { 'retry-after': '120' }));
    const err = await expectError(fetchPageviews(QUERY, options), 'RATE_LIMITED');
    expect(err.message).toMatch(/120 s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('retries network errors, then reports NETWORK_ERROR', async () => {
    const { fetchMock, options } = setup(new TypeError('fetch failed'), new TypeError('fetch failed'));
    await expectError(fetchPageviews(QUERY, { ...options, maxRetries: 1 }), 'NETWORK_ERROR');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps timeouts to TIMEOUT', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const { options } = setup(timeout);
    await expectError(fetchPageviews(QUERY, { ...options, maxRetries: 0 }), 'TIMEOUT');
  });

  it('maps a timeout while reading the body to TIMEOUT', async () => {
    const response = new Response('{}', { status: 200 });
    vi.spyOn(response, 'json').mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const { options } = setup(response);
    await expectError(fetchPageviews(QUERY, options), 'TIMEOUT');
  });

  it('aborts a hanging request using the real timeout signal', async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    await expectError(
      fetchPageviews(QUERY, { fetch: hanging as unknown as typeof fetch, timeoutMs: 20, maxRetries: 0, now: () => NOW }),
      'TIMEOUT',
    );
  });
});

describe('fetchPageviews: response validation', () => {
  const bad: Array<[string, Response]> = [
    ['non-JSON body', new Response('<html>oops</html>', { status: 200 })],
    ['missing items', json({ foo: [] })],
    ['bad timestamp', json({ items: [item('2024-01-01', 1)] })],
    ['negative views', json({ items: [item('2024010100', -1)] })],
    ['fractional views', json({ items: [item('2024010100', 1.5)] })],
    ['string views', json({ items: [item('2024010100', '5' as never)] })],
    ['duplicate dates', json({ items: [item('2024010100', 1), item('2024010100', 2)] })],
    ['granularity mismatch', json({ items: [item('2024010100', 1, { granularity: 'monthly' })] })],
  ];

  it.each(bad)('%s → INVALID_RESPONSE', async (_name, response) => {
    const { options } = setup(response);
    await expectError(fetchPageviews(QUERY, options), 'INVALID_RESPONSE');
  });
});

describe('fetchProjectPageviews (edition totals)', () => {
  it('calls the aggregate endpoint and parses items without an article', async () => {
    const edition = (timestamp: string, views: number) => {
      const { article: _article, ...rest } = item(timestamp, views, { project: 'cs.wikipedia' });
      return rest;
    };
    const { fetchMock, options } = setup(json({ items: [edition('2024010200', 2810429), edition('2024010100', 2660435)] }));
    const result = await fetchProjectPageviews({ project: 'cs.wikipedia', start: '2024-01-01', end: '2024-01-02' }, options);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/cs.wikipedia/all-access/user/daily/20240101/20240102',
    );
    expect(result).toEqual({
      project: 'cs.wikipedia',
      granularity: 'daily',
      access: 'all-access',
      agent: 'user',
      start: '2024-01-01',
      end: '2024-01-02',
      points: [
        { date: '2024-01-01', views: 2660435 },
        { date: '2024-01-02', views: 2810429 },
      ],
      noData: false,
      warnings: [],
    });
  });

  it('returns noData on 404 and validates input', async () => {
    const { options } = setup(json(NOT_FOUND_BODY, 404));
    const result = await fetchProjectPageviews({ project: 'xx.wikipedia', start: '2024-01-01', end: '2024-01-02' }, options);
    expect(result).toMatchObject({ noData: true, points: [] });
    await expect(fetchProjectPageviews({ project: 'cswiki', start: '2024-01-01', end: '2024-01-02' }, options)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('builds the aggregate URL', () => {
    expect(
      buildProjectPageviewsUrl({ project: 'pl.wikipedia', access: 'desktop', agent: 'all-agents', granularity: 'monthly', start: '2024-01-01', end: '2024-03-31' }),
    ).toBe('https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/pl.wikipedia/desktop/all-agents/monthly/20240101/20240331');
  });
});
