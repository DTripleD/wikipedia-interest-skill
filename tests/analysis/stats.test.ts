import { describe, expect, it } from 'vitest';
import {
  coefficientOfVariation,
  mean,
  meanAbsoluteDeviation,
  median,
  medianAbsoluteDeviation,
  normalCdf,
  sampleStdDev,
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
