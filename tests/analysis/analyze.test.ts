import { describe, expect, it } from 'vitest';
import { analyzeSeries } from '../../src/analysis/analyze.js';
import { compareLanguages } from '../../src/analysis/compare.js';
import { daysInclusive } from '../../src/dates.js';
import { makeSeries, monthlySeries, seriesOf } from '../helpers/series.js';

const EDITION = { article: null };

describe('analyzeSeries', () => {
  it('summarizes a short series and marks unavailable metrics with reasons', () => {
    const series = makeSeries('2024-01-30', [10, 20, null, 30]); // Jan 30 .. Feb 2
    const a = analyzeSeries(series);
    expect(a.period).toEqual({ start: '2024-01-30', end: '2024-02-02', days: 4 });
    expect(a.summary).toEqual({ totalViews: 60, dailyMean: 15, dailyMedian: 15, peakDay: { date: '2024-02-02', views: 30 } });
    expect(a.coverage.imputedDays).toBe(1);
    expect(a.monthly).toEqual([
      { month: '2024-01', views: 30, days: 2, complete: false, imputedDays: 0, dailyAverage: 15, viewsPerMillion: null },
      { month: '2024-02', views: 30, days: 2, complete: false, imputedDays: 1, dailyAverage: 15, viewsPerMillion: null },
    ]);
    expect(a.movingAverages[7].every((p) => p.value === null)).toBe(true);
    expect(a.recentVsPrevious).toMatchObject({ available: false, windowDays: 90 });
    expect(a.yearOverYear).toMatchObject({ available: false, windowDays: 365 });
    expect(a.trend.available).toBe(false);
    expect(a.volatility.monthlyCv).toBeNull();
    expect(a.normalization).toBeNull();
  });

  it('computes year-over-year and recent changes on two years of data', () => {
    // 2023-01-01 .. 2024-12-30 (730 days): 100/day in the first 365 days, 150/day after.
    const series = seriesOf('2023-01-01', 730, (i) => (i < 365 ? 100 : 150));
    const a = analyzeSeries(series, { recentDays: 30 });
    expect(a.yearOverYear).toMatchObject({ available: true, relativeChange: 0.5 });
    expect(a.recentVsPrevious).toMatchObject({ available: true, windowDays: 30, relativeChange: 0 });
    expect(a.trend).toMatchObject({ available: true, basis: 'monthly', direction: 'increasing' });
    expect(a.volatility.dailyCv).toBeGreaterThan(0);
    expect(a.movingAverages[28][27]!.value).toBe(100);
  });

  it('normalizes by edition size and tolerates a longer edition series', () => {
    const series = seriesOf('2024-02-01', 29, () => 10); // 290 views in Feb 2024
    const edition = seriesOf('2024-01-01', 60, () => 1_000_000, EDITION); // 29 M in Feb
    const a = analyzeSeries(series, { editionSeries: edition });
    expect(a.normalization).toEqual({ editionTotalViews: 29_000_000, viewsPerMillion: 10 });
    expect(a.monthly[0]!.viewsPerMillion).toBe(10);
  });

  it('skips normalization with a warning when edition data does not cover the period', () => {
    const series = seriesOf('2024-02-01', 29, () => 10);
    const edition = seriesOf('2024-02-05', 20, () => 1000, EDITION);
    const a = analyzeSeries(series, { editionSeries: edition });
    expect(a.normalization).toBeNull();
    expect(a.warnings.join(' ')).toMatch(/views per million are not computed/);
  });

  it('warns when edition totals have gaps, and rejects a mismatched edition', () => {
    const series = seriesOf('2024-02-01', 3, () => 10);
    const gappy = makeSeries('2024-02-01', [1000, null, 1000], EDITION);
    expect(analyzeSeries(series, { editionSeries: gappy }).warnings.join(' ')).toMatch(/missing 1 day/);
    const other = seriesOf('2024-02-01', 3, () => 1000, { ...EDITION, project: 'pl.wikipedia', language: 'pl' });
    expect(() => analyzeSeries(series, { editionSeries: other })).toThrow(/does not match/);
  });

  it('reports year-over-year change with and without spike days', () => {
    // 100/day for two years, plus one 5000-view day in the recent year.
    const series = seriesOf('2023-01-01', 730, (i) => (i === 500 ? 5000 : 100));
    const a = analyzeSeries(series);
    expect(a.yearOverYear.available).toBe(true);
    if (a.yearOverYear.available) {
      expect(a.yearOverYear.relativeChange).toBeCloseTo(4900 / 36_500, 12);
      expect(a.yearOverYear.relativeChangeExcludingSpikes).toBeCloseTo(0, 12);
    }
  });

  it('measures deviation from the trend robustly and runs the pattern detectors', () => {
    // 24 months on an exact line except one month far off it.
    const levels = Array.from({ length: 24 }, (_, k) => (k === 10 ? 1000 : 100 + 5 * k));
    const a = analyzeSeries(monthlySeries('2024-01', levels));
    expect(a.volatility.trendDeviation).toBe(0);
    expect(a.levelShift).toMatchObject({ assessed: true, detected: false });
    expect(a.seasonality).toMatchObject({ assessed: true, pairs: 12 });
    expect(analyzeSeries(seriesOf('2024-01-01', 20, () => 5)).volatility.trendDeviation).toBeNull();
  });

  it('keeps the series warnings', () => {
    const series = { ...seriesOf('2024-01-01', 3, () => 1), warnings: ['clamped'] };
    expect(analyzeSeries(series).warnings).toEqual(['clamped']);
  });
});

describe('compareLanguages', () => {
  const pl = { language: 'pl', project: 'pl.wikipedia', article: 'Post' };

  it('ranks by raw views and by views per million over the common period', () => {
    const days = daysInclusive('2024-01-01', '2024-03-31');
    const cs = seriesOf('2024-01-01', days, () => 100);
    const plSeries = seriesOf('2024-01-01', days + 10, () => 200, pl); // 10 extra days
    const csEdition = seriesOf('2024-01-01', days, () => 1_000_000, EDITION);
    const plEdition = seriesOf('2024-01-01', days + 10, () => 4_000_000, { ...EDITION, language: 'pl', project: 'pl.wikipedia' });

    const c = compareLanguages([
      { series: cs, editionSeries: csEdition },
      { series: plSeries, editionSeries: plEdition },
    ]);
    expect(c.period).toEqual({ start: '2024-01-01', end: '2024-03-31', days });
    expect(c.analyses.map((a) => a.period.end)).toEqual(['2024-03-31', '2024-03-31']);
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toMatch(/pl\.wikipedia\/Post covers 2024-01-01\.\.2024-04-10/);

    expect(c.ranking.byTotalViews).toEqual([
      { index: 1, language: 'pl', article: 'Post', value: 200 * days, relativeToLeader: 1 },
      { index: 0, language: 'cs', article: 'Přerušovaný_půst', value: 100 * days, relativeToLeader: 0.5 },
    ]);
    // Per million: cs 100/1M = 100, pl 200/4M = 50 → cs leads once edition size is removed.
    expect(c.ranking.byViewsPerMillion).toEqual([
      { index: 0, language: 'cs', article: 'Přerušovaný_půst', value: 100, relativeToLeader: 1 },
      { index: 1, language: 'pl', article: 'Post', value: 50, relativeToLeader: 0.5 },
    ]);
  });

  it('omits the per-million ranking unless every series has edition data', () => {
    const c = compareLanguages([
      { series: seriesOf('2024-01-01', 10, () => 1), editionSeries: seriesOf('2024-01-01', 10, () => 100, EDITION) },
      { series: seriesOf('2024-01-01', 10, () => 2, pl) },
    ]);
    expect(c.ranking.byViewsPerMillion).toBeNull();
    expect(c.warnings).toEqual([]);
  });

  it('handles a leader with zero views', () => {
    const c = compareLanguages([{ series: seriesOf('2024-01-01', 5, () => 0) }]);
    expect(c.ranking.byTotalViews[0]!.relativeToLeader).toBeNull();
  });

  it('rejects empty input and series without a common period', () => {
    expect(() => compareLanguages([])).toThrow(/Nothing/);
    expect(() =>
      compareLanguages([{ series: seriesOf('2024-01-01', 5, () => 1) }, { series: seriesOf('2024-02-01', 5, () => 1, pl) }]),
    ).toThrow(/no period in common/);
  });
});
