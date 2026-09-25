/**
 * Full deterministic analysis of one daily pageview series. Every number the agent,
 * the charts and the report show comes from here. The LLM never computes statistics.
 *
 * Optional normalization by edition size: with the edition-wide daily totals
 * (getEditionDailySeries), views are also expressed per million edition pageviews, which
 * makes editions of different sizes comparable.
 */
import { aggregateMonthly, sliceSeries, type Coverage, type PageviewSeries } from '../data/series.js';
import { detectOutliers, type Outlier, type OutlierResult } from './outliers.js';
import { detectLevelShift, detectSeasonality, type LevelShift, type PatternUnavailable, type Seasonality } from './patterns.js';
import { coefficientOfVariation, mean, median, sum } from './stats.js';
import {
  analyzeTrend,
  comparePeriods,
  movingAverage,
  type MovingAveragePoint,
  type PeriodComparison,
  type PeriodComparisonUnavailable,
  type TrendResult,
  type TrendUnavailable,
} from './trends.js';

export const DEFAULT_RECENT_DAYS = 90;
export const DEFAULT_YOY_DAYS = 365;
export const MOVING_AVERAGE_WINDOWS = [7, 28] as const;
/** The daily chart's y-axis is capped at this multiple of the highest 28-day average. */
export const AXIS_CAP_FACTOR = 3;

export interface AnalysisOptions {
  /** Edition-wide daily totals for the same language; must cover the series period. */
  editionSeries?: PageviewSeries | null;
  /** Window of the recent-vs-previous comparison. Default 90 days. */
  recentDays?: number;
  /** Window of the year-over-year comparison. Default 365 days. */
  yoyDays?: number;
}

export interface MonthlyRow {
  month: string;
  views: number;
  days: number;
  complete: boolean;
  imputedDays: number;
  /** views / days: comparable between partial and complete months. */
  dailyAverage: number;
  /** Views per million edition pageviews that month; null without edition data. */
  viewsPerMillion: number | null;
}

export interface Normalization {
  editionTotalViews: number;
  /** Article views per million pageviews of the whole edition over the period. */
  viewsPerMillion: number;
}

export interface Volatility {
  /** Coefficient of variation of daily views; null if the mean is 0. */
  dailyCv: number | null;
  /** CV of the average daily views of complete months; null for fewer than 3 complete months. */
  monthlyCv: number | null;
  /**
   * Median absolute deviation of the trend periods from the Theil–Sen line / their median
   * level: how far a typical period strays from the trend (0.2 = 20 %). Robust to a single
   * spike period. Null without a trend or with a zero median.
   */
  trendDeviation: number | null;
}

/** A period comparison plus the same change with the excess views of spike days removed. */
export type AnalyzedComparison =
  | (PeriodComparison & {
      /** Relative change after subtracting (views − baseline) of spike days in each window; null if the previous adjusted mean is 0. */
      relativeChangeExcludingSpikes: number | null;
    })
  | PeriodComparisonUnavailable;

export interface SeriesAnalysis {
  language: string;
  project: string;
  article: string | null;
  period: { start: string; end: string; days: number };
  coverage: Coverage;
  summary: {
    totalViews: number;
    dailyMean: number;
    dailyMedian: number;
    /** null when no views were reported in the period. */
    peakDay: { date: string; views: number } | null;
  };
  normalization: Normalization | null;
  monthly: MonthlyRow[];
  /** Keyed by window length in days (7 and 28). */
  movingAverages: Record<(typeof MOVING_AVERAGE_WINDOWS)[number], MovingAveragePoint[]>;
  recentVsPrevious: AnalyzedComparison;
  yearOverYear: AnalyzedComparison;
  trend: TrendResult | TrendUnavailable;
  /** Whether the change is a one-time step rather than a gradual trend. */
  levelShift: LevelShift | PatternUnavailable;
  /**
   * The same detector on the edition-wide totals over the same period (null without edition
   * data). A step in both at the same time points to an edition-wide cause, not the topic.
   */
  editionLevelShift: LevelShift | PatternUnavailable | null;
  /** Whether the monthly pattern repeats a year later. */
  seasonality: Seasonality | PatternUnavailable;
  volatility: Volatility;
  outliers: OutlierResult;
  /**
   * Display aid for daily charts: when single days exceed AXIS_CAP_FACTOR × the highest
   * 28-day average, the y-axis is capped there so the averages stay readable, and the days
   * above it are listed so the chart can mark them with their real values. Null when no day
   * exceeds the cap (or the series is shorter than 28 days).
   */
  dailyAxisCap: { cap: number; clippedDays: Array<{ date: string; views: number }> } | null;
  warnings: string[];
}

export function analyzeSeries(series: PageviewSeries, options: AnalysisOptions = {}): SeriesAnalysis {
  const warnings = [...series.warnings];
  const views = series.points.map((p) => p.views);
  const peak = series.points.reduce((best, p) => (p.views > best.views ? p : best), series.points[0]!);

  const edition = alignEdition(series, options.editionSeries ?? null, warnings);
  const editionByMonth = new Map((edition ? aggregateMonthly(edition) : []).map((m) => [m.month, m.views]));

  const monthly = aggregateMonthly(series).map((m): MonthlyRow => {
    const editionViews = editionByMonth.get(m.month);
    return {
      month: m.month,
      views: m.views,
      days: m.days,
      complete: m.complete,
      imputedDays: m.imputedDays,
      dailyAverage: m.views / m.days,
      viewsPerMillion: editionViews ? (m.views / editionViews) * 1e6 : null,
    };
  });

  const totalViews = sum(views);
  const editionTotal = edition ? sum(edition.points.map((p) => p.views)) : 0;
  const completeMonthAverages = monthly.filter((m) => m.complete).map((m) => m.dailyAverage);
  const trend = analyzeTrend(series);
  const outliers = detectOutliers(series);
  const movingAverages = { 7: movingAverage(series.points, 7), 28: movingAverage(series.points, 28) };

  return {
    language: series.language,
    project: series.project,
    article: series.article,
    period: { start: series.start, end: series.end, days: series.points.length },
    coverage: series.coverage,
    summary: {
      totalViews,
      dailyMean: mean(views),
      dailyMedian: median(views),
      peakDay: totalViews > 0 ? { date: peak.date, views: peak.views } : null,
    },
    normalization: edition && editionTotal > 0 ? { editionTotalViews: editionTotal, viewsPerMillion: (totalViews / editionTotal) * 1e6 } : null,
    monthly,
    movingAverages,
    recentVsPrevious: withoutSpikes(comparePeriods(series, options.recentDays ?? DEFAULT_RECENT_DAYS), outliers.outliers),
    yearOverYear: withoutSpikes(comparePeriods(series, options.yoyDays ?? DEFAULT_YOY_DAYS), outliers.outliers),
    trend,
    levelShift: detectLevelShift(trend),
    editionLevelShift: edition ? detectLevelShift(analyzeTrend(edition)) : null,
    seasonality: detectSeasonality(monthly),
    volatility: {
      dailyCv: coefficientOfVariation(views),
      monthlyCv: completeMonthAverages.length >= 3 ? coefficientOfVariation(completeMonthAverages) : null,
      trendDeviation: trendDeviation(trend),
    },
    outliers,
    dailyAxisCap: dailyAxisCap(series, movingAverages[28]),
    warnings,
  };
}

function dailyAxisCap(series: PageviewSeries, ma28: readonly MovingAveragePoint[]): SeriesAnalysis['dailyAxisCap'] {
  const highestAverage = Math.max(0, ...ma28.map((p) => p.value ?? 0));
  if (highestAverage === 0) return null;
  const cap = Math.ceil(AXIS_CAP_FACTOR * highestAverage);
  const clippedDays = series.points.filter((p) => p.views > cap).map((p) => ({ date: p.date, views: p.views }));
  return clippedDays.length === 0 ? null : { cap, clippedDays };
}

function trendDeviation(trend: TrendResult | TrendUnavailable): number | null {
  if (!trend.available) return null;
  const level = median(trend.values);
  if (level === 0) return null;
  return median(trend.values.map((v, i) => Math.abs(v - (trend.fittedStart + trend.slopePerPeriod * i)))) / level;
}

function withoutSpikes(comparison: PeriodComparison | PeriodComparisonUnavailable, outliers: readonly Outlier[]): AnalyzedComparison {
  if (!comparison.available) return comparison;
  const adjustedMean = (p: PeriodComparison['recent']): number => {
    const excess = sum(
      outliers.filter((o) => o.direction === 'spike' && o.date >= p.start && o.date <= p.end).map((o) => o.views - o.baseline),
    );
    return (p.totalViews - excess) / p.days;
  };
  const previous = adjustedMean(comparison.previous);
  return {
    ...comparison,
    relativeChangeExcludingSpikes: previous === 0 ? null : adjustedMean(comparison.recent) / previous - 1,
  };
}

/** Returns the edition series cut to the article's period, or null (with a warning) if unusable. */
function alignEdition(series: PageviewSeries, edition: PageviewSeries | null, warnings: string[]): PageviewSeries | null {
  if (edition === null) return null;
  if (edition.project !== series.project || edition.access !== series.access || edition.agent !== series.agent) {
    throw new RangeError(`Edition series ${edition.project}/${edition.access}/${edition.agent} does not match ${series.project}/${series.access}/${series.agent}.`);
  }
  if (edition.start > series.start || edition.end < series.end) {
    warnings.push(`Edition totals cover only ${edition.start}..${edition.end}, not the whole period; views per million are not computed.`);
    return null;
  }
  const aligned = sliceSeries(edition, series.start, series.end);
  if (aligned.coverage.imputedDays > 0) {
    warnings.push(`Edition totals are missing ${aligned.coverage.imputedDays} day(s); views per million may be slightly overstated.`);
  }
  return aligned;
}
