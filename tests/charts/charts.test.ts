import { describe, expect, it } from 'vitest';
import { analyzeSeries } from '../../src/analysis/analyze.js';
import { compareLanguages } from '../../src/analysis/compare.js';
import { MAX_COMPARISON_LINES, comparisonSpec, timelineSpec, yoySpec } from '../../src/charts/charts.js';
import { renderSvg, toChart } from '../../src/charts/render.js';
import { CATEGORICAL } from '../../src/charts/theme.js';
import { addDays } from '../../src/dates.js';
import { missingGlyphs } from '../../src/fonts.js';
import { monthlySeries, seriesOf } from '../helpers/series.js';

// The specs are plain JSON; these helpers dig into them without the Vega-Lite union types.
type Json = Record<string, any>;
const layers = (spec: unknown): Json[] => (spec as Json).layer;
const values = (layer: Json): Json[] => layer.data.values;

const wiggle = (k: number, amp: number): number => (k % 2 === 0 ? amp : -amp);
const stepSeries = () => monthlySeries('2024-01', Array.from({ length: 24 }, (_, k) => (k < 15 ? 280 : 60) + wiggle(k, 10)));
const edition = (language: string, perDay: number, months = 24) =>
  monthlySeries('2023-01', Array(months).fill(perDay), { language, project: `${language}.wikipedia`, article: null });

describe('timelineSpec', () => {
  it('draws daily views, the 28-day average, the trend and the level shift', () => {
    const series = stepSeries();
    const analysis = analyzeSeries(series);
    const spec = timelineSpec(series, analysis);
    const [daily, ma, trend, rule, text] = layers(spec);
    expect(layers(spec)).toHaveLength(5);

    expect(values(daily!)).toHaveLength(series.points.length);
    expect(values(daily!)[0]).toEqual({ date: '2024-01-01', value: 290 });
    expect(values(ma!)[0]).toEqual({ date: '2024-01-28', value: 290 }); // first full 28-day window
    expect(daily!.encoding.color.scale).toEqual({ domain: ['Daily views', '28-day average', 'Trend (Theil–Sen)'], range: ['#c3c2b7', CATEGORICAL[0], CATEGORICAL[1]] });

    if (!analysis.trend.available) throw new Error('expected a trend');
    expect(values(trend!)).toEqual([
      { date: '2024-01-15', value: analysis.trend.fittedStart },
      { date: '2025-12-15', value: analysis.trend.fittedEnd },
    ]);
    expect(values(rule!)).toEqual([{ date: '2025-04-01', label: 'Step: 290 to 50/day' }]);
    expect(text!.encoding.text).toEqual({ field: 'label' });

    expect((spec as Json).title).toEqual({
      text: 'Přerušovaný půst — cs.wikipedia',
      subtitle: ['Human pageviews per day, 2024-01-01 to 2025-12-31. Wikipedia attention, not market demand.'],
    });
  });

  it('caps the y-axis above spikes and marks the clipped days with their real values', () => {
    // 100/day with seven spikes; the highest 28-day average is (27·100 + 1270)/28 ≈ 141.8 → cap ⌈425.4⌉ = 426.
    const spikes = [30, 60, 90, 120, 150, 180, 210];
    const series = seriesOf('2024-01-01', 240, (i) => (spikes.includes(i) ? 1300 - i : 100));
    const analysis = analyzeSeries(series);
    expect(analysis.dailyAxisCap).toEqual({ cap: 426, clippedDays: spikes.map((i) => ({ date: addDays('2024-01-01', i), views: 1300 - i })) });

    const spec = timelineSpec(series, analysis) as Json;
    const all = layers(spec);
    for (const l of all.slice(0, 3)) {
      expect(l.encoding.y.scale).toEqual({ domain: [0, 426] });
      expect(l.mark.clip).toBe(true);
    }
    const [markers, labels] = all.slice(-2);
    expect(markers!.mark.shape).toBe('triangle-up');
    expect(values(markers!)).toHaveLength(7);
    expect(values(labels!).map((d) => d.label)).toEqual(['1270', '1240', '1210', '1180', '1150']); // the 5 largest
    expect(spec.title.subtitle[1]).toBe('Axis capped at 426 views/day; triangles mark 7 day(s) above it (largest values shown).');
  });

  it('places a weekly trend mid-week and omits missing layers', () => {
    const series = seriesOf('2024-01-01', 60, (i) => 100 + i); // Monday start, weekly trend, no step
    const spec = timelineSpec(series, analyzeSeries(series));
    expect(layers(spec)).toHaveLength(3);
    expect(values(layers(spec)[2]!)[0]!.date).toBe('2024-01-04');

    const short = seriesOf('2024-01-01', 20, () => 5); // no trend at all
    expect(layers(timelineSpec(short, analyzeSeries(short)))).toHaveLength(2);
  });

  it('rejects an analysis of another series', () => {
    expect(() => timelineSpec(stepSeries(), analyzeSeries(seriesOf('2024-01-01', 20, () => 5)))).toThrow(/does not belong/);
  });
});

describe('comparisonSpec', () => {
  it('plots views per million in input-order colors, with end labels', () => {
    const c = compareLanguages([
      { series: monthlySeries('2023-01', Array(24).fill(300), { language: 'pl', project: 'pl.wikipedia', article: 'Post' }), editionSeries: edition('pl', 4_000_000) },
      { series: monthlySeries('2023-01', Array(24).fill(100)), editionSeries: edition('cs', 1_000_000) },
    ]);
    const spec = comparisonSpec(c);
    const [lines, ends] = layers(spec);
    expect(lines!.encoding.y.title).toBe('Views per million edition pageviews');
    expect(lines!.encoding.color.scale).toEqual({ domain: ['pl', 'cs'], range: [CATEGORICAL[0], CATEGORICAL[1]] });
    expect(values(lines!)).toHaveLength(48);
    expect(values(lines!)[0]).toEqual({ date: '2023-01-01', series: 'pl', value: 75 });
    expect(values(ends!)).toEqual([
      { date: '2024-12-01', series: 'pl', value: 75 },
      { date: '2024-12-01', series: 'cs', value: 100 },
    ]);
  });

  it('falls back to average daily views and caps the number of lines', () => {
    const langs = ['cs', 'pl', 'sk', 'de', 'fr', 'it', 'es', 'nl', 'sv', 'fi'];
    const c = compareLanguages(langs.map((l, i) => ({ series: seriesOf('2024-01-01', 90, () => 10 * (i + 1), { language: l, project: `${l}.wikipedia` }) })));
    const spec = comparisonSpec(c) as Json;
    const [lines] = layers(spec);
    expect(lines!.encoding.y.title).toBe('Average views per day');
    // The 8 largest (sk … fi, i.e. inputs 2–9) are shown, colored in input order.
    expect(lines!.encoding.color.scale.domain).toEqual(langs.slice(2));
    expect(MAX_COMPARISON_LINES).toBe(8);
    expect(spec.title.subtitle).toContain('Showing the top 8 of 10 series.');
    expect(spec.title.subtitle[0]).toMatch(/Raw views: larger editions look bigger\./);
  });
});

describe('yoySpec', () => {
  it('shows prior vs last 365 days per series with the change label', () => {
    const grow = seriesOf('2023-01-01', 730, (i) => (i < 365 ? 100 : 150));
    const flat = seriesOf('2023-01-01', 730, () => 40, { language: 'pl', project: 'pl.wikipedia' });
    const spec = yoySpec(compareLanguages([{ series: grow }, { series: flat }]).analyses) as Json;
    expect(spec.data.values).toEqual([
      { series: 'cs', period: 'Prior 365 d', value: 100, change: '' },
      { series: 'cs', period: 'Last 365 d', value: 150, change: '+50%' },
      { series: 'pl', period: 'Prior 365 d', value: 40, change: '' },
      { series: 'pl', period: 'Last 365 d', value: 40, change: '0%' },
    ]);
    expect(spec.resolve).toEqual({ scale: { y: 'independent' } });
    expect(spec.title.subtitle[0]).toBe('Average views per day, 2024-01-01 to 2024-12-30 vs 2023-01-01 to 2023-12-31. Each panel has its own scale.');
  });

  it('lists series without year-over-year data and returns null when none has it', () => {
    const long = seriesOf('2023-01-01', 730, () => 10);
    const short = seriesOf('2024-06-01', 100, () => 10, { language: 'pl', project: 'pl.wikipedia' });
    const spec = yoySpec([analyzeSeries(long), analyzeSeries(short)]) as Json;
    expect(spec.data.values).toHaveLength(2);
    expect(spec.title.subtitle).toContain('No year-over-year data (under 730 days) for: pl.');
    expect(yoySpec([analyzeSeries(short)])).toBeNull();
  });
});

describe('chart layer rules', () => {
  it('never asks Vega-Lite to compute anything', () => {
    const series = stepSeries();
    const a = analyzeSeries(series);
    const c = compareLanguages([{ series }]);
    for (const spec of [timelineSpec(series, a), comparisonSpec(c), yoySpec([analyzeSeries(seriesOf('2023-01-01', 730, () => 1))])]) {
      expect(JSON.stringify(spec)).not.toMatch(/"(aggregate|transform|bin|timeUnit|impute|window|joinaggregate)"/);
    }
  });

  it('uses only characters the embedded font can draw', () => {
    const spiky = seriesOf('2023-01-01', 730, (i) => (i % 97 === 0 ? 5000 : 100 + (i > 400 ? -60 : 0)));
    const a = analyzeSeries(spiky);
    const specs = [timelineSpec(spiky, a), timelineSpec(stepSeries(), analyzeSeries(stepSeries())), comparisonSpec(compareLanguages([{ series: spiky }])), yoySpec([a])];
    for (const spec of specs) expect(missingGlyphs(JSON.stringify(spec))).toEqual([]);
  });

  it('always carries the attention-not-demand note', () => {
    const series = stepSeries();
    const specs = [timelineSpec(series, analyzeSeries(series)), comparisonSpec(compareLanguages([{ series }])), yoySpec([analyzeSeries(seriesOf('2023-01-01', 730, () => 1))])];
    for (const spec of specs) expect(JSON.stringify((spec as Json).title)).toContain('Wikipedia attention, not market demand.');
  });
});

describe('renderSvg', () => {
  it('renders the comparison and year-over-year charts', async () => {
    const cs = seriesOf('2023-01-01', 730, () => 100);
    const uk = seriesOf('2023-01-01', 730, () => 50, { language: 'uk', project: 'uk.wikipedia', article: 'Астрономія' });
    const c = compareLanguages([{ series: cs }, { series: uk }]);
    const comparison = await renderSvg(comparisonSpec(c));
    expect(comparison).toContain('Interest by language');
    expect(comparison).toContain('>uk<');
    const yoy = await renderSvg(yoySpec(c.analyses)!);
    expect(yoy).toContain('Last 365 d');
    expect(yoy).toContain('0%');
  });

  it('renders a deterministic, compact SVG with titles and legend labels', async () => {
    const series = stepSeries();
    const spec = timelineSpec(series, analyzeSeries(series));
    const svg = await renderSvg(spec);
    expect(svg.startsWith('<svg')).toBe(true);
    for (const text of ['Přerušovaný půst — cs.wikipedia', 'Daily views', '28-day average', 'Trend (Theil–Sen)', 'Step: 290 to 50/day']) {
      expect(svg).toContain(text);
    }
    // With Helvetica metrics the SVG is about as wide as the plot; Vega's 0.8-em fallback made it ~730 px.
    const width = Number(/^<svg[^>]* width="(\d+)"/.exec(svg)![1]);
    expect(width).toBeGreaterThan(520);
    expect(width).toBeLessThan(620);
    expect(await renderSvg(spec)).toBe(svg);
    expect((await toChart(spec)).svg).toBe(svg);
  });
});
