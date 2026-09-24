import { describe, expect, it } from 'vitest';
import { analyzeSeries, type SeriesAnalysis } from '../../src/analysis/analyze.js';
import { compareLanguages } from '../../src/analysis/compare.js';
import {
  COMPARISON_CAVEATS,
  DEMAND_CAVEAT,
  assessComparison,
  assessSeries,
  type Factor,
  type FactorId,
} from '../../src/analysis/confidence.js';
import { missingGlyphs } from '../../src/fonts.js';
import { makeSeries, monthlySeries, seriesOf } from '../helpers/series.js';

const factor = (a: { factors: Factor[] }, id: FactorId): Factor => a.factors.find((f) => f.id === id)!;
const wiggle = (k: number, amp: number): number => (k % 2 === 0 ? amp : -amp);
const assess = (values: ReadonlyArray<number | null>) => assessSeries(analyzeSeries(makeSeries('2024-01-01', values)));

/** 24 months of steady growth: every check passes. */
const steady = (): SeriesAnalysis => analyzeSeries(monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 1000 + 20 * k)));

describe('assessSeries', () => {
  it('rates clean, long, high-traffic data high, with the demand caveat', () => {
    const a = assessSeries(steady(), { confidence: 'high', notes: [] });
    expect(a.level).toBe('high');
    expect(a.reasons).toEqual(['All data-quality checks passed.']);
    expect(a.factors.map((f) => [f.id, f.status])).toEqual([
      ['resolution', 'ok'],
      ['period', 'ok'],
      ['volume', 'ok'],
      ['coverage', 'ok'],
      ['outliers', 'ok'],
      ['consistency', 'ok'],
      ['level_shift', 'ok'],
      ['seasonality', 'info'],
    ]);
    expect(a.claims.trend?.level).toBe('high');
    expect(a.claims.trend?.reasons[0]).toMatch(/increase is statistically significant \(Mann–Kendall p < 0\.001, 24 months\)/);
    expect(a.claims.yearOverYear).toEqual({ level: 'high', reasons: [] });
    expect(a.claims.recentVsPrevious).toEqual({ level: 'high', reasons: [] });
    expect(a.caveats[0]).toBe(DEMAND_CAVEAT);
    expect(DEMAND_CAVEAT).toMatch(/not a measure of market demand/);
  });

  it('treats a missing trend as medium confidence, not as evidence of stability', () => {
    const a = assessSeries(analyzeSeries(monthlySeries('2023-01', Array(24).fill(500))));
    expect(a.level).toBe('high');
    expect(a.claims.trend?.level).toBe('medium');
    expect(a.claims.trend?.reasons[0]).toMatch(/not proof that interest is stable/);
  });

  it('caps the trend at medium when the change is a one-time step (uk-like)', () => {
    const levels = Array.from({ length: 24 }, (_, k) => (k < 15 ? 280 : 60) + wiggle(k, 10));
    const a = assessSeries(analyzeSeries(monthlySeries('2024-01', levels)));
    expect(factor(a, 'level_shift').status).toBe('caution');
    expect(factor(a, 'level_shift').message).toMatch(/between 2025-03 and 2025-04 \(from about 290 to 50 views\/day/);
    expect(factor(a, 'consistency').status).toBe('ok'); // deviation from the line ≈ 16 % (Python)
    expect(a.level).toBe('medium');
    expect(a.claims.trend?.level).toBe('medium');
    expect(a.claims.trend?.reasons.join(' ')).toMatch(/one-time step between 2025-03 and 2025-04, not a gradual trend/);
  });

  it('measures consistency against the step, not the line, once a step is detected', () => {
    // Before and after the step each month is ±15 % around its level; a line through the step misses badly.
    const levels = Array.from({ length: 24 }, (_, k) => (k < 12 ? 300 : 60) * (1 + wiggle(k, 0.15)));
    const analysis = analyzeSeries(monthlySeries('2024-01', levels.map(Math.round)));
    expect(analysis.levelShift).toMatchObject({ detected: true });
    if (analysis.levelShift.assessed) expect(analysis.levelShift.stepDeviation).toBeCloseTo(0.15, 12);
    expect(analysis.volatility.trendDeviation!).toBeGreaterThan(0.3); // the line would call it irregular (caution)
    const c = factor(assessSeries(analysis), 'consistency');
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/deviates by 15% from the levels before and after the step/);
  });

  it('says when the whole edition shifted at the same time', () => {
    const article = monthlySeries('2024-01', Array.from({ length: 24 }, (_, k) => (k < 15 ? 280 : 60) + wiggle(k, 10)));
    const edition = monthlySeries(
      '2024-01',
      Array.from({ length: 24 }, (_, k) => (k < 15 ? 3_000_000 : 2_000_000) + wiggle(k, 10_000)),
      { article: null },
    );
    const a = assessSeries(analyzeSeries(article, { editionSeries: edition }));
    expect(factor(a, 'level_shift').message).toMatch(/whole cs edition also shifted then \(-34% total views\)/); // 1.99 M / 3.01 M − 1

    const flatEdition = monthlySeries('2024-01', Array.from({ length: 24 }, (_, k) => 3_000_000 + wiggle(k, 10_000)), { article: null });
    const b = assessSeries(analyzeSeries(article, { editionSeries: flatEdition }));
    expect(factor(b, 'level_shift').message).not.toMatch(/edition/);
  });

  it('rates a short period low and limits every claim by the data level', () => {
    const a = assessSeries(analyzeSeries(seriesOf('2024-01-01', 60, (i) => 200 + i)));
    expect(factor(a, 'period')).toMatchObject({ status: 'weak', value: 60 });
    expect(a.level).toBe('low');
    expect(a.claims.trend?.level).toBe('low');
    expect(a.claims.trend?.reasons.join(' ')).toMatch(/weekly averages.*Limited by the low data confidence/s);
    expect(a.claims.yearOverYear).toBeNull();
    expect(a.claims.recentVsPrevious).toBeNull();
  });

  it('rates less than a year as caution', () => {
    const a = assessSeries(analyzeSeries(seriesOf('2024-01-01', 200, () => 100)));
    expect(factor(a, 'period').status).toBe('caution');
    expect(a.level).toBe('medium');
  });

  it('applies the volume thresholds to the median daily views', () => {
    const volume = (v: number) => factor(assess(Array(400).fill(v)), 'volume');
    expect(volume(4)).toMatchObject({ status: 'weak', value: 4 });
    expect(volume(5).status).toBe('caution');
    expect(volume(29).message).toMatch(/Median of 29 views\/day: low traffic/);
    expect(volume(30).status).toBe('ok');
  });

  it('rates imputed days and flags an article that starts late in the period', () => {
    // `n` missing days spread evenly over 400 days, the first one on day 0.
    const gaps = (n: number) => Array.from({ length: 400 }, (_, i) => (i % (400 / n) === 0 ? null : 100));
    expect(factor(assess(gaps(10)), 'coverage').status).toBe('ok'); // 2.5 %
    expect(factor(assess(gaps(40)), 'coverage').status).toBe('caution'); // 10 %
    expect(factor(assess(gaps(100)), 'coverage').status).toBe('weak'); // 25 %

    // 40 leading empty days out of 900 (4 %) are fine by share, but the late start is flagged.
    const late = factor(assess(Array.from({ length: 900 }, (_, i) => (i < 40 ? null : 100))), 'coverage');
    expect(late.status).toBe('caution');
    expect(late.message).toMatch(/first reported day is 2024-02-10/);

    expect(factor(assess(Array(100).fill(null)), 'coverage')).toMatchObject({
      status: 'weak',
      message: 'The API reported no views at all for this period.',
    });
  });

  it('rates the share of views that come from spikes', () => {
    const spikes = (n: number) => assess(Array.from({ length: 400 }, (_, i) => (i % 70 === 35 && i < 70 * n ? 3000 : 100)));
    expect(factor(spikes(0), 'outliers')).toMatchObject({ status: 'ok', message: 'No outlier days.' });
    const three = factor(spikes(3), 'outliers'); // 8700 / 48700 = 18 %
    expect(three.status).toBe('caution');
    expect(three.message).toMatch(/3 outlier day\(s\); spikes account for 18% .* largest spike is 2024-02-05 \(3000 views vs a typical 100\)/);
    expect(factor(spikes(5), 'outliers').status).toBe('weak'); // 14500 / 54500 = 27 %
  });

  it('rates irregular months as inconsistent', () => {
    const levels = Array.from({ length: 24 }, (_, k) => 1000 + wiggle(k, 300));
    const c = factor(assessSeries(analyzeSeries(monthlySeries('2023-01', levels))), 'consistency');
    expect(c).toMatchObject({ status: 'caution', value: 0.3 });
    expect(c.message).toMatch(/typical month deviates by 30% from the trend line/);
  });

  it('turns resolver uncertainty into a factor', () => {
    const medium = assessSeries(steady(), { confidence: 'medium', notes: ['Redirects to a section.'] });
    expect(factor(medium, 'resolution').status).toBe('caution');
    expect(medium.reasons[0]).toMatch(/only partly or indirectly\. Redirects to a section\./);
    expect(assessSeries(steady(), { confidence: null, notes: [] }).level).toBe('low');
    expect(assessSeries(steady()).factors.some((f) => f.id === 'resolution')).toBe(false);
  });

  it('marks a change driven by spike days', () => {
    const a = assessSeries(analyzeSeries(seriesOf('2023-01-01', 730, (i) => (i === 500 ? 5000 : 100))));
    expect(a.level).toBe('high');
    expect(a.claims.yearOverYear).toEqual({ level: 'medium', reasons: ['Largely driven by spike days: +13% overall, 0% without them.'] });
  });

  it('prefers year-over-year when interest is seasonal', () => {
    const levels = Array.from({ length: 36 }, (_, k) => Math.round(1000 * (1 + 0.3 * Math.sin((2 * Math.PI * k) / 12))));
    const a = assessSeries(analyzeSeries(monthlySeries('2023-01', levels)));
    expect(factor(a, 'seasonality').message).toMatch(/seasonal pattern repeats/);
    expect(a.claims.recentVsPrevious?.level).toBe('medium');
    expect(a.claims.recentVsPrevious?.reasons.join(' ')).toMatch(/Interest is seasonal.*prefer the year-over-year change/);
  });

  it('caps recent-vs-previous when seasonality cannot be checked', () => {
    const a = assess(Array(400).fill(100));
    expect(factor(a, 'seasonality').status).toBe('info');
    expect(a.claims.recentVsPrevious).toMatchObject({ level: 'medium' });
    expect(a.claims.recentVsPrevious?.reasons[0]).toMatch(/seasonality could not be checked/);
  });
});

describe('assessment text', () => {
  it('uses only characters the embedded PDF font can draw', () => {
    const article = monthlySeries('2024-01', Array.from({ length: 24 }, (_, k) => (k < 15 ? 280 : 60) + wiggle(k, 10)));
    const editionSeries = monthlySeries('2024-01', Array.from({ length: 24 }, (_, k) => (k < 15 ? 3e6 : 2e6)), { article: null });
    const texts = [
      assessSeries(analyzeSeries(article, { editionSeries }), { confidence: 'medium', notes: ['Redirect to a section.'] }),
      assess(Array.from({ length: 400 }, (_, i) => (i < 40 ? null : i % 70 === 35 ? 3000 : 3))),
      assessSeries(analyzeSeries(seriesOf('2024-01-01', 60, (i) => 200 + i))),
    ].map((a) => JSON.stringify(a));
    const cmp = compareLanguages([{ series: monthlySeries('2023-01', Array(24).fill(100)) }, { series: monthlySeries('2023-01', Array(24).fill(90), { language: 'pl', project: 'pl.wikipedia' }) }]);
    texts.push(JSON.stringify(assessComparison(cmp)));
    for (const t of texts) expect(missingGlyphs(t)).toEqual([]);
  });
});

describe('assessComparison', () => {
  const pl = { language: 'pl', project: 'pl.wikipedia', article: 'Post' };
  const edition = (language: string, perDay: number) =>
    monthlySeries('2023-01', Array(24).fill(perDay), { language, project: `${language}.wikipedia`, article: null });

  it('is high when the normalized ranking holds every month and every series is clean', () => {
    const c = compareLanguages([
      { series: monthlySeries('2023-01', Array(24).fill(300), pl), editionSeries: edition('pl', 4_000_000) }, // 75 per million
      { series: monthlySeries('2023-01', Array(24).fill(100)), editionSeries: edition('cs', 1_000_000) }, // 100 per million
    ]);
    const a = assessComparison(c, [{ confidence: 'high', notes: [] }, { confidence: 'high', notes: [] }]);
    expect(a.basis).toBe('views_per_million');
    expect(a.rankingPairs).toEqual([{ higher: 1, lower: 0, monthsAhead: 24, months: 24, share: 1 }]);
    expect(factor(a, 'ranking_stability').message).toBe('The ranking holds month by month: cs is ahead of pl in 24 of 24 complete months.');
    expect(a.level).toBe('high');
    expect(a.members.map((m) => [m.language, m.level])).toEqual([
      ['pl', 'high'],
      ['cs', 'high'],
    ]);
    expect(a.caveats).toEqual(COMPARISON_CAVEATS);
  });

  it('flags raw-total rankings, an unstable order and weak members', () => {
    const cs = monthlySeries('2023-01', Array(24).fill(100));
    const plSeries = monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 100 + wiggle(k, 10)), pl);
    const sk = monthlySeries('2023-01', Array(24).fill(2), { language: 'sk', project: 'sk.wikipedia', article: 'Pôst' });
    const a = assessComparison(compareLanguages([{ series: cs }, { series: plSeries }, { series: sk }]));
    expect(a.basis).toBe('total_views');
    expect(factor(a, 'normalization').status).toBe('caution');
    const stability = factor(a, 'ranking_stability');
    expect(stability.status).toBe('weak');
    expect(stability.message).toMatch(/not stable month by month: \w+ is ahead of \w+ in 12 of 24 complete months\./);
    expect(factor(a, 'members')).toMatchObject({ status: 'weak', message: 'Data confidence per series: sk low (see members).' });

    // With many unstable pairs, the message names two and counts the rest.
    const many = ['de', 'fr', 'it', 'es'].map((l, i) => ({
      series: monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 100 + wiggle(k + i, 10)), { language: l, project: `${l}.wikipedia` }),
    }));
    const m = factor(assessComparison(compareLanguages(many)), 'ranking_stability').message;
    expect(m).toMatch(/^The ranking is not stable month by month: \w+ is ahead of \w+ in 12 of 24 complete months; \w+ is ahead of \w+ in 12 of 24 complete months; and 1 more adjacent pair\(s\)\. Treat/);
    expect(a.level).toBe('low');
  });

  it('labels same-language series by article and skips stability for one series or few months', () => {
    const a = seriesOf('2024-01-01', 60, () => 10);
    const b = seriesOf('2024-01-01', 60, () => 20, { article: 'Půst' });
    const two = assessComparison(compareLanguages([{ series: a }, { series: b }]));
    expect(factor(two, 'ranking_stability').status).toBe('info');
    expect(factor(two, 'ranking_stability').message).toMatch(/at least 3 complete months; the period has 2/);
    expect(factor(two, 'members').message).toBe('Data confidence per series: cs:Přerušovaný půst low, cs:Půst low (see members).');

    const one = assessComparison(compareLanguages([{ series: a }]));
    expect(factor(one, 'ranking_stability').message).toMatch(/Only one series/);
    expect(one.rankingPairs).toEqual([]);
  });
});
