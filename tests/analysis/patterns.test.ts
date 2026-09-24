import { describe, expect, it } from 'vitest';
import { analyzeSeries } from '../../src/analysis/analyze.js';
import { detectLevelShift, detectSeasonality } from '../../src/analysis/patterns.js';
import { analyzeTrend } from '../../src/analysis/trends.js';
import { monthlySeries, seriesOf } from '../helpers/series.js';

/** ±`amp` alternating noise so that no two neighbouring months are equal. */
const wiggle = (k: number, amp: number): number => (k % 2 === 0 ? amp : -amp);

describe('detectLevelShift', () => {
  it('detects a one-time drop (like uk intermittent fasting in 2025)', () => {
    const levels = Array.from({ length: 24 }, (_, k) => (k < 15 ? 28 : 6) + wiggle(k, 1));
    const shift = detectLevelShift(analyzeTrend(monthlySeries('2024-01', levels)));
    expect(shift).toMatchObject({
      assessed: true,
      detected: true,
      basis: 'monthly',
      lastPeriodBefore: '2025-03',
      firstPeriodAfter: '2025-04',
      medianBefore: 29,
      medianAfter: 5, // five months at 5, four at 7
    });
    if (shift.assessed) {
      // Perfect 15/9 split: K = 135, p = 2·exp(−6·135² / (24³ + 24²)).
      expect(shift.pValue).toBeCloseTo(2 * Math.exp((-6 * 135 ** 2) / (24 ** 3 + 24 ** 2)), 12);
      expect(shift.stepError).toBeLessThan(shift.linearError);
    }
  });

  it('does not call a steady trend a step, although Pettitt finds a change point', () => {
    const levels = Array.from({ length: 24 }, (_, k) => 100 + 5 * k + wiggle(k, 1));
    const shift = detectLevelShift(analyzeTrend(monthlySeries('2024-01', levels)));
    expect(shift).toMatchObject({ assessed: true, detected: false });
    if (shift.assessed) {
      expect(shift.pValue).toBeLessThan(0.05);
      expect(shift.stepError).toBeGreaterThan(shift.linearError);
    }
  });

  it('ignores a change point with fewer than 3 periods on one side', () => {
    const levels = Array.from({ length: 12 }, (_, k) => (k < 10 ? 50 : 5) + wiggle(k, 1));
    expect(detectLevelShift(analyzeTrend(monthlySeries('2024-01', levels)))).toMatchObject({ assessed: true, detected: false });
  });

  it('is not assessed without a trend', () => {
    const shift = detectLevelShift(analyzeTrend(seriesOf('2024-01-01', 20, () => 5)));
    expect(shift).toMatchObject({ assessed: false });
    if (!shift.assessed) expect(shift.reason).toMatch(/Needs a trend estimate/);
  });
});

describe('detectSeasonality', () => {
  it('detects a yearly pattern on top of growth', () => {
    const levels = Array.from({ length: 36 }, (_, k) => Math.round(100 * (1 + 0.3 * Math.sin((2 * Math.PI * k) / 12)) * 1.01 ** k));
    const s = detectSeasonality(analyzeSeries(monthlySeries('2023-01', levels)).monthly);
    expect(s).toMatchObject({ assessed: true, detected: true, pairs: 24 });
    if (s.assessed) expect(s.correlation).toBeGreaterThan(0.9);
  });

  it('finds no pattern in irregular data', () => {
    // The first 24 digits of π: months 12 apart are unrelated.
    const levels = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3, 2, 3, 8, 4, 6, 2, 6, 4].map((d) => 50 + 5 * d);
    const s = detectSeasonality(analyzeSeries(monthlySeries('2024-01', levels)).monthly);
    expect(s).toMatchObject({ assessed: true, detected: false, pairs: 12 });
    if (s.assessed) expect(Math.abs(s.correlation!)).toBeLessThan(0.6);
  });

  it('needs at least 22 complete months', () => {
    const s = detectSeasonality(analyzeSeries(monthlySeries('2024-01', Array(21).fill(10))).monthly);
    expect(s).toMatchObject({ assessed: false });
    if (!s.assessed) expect(s.reason).toMatch(/at least 22 complete months; the period has 21/);
  });

  it('handles constant data (no correlation defined)', () => {
    const s = detectSeasonality(analyzeSeries(monthlySeries('2024-01', Array(24).fill(10))).monthly);
    expect(s).toMatchObject({ assessed: true, detected: false, correlation: null });
  });
});
