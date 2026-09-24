import { describe, expect, it } from 'vitest';
import { compareLanguages, type ComparisonInput } from '../../src/analysis/compare.js';
import { DEMAND_CAVEAT, assessComparison } from '../../src/analysis/confidence.js';
import type { PageviewSeries } from '../../src/data/series.js';
import { MAX_ANALYST_NOTE_CHARS, MAX_TABLE_ROWS, buildReportModel, type ReportInput } from '../../src/reports/content.js';
import { generateReport } from '../../src/reports/pdf.js';
import { monthlySeries, seriesOf } from '../helpers/series.js';

const GENERATED = new Date('2026-09-25T12:00:00Z');
const wiggle = (k: number, amp: number): number => (k % 2 === 0 ? amp : -amp);

function edition(language: string, perDay: number, months = 24): PageviewSeries {
  return monthlySeries('2023-01', Array(months).fill(perDay), { language, project: `${language}.wikipedia`, article: null });
}

function input(inputs: ComparisonInput[], extra: Partial<ReportInput> = {}): ReportInput {
  const comparison = compareLanguages(inputs);
  return {
    topic: 'intermittent fasting',
    comparison,
    assessment: assessComparison(comparison, inputs.map(() => ({ confidence: 'high' as const, notes: [] }))),
    series: inputs.map((i) => i.series),
    generatedAt: GENERATED,
    ...extra,
  };
}

/** cs: 100/day in a 1M/day edition (100 per million); pl: 300/day in a 4M/day edition (75 per million). */
const twoLanguages = (): ComparisonInput[] => [
  { series: monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 300 + wiggle(k, 5)), { language: 'pl', project: 'pl.wikipedia', article: 'Post_przerywany' }), editionSeries: edition('pl', 4_000_000) },
  { series: monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 100 + wiggle(k, 5))), editionSeries: edition('cs', 1_000_000) },
];

describe('buildReportModel', () => {
  it('builds a comparison report from computed numbers only', () => {
    const m = buildReportModel(input(twoLanguages(), { missing: [{ language: 'uk', reason: 'no article linked to the topic' }] }));
    expect(m.title).toBe('Wikipedia interest: intermittent fasting');
    expect(m.subtitle).toBe('Wikipedia editions: pl, cs, uk · 2023-01-01 to 2024-12-31 (731 days) · generated 2026-09-25 UTC');
    expect(m.attentionBanner).toMatch(/not market demand/);

    // Ranked by views per million: cs first.
    expect(m.table.header).toEqual(['Edition', 'Article', 'Views', 'Median/day', 'Per million', 'YoY', 'Trend/year', 'Confidence']);
    expect(m.table.rows.map((r) => r.slice(0, 2))).toEqual([
      ['cs', 'Přerušovaný půst'],
      ['pl', 'Post przerywany'],
      ['uk', 'no article linked to the topic'],
    ]);
    expect(Number(m.table.rows[0]![4])).toBeCloseTo(100, 0);
    expect(m.table.rows[2]!.slice(2)).toEqual(['—', '—', '—', '—', '—', '—']);

    expect(m.findings[0]).toMatch(/^Highest interest relative to edition size: cs \(100\), pl \(75\) views per million edition pageviews\.$/);
    expect(m.findings[1]).toMatch(/^The ranking holds month by month: cs is ahead of pl in 24 of 24 complete months\.$/);
    expect(m.findings).toContain('No data for: uk (no article linked to the topic).');
    expect(m.findings.some((f) => f.startsWith('cs: no clear trend; '))).toBe(true);

    expect(m.limitations[0]).toBe(DEMAND_CAVEAT);
    expect(m.charts).toHaveLength(2);
    expect(m.charts.map((c) => c.id)).toEqual(['comparison', 'yoy']);
    expect(JSON.stringify(m.charts[0]!.spec)).toContain('Interest by language');
    expect(m.analystNote).toBeNull();
    expect(m.warnings).toEqual([]);
  });

  it('refers to the table instead of "members" in the confidence reasons', () => {
    const inputs = twoLanguages();
    inputs[1] = { series: monthlySeries('2023-01', Array(24).fill(3)), editionSeries: edition('cs', 1_000_000) }; // very low volume
    const m = buildReportModel(input(inputs));
    expect(m.confidence.level).toBe('low');
    expect(m.confidence.reasons.join(' ')).toContain('(see the table)');
    expect(m.confidence.reasons.join(' ')).not.toContain('members');
  });

  it('builds a single-series report with a timeline and typical-day finding', () => {
    const levels = Array.from({ length: 24 }, (_, k) => (k < 15 ? 280 : 60) + wiggle(k, 10));
    const m = buildReportModel(input([{ series: monthlySeries('2023-01', levels, { language: 'uk', project: 'uk.wikipedia', article: 'Астрономія' }) }], { topic: 'astronomy' }));
    expect(m.subtitle).toMatch(/^Wikipedia edition: uk · /);
    expect(m.charts.map((c) => c.id)).toEqual(['timeline', 'yoy']);
    expect(JSON.stringify(m.charts[0]!.spec)).toContain('Астрономія — uk.wikipedia');
    expect(m.findings[0]).toMatch(/^uk: decreasing .*abrupt change between 2024-03 and 2024-04\.$/);
    expect(m.findings[1]).toMatch(/^Typical day: \d+ views \(median\); busiest day \d{4}-\d{2}-\d{2} with \d+ views\.$/);
    expect(m.table.rows[0]![4]).toBe('—'); // no edition data
  });

  it('keeps one chart when there is no year-over-year data', () => {
    const m = buildReportModel(input([{ series: seriesOf('2024-01-01', 200, () => 50) }]));
    expect(m.charts).toHaveLength(1);
    expect(m.table.rows[0]![5]).toBe('n/a');
  });

  it('validates the topic, the analyst note and the inputs', () => {
    expect(() => buildReportModel(input(twoLanguages(), { topic: '  ' }))).toThrow(/topic/);
    expect(() => buildReportModel(input(twoLanguages(), { analystNote: 'x'.repeat(MAX_ANALYST_NOTE_CHARS + 1) }))).toThrow(/analyst note/);
    const ok = input(twoLanguages());
    expect(() => buildReportModel({ ...ok, series: ok.series.slice(0, 1) })).toThrow(/one to one/);
    expect(buildReportModel(input(twoLanguages(), { analystNote: '  Worth a closer look.  ' })).analystNote).toBe('Worth a closer look.');
  });

  it('replaces characters the font cannot draw and caps the table', () => {
    const langs = ['cs', 'pl', 'sk', 'de', 'fr', 'it', 'es', 'nl', 'sv', 'fi', 'da', 'no'];
    const inputs = langs.map((l, i) => ({ series: seriesOf('2024-01-01', 90, () => 10 + i, { language: l, project: `${l}.wikipedia` }) }));
    const m = buildReportModel(input(inputs, { topic: 'astronomy 天文' }));
    expect(m.title).toBe('Wikipedia interest: astronomy ??');
    expect(m.table.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(m.warnings).toEqual(['The table shows 10 of 12 rows.', 'Replaced characters the embedded font cannot draw with "?": 天 文']);
    expect(m.findings).toContain('Other editions: see the table.');
  });
});

describe('generateReport', () => {
  const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

  it('renders a one-page PDF', async () => {
    const { pdf, model } = await generateReport(input(twoLanguages(), { analystNote: 'Czech readers look relatively more interested.' }));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(model.analystNote).toBe('Czech readers look relatively more interested.');
  });

  it('still fits on one page with the maximum content', async () => {
    const langs = ['cs', 'pl', 'sk', 'de', 'fr', 'it', 'es', 'nl'];
    const inputs = langs.map((l, i) => ({
      series: monthlySeries('2023-01', Array.from({ length: 24 }, (_, k) => 50 + 10 * i + wiggle(k + i, 20)), { language: l, project: `${l}.wikipedia`, article: `A_very_long_article_title_number_${i}` }),
      editionSeries: edition(l, 1_000_000 * (i + 1)),
    }));
    const missing = [{ language: 'uk', reason: 'no article linked to the topic' }, { language: 'xx', reason: 'edition does not exist' }];
    const { pdf, model } = await generateReport(input(inputs, { topic: 'x'.repeat(120), missing, analystNote: 'word '.repeat(120).trim() }));
    expect(pageCount(pdf)).toBe(1);
    // The year-over-year chart may be dropped to make room; that is reported, never silent.
    expect(model.warnings.every((w) => /chart\(s\) left out/.test(w))).toBe(true);
  });
});
