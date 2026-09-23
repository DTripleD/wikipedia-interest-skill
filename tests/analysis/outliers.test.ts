import { describe, expect, it } from 'vitest';
import { detectOutliers } from '../../src/analysis/outliers.js';
import { seriesOf } from '../helpers/series.js';

// Weekly pattern around 100 views/day: MAD of a window is well above 0.
const weekly = [96, 104, 100, 98, 102, 95, 105];

describe('detectOutliers', () => {
  it('flags a spike and a dip against the rolling median', () => {
    const series = seriesOf('2024-01-01', 60, (i) => (i === 20 ? 1000 : i === 40 ? 10 : weekly[i % 7]!));
    const r = detectOutliers(series);
    expect(r).toMatchObject({ method: 'hampel', windowDays: 29, threshold: 3.5, count: 2 });
    const [spike, dip] = r.outliers;
    expect(spike).toMatchObject({ date: '2024-01-21', views: 1000, baseline: 100, direction: 'spike' });
    expect(dip).toMatchObject({ date: '2024-02-10', views: 10, baseline: 100, direction: 'dip' });
    expect(spike!.robustZ).toBeGreaterThan(3.5);
    expect(dip!.robustZ).toBeLessThan(-3.5);
    expect(r.share).toBeCloseTo(2 / 60, 12);
    const total = series.points.reduce((s, p) => s + p.views, 0);
    expect(r.excessViewsShare).toBeCloseTo(900 / total, 12);
  });

  it('does not flag a steady trend', () => {
    const series = seriesOf('2024-01-01', 365, (i) => 100 + i + weekly[i % 7]! - 100);
    expect(detectOutliers(series).count).toBe(0);
  });

  it('handles windows of mostly zeros (MAD = 0) with the mean-deviation fallback', () => {
    const series = seriesOf('2024-01-01', 30, (i) => (i === 15 ? 12 : 0));
    const r = detectOutliers(series);
    expect(r.count).toBe(1);
    expect(r.outliers[0]).toMatchObject({ date: '2024-01-16', views: 12, baseline: 0, direction: 'spike' });
    expect(r.excessViewsShare).toBe(1);
  });

  it('flags nothing in a constant or all-zero series', () => {
    expect(detectOutliers(seriesOf('2024-01-01', 40, () => 50)).count).toBe(0);
    expect(detectOutliers(seriesOf('2024-01-01', 40, () => 0))).toMatchObject({ count: 0, share: 0, excessViewsShare: 0 });
  });
});
