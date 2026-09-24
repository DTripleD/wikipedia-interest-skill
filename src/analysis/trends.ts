/**
 * Trend, period comparisons and moving averages.
 *
 * Trend = Theil–Sen slope (median of pairwise slopes; robust to one-off spikes) plus a
 * Mann–Kendall test for whether a monotonic trend is statistically significant.
 * It runs on the average daily views of complete calendar months, or of complete ISO
 * weeks when the period has too few complete months. Daily data are not used directly:
 * weekday seasonality and strong day-to-day autocorrelation would make the Mann–Kendall
 * p-value far too optimistic.
 */
import { aggregateMonthly, aggregateWeekly, type DailyPoint, type PageviewSeries } from '../data/series.js';
import { mean, median, normalCdf, sum } from './stats.js';

/** Minimum number of complete periods for a trend estimate. */
export const MIN_TREND_PERIODS = 8;
/** Two-sided significance level for the Mann–Kendall test. */
export const SIGNIFICANCE_LEVEL = 0.05;

// ---------------------------------------------------------------------------
// Theil–Sen and Mann–Kendall on an equally spaced series (x = 0, 1, 2, ...)
// ---------------------------------------------------------------------------

export interface TheilSen {
  /** Change in y per step. */
  slope: number;
  /** Fitted y at x = 0. */
  intercept: number;
}

export function theilSen(ys: readonly number[]): TheilSen {
  if (ys.length < 2) throw new RangeError('Theil–Sen needs at least 2 points.');
  const slopes: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    for (let j = i + 1; j < ys.length; j++) slopes.push((ys[j]! - ys[i]!) / (j - i));
  }
  const slope = median(slopes);
  const intercept = median(ys.map((y, x) => y - slope * x));
  return { slope, intercept };
}

export interface MannKendall {
  /** Sum of signs of all pairwise differences. */
  s: number;
  /** Normal approximation with continuity and tie corrections. */
  z: number;
  /** Two-sided p-value. */
  pValue: number;
  /** Kendall's tau-a = s / (n(n−1)/2), in [−1, 1]. */
  tau: number;
}

export function mannKendall(ys: readonly number[]): MannKendall {
  const n = ys.length;
  if (n < 3) throw new RangeError('Mann–Kendall needs at least 3 points.');
  let s = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) s += Math.sign(ys[j]! - ys[i]!);
  }
  const ties = new Map<number, number>();
  for (const y of ys) ties.set(y, (ties.get(y) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  const z = variance === 0 || s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
  const pValue = z === 0 ? 1 : Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { s, z, pValue, tau: s / ((n * (n - 1)) / 2) };
}

export interface Pettitt {
  /** max |U_t| over all split points. */
  k: number;
  /** Index of the last value before the most likely change point. */
  changeIndex: number;
  /** Approximate two-sided p-value: min(1, 2·exp(−6K² / (n³ + n²))). */
  pValue: number;
}

/**
 * Pettitt's (1979) non-parametric test for a single change point in the level of a series.
 * U_t = Σ_{i≤t} Σ_{j>t} sign(y_i − y_j); the change point is where |U_t| is largest.
 * A steady trend also produces a significant change point, so callers must compare it with
 * a trend model before calling it a step (see patterns.ts).
 */
export function pettitt(ys: readonly number[]): Pettitt {
  const n = ys.length;
  if (n < 3) throw new RangeError('Pettitt needs at least 3 points.');
  let u = 0;
  let k = 0;
  let changeIndex = 0;
  // U_t = U_{t−1} + Σ_j sign(y_t − y_j).
  for (let t = 0; t < n - 1; t++) {
    for (let j = 0; j < n; j++) u += Math.sign(ys[t]! - ys[j]!);
    if (Math.abs(u) > k) {
      k = Math.abs(u);
      changeIndex = t;
    }
  }
  const pValue = Math.min(1, 2 * Math.exp((-6 * k * k) / (n ** 3 + n ** 2)));
  return { k, changeIndex, pValue };
}

// ---------------------------------------------------------------------------
// Trend of a pageview series
// ---------------------------------------------------------------------------

export type TrendDirection = 'increasing' | 'decreasing' | 'no_significant_trend';

export interface TrendResult {
  available: true;
  basis: 'monthly' | 'weekly';
  /** Number of complete periods used. */
  periods: number;
  /** First and last period used (`YYYY-MM` or the Monday of the ISO week). */
  firstPeriod: string;
  lastPeriod: string;
  /** Label of each period used (`YYYY-MM` or the Monday of the ISO week). */
  periodLabels: string[];
  /** Average daily views of each period used. */
  values: number[];
  /** Theil–Sen change in average daily views per period (month or week). */
  slopePerPeriod: number;
  /** Fitted average daily views at the first and last period. */
  fittedStart: number;
  fittedEnd: number;
  /**
   * Compound yearly rate from a Theil–Sen fit on ln(values): exp(slope · periods per year) − 1
   * (0.1 = +10 %/year; always > −1). Null if any period has 0 average views.
   */
  relativeChangePerYear: number | null;
  mannKendall: MannKendall;
  /** `increasing`/`decreasing` only if Mann–Kendall p < SIGNIFICANCE_LEVEL. */
  direction: TrendDirection;
}

export interface TrendUnavailable {
  available: false;
  reason: string;
}

export function analyzeTrend(series: PageviewSeries): TrendResult | TrendUnavailable {
  const months = aggregateMonthly(series).filter((m) => m.complete);
  let basis: TrendResult['basis'];
  let periods: Array<{ label: string; value: number }>;
  if (months.length >= MIN_TREND_PERIODS) {
    basis = 'monthly';
    periods = months.map((m) => ({ label: m.month, value: m.views / m.days }));
  } else {
    const weeks = aggregateWeekly(series).filter((w) => w.complete);
    if (weeks.length < MIN_TREND_PERIODS) {
      return {
        available: false,
        reason: `A trend needs at least ${MIN_TREND_PERIODS} complete months or weeks; the period has ${months.length} complete months and ${weeks.length} complete weeks.`,
      };
    }
    basis = 'weekly';
    periods = weeks.map((w) => ({ label: w.weekStart, value: w.views / w.days }));
  }

  const values = periods.map((p) => p.value);
  const { slope, intercept } = theilSen(values);
  const mk = mannKendall(values);
  const perYear = basis === 'monthly' ? 12 : 365.25 / 7;
  // A relative rate from the linear slope divided by a level can fall below −100 % after a
  // level drop (observed on uk.wikipedia data); a log-scale fit gives a proper compound rate.
  const logSlope = values.every((v) => v > 0) ? theilSen(values.map(Math.log)).slope : null;
  const significant = mk.pValue < SIGNIFICANCE_LEVEL && mk.s !== 0;
  return {
    available: true,
    basis,
    periods: values.length,
    firstPeriod: periods[0]!.label,
    lastPeriod: periods[periods.length - 1]!.label,
    periodLabels: periods.map((p) => p.label),
    values,
    slopePerPeriod: slope,
    fittedStart: intercept,
    fittedEnd: intercept + slope * (values.length - 1),
    relativeChangePerYear: logSlope === null ? null : Math.expm1(logSlope * perYear),
    mannKendall: mk,
    direction: significant ? (mk.s > 0 ? 'increasing' : 'decreasing') : 'no_significant_trend',
  };
}

// ---------------------------------------------------------------------------
// Recent vs previous period (also used for year-over-year)
// ---------------------------------------------------------------------------

export interface PeriodStats {
  start: string;
  end: string;
  days: number;
  totalViews: number;
  dailyMean: number;
  imputedDays: number;
}

export interface PeriodComparison {
  available: true;
  windowDays: number;
  /** The last `windowDays` days of the series. */
  recent: PeriodStats;
  /** The `windowDays` days right before `recent`. */
  previous: PeriodStats;
  /** recent.dailyMean − previous.dailyMean. */
  absoluteChange: number;
  /** Relative change of the daily mean (0.25 = +25 %); null if the previous mean is 0. */
  relativeChange: number | null;
}

export interface PeriodComparisonUnavailable {
  available: false;
  windowDays: number;
  reason: string;
}

export function comparePeriods(
  series: PageviewSeries,
  windowDays: number,
): PeriodComparison | PeriodComparisonUnavailable {
  if (!Number.isInteger(windowDays) || windowDays < 1) throw new RangeError(`Invalid window ${windowDays}.`);
  const n = series.points.length;
  if (n < 2 * windowDays) {
    return {
      available: false,
      windowDays,
      reason: `Comparing two ${windowDays}-day periods needs ${2 * windowDays} days of data; the series has ${n}.`,
    };
  }
  const recent = periodStats(series.points.slice(n - windowDays));
  const previous = periodStats(series.points.slice(n - 2 * windowDays, n - windowDays));
  return {
    available: true,
    windowDays,
    recent,
    previous,
    absoluteChange: recent.dailyMean - previous.dailyMean,
    relativeChange: previous.dailyMean === 0 ? null : recent.dailyMean / previous.dailyMean - 1,
  };
}

function periodStats(points: readonly DailyPoint[]): PeriodStats {
  const views = points.map((p) => p.views);
  return {
    start: points[0]!.date,
    end: points[points.length - 1]!.date,
    days: points.length,
    totalViews: sum(views),
    dailyMean: mean(views),
    imputedDays: points.filter((p) => p.imputed).length,
  };
}

// ---------------------------------------------------------------------------
// Moving average
// ---------------------------------------------------------------------------

export interface MovingAveragePoint {
  date: string;
  /** Mean of this day and the `window − 1` days before it; null until the window is full. */
  value: number | null;
}

/** Trailing moving average over a dense daily series. */
export function movingAverage(points: readonly DailyPoint[], window: number): MovingAveragePoint[] {
  if (!Number.isInteger(window) || window < 1) throw new RangeError(`Invalid window ${window}.`);
  let running = 0;
  return points.map((p, i) => {
    running += p.views;
    if (i >= window) running -= points[i - window]!.views;
    return { date: p.date, value: i >= window - 1 ? running / window : null };
  });
}
