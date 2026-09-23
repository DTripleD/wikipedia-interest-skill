/**
 * Full deterministic analysis of one daily pageview series. Every number the agent,
 * the charts and the report show comes from here. The LLM never computes statistics.
 *
 * Optional normalization by edition size: with the edition-wide daily totals
 * (getEditionDailySeries), views are also expressed per million edition pageviews, which
 * makes editions of different sizes comparable.
 */
import { aggregateMonthly, sliceSeries, type Coverage, type PageviewSeries } from '../data/series.js';
import { detectOutliers, type OutlierResult } from './outliers.js';
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
}

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
    peakDay: { date: string; views: number };
  };
  normalization: Normalization | null;
  monthly: MonthlyRow[];
  /** Keyed by window length in days (7 and 28). */
  movingAverages: Record<(typeof MOVING_AVERAGE_WINDOWS)[number], MovingAveragePoint[]>;
  recentVsPrevious: PeriodComparison | PeriodComparisonUnavailable;
  yearOverYear: PeriodComparison | PeriodComparisonUnavailable;
  trend: TrendResult | TrendUnavailable;
  volatility: Volatility;
  outliers: OutlierResult;
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
      peakDay: { date: peak.date, views: peak.views },
    },
    normalization: edition && editionTotal > 0 ? { editionTotalViews: editionTotal, viewsPerMillion: (totalViews / editionTotal) * 1e6 } : null,
    monthly,
    movingAverages: { 7: movingAverage(series.points, 7), 28: movingAverage(series.points, 28) },
    recentVsPrevious: comparePeriods(series, options.recentDays ?? DEFAULT_RECENT_DAYS),
    yearOverYear: comparePeriods(series, options.yoyDays ?? DEFAULT_YOY_DAYS),
    trend: analyzeTrend(series),
    volatility: {
      dailyCv: coefficientOfVariation(views),
      monthlyCv: completeMonthAverages.length >= 3 ? coefficientOfVariation(completeMonthAverages) : null,
    },
    outliers: detectOutliers(series),
    warnings,
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
