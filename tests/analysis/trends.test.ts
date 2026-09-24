import { describe, expect, it } from 'vitest';
import {
  MIN_TREND_PERIODS,
  analyzeTrend,
  comparePeriods,
  mannKendall,
  movingAverage,
  pettitt,
  theilSen,
} from '../../src/analysis/trends.js';
import { daysInclusive } from '../../src/dates.js';
import { makeSeries, seriesOf } from '../helpers/series.js';

// Reference values computed independently in Python (brute-force S, math.erf).
describe('mannKendall', () => {
  it('detects a perfectly increasing series', () => {
    const mk = mannKendall([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(mk.s).toBe(28);
    expect(mk.tau).toBe(1);
    expect(mk.z).toBeCloseTo(3.340383700311406, 9);
    expect(mk.pValue).toBeCloseTo(0.0008366271311193163, 6);
  });

  it('applies the tie correction', () => {
    const mk = mannKendall([1, 2, 2, 3, 1, 4, 5, 5, 6, 7]);
    expect(mk.s).toBe(36);
    expect(mk.z).toBeCloseTo(3.1687511114881484, 9);
    expect(mk.pValue).toBeCloseTo(0.0015309543450490182, 6);
    expect(mk.tau).toBeCloseTo(0.8, 12);
  });

  it('finds no trend in noise and handles constant series', () => {
    const mk = mannKendall([5, 3, 6, 2, 7, 4, 5, 3]);
    expect(mk.s).toBe(-2);
    expect(mk.z).toBeCloseTo(-0.12565617248750865, 9);
    expect(mk.pValue).toBeCloseTo(0.9000040960811826, 6);
    expect(mannKendall([4, 4, 4, 4])).toMatchObject({ s: 0, z: 0, pValue: 1 });
  });
});

describe('theilSen', () => {
  it('ignores a single spike (reference: Python)', () => {
    expect(theilSen([10, 12, 11, 13, 100, 15, 14, 16])).toEqual({ slope: 0.75, intercept: 10.75 });
  });

  it('recovers an exact line', () => {
    expect(theilSen([3, 5, 7, 9])).toEqual({ slope: 2, intercept: 3 });
  });
});

describe('analyzeTrend', () => {
  it('uses complete months and reports a significant increase', () => {
    // 2024-01-15 .. 2024-12-31: January is partial, Feb–Dec (11 months) are complete.
    // Daily views = 100 + 10 × month index, so every complete month is flat inside.
    const start = '2024-01-15';
    const series = seriesOf(start, daysInclusive(start, '2024-12-31'), (i) => {
      const month = new Date(Date.UTC(2024, 0, 15 + i)).getUTCMonth();
      return 100 + 10 * month;
    });
    const trend = analyzeTrend(series);
    if (!trend.available) throw new Error(trend.reason);
    expect(trend).toMatchObject({ basis: 'monthly', periods: 11, firstPeriod: '2024-02', lastPeriod: '2024-12' });
    expect(trend.values[0]).toBe(110);
    expect(trend.slopePerPeriod).toBe(10);
    expect(trend.fittedStart).toBe(110);
    expect(trend.fittedEnd).toBe(210);
    // Compound rate of a log-scale Theil–Sen fit (reference: Python).
    expect(trend.relativeChangePerYear).toBeCloseTo(1.136094674556214, 9);
    expect(trend.direction).toBe('increasing');
    expect(trend.mannKendall.pValue).toBeLessThan(0.001);
  });

  it('falls back to complete ISO weeks for short periods', () => {
    // 2024-01-01 is a Monday; 10 full weeks, decreasing by 5 views/day each week.
    const series = seriesOf('2024-01-01', 70, (i) => 200 - 5 * Math.floor(i / 7));
    const trend = analyzeTrend(series);
    if (!trend.available) throw new Error(trend.reason);
    expect(trend).toMatchObject({ basis: 'weekly', periods: 10, firstPeriod: '2024-01-01', lastPeriod: '2024-03-04' });
    if (trend.available) expect(trend.periodLabels.slice(0, 2)).toEqual(['2024-01-01', '2024-01-08']);
    expect(trend.slopePerPeriod).toBe(-5);
    expect(trend.relativeChangePerYear).toBeCloseTo(-0.770592629026186, 9);
    expect(trend.relativeChangePerYear).toBeGreaterThan(-1);
    expect(trend.direction).toBe('decreasing');
  });

  it('reports no significant trend for flat noisy data', () => {
    const pattern = [5, 3, 6, 2, 7, 4, 5, 3, 6, 4];
    const series = seriesOf('2024-01-01', 70, (i) => 100 + pattern[Math.floor(i / 7)]!);
    const trend = analyzeTrend(series);
    expect(trend.available && trend.direction).toBe('no_significant_trend');
  });

  it('is unavailable when there are too few complete periods', () => {
    const series = seriesOf('2024-01-01', 7 * (MIN_TREND_PERIODS - 1), () => 10);
    const trend = analyzeTrend(series);
    expect(trend.available).toBe(false);
    expect(!trend.available && trend.reason).toMatch(/at least 8 complete/);
  });

  it('returns a null relative change when a period has 0 average views', () => {
    const series = seriesOf('2024-01-01', 70, (i) => (i >= 63 ? 7 : 0));
    const trend = analyzeTrend(series);
    expect(trend.available && trend.relativeChangePerYear).toBeNull();
  });
});

describe('comparePeriods', () => {
  it('compares the last window with the one before, by daily mean', () => {
    const series = makeSeries('2024-01-01', [1, 1, 1, 2, 2, 2, 4, 4, null]);
    const c = comparePeriods(series, 3);
    if (!c.available) throw new Error(c.reason);
    expect(c.recent).toEqual({ start: '2024-01-07', end: '2024-01-09', days: 3, totalViews: 8, dailyMean: 8 / 3, imputedDays: 1 });
    expect(c.previous).toMatchObject({ start: '2024-01-04', end: '2024-01-06', totalViews: 6, dailyMean: 2 });
    expect(c.absoluteChange).toBeCloseTo(2 / 3, 12);
    expect(c.relativeChange).toBeCloseTo(1 / 3, 12);
  });

  it('returns null relative change when the previous period had no views', () => {
    const c = comparePeriods(makeSeries('2024-01-01', [0, 0, 5, 5]), 2);
    expect(c.available && c.relativeChange).toBeNull();
  });

  it('is unavailable when the series is shorter than two windows', () => {
    const c = comparePeriods(seriesOf('2024-01-01', 729, () => 1), 365);
    expect(c).toMatchObject({ available: false, windowDays: 365 });
    expect(!c.available && c.reason).toMatch(/needs 730 days/);
    expect(comparePeriods(seriesOf('2024-01-01', 730, () => 1), 365).available).toBe(true);
  });
});

describe('movingAverage', () => {
  it('computes a trailing mean and is null until the window is full', () => {
    const series = makeSeries('2024-01-01', [1, 2, 3, 4, 10]);
    expect(movingAverage(series.points, 3).map((p) => p.value)).toEqual([null, null, 2, 3, 17 / 3]);
    expect(movingAverage(series.points, 1).map((p) => p.value)).toEqual([1, 2, 3, 4, 10]);
    expect(movingAverage(series.points, 3)[4]!.date).toBe('2024-01-05');
    expect(() => movingAverage(series.points, 0)).toThrow(RangeError);
  });
});

// Reference values from a brute-force Python implementation of U_t.
describe('pettitt', () => {
  it('locates a step change', () => {
    const p = pettitt([10, 11, 9, 10, 12, 3, 4, 2, 3, 4]);
    expect(p).toMatchObject({ k: 25, changeIndex: 4 });
    expect(p.pValue).toBeCloseTo(0.06614250297660204, 12);
  });

  it('also finds a change point in a steady trend', () => {
    const p = pettitt([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(p).toMatchObject({ k: 36, changeIndex: 5 });
    expect(p.pValue).toBeCloseTo(0.03140780113025614, 12);
  });

  it('caps the p-value at 1 and rejects tiny inputs', () => {
    expect(pettitt([5, 3, 6, 2, 7, 4, 5, 3])).toMatchObject({ k: 4, changeIndex: 3, pValue: 1 });
    expect(() => pettitt([1, 2])).toThrow(RangeError);
  });
});
