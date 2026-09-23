/**
 * Wikimedia Pageviews API client (per-article endpoint).
 *
 * Endpoint:
 *   GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
 *       {project}/{access}/{agent}/{article}/{granularity}/{start}/{end}
 *
 * API behavior verified against the live API on 2026-09-23 (see docs/wikimedia-api.md):
 * - Dates are YYYYMMDD (YYYYMMDDHH is also accepted). Data starts 2015-07-01; earlier
 *   start dates are silently truncated by the API.
 * - 404 means "no data for this article/range" — it is returned both for nonexistent
 *   articles and for unknown projects, so it cannot distinguish the two.
 * - Titles are case-sensitive; spaces are equivalent to underscores; "/" must be encoded.
 * - Days are sometimes omitted from the response (observed on low-traffic articles).
 *   This client does NOT fill gaps; normalization happens in a later layer.
 * - Requests without a User-Agent get 403. Unauthenticated clients with a compliant
 *   User-Agent are limited to 200 req/min; 429/503 responses usually carry Retry-After.
 */
import { getUserAgent } from '../config.js';
import { fromApiTimestamp, isIsoDate, toApiDate, todayUtc } from '../dates.js';

export const PAGEVIEWS_API_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';

/** First date for which the Pageviews API has data. */
export const DATA_START_DATE = '2015-07-01';

export const GRANULARITIES = ['daily', 'monthly'] as const;
export const ACCESS_TYPES = ['all-access', 'desktop', 'mobile-app', 'mobile-web'] as const;
export const AGENT_TYPES = ['all-agents', 'user', 'spider', 'automated'] as const;

export type Granularity = (typeof GRANULARITIES)[number];
export type Access = (typeof ACCESS_TYPES)[number];
export type Agent = (typeof AGENT_TYPES)[number];

export interface PageviewsQuery {
  /** Wikipedia project, e.g. `pl.wikipedia`. Use `wikipediaProject('pl')` to build it. */
  project: string;
  /** Exact article title (case-sensitive). Spaces or underscores. */
  article: string;
  /** Inclusive ISO date `YYYY-MM-DD`. */
  start: string;
  /** Inclusive ISO date `YYYY-MM-DD`. */
  end: string;
  /** Default `daily`. */
  granularity?: Granularity;
  /** Default `all-access`. */
  access?: Access;
  /** Default `user` (excludes spiders and automated traffic). */
  agent?: Agent;
}

export interface PageviewPoint {
  /** ISO date. For monthly granularity this is the first day of the month. */
  date: string;
  views: number;
}

export interface PageviewsResult {
  project: string;
  /** Article title in API form (underscores). */
  article: string;
  granularity: Granularity;
  access: Access;
  agent: Agent;
  /** Effective range requested from the API (start may be clamped to DATA_START_DATE). */
  start: string;
  end: string;
  /** Points returned by the API, sorted by date. Missing dates are NOT filled in. */
  points: PageviewPoint[];
  /** True when the API answered 404 (no data for this article/range, or unknown project). */
  noData: boolean;
  /** Non-fatal notes about the request (clamping, partial months, recent-data lag). */
  warnings: string[];
}

export type PageviewsErrorCode =
  | 'INVALID_INPUT'
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

export class PageviewsApiError extends Error {
  override readonly name = 'PageviewsApiError';
  constructor(
    readonly code: PageviewsErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface PageviewsClientOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  baseUrl?: string;
  /** Per-attempt timeout. Default 15 000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt for 429, 5xx, timeouts and network errors. Default 3. */
  maxRetries?: number;
  /** Exponential backoff base: delay = base * 2^retryIndex. Default 1 000 ms. */
  baseDelayMs?: number;
  /** Give up instead of waiting if the server asks for a longer Retry-After. Default 60 000 ms. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Minimum wait after a 429 without Retry-After, per Wikimedia rate-limit guidance. */
const MIN_RATE_LIMIT_DELAY_MS = 5_000;

const LANGUAGE_CODE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PROJECT = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.wikipedia$/;

/** `pl` → `pl.wikipedia`. Throws INVALID_INPUT for malformed language codes. */
export function wikipediaProject(language: string): string {
  const code = language.trim().toLowerCase();
  if (!LANGUAGE_CODE.test(code) || code.length > 20) {
    throw new PageviewsApiError('INVALID_INPUT', `Invalid Wikipedia language code: "${language}".`);
  }
  return `${code}.wikipedia`;
}

/** Converts a title to the API form: trimmed, spaces → underscores. Case is preserved. */
export function normalizeArticleTitle(title: string): string {
  return title.trim().replace(/\s+/g, '_');
}

export function buildPageviewsUrl(
  query: Required<PageviewsQuery>,
  baseUrl: string = PAGEVIEWS_API_BASE,
): string {
  const parts = [
    query.project,
    query.access,
    query.agent,
    encodeURIComponent(normalizeArticleTitle(query.article)),
    query.granularity,
    toApiDate(query.start),
    toApiDate(query.end),
  ];
  return `${baseUrl}/${parts.join('/')}`;
}

export async function fetchPageviews(
  query: PageviewsQuery,
  options: PageviewsClientOptions = {},
): Promise<PageviewsResult> {
  const now = options.now ?? (() => new Date());
  const { resolved, warnings } = validateQuery(query, todayUtc(now()));
  const url = buildPageviewsUrl(resolved, options.baseUrl);

  const response = await requestWithRetry(url, options);

  const base = {
    project: resolved.project,
    article: normalizeArticleTitle(resolved.article),
    granularity: resolved.granularity,
    access: resolved.access,
    agent: resolved.agent,
    start: resolved.start,
    end: resolved.end,
    warnings,
  };

  if (response.status === 404) {
    return { ...base, points: [], noData: true };
  }

  const body = await readJson(response, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const points = parseItems(body, resolved.granularity);
  return { ...base, points, noData: false };
}

function validateQuery(
  query: PageviewsQuery,
  today: string,
): { resolved: Required<PageviewsQuery>; warnings: string[] } {
  const warnings: string[] = [];
  const invalid = (msg: string) => new PageviewsApiError('INVALID_INPUT', msg);

  const project = query.project.trim().toLowerCase();
  if (!PROJECT.test(project)) {
    throw invalid(`Invalid project "${query.project}". Expected "<language>.wikipedia", e.g. "pl.wikipedia".`);
  }

  const article = normalizeArticleTitle(query.article);
  if (article.length === 0) throw invalid('Article title must not be empty.');

  const granularity = query.granularity ?? 'daily';
  const access = query.access ?? 'all-access';
  const agent = query.agent ?? 'user';
  if (!GRANULARITIES.includes(granularity)) {
    throw invalid(`Invalid granularity "${granularity}". Allowed: ${GRANULARITIES.join(', ')}.`);
  }
  if (!ACCESS_TYPES.includes(access)) {
    throw invalid(`Invalid access "${access}". Allowed: ${ACCESS_TYPES.join(', ')}.`);
  }
  if (!AGENT_TYPES.includes(agent)) {
    throw invalid(`Invalid agent "${agent}". Allowed: ${AGENT_TYPES.join(', ')}.`);
  }

  if (!isIsoDate(query.start)) throw invalid(`Invalid start date "${query.start}". Expected YYYY-MM-DD.`);
  if (!isIsoDate(query.end)) throw invalid(`Invalid end date "${query.end}". Expected YYYY-MM-DD.`);
  if (query.start > query.end) {
    throw invalid(`Start date ${query.start} is after end date ${query.end}.`);
  }
  if (query.end < DATA_START_DATE) {
    throw invalid(`End date ${query.end} is before ${DATA_START_DATE}, the first date with pageview data.`);
  }
  if (query.start > today) {
    throw invalid(`Start date ${query.start} is in the future (today is ${today} UTC).`);
  }

  let start = query.start;
  if (start < DATA_START_DATE) {
    warnings.push(`Start date ${start} clamped to ${DATA_START_DATE}: no pageview data exists before it.`);
    start = DATA_START_DATE;
  }
  if (query.end >= today) {
    warnings.push(
      `End date ${query.end} is today or later; pageview data usually lags by about a day, so the most recent days may be missing.`,
    );
  }
  if (granularity === 'monthly' && (!start.endsWith('-01') || !isLastDayOfMonth(query.end))) {
    warnings.push('Monthly granularity with a range that does not cover whole months: the first/last month totals are partial.');
  }

  return { resolved: { project, article, start, end: query.end, granularity, access, agent }, warnings };
}

function isLastDayOfMonth(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}

async function requestWithRetry(url: string, options: PageviewsClientOptions): Promise<Response> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 60_000;
  const headers = {
    'User-Agent': options.userAgent ?? getUserAgent(),
    Accept: 'application/json',
  };

  for (let attempt = 0; ; attempt++) {
    const backoff = baseDelayMs * 2 ** attempt;
    const canRetry = attempt < maxRetries;
    let failure: PageviewsApiError;
    let delay = backoff;

    try {
      const response = await doFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status === 404) return response;

      failure = await httpError(response);
      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), options.now?.() ?? new Date());
        if (retryAfter !== null && retryAfter > maxRetryAfterMs) {
          throw new PageviewsApiError(
            failure.code,
            `${failure.message} Server asked to retry after ${Math.ceil(retryAfter / 1000)} s; giving up.`,
            response.status,
          );
        }
        delay = retryAfter ?? (response.status === 429 ? Math.max(MIN_RATE_LIMIT_DELAY_MS, backoff) : backoff);
      } else if (response.status < 500) {
        throw failure; // other 4xx: not retryable
      }
    } catch (err) {
      if (err instanceof PageviewsApiError) throw err;
      failure = toTransportError(err, timeoutMs);
    }

    if (!canRetry) throw failure;
    await sleep(delay);
  }
}

async function httpError(response: Response): Promise<PageviewsApiError> {
  const detail = await readProblemDetail(response);
  const suffix = detail ? `: ${detail}` : '';
  const status = response.status;
  if (status === 400) return new PageviewsApiError('BAD_REQUEST', `Pageviews API rejected the request (400)${suffix}`, status);
  if (status === 403) {
    return new PageviewsApiError('FORBIDDEN', `Pageviews API refused access (403); check the User-Agent/WIKI_SKILL_CONTACT${suffix}`, status);
  }
  if (status === 429) return new PageviewsApiError('RATE_LIMITED', `Pageviews API rate limit exceeded (429)${suffix}`, status);
  if (status >= 500) return new PageviewsApiError('SERVER_ERROR', `Pageviews API server error (${status})${suffix}`, status);
  return new PageviewsApiError('HTTP_ERROR', `Pageviews API returned HTTP ${status}${suffix}`, status);
}

async function readProblemDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail;
    }
  } catch {
    // Body is not JSON; the status code alone is reported.
  }
  return null;
}

function toTransportError(err: unknown, timeoutMs: number): PageviewsApiError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new PageviewsApiError('TIMEOUT', `Pageviews API did not respond within ${timeoutMs} ms.`);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PageviewsApiError('NETWORK_ERROR', `Network error calling Pageviews API: ${message}`);
}

/** Parses Retry-After (delta-seconds or HTTP-date) into milliseconds; null if absent/invalid. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now.getTime());
}

async function readJson(response: Response, timeoutMs: number): Promise<unknown> {
  try {
    return await response.json();
  } catch (err) {
    // The timeout signal also covers reading the body.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw toTransportError(err, timeoutMs);
    }
    throw new PageviewsApiError('INVALID_RESPONSE', 'Pageviews API returned a body that is not valid JSON.', response.status);
  }
}

function parseItems(body: unknown, granularity: Granularity): PageviewPoint[] {
  const invalid = (msg: string) => new PageviewsApiError('INVALID_RESPONSE', `Unexpected Pageviews API response: ${msg}`);

  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items)) {
    throw invalid('missing "items" array.');
  }

  const points: PageviewPoint[] = [];
  const seen = new Set<string>();
  for (const item of body.items as unknown[]) {
    if (!item || typeof item !== 'object') throw invalid('item is not an object.');
    const { timestamp, views, granularity: itemGranularity } = item as Record<string, unknown>;
    const date = typeof timestamp === 'string' ? fromApiTimestamp(timestamp) : null;
    if (date === null) throw invalid(`bad timestamp ${JSON.stringify(timestamp)}.`);
    if (typeof views !== 'number' || !Number.isInteger(views) || views < 0) {
      throw invalid(`bad views value ${JSON.stringify(views)} on ${date}.`);
    }
    if (itemGranularity !== undefined && itemGranularity !== granularity) {
      throw invalid(`granularity "${String(itemGranularity)}" does not match requested "${granularity}".`);
    }
    if (seen.has(date)) throw invalid(`duplicate date ${date}.`);
    seen.add(date);
    points.push({ date, views });
  }

  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
