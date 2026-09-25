import { describe, expect, it } from 'vitest';
import {
  aggregateMonthly,
  aggregateWeekly,
  buildSeries,
  sliceSeries,
  totalViews,
  type SeriesMeta,
} from '../../src/data/series.js';

const META: SeriesMeta = {
  language: 'cs',
  project: 'cs.wikipedia',
  article: 'Přerušovaný_půst',
  access: 'all-access',
  agent: 'user',
};

describe('buildSeries', () => {
  it('fills days the API omitted with imputed zeros and reports coverage', () => {
    const s = buildSeries(META, '2024-01-01', '2024-01-05', [
      { date: '2024-01-02', views: 7 },
      { date: '2024-01-04', views: 0 },
    ]);
    expect(s.points).toEqual([
      { date: '2024-01-01', views: 0, imputed: true },
      { date: '2024-01-02', views: 7, imputed: false },
      { date: '2024-01-03', views: 0, imputed: true },
      { date: '2024-01-04', views: 0, imputed: false },
      { date: '2024-01-05', views: 0, imputed: true },
    ]);
    expect(s.coverage).toEqual({
      expectedDays: 5,
      reportedDays: 2,
      imputedDays: 3,
      imputedShare: 0.6,
      firstReportedDate: '2024-01-02',
      lastReportedDate: '2024-01-04',
    });
    expect(s).toMatchObject({ ...META, start: '2024-01-01', end: '2024-01-05', warnings: [] });
  });

  it('accepts unsorted input and reports no reported days for an empty input', () => {
    const s = buildSeries(META, '2024-01-01', '2024-01-02', [
      { date: '2024-01-02', views: 2 },
      { date: '2024-01-01', views: 1 },
    ]);
    expect(s.points.map((p) => p.views)).toEqual([1, 2]);

    const empty = buildSeries(META, '2024-01-01', '2024-01-02', []);
    expect(empty.coverage).toMatchObject({ reportedDays: 0, imputedShare: 1, firstReportedDate: null, lastReportedDate: null });
  });

  it('rejects out-of-range, duplicate or invalid points and bad ranges', () => {
    expect(() => buildSeries(META, '2024-01-01', '2024-01-02', [{ date: '2024-01-03', views: 1 }])).toThrow(/outside/);
    expect(() =>
      buildSeries(META, '2024-01-01', '2024-01-02', [
        { date: '2024-01-01', views: 1 },
        { date: '2024-01-01', views: 2 },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => buildSeries(META, '2024-01-01', '2024-01-02', [{ date: '2024-01-01', views: -1 }])).toThrow(/Invalid views/);
    expect(() => buildSeries(META, '2024-01-01', '2024-01-02', [{ date: '2024-01-01', views: 1.5 }])).toThrow(/Invalid views/);
    expect(() => buildSeries(META, '2024-01-02', '2024-01-01', [])).toThrow(/range/);
  });
});

describe('aggregation', () => {
  it('sums views', () => {
    const s = buildSeries(META, '2024-01-01', '2024-01-03', [
      { date: '2024-01-01', views: 1 },
      { date: '2024-01-03', views: 10 },
    ]);
    expect(totalViews(s.points)).toBe(11);
  });

  it('aggregates by calendar month and flags partial months', () => {
    const reported = [
      { date: '2024-01-31', views: 5 },
      { date: '2024-02-01', views: 1 },
      { date: '2024-02-29', views: 2 },
      { date: '2024-03-01', views: 4 },
    ];
    const months = aggregateMonthly(buildSeries(META, '2024-01-15', '2024-03-01', reported));
    expect(months).toEqual([
      { month: '2024-01', views: 5, days: 17, calendarDays: 31, complete: false, imputedDays: 16 },
      { month: '2024-02', views: 3, days: 29, calendarDays: 29, complete: true, imputedDays: 27 },
      { month: '2024-03', views: 4, days: 1, calendarDays: 31, complete: false, imputedDays: 0 },
    ]);
  });
});

describe('sliceSeries', () => {
  it('cuts a series and recomputes coverage, keeping imputed days imputed', () => {
    const s = buildSeries(META, '2024-01-01', '2024-01-05', [
      { date: '2024-01-01', views: 1 },
      { date: '2024-01-03', views: 3 },
      { date: '2024-01-05', views: 5 },
    ], ['note']);
    const cut = sliceSeries(s, '2024-01-02', '2024-01-04');
    expect(cut.points).toEqual([
      { date: '2024-01-02', views: 0, imputed: true },
      { date: '2024-01-03', views: 3, imputed: false },
      { date: '2024-01-04', views: 0, imputed: true },
    ]);
    expect(cut.coverage).toMatchObject({ expectedDays: 3, reportedDays: 1, imputedDays: 2 });
    expect(cut).toMatchObject({ ...META, start: '2024-01-02', end: '2024-01-04', warnings: ['note'] });
  });

  it('rejects a range outside the series', () => {
    const s = buildSeries(META, '2024-01-01', '2024-01-05', []);
    expect(() => sliceSeries(s, '2023-12-31', '2024-01-02')).toThrow(/not within/);
  });
});

describe('aggregateWeekly', () => {
  it('groups by ISO week (Monday start) and flags partial weeks', () => {
    // 2024-01-06 is a Saturday; 2024-01-08 is a Monday.
    const reported = [
      { date: '2024-01-06', views: 1 },
      { date: '2024-01-08', views: 10 },
      { date: '2024-01-14', views: 20 },
      { date: '2024-01-15', views: 5 },
    ];
    expect(aggregateWeekly(buildSeries(META, '2024-01-06', '2024-01-15', reported))).toEqual([
      { weekStart: '2024-01-01', views: 1, days: 2, complete: false, imputedDays: 1 },
      { weekStart: '2024-01-08', views: 30, days: 7, complete: true, imputedDays: 5 },
      { weekStart: '2024-01-15', views: 5, days: 1, complete: false, imputedDays: 0 },
    ]);
  });
});
