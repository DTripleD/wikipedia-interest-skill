import { describe, expect, it } from 'vitest';
import {
  coefficientOfVariation,
  mean,
  meanAbsoluteDeviation,
  median,
  medianAbsoluteDeviation,
  normalCdf,
  pearson,
  ranks,
  sampleStdDev,
  spearman,
  sum,
} from '../../src/analysis/stats.js';

describe('descriptive statistics', () => {
  it('computes sum, mean and median', () => {
    expect(sum([])).toBe(0);
    expect(sum([1, 2, 3])).toBe(6);
    expect(mean([1, 2, 3, 10])).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('rejects empty input where the value is undefined', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => median([])).toThrow(RangeError);
  });

  it('computes the sample standard deviation and CV', () => {
    // Values 2,4,4,4,5,5,7,9: mean 5, sum of squares 32, sample variance 32/7.
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(sampleStdDev(xs)).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(coefficientOfVariation(xs)).toBeCloseTo(Math.sqrt(32 / 7) / 5, 12);
    expect(sampleStdDev([1])).toBeNull();
    expect(coefficientOfVariation([0, 0, 0])).toBeNull();
  });

  it('computes median and mean absolute deviations', () => {
    expect(medianAbsoluteDeviation([1, 1, 2, 2, 4, 6, 9])).toBe(1);
    expect(medianAbsoluteDeviation([0, 0, 0, 5])).toBe(0);
    expect(meanAbsoluteDeviation([0, 0, 0, 8], 0)).toBe(2);
  });

  it('approximates the standard normal CDF (reference: Python math.erf)', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517796, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145713, 6);
  });
});

// Reference values computed in Python (direct formulas).
describe('ranks and correlation', () => {
  it('gives tied values their average rank', () => {
    expect(ranks([3, 1, 4, 1, 5])).toEqual([3, 1.5, 4, 1.5, 5]);
  });

  it('computes Pearson and Spearman correlations', () => {
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(0.7745966692414834, 12);
    expect(spearman([1, 2, 2, 3, 10], [5, 6, 7, 8, 1])).toBeCloseTo(-0.051298917604257706, 12);
    expect(spearman([1, 2, 3], [10, 100, 1000])).toBeCloseTo(1, 12);
  });

  it('returns null for a constant side or fewer than 2 pairs, and rejects unequal lengths', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1], [2])).toBeNull();
    expect(() => pearson([1, 2], [1])).toThrow(RangeError);
  });
});
