/**
 * Outlier detection on daily views with a Hampel filter: each day is compared with the
 * median of a centred window of ±OUTLIER_HALF_WINDOW days (truncated at the series edges).
 *
 * Robust z-score (Iglewicz & Hoaglin): z = 0.6745 · (x − median) / MAD, flagged if |z| > 3.5.
 * When MAD is 0 (e.g. a window of mostly zeros), the usual fallback is used:
 * z = (x − median) / (1.253314 · meanAbsoluteDeviation). If that is 0 as well, every value
 * in the window equals the median and nothing is flagged.
 *
 * A rolling baseline follows slow level changes, so a steady trend is not flagged.
 */
import type { PageviewSeries } from '../data/series.js';
import { meanAbsoluteDeviation, median, medianAbsoluteDeviation, sum } from './stats.js';

export const OUTLIER_HALF_WINDOW = 14;
export const OUTLIER_THRESHOLD = 3.5;

export interface Outlier {
  date: string;
  views: number;
  /** Rolling median of the window around this day. */
  baseline: number;
  robustZ: number;
  direction: 'spike' | 'dip';
}

export interface OutlierResult {
  method: 'hampel';
  windowDays: number;
  threshold: number;
  count: number;
  /** count / days in the series. */
  share: number;
  /** Views above baseline on spike days / total views; 0 if there are no views. */
  excessViewsShare: number;
  /** All outliers in date order. */
  outliers: Outlier[];
}

export function detectOutliers(series: PageviewSeries): OutlierResult {
  const values = series.points.map((p) => p.views);
  const outliers: Outlier[] = [];
  for (let i = 0; i < values.length; i++) {
    const window = values.slice(Math.max(0, i - OUTLIER_HALF_WINDOW), i + OUTLIER_HALF_WINDOW + 1);
    const baseline = median(window);
    const x = values[i]!;
    const z = robustZ(x, baseline, window);
    if (Math.abs(z) > OUTLIER_THRESHOLD) {
      outliers.push({ date: series.points[i]!.date, views: x, baseline, robustZ: z, direction: z > 0 ? 'spike' : 'dip' });
    }
  }
  const total = sum(values);
  const excess = sum(outliers.filter((o) => o.direction === 'spike').map((o) => o.views - o.baseline));
  return {
    method: 'hampel',
    windowDays: 2 * OUTLIER_HALF_WINDOW + 1,
    threshold: OUTLIER_THRESHOLD,
    count: outliers.length,
    share: values.length === 0 ? 0 : outliers.length / values.length,
    excessViewsShare: total === 0 ? 0 : excess / total,
    outliers,
  };
}

function robustZ(x: number, center: number, window: readonly number[]): number {
  if (x === center) return 0;
  const mad = medianAbsoluteDeviation(window, center);
  if (mad > 0) return (0.6745 * (x - center)) / mad;
  const meanAd = meanAbsoluteDeviation(window, center);
  return meanAd > 0 ? (x - center) / (1.253314 * meanAd) : 0;
}
