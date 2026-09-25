/**
 * Report content: turns the deterministic results into the text, table and chart specs of the
 * one-page report. Every number comes from the analysis and confidence layers. The only free
 * text is the optional analyst note from the agent, which is length-limited and labelled as
 * such in the PDF.
 */
import type { TopLevelSpec } from 'vega-lite';
import type { SeriesAnalysis } from '../analysis/analyze.js';
import { seriesLabels, type LanguageComparison } from '../analysis/compare.js';
import { editionShiftWithStep, type ComparisonAssessment, type ConfidenceLevel, type SeriesAssessment } from '../analysis/confidence.js';
import { comparisonSpec, timelineSpec, yoySpec } from '../charts/charts.js';
import { sliceSeries, type PageviewSeries } from '../data/series.js';
import { missingGlyphs } from '../fonts.js';
import { formatInteger, formatNumber, formatSignedPercent, formatSignificant, plural } from '../format.js';

export const MAX_ANALYST_NOTE_CHARS = 600;
export const MAX_TOPIC_CHARS = 120;
export const MAX_TABLE_ROWS = 10;
/** Series that get their own line in the findings (the top of the ranking). */
export const MAX_SERIES_FINDINGS = 3;
export const MAX_CONFIDENCE_REASONS = 4;
export const MAX_LIMITATIONS = 4;

export const ATTENTION_BANNER =
  'Wikipedia pageviews measure attention and information-seeking on Wikipedia, not market demand, purchase intent or willingness to pay.';

/** A requested edition with no data in the report (no article, edition does not exist, ...). */
export interface MissingEdition {
  language: string;
  /** Short reason, e.g. "no article linked to the topic". */
  reason: string;
}

export interface ReportInput {
  /** The topic as the user named it, e.g. "intermittent fasting". */
  topic: string;
  comparison: LanguageComparison;
  /** assessComparison(comparison, resolutions). */
  assessment: ComparisonAssessment;
  /** The daily series in the same order as comparison.analyses (used for the single-series timeline). */
  series: readonly PageviewSeries[];
  missing?: readonly MissingEdition[];
  /** Optional short note from the agent; shown under a label saying it is not computed. */
  analystNote?: string | null;
  generatedAt: Date;
}

export interface ReportChart {
  id: 'timeline' | 'comparison' | 'yoy';
  spec: TopLevelSpec;
}

export interface ReportModel {
  title: string;
  subtitle: string;
  attentionBanner: string;
  table: { header: string[]; rows: string[][] };
  findings: string[];
  analystNote: string | null;
  confidence: { level: ConfidenceLevel; reasons: string[] };
  limitations: string[];
  /** One or two charts, top to bottom. */
  charts: ReportChart[];
  /** Non-fatal problems (rows omitted, characters the font cannot draw). */
  warnings: string[];
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { comparison, assessment } = input;
  const analyses = comparison.analyses;
  const topic = input.topic.trim();
  if (topic === '' || topic.length > MAX_TOPIC_CHARS) throw new RangeError(`The topic must be 1–${MAX_TOPIC_CHARS} characters.`);
  if (assessment.members.length !== analyses.length || input.series.length !== analyses.length) {
    throw new RangeError('assessment.members and series must match comparison.analyses one to one.');
  }
  const note = input.analystNote?.trim() || null;
  if (note !== null && note.length > MAX_ANALYST_NOTE_CHARS) {
    throw new RangeError(`The analyst note is ${note.length} characters; the maximum is ${MAX_ANALYST_NOTE_CHARS}.`);
  }

  const labels = seriesLabels(analyses);
  const missing = input.missing ?? [];
  const warnings: string[] = [];
  const perMillion = comparison.ranking.byViewsPerMillion;
  const order = (perMillion ?? comparison.ranking.byTotalViews).map((r) => r.index);
  const single = analyses.length === 1;

  const editions = [...labels, ...missing.map((m) => m.language)];
  const { start, end, days } = comparison.period;
  const subtitle = `${editions.length === 1 ? 'Wikipedia edition' : 'Wikipedia editions'}: ${editions.join(', ')} · ${start} to ${end} (${days} days) · generated ${input.generatedAt.toISOString().slice(0, 10)} UTC`;

  // Table: ranked series, then the missing editions.
  const rows = order.map((i) => tableRow(labels[i]!, analyses[i]!, assessment.members[i]!));
  for (const m of missing) rows.push([m.language, m.reason, '—', '—', '—', '—', '—', '—']);
  if (rows.length > MAX_TABLE_ROWS) warnings.push(`The table shows ${MAX_TABLE_ROWS} of ${rows.length} rows.`);

  // In the report, per-series levels are in the table (the JSON output calls them "members").
  const confidence = single
    ? { level: assessment.members[0]!.level, reasons: assessment.members[0]!.reasons.slice(0, MAX_CONFIDENCE_REASONS) }
    : { level: assessment.level, reasons: assessment.reasons.slice(0, MAX_CONFIDENCE_REASONS).map((r) => r.replace('(see members)', '(see the table)')) };

  const imputed = analyses.reduce((n, a) => n + a.coverage.imputedDays, 0);
  // The caveats start with DEMAND_CAVEAT, so it always survives the MAX_LIMITATIONS cut.
  const limitations = [...(single ? assessment.members[0]!.caveats : assessment.caveats)];
  if (imputed > 0) limitations.push(`Days the API reported no views for are counted as zero (${plural(imputed, 'day')} in total).`);

  const charts: ReportChart[] = single
    ? [{ id: 'timeline', spec: timelineSpec(sliceSeries(input.series[0]!, start, end), analyses[0]!, { height: 150 }) }]
    : [{ id: 'comparison', spec: comparisonSpec(comparison, { height: 150 }) }];
  const yoy = yoySpec(analyses, { width: Math.min(110, Math.floor(480 / analyses.length) - 30), height: 100 });
  if (yoy) charts.push({ id: 'yoy', spec: yoy });
  for (const { spec } of charts) {
    const bad = missingGlyphs(JSON.stringify(spec));
    if (bad.length > 0) warnings.push(`The embedded font cannot draw some characters in a chart: ${bad.join(' ')}`);
  }

  const model: ReportModel = {
    title: `Wikipedia interest: ${topic}`,
    subtitle,
    attentionBanner: ATTENTION_BANNER,
    table: { header: ['Edition', 'Article', 'Views', 'Median/day', 'Per million', 'YoY', 'Trend/year', 'Confidence'], rows: rows.slice(0, MAX_TABLE_ROWS) },
    findings: findings(input, labels, order),
    analystNote: note,
    confidence,
    limitations: limitations.slice(0, MAX_LIMITATIONS),
    charts,
    warnings,
  };
  return sanitize(model);
}

function tableRow(label: string, a: SeriesAnalysis, member: SeriesAssessment): string[] {
  const t = a.trend;
  let trend = 'n/a';
  if (t.available) {
    trend = t.direction === 'no_significant_trend' ? 'no clear trend' : t.relativeChangePerYear === null ? t.direction : formatSignedPercent(t.relativeChangePerYear);
  }
  return [
    label,
    a.article === null ? '(all articles)' : a.article.replaceAll('_', ' '),
    formatInteger(a.summary.totalViews),
    formatNumber(a.summary.dailyMedian),
    a.normalization ? formatSignificant(a.normalization.viewsPerMillion) : '—',
    a.yearOverYear.available && a.yearOverYear.relativeChange !== null ? formatSignedPercent(a.yearOverYear.relativeChange) : 'n/a',
    trend,
    member.level,
  ];
}

function findings(input: ReportInput, labels: readonly string[], order: readonly number[]): string[] {
  const { comparison, assessment } = input;
  const analyses = comparison.analyses;
  const out: string[] = [];

  if (analyses.length > 1) {
    const perMillion = comparison.ranking.byViewsPerMillion;
    const ranking = perMillion ?? comparison.ranking.byTotalViews;
    const top = ranking.slice(0, 4).map((r) => `${labels[r.index]} (${perMillion ? formatSignificant(r.value) : formatInteger(r.value)})`);
    // A tiny edition can lead per million on a handful of views; say so where the lead is stated.
    const leaderLow = assessment.members[ranking[0]!.index]?.level === 'low';
    const caveat = leaderLow ? ` (${labels[ranking[0]!.index]} has low data confidence: see Confidence)` : '';
    out.push(
      perMillion
        ? `Highest interest relative to edition size: ${top.join(', ')} views per million edition pageviews${caveat}.`
        : `Most views: ${top.join(', ')}${caveat}. Raw totals favour larger editions (edition totals were not available).`,
    );
    // An unstable ranking already appears under Confidence; here only the positive fact.
    const stability = assessment.factors.find((f) => f.id === 'ranking_stability');
    if (stability?.status === 'ok') out.push(stability.message);
  }

  for (const i of order.slice(0, MAX_SERIES_FINDINGS)) out.push(seriesFinding(labels[i]!, analyses[i]!, assessment.members[i]!));

  if (analyses.length === 1) {
    const a = analyses[0]!;
    const peak = a.summary.peakDay;
    out.push(
      peak === null
        ? 'No views were reported in this period: the article may not have existed yet under this title.'
        : `Typical day: ${formatNumber(a.summary.dailyMedian)} ${a.summary.dailyMedian === 1 ? 'view' : 'views'} (median); busiest day ${peak.date} with ${plural(peak.views, 'view').replace(/^\d+/, formatInteger(peak.views))}.`,
    );
    if (a.seasonality.assessed && a.seasonality.detected) out.push('Interest follows a seasonal pattern that repeats every year.');
  }
  if (analyses.length > MAX_SERIES_FINDINGS) out.push('Other editions: see the table.');
  const missing = input.missing ?? [];
  if (missing.length > 0) out.push(`No data for: ${missing.map((m) => `${m.language} (${m.reason})`).join(', ')}.`);
  return out;
}

function seriesFinding(label: string, a: SeriesAnalysis, member: SeriesAssessment): string {
  const parts: string[] = [];
  const t = a.trend;
  if (a.summary.totalViews === 0) parts.push('no views reported');
  else if (!t.available) parts.push('period too short for a trend');
  else if (t.direction === 'no_significant_trend') parts.push('no clear trend');
  else parts.push(t.relativeChangePerYear === null ? t.direction : `${t.direction} (about ${formatSignedPercent(t.relativeChangePerYear)} per year)`);

  const yoy = a.yearOverYear;
  if (yoy.available && yoy.relativeChange !== null) {
    const spikes = member.claims.yearOverYear?.reasons.some((r) => r.startsWith('Largely driven by spike days')) ?? false;
    parts.push(`${formatSignedPercent(yoy.relativeChange)} year over year${spikes ? ' (mostly spike days)' : ''}`);
  }
  const shift = a.levelShift;
  if (shift.assessed && shift.detected) {
    const edition = editionShiftWithStep(a);
    parts.push(
      `abrupt change between ${shift.lastPeriodBefore} and ${shift.firstPeriodAfter}${edition === null ? '' : ` (the whole edition changed ${formatSignedPercent(edition)} then)`}`,
    );
  }
  return `${label}: ${parts.join('; ')}.`;
}

/** Replaces characters the embedded font cannot draw with "?" (with one warning). */
function sanitize(model: ReportModel): ReportModel {
  const bad = new Set<string>();
  const clean = (s: string): string => {
    const missing = missingGlyphs(s);
    if (missing.length === 0) return s;
    for (const ch of missing) bad.add(ch);
    return [...s].map((ch) => (missing.includes(ch) ? '?' : ch)).join('');
  };
  const result: ReportModel = {
    ...model,
    title: clean(model.title),
    subtitle: clean(model.subtitle),
    table: { header: model.table.header, rows: model.table.rows.map((r) => r.map(clean)) },
    findings: model.findings.map(clean),
    analystNote: model.analystNote === null ? null : clean(model.analystNote),
    confidence: { level: model.confidence.level, reasons: model.confidence.reasons.map(clean) },
    limitations: model.limitations.map(clean),
  };
  if (bad.size > 0) result.warnings = [...model.warnings, `Replaced characters the embedded font cannot draw with "?": ${[...bad].join(' ')}`];
  return result;
}
