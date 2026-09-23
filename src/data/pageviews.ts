/**
 * Daily pageview series with an incremental cache.
 *
 * One cache entry per (project, access, agent, article) holds every day fetched so far
 * as one contiguous range [from, to]. A request only fetches what the entry lacks:
 * - days before `from` (one request);
 * - days after `finalThrough`, when the request goes past `to`, or when the non-final
 *   tail is older than RECENT_TTL_MS (one request).
 * Days on or before `finalThrough` are treated as immutable. Days after it are "recent":
 * they may not be published yet. This follows Wikimedia's ~1-day publication lag
 * (observed); that older days never change is an assumption, not documented.
 *
 * Always fetches daily data: monthly API totals count partial months (verified), so
 * monthly figures are aggregated from daily points (see series.ts).
 */
import { addDays, isIsoDate, todayUtc } from '../dates.js';
import {
  ACCESS_TYPES,
  AGENT_TYPES,
  DATA_START_DATE,
  fetchPageviews,
  normalizeArticleTitle,
  type Access,
  type Agent,
  type PageviewPoint,
  type PageviewsClientOptions,
} from '../wikipedia/api.js';
import { WikimediaApiError } from '../wikipedia/http.js';
import { toEdition } from '../wikipedia/languages.js';
import { isFresh, type JsonCache } from './cache.js';
import { buildSeries, type PageviewSeries, type SeriesMeta } from './series.js';

/** Days within this many days of today are not final (data may still be missing). */
export const RECENT_DAYS = 3;
/** Reuse cached recent days for this long. Matches the API's own cache-control max-age (4 h). */
export const RECENT_TTL_MS = 4 * 60 * 60 * 1000;

const NAMESPACE = 'pageviews';

export interface SeriesRequest {
  /** Language code or edition, e.g. "pl" (aliases like "nb" are normalized). */
  language: string;
  /** Canonical article title, e.g. from the resolver. Spaces or underscores. */
  article: string;
  /** Inclusive ISO dates. `end` is clamped to yesterday (UTC). */
  start: string;
  end: string;
  /** Default `all-access`. */
  access?: Access;
  /** Default `user`. */
  agent?: Agent;
}

export interface SeriesOptions extends PageviewsClientOptions {
  /** Cache to read and update; null or omitted disables caching. */
  cache?: JsonCache | null;
}

export interface SeriesFetchResult {
  series: PageviewSeries;
  /** Pageviews API calls made (0 when fully served from the cache). */
  apiRequests: number;
}

/** Cached value. `points` holds only the days the API reported, within [from, to]. */
interface StoredSeries {
  from: string;
  to: string;
  /** Last day considered final when the tail was fetched; may be before `from`. */
  finalThrough: string;
  /** When the tail (days after finalThrough) was last fetched. */
  tailFetchedAt: string;
  points: PageviewPoint[];
}

export async function getDailySeries(request: SeriesRequest, options: SeriesOptions = {}): Promise<SeriesFetchResult> {
  const now = options.now?.() ?? new Date();
  const today = todayUtc(now);
  const { meta, start, end, warnings } = validateRequest(request, today);
  const cache = options.cache ?? null;
  const key = [meta.project, meta.access, meta.agent, meta.article].join('|');
  const cutoff = addDays(today, -RECENT_DAYS);

  const cached = cache?.get(NAMESPACE, key);
  let stored = cached ? parseStored(cached.value) : null;
  let apiRequests = 0;

  const fetchRange = async (from: string, to: string): Promise<PageviewPoint[]> => {
    apiRequests++;
    const result = await fetchPageviews(
      { project: meta.project, article: meta.article, start: from, end: to, access: meta.access, agent: meta.agent },
      options,
    );
    return result.points; // a 404 (noData) yields [] — no reported days in the range
  };

  if (stored === null) {
    stored = {
      from: start,
      to: end,
      finalThrough: minDate(end, cutoff),
      tailFetchedAt: now.toISOString(),
      points: await fetchRange(start, end),
    };
  } else {
    let { from, to, finalThrough, tailFetchedAt, points } = stored;
    if (start < from) {
      const left = await fetchRange(start, addDays(from, -1));
      points = [...left, ...points];
      from = start;
    }
    const tailStale = end > finalThrough && !isFresh(tailFetchedAt, RECENT_TTL_MS, now);
    if (end > to || tailStale) {
      const tailFrom = maxDate(addDays(finalThrough, 1), from);
      const tailTo = maxDate(end, to);
      const tail = await fetchRange(tailFrom, tailTo);
      points = [...points.filter((p) => p.date < tailFrom), ...tail];
      to = tailTo;
      finalThrough = minDate(tailTo, cutoff);
      tailFetchedAt = now.toISOString();
    }
    stored = { from, to, finalThrough, tailFetchedAt, points };
  }
  if (cache && apiRequests > 0) cache.set(NAMESPACE, key, stored, now);

  // Trim trailing recent days the API has not reported: they are most likely not
  // published yet, so counting them as zero would fake a drop at the end of the series.
  const reported = new Set(stored.points.map((p) => p.date));
  let effectiveEnd = end;
  while (effectiveEnd >= start && effectiveEnd > stored.finalThrough && !reported.has(effectiveEnd)) {
    effectiveEnd = addDays(effectiveEnd, -1);
  }
  if (effectiveEnd < start) {
    throw new WikimediaApiError(
      'INVALID_INPUT',
      `No pageview data has been published yet for ${start}..${end} (Wikimedia publishes with a delay of about a day). Choose an earlier end date.`,
    );
  }
  if (effectiveEnd < end) {
    warnings.push(
      `No data yet for ${addDays(effectiveEnd, 1)}..${end}: recent days are published with a delay, so the series ends on ${effectiveEnd} instead of counting them as zero.`,
    );
  }

  const points = stored.points.filter((p) => p.date >= start && p.date <= effectiveEnd);
  if (points.length === 0) {
    warnings.push(
      `The Pageviews API reported no views of "${meta.article}" on ${meta.project} in this period: the article may not have existed under this title, or had no views.`,
    );
  }
  return { series: buildSeries(meta, start, effectiveEnd, points, warnings), apiRequests };
}

function validateRequest(request: SeriesRequest, today: string) {
  const invalid = (msg: string) => new WikimediaApiError('INVALID_INPUT', msg);
  const language = toEdition(request.language);
  const article = normalizeArticleTitle(request.article);
  if (article.length === 0) throw invalid('Article title must not be empty.');
  const access = request.access ?? 'all-access';
  const agent = request.agent ?? 'user';
  if (!ACCESS_TYPES.includes(access)) throw invalid(`Invalid access "${access}". Allowed: ${ACCESS_TYPES.join(', ')}.`);
  if (!AGENT_TYPES.includes(agent)) throw invalid(`Invalid agent "${agent}". Allowed: ${AGENT_TYPES.join(', ')}.`);
  if (!isIsoDate(request.start)) throw invalid(`Invalid start date "${request.start}". Expected YYYY-MM-DD.`);
  if (!isIsoDate(request.end)) throw invalid(`Invalid end date "${request.end}". Expected YYYY-MM-DD.`);
  if (request.start > request.end) throw invalid(`Start date ${request.start} is after end date ${request.end}.`);

  const warnings: string[] = [];
  const latest = addDays(today, -1);
  let start = request.start;
  let end = request.end;
  if (end < DATA_START_DATE) throw invalid(`End date ${end} is before ${DATA_START_DATE}, the first date with pageview data.`);
  if (start > latest) throw invalid(`Start date ${start} is not in the past; the latest possible day is ${latest} (UTC).`);
  if (start < DATA_START_DATE) {
    warnings.push(`Start date ${start} clamped to ${DATA_START_DATE}: no pageview data exists before it.`);
    start = DATA_START_DATE;
  }
  if (end > latest) {
    warnings.push(`End date ${end} clamped to ${latest}: pageviews for today and later are not available.`);
    end = latest;
  }

  const meta: SeriesMeta = { language, project: `${language}.wikipedia`, article, access, agent };
  return { meta, start, end, warnings };
}

/** Validates a cached value; anything unexpected is treated as a cache miss. */
function parseStored(value: unknown): StoredSeries | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const { from, to, finalThrough, tailFetchedAt, points } = v;
  if (typeof from !== 'string' || !isIsoDate(from)) return null;
  if (typeof to !== 'string' || !isIsoDate(to) || to < from) return null;
  if (typeof finalThrough !== 'string' || !isIsoDate(finalThrough) || finalThrough > to) return null;
  if (typeof tailFetchedAt !== 'string' || Number.isNaN(Date.parse(tailFetchedAt))) return null;
  if (!Array.isArray(points)) return null;
  let previous = '';
  for (const p of points as unknown[]) {
    if (typeof p !== 'object' || p === null) return null;
    const { date, views } = p as Record<string, unknown>;
    if (typeof date !== 'string' || !isIsoDate(date) || date < from || date > to || date <= previous) return null;
    if (typeof views !== 'number' || !Number.isInteger(views) || views < 0) return null;
    previous = date;
  }
  return { from, to, finalThrough, tailFetchedAt, points: points as PageviewPoint[] };
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
