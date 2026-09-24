/**
 * Vega-Lite spec builders. They only arrange numbers that the analysis layer already
 * computed. The specs use no Vega-Lite aggregate, bin, timeUnit or transform (a unit test
 * enforces this), so the chart layer computes no statistics.
 *
 * All dates are UTC days (the Wikimedia convention), so every time axis uses a UTC scale.
 * Render a spec with renderSvg / toChart (render.ts).
 */
import type { TopLevelSpec } from 'vega-lite';
import type { SeriesAnalysis } from '../analysis/analyze.js';
import { seriesLabels, type LanguageComparison } from '../analysis/compare.js';
import type { PageviewSeries } from '../data/series.js';
import { addDays } from '../dates.js';
import { formatNumber, formatSignedPercent } from '../format.js';
import { CATEGORICAL, CHART_CONFIG, DEEMPHASIS, INK } from './theme.js';

export interface ChartSize {
  width?: number;
  height?: number;
}

/** Most lines one comparison chart shows (one per categorical palette slot). */
export const MAX_COMPARISON_LINES = CATEGORICAL.length;

const ATTENTION_NOTE = 'Wikipedia attention, not market demand.';
const SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json';
const TIME_AXIS = { field: 'date', type: 'temporal', title: null, scale: { type: 'utc' }, axis: { format: '%b %Y', labelAngle: 0 } } as const;

// ---------------------------------------------------------------------------
// 1. One series over time
// ---------------------------------------------------------------------------

/**
 * Daily views (light), the 28-day moving average, the Theil–Sen trend line and, if one was
 * detected, the level shift. `analysis` must be the analysis of `series`.
 */
export function timelineSpec(series: PageviewSeries, analysis: SeriesAnalysis, size: ChartSize = {}): TopLevelSpec {
  if (series.project !== analysis.project || series.article !== analysis.article || series.start !== analysis.period.start || series.end !== analysis.period.end) {
    throw new RangeError('The analysis does not belong to this series.');
  }
  const keys: string[] = ['Daily views', '28-day average'];
  const trend = analysis.trend;
  if (trend.available) keys.push('Trend (Theil–Sen)');
  const colors = [DEEMPHASIS, CATEGORICAL[0], CATEGORICAL[1]];
  const color = (key: string) => ({ datum: key, scale: { domain: keys, range: colors.slice(0, keys.length) } });

  const layers: unknown[] = [
    {
      data: { values: series.points.map((p) => ({ date: p.date, value: p.views })) },
      mark: { type: 'line', strokeWidth: 1 },
      encoding: { x: TIME_AXIS, y: { field: 'value', type: 'quantitative', title: 'Views per day' }, color: color('Daily views') },
    },
    {
      data: { values: analysis.movingAverages[28].filter((p) => p.value !== null).map((p) => ({ date: p.date, value: p.value })) },
      mark: { type: 'line' },
      encoding: { x: TIME_AXIS, y: { field: 'value', type: 'quantitative' }, color: color('28-day average') },
    },
  ];
  if (trend.available) {
    // Trend values are period averages; draw them at the middle of the first and last period.
    const mid = (label: string) => (trend.basis === 'monthly' ? `${label}-15` : addDays(label, 3));
    layers.push({
      data: {
        values: [
          { date: mid(trend.firstPeriod), value: trend.fittedStart },
          { date: mid(trend.lastPeriod), value: trend.fittedEnd },
        ],
      },
      mark: { type: 'line', strokeDash: [6, 4] },
      encoding: { x: TIME_AXIS, y: { field: 'value', type: 'quantitative' }, color: color('Trend (Theil–Sen)') },
    });
  }
  const shift = analysis.levelShift;
  if (shift.assessed && shift.detected) {
    const date = shift.basis === 'monthly' ? `${shift.firstPeriodAfter}-01` : shift.firstPeriodAfter;
    const data = { values: [{ date, label: `Step ≈ ${formatNumber(shift.medianBefore)} → ${formatNumber(shift.medianAfter)}/day` }] };
    layers.push(
      { data, mark: { type: 'rule', color: INK.secondary, strokeWidth: 1, strokeDash: [2, 2] }, encoding: { x: TIME_AXIS } },
      {
        data,
        mark: { type: 'text', align: 'left', baseline: 'top', dx: 4, y: 2, color: INK.secondary, fontSize: 9 },
        encoding: { x: TIME_AXIS, text: { field: 'label' } },
      },
    );
  }

  const title = analysis.article === null ? `${analysis.project} (all articles)` : `${analysis.article.replaceAll('_', ' ')} — ${analysis.project}`;
  return {
    $schema: SCHEMA,
    title: { text: title, subtitle: `Human pageviews per day, ${analysis.period.start} to ${analysis.period.end}. ${ATTENTION_NOTE}` },
    width: size.width ?? 520,
    height: size.height ?? 200,
    config: CHART_CONFIG,
    layer: layers,
  } as TopLevelSpec;
}

// ---------------------------------------------------------------------------
// 2. Languages side by side
// ---------------------------------------------------------------------------

/**
 * One line per series with monthly values: views per million edition pageviews when every
 * series has edition data, otherwise average views per day. Colors follow input order.
 */
export function comparisonSpec(comparison: LanguageComparison, size: ChartSize = {}): TopLevelSpec {
  const { analyses } = comparison;
  const labels = seriesLabels(analyses);
  const perMillion = comparison.ranking.byViewsPerMillion !== null;
  const ranking = comparison.ranking.byViewsPerMillion ?? comparison.ranking.byTotalViews;
  const shown = ranking
    .slice(0, MAX_COMPARISON_LINES)
    .map((r) => r.index)
    .sort((a, b) => a - b);
  const shownLabels = shown.map((i) => labels[i]!);

  const rows = shown.flatMap((i) =>
    analyses[i]!.monthly.flatMap((m) => {
      const value = perMillion ? m.viewsPerMillion : m.dailyAverage;
      return value === null ? [] : [{ date: `${m.month}-01`, series: labels[i]!, value }];
    }),
  );
  const ends = shownLabels.flatMap((label) => rows.filter((r) => r.series === label).slice(-1));
  const color = { field: 'series', type: 'nominal', scale: { domain: shownLabels, range: CATEGORICAL.slice(0, shown.length) }, legend: { title: null } };
  const y = { field: 'value', type: 'quantitative', title: perMillion ? 'Views per million edition pageviews' : 'Average views per day' };

  const subtitle = [
    `Monthly, ${comparison.period.start} to ${comparison.period.end}. ${
      perMillion ? 'Normalized by each edition’s total pageviews.' : 'Raw views: larger editions look bigger.'
    } ${ATTENTION_NOTE}`,
  ];
  if (shown.length < analyses.length) subtitle.push(`Showing the top ${shown.length} of ${analyses.length} series.`);

  return {
    $schema: SCHEMA,
    title: { text: 'Interest by language', subtitle },
    width: size.width ?? 520,
    height: size.height ?? 200,
    padding: { left: 5, top: 5, bottom: 5, right: 60 },
    config: CHART_CONFIG,
    layer: [
      { data: { values: rows }, mark: { type: 'line' }, encoding: { x: TIME_AXIS, y, color } },
      {
        data: { values: ends },
        mark: { type: 'text', align: 'left', dx: 5, color: INK.secondary, fontSize: 9 },
        encoding: { x: TIME_AXIS, y: { field: 'value', type: 'quantitative' }, text: { field: 'series' } },
      },
    ],
  } as TopLevelSpec;
}

// ---------------------------------------------------------------------------
// 3. Year over year
// ---------------------------------------------------------------------------

const PRIOR = 'Prior 365 d';
const LAST = 'Last 365 d';

/**
 * One small panel per series: average daily views in the prior vs the last 365 days, with
 * the relative change on the last bar. Each panel has its own y scale, because editions
 * differ in size by orders of magnitude. Null if no series has a year-over-year comparison.
 */
export function yoySpec(analyses: readonly SeriesAnalysis[], size: ChartSize = {}): TopLevelSpec | null {
  const labels = seriesLabels(analyses);
  const available = analyses.flatMap((a, i) => (a.yearOverYear.available ? [{ yoy: a.yearOverYear, label: labels[i]! }] : []));
  if (available.length === 0) return null;
  const missing = labels.filter((_, i) => !analyses[i]!.yearOverYear.available);

  const rows = available.flatMap(({ yoy, label }) => [
    { series: label, period: PRIOR, value: yoy.previous.dailyMean, change: '' },
    { series: label, period: LAST, value: yoy.recent.dailyMean, change: yoy.relativeChange === null ? 'n/a' : formatSignedPercent(yoy.relativeChange) },
  ]);
  const { recent, previous } = available[0]!.yoy;
  const subtitle = [`Average views per day, ${recent.start} to ${recent.end} vs ${previous.start} to ${previous.end}. Each panel has its own scale.`];
  if (missing.length > 0) subtitle.push(`No year-over-year data (under 730 days) for: ${missing.join(', ')}.`);
  subtitle.push(ATTENTION_NOTE);

  const x = { field: 'period', type: 'nominal', sort: [PRIOR, LAST], title: null, axis: { labelAngle: 0 } };
  const y = { field: 'value', type: 'quantitative', title: 'Views per day' };
  return {
    $schema: SCHEMA,
    title: { text: 'Year over year', subtitle },
    data: { values: rows },
    facet: { column: { field: 'series', type: 'nominal', sort: available.map((a) => a.label), title: null } },
    spec: {
      width: size.width ?? 110,
      height: size.height ?? 150,
      layer: [
        {
          mark: { type: 'bar', size: 24, cornerRadiusEnd: 4 },
          encoding: { x, y, color: { field: 'period', type: 'nominal', scale: { domain: [PRIOR, LAST], range: [DEEMPHASIS, CATEGORICAL[0]] }, legend: null } },
        },
        {
          mark: { type: 'text', baseline: 'bottom', dy: -3, color: INK.primary, fontSize: 10 },
          encoding: { x, y, text: { field: 'change' } },
        },
      ],
    },
    resolve: { scale: { y: 'independent' } },
    config: CHART_CONFIG,
  } as TopLevelSpec;
}
