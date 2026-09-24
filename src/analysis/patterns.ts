/**
 * Structural patterns that change how a trend or a period comparison should be read.
 * Both detectors run on period averages (months, or weeks for the level shift), never on
 * raw days.
 *
 * - Level shift: a one-time step (e.g. uk "Інтервальне голодування" fell from ≈ 28 to
 *   ≈ 6 views/day between May and June 2025) rather than a gradual trend. Pettitt's test finds the most
 *   likely change point. Because a steady trend also yields a significant change point, a
 *   step is reported only if a two-level model (segment medians) fits at least as well as
 *   the Theil–Sen line.
 * - Seasonality: whether the monthly pattern repeats a year later. The log of each complete
 *   month's daily average is detrended with a Theil–Sen line, and months 12 apart are
 *   correlated (Spearman, robust to single spike months). With 11 pairs, r ≥ 0.6 is
 *   roughly a one-sided p < 0.025.
 */
import type { MonthlyRow } from './analyze.js';
import { mean, median, spearman } from './stats.js';
import { pettitt, theilSen, SIGNIFICANCE_LEVEL, type TrendResult, type TrendUnavailable } from './trends.js';

/** Minimum number of periods on each side of a level shift. */
export const MIN_SHIFT_SEGMENT = 3;
/** Minimum pairs of months 12 months apart (i.e. at least 22 consecutive complete months). */
export const MIN_SEASONAL_PAIRS = 10;
export const SEASONAL_CORRELATION_THRESHOLD = 0.6;

export interface LevelShift {
  assessed: true;
  /** True if Pettitt p < 0.05, both segments have ≥ 3 periods and the step fits at least as well as the line. */
  detected: boolean;
  basis: TrendResult['basis'];
  pValue: number;
  /** Last period before the change and first period after it. */
  lastPeriodBefore: string;
  firstPeriodAfter: string;
  /** Median average-daily-views of the periods before and after. */
  medianBefore: number;
  medianAfter: number;
  /** Mean absolute residual of the two-level model and of the Theil–Sen line. */
  stepError: number;
  linearError: number;
  /**
   * Median of |value − segment median| / segment median: how far a typical period strays
   * from its own level (0.15 = 15 %). The step-model counterpart of volatility.trendDeviation.
   * Null if a segment median is 0.
   */
  stepDeviation: number | null;
}

export interface Seasonality {
  assessed: true;
  /** True if the correlation of months 12 apart is ≥ SEASONAL_CORRELATION_THRESHOLD. */
  detected: boolean;
  pairs: number;
  /** Spearman correlation of detrended log values 12 months apart; null if a side is constant. */
  correlation: number | null;
}

export interface PatternUnavailable {
  assessed: false;
  reason: string;
}

export function detectLevelShift(trend: TrendResult | TrendUnavailable): LevelShift | PatternUnavailable {
  if (!trend.available) return { assessed: false, reason: `Needs a trend estimate. ${trend.reason}` };
  const { values, periodLabels } = trend;
  const test = pettitt(values);
  const cut = test.changeIndex + 1;
  const before = values.slice(0, cut);
  const after = values.slice(cut);
  const medianBefore = median(before);
  const medianAfter = median(after);
  const stepFit = values.map((_, i) => (i < cut ? medianBefore : medianAfter));
  const stepError = mean(values.map((v, i) => Math.abs(v - stepFit[i]!)));
  const linearError = mean(values.map((v, i) => Math.abs(v - (trend.fittedStart + trend.slopePerPeriod * i))));
  return {
    assessed: true,
    detected:
      test.pValue < SIGNIFICANCE_LEVEL &&
      before.length >= MIN_SHIFT_SEGMENT &&
      after.length >= MIN_SHIFT_SEGMENT &&
      stepError <= linearError,
    basis: trend.basis,
    pValue: test.pValue,
    lastPeriodBefore: periodLabels[cut - 1]!,
    firstPeriodAfter: periodLabels[cut]!,
    medianBefore,
    medianAfter,
    stepError,
    linearError,
    stepDeviation: medianBefore === 0 || medianAfter === 0 ? null : median(values.map((v, i) => Math.abs(v - stepFit[i]!) / stepFit[i]!)),
  };
}

/** `monthly` must be the consecutive monthly rows of one series (as produced by analyzeSeries). */
export function detectSeasonality(monthly: readonly MonthlyRow[]): Seasonality | PatternUnavailable {
  const complete = monthly.filter((m) => m.complete);
  const pairs = complete.length - 12;
  if (pairs < MIN_SEASONAL_PAIRS) {
    return {
      assessed: false,
      reason: `Needs at least ${MIN_SEASONAL_PAIRS + 12} complete months; the period has ${complete.length}.`,
    };
  }
  const logs = complete.map((m) => Math.log1p(m.dailyAverage));
  const { slope, intercept } = theilSen(logs);
  const residuals = logs.map((y, i) => y - (intercept + slope * i));
  const correlation = spearman(residuals.slice(0, pairs), residuals.slice(12));
  return {
    assessed: true,
    detected: correlation !== null && correlation >= SEASONAL_CORRELATION_THRESHOLD,
    pairs,
    correlation,
  };
}
