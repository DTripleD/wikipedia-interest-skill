import { describe, expect, it, vi } from 'vitest';
import { WikimediaApiError, requestWithRetry } from '../../src/wikipedia/http.js';

const spec = { service: 'Test API' };

function dnsFailure() {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND xx.wikipedia.org'), { code: 'ENOTFOUND' }) });
}

describe('requestWithRetry (shared layer)', () => {
  it('maps DNS ENOTFOUND to HOST_NOT_FOUND without retrying', async () => {
    const fetchMock = vi.fn(async () => {
      throw dnsFailure();
    });
    const err = await requestWithRetry('https://xx.wikipedia.org/w/api.php', { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} }, spec).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WikimediaApiError);
    expect((err as WikimediaApiError).code).toBe('HOST_NOT_FOUND');
    expect((err as WikimediaApiError).message).toContain('xx.wikipedia.org');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats non-2xx as errors unless listed in passStatuses', async () => {
    const make = () => vi.fn(async () => new Response('{}', { status: 404 }));
    const passing = make();
    const res = await requestWithRetry('https://x.test/', { fetch: passing as unknown as typeof fetch }, { ...spec, passStatuses: [404] });
    expect(res.status).toBe(404);

    const failing = make();
    const err = await requestWithRetry('https://x.test/', { fetch: failing as unknown as typeof fetch }, spec).catch((e: unknown) => e);
    expect((err as WikimediaApiError).code).toBe('HTTP_ERROR');
    expect((err as WikimediaApiError).message).toMatch(/^Test API returned HTTP 404/);
  });

  it('mentions WIKI_SKILL_CONTACT when rate limited', async () => {
    const fetchMock = vi.fn(async () => new Response('Too many requests', { status: 429, headers: { 'retry-after': '1' } }));
    const err = await requestWithRetry('https://x.test/', { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, maxRetries: 1 }, spec).catch(
      (e: unknown) => e,
    );
    expect((err as WikimediaApiError).code).toBe('RATE_LIMITED');
    expect((err as WikimediaApiError).message).toMatch(/WIKI_SKILL_CONTACT/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the configured User-Agent', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 200 }));
    await requestWithRetry('https://x.test/', { fetch: fetchMock as unknown as typeof fetch, userAgent: 'ua/1 (me@example.org)' }, spec);
    expect((fetchMock.mock.calls[0]![1]!.headers as Record<string, string>)['User-Agent']).toBe('ua/1 (me@example.org)');
  });
});
