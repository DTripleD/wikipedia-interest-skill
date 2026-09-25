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
 * - Requests without a User-Agent get 403. Retries and error mapping live in http.ts.
 */
import { fromApiTimestamp, isIsoDate, toApiDate, todayUtc } from '../dates.js';
import { WikimediaApiError, readJson, requestWithRetry, type HttpOptions } from './http.js';

export { wikipediaProject } from './languages.js';
export { parseRetryAfter } from './http.js';

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

export interface PageviewsClientOptions extends HttpOptions {
  /** Overrides the per-article endpoint base only (not the aggregate endpoint). */
  baseUrl?: string;
}

const SERVICE = 'Pageviews API';
const PROJECT = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.wikipedia$/;

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
  const { resolved: common, warnings } = validateQuery(query, todayUtc(now()));
  const article = normalizeArticleTitle(query.article);
  if (article.length === 0) throw new WikimediaApiError('INVALID_INPUT', 'Article title must not be empty.');
  const resolved = { ...common, article };

  const result = await fetchItems(buildPageviewsUrl(resolved, options.baseUrl), common, options);
  return { ...result, article, warnings };
}

/** Edition-wide totals: the aggregate endpoint (all articles of a project). */
export type ProjectPageviewsQuery = Omit<PageviewsQuery, 'article'>;
export type ProjectPageviewsResult = Omit<PageviewsResult, 'article'>;

export const PAGEVIEWS_AGGREGATE_BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate';

export function buildProjectPageviewsUrl(
  query: Required<ProjectPageviewsQuery>,
  baseUrl: string = PAGEVIEWS_AGGREGATE_BASE,
): string {
  const parts = [query.project, query.access, query.agent, query.granularity, toApiDate(query.start), toApiDate(query.end)];
  return `${baseUrl}/${parts.join('/')}`;
}

/**
 * Total pageviews of a whole edition, e.g. all of pl.wikipedia. Same response format,
 * validation and 404 semantics as the per-article endpoint (verified 2026-09-24).
 */
export async function fetchProjectPageviews(
  query: ProjectPageviewsQuery,
  options: PageviewsClientOptions = {},
): Promise<ProjectPageviewsResult> {
  const now = options.now ?? (() => new Date());
  const { resolved, warnings } = validateQuery(query, todayUtc(now()));
  const result = await fetchItems(buildProjectPageviewsUrl(resolved), resolved, options);
  return { ...result, warnings };
}

async function fetchItems(
  url: string,
  resolved: Required<ProjectPageviewsQuery>,
  options: PageviewsClientOptions,
): Promise<Omit<ProjectPageviewsResult, 'warnings'>> {
  const response = await requestWithRetry(url, options, { service: SERVICE, passStatuses: [404] });
  const base = {
    project: resolved.project,
    granularity: resolved.granularity,
    access: resolved.access,
    agent: resolved.agent,
    start: resolved.start,
    end: resolved.end,
  };
  if (response.status === 404) return { ...base, points: [], noData: true };

  const body = await readJson(response, options, SERVICE);
  return { ...base, points: parseItems(body, resolved.granularity), noData: false };
}

/** Validates everything except the article title. */
function validateQuery(
  query: ProjectPageviewsQuery,
  today: string,
): { resolved: Required<ProjectPageviewsQuery>; warnings: string[] } {
  const warnings: string[] = [];
  const invalid = (msg: string) => new WikimediaApiError('INVALID_INPUT', msg);

  const project = query.project.trim().toLowerCase();
  if (!PROJECT.test(project)) {
    throw invalid(`Invalid project "${query.project}". Expected "<language>.wikipedia", e.g. "pl.wikipedia".`);
  }

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

  return { resolved: { project, start, end: query.end, granularity, access, agent }, warnings };
}

function isLastDayOfMonth(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}

function parseItems(body: unknown, granularity: Granularity): PageviewPoint[] {
  const invalid = (msg: string) => new WikimediaApiError('INVALID_RESPONSE', `Unexpected ${SERVICE} response: ${msg}`);

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
