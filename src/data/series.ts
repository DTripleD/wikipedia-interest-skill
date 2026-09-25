/**
 * Internal data model for pageviews: one dense daily series per (language, article).
 *
 * Normalization rules:
 * - Every day in [start, end] has exactly one point, sorted by date.
 * - Days the API did not report are filled with 0 views and marked `imputed: true`.
 *   The API omits days, most likely days with zero views (observed, undocumented; see
 *   docs/wikimedia-api.md). Their count and share are reported in `coverage` so the
 *   confidence model can take them into account.
 * - Recent days that are not published yet are NOT imputed: the fetch layer trims them
 *   off the end of the range before building the series (see pageviews.ts).
 */
import { addDays, daysInMonth, eachDay, isIsoDate } from '../dates.js';
import type { Access, Agent, PageviewPoint } from '../wikipedia/api.js';

export interface DailyPoint {
  date: string;
  views: number;
  /** True if the API did not report this day and it was filled with 0. */
  imputed: boolean;
}

export interface Coverage {
  /** Days in [start, end]. */
  expectedDays: number;
  /** Days the API reported (including days it reported with 0 views). */
  reportedDays: number;
  /** Days filled with 0 because the API omitted them. */
  imputedDays: number;
  /** imputedDays / expectedDays (0 when expectedDays is 0). */
  imputedShare: number;
  firstReportedDate: string | null;
  lastReportedDate: string | null;
}

export interface SeriesMeta {
  /** Edition subdomain, e.g. "pl". */
  language: string;
  /** Pageviews project, e.g. "pl.wikipedia". */
  project: string;
  /** Article title in API form (underscores); null for edition-wide totals. */
  article: string | null;
  access: Access;
  agent: Agent;
}

export interface PageviewSeries extends SeriesMeta {
  /** Inclusive range covered by `points`. */
  start: string;
  end: string;
  points: DailyPoint[];
  coverage: Coverage;
  /** Non-fatal notes: clamped dates, trimmed recent days, no data at all. */
  warnings: string[];
}

export interface MonthlyTotal {
  /** `YYYY-MM`. */
  month: string;
  views: number;
  /** Days of this month inside the series. */
  days: number;
  /** Days in the calendar month. */
  calendarDays: number;
  /** True if the series covers the whole calendar month. */
  complete: boolean;
  imputedDays: number;
}

/**
 * Builds a dense daily series from the days the API reported.
 * `reported` must be within [start, end], unique, with non-negative integer views.
 */
export function buildSeries(
  meta: SeriesMeta,
  start: string,
  end: string,
  reported: readonly PageviewPoint[],
  warnings: readonly string[] = [],
): PageviewSeries {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    throw new RangeError(`Invalid series range ${start}..${end}.`);
  }
  const byDate = new Map<string, number>();
  for (const p of reported) {
    if (p.date < start || p.date > end) throw new RangeError(`Point ${p.date} is outside ${start}..${end}.`);
    if (!Number.isInteger(p.views) || p.views < 0) throw new RangeError(`Invalid views ${p.views} on ${p.date}.`);
    if (byDate.has(p.date)) throw new RangeError(`Duplicate point for ${p.date}.`);
    byDate.set(p.date, p.views);
  }

  const points = eachDay(start, end).map((date): DailyPoint => {
    const views = byDate.get(date);
    return views === undefined ? { date, views: 0, imputed: true } : { date, views, imputed: false };
  });

  const reportedDates = [...byDate.keys()].sort();
  const expectedDays = points.length;
  const imputedDays = expectedDays - reportedDates.length;
  return {
    ...meta,
    start,
    end,
    points,
    coverage: {
      expectedDays,
      reportedDays: reportedDates.length,
      imputedDays,
      imputedShare: expectedDays === 0 ? 0 : imputedDays / expectedDays,
      firstReportedDate: reportedDates[0] ?? null,
      lastReportedDate: reportedDates[reportedDates.length - 1] ?? null,
    },
    warnings: [...warnings],
  };
}

/** The part of a series within [start, end] (must lie inside it), with coverage recomputed. */
export function sliceSeries(series: PageviewSeries, start: string, end: string): PageviewSeries {
  if (start < series.start || end > series.end) {
    throw new RangeError(`${start}..${end} is not within the series range ${series.start}..${series.end}.`);
  }
  const { points, coverage: _coverage, warnings, start: _start, end: _end, ...meta } = series;
  const reported = points.filter((p) => !p.imputed && p.date >= start && p.date <= end);
  return buildSeries(meta, start, end, reported, warnings);
}

export function totalViews(points: readonly DailyPoint[]): number {
  return points.reduce((sum, p) => sum + p.views, 0);
}

/** Calendar-month totals. First/last months may be partial; check `complete`. */
export function aggregateMonthly(series: PageviewSeries): MonthlyTotal[] {
  const months = new Map<string, MonthlyTotal>();
  for (const p of series.points) {
    const month = p.date.slice(0, 7);
    let total = months.get(month);
    if (!total) {
      total = { month, views: 0, days: 0, calendarDays: daysInMonth(month), complete: false, imputedDays: 0 };
      months.set(month, total);
    }
    total.views += p.views;
    total.days += 1;
    if (p.imputed) total.imputedDays += 1;
  }
  for (const total of months.values()) total.complete = total.days === total.calendarDays;
  return [...months.values()];
}

export interface WeeklyTotal {
  /** Monday of the ISO week. */
  weekStart: string;
  views: number;
  /** Days of this week inside the series (7 when complete). */
  days: number;
  complete: boolean;
  imputedDays: number;
}

/** Totals per ISO week (Monday–Sunday). First/last weeks may be partial; check `complete`. */
export function aggregateWeekly(series: PageviewSeries): WeeklyTotal[] {
  const weeks = new Map<string, WeeklyTotal>();
  for (const p of series.points) {
    const weekday = (new Date(`${p.date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const weekStart = addDays(p.date, -weekday);
    let total = weeks.get(weekStart);
    if (!total) {
      total = { weekStart, views: 0, days: 0, complete: false, imputedDays: 0 };
      weeks.set(weekStart, total);
    }
    total.views += p.views;
    total.days += 1;
    if (p.imputed) total.imputedDays += 1;
  }
  for (const total of weeks.values()) total.complete = total.days === 7;
  return [...weeks.values()];
}
