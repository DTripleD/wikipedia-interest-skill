/**
 * Cross-language (or cross-article) comparison. All series are cut to their common
 * period first, so totals, changes and trends are computed over the same days.
 *
 * Raw totals mostly reflect edition size (pl.wikipedia had ~3× the views of cs.wikipedia
 * in January 2024; verified). Rank by views per million edition pageviews when the edition
 * totals are available for every series.
 */
import { sliceSeries, type PageviewSeries } from '../data/series.js';
import { analyzeSeries, type AnalysisOptions, type SeriesAnalysis } from './analyze.js';

export interface ComparisonInput {
  series: PageviewSeries;
  editionSeries?: PageviewSeries | null;
}

export interface RankRow {
  /** Position of this series in `analyses` (input order). */
  index: number;
  language: string;
  article: string | null;
  value: number;
  /** value / the leader's value (1 for the leader); null if the leader's value is 0. */
  relativeToLeader: number | null;
}

export interface LanguageComparison {
  period: { start: string; end: string; days: number };
  /** One analysis per input, in input order, over the common period. */
  analyses: SeriesAnalysis[];
  ranking: {
    byTotalViews: RankRow[];
    /** Null unless every series has edition totals. */
    byViewsPerMillion: RankRow[] | null;
  };
  warnings: string[];
}

export function compareLanguages(
  inputs: readonly ComparisonInput[],
  options: Omit<AnalysisOptions, 'editionSeries'> = {},
): LanguageComparison {
  if (inputs.length === 0) throw new RangeError('Nothing to compare.');
  const start = inputs.map((i) => i.series.start).reduce((a, b) => (a > b ? a : b));
  const end = inputs.map((i) => i.series.end).reduce((a, b) => (a < b ? a : b));
  if (start > end) throw new RangeError('The series have no period in common.');

  const warnings: string[] = [];
  for (const { series } of inputs) {
    if (series.start !== start || series.end !== end) {
      warnings.push(
        `${label(series)} covers ${series.start}..${series.end}; the comparison uses the common period ${start}..${end}.`,
      );
    }
  }

  const analyses = inputs.map(({ series, editionSeries }) =>
    analyzeSeries(sliceSeries(series, start, end), { ...options, editionSeries: editionSeries ?? null }),
  );

  const perMillion = analyses.every((a) => a.normalization !== null);
  return {
    period: { start, end, days: analyses[0]!.period.days },
    analyses,
    ranking: {
      byTotalViews: rank(analyses, (a) => a.summary.totalViews),
      byViewsPerMillion: perMillion ? rank(analyses, (a) => a.normalization!.viewsPerMillion) : null,
    },
    warnings,
  };
}

function rank(analyses: readonly SeriesAnalysis[], value: (a: SeriesAnalysis) => number): RankRow[] {
  const rows = analyses
    .map((a, index) => ({ index, language: a.language, article: a.article, value: value(a) }))
    .sort((x, y) => y.value - x.value || x.language.localeCompare(y.language));
  const leader = rows[0]!.value;
  return rows.map((r) => ({ ...r, relativeToLeader: leader === 0 ? null : r.value / leader }));
}

function label(series: PageviewSeries): string {
  return series.article === null ? series.project : `${series.project}/${series.article}`;
}
