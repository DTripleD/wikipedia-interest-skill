/**
 * Compact JSON for the agent: rounded numbers, percentages already multiplied by 100 (fields
 * ending in `Pct`), no raw series or long arrays. Everything is copied from the analysis and
 * confidence results; nothing is computed here except rounding and percent scaling.
 */
import type { SeriesAnalysis } from '../analysis/analyze.js';
import { seriesLabels } from '../analysis/compare.js';
import { editionShiftWithStep, type ClaimConfidence, type SeriesAssessment } from '../analysis/confidence.js';
import { formatPValue } from '../format.js';
import type { ReportModel } from '../reports/content.js';
import type { ResolveResult } from '../wikipedia/resolver.js';
import type { Analysis } from './pipeline.js';

/** Rounds to `digits` decimals (also turns −0 into 0). */
export function round(x: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f + 0;
}

const pct = (share: number | null): number | null => (share === null ? null : round(share * 100, 1));

/** Resolver notes name the library option `titles.<lang>`; the CLI flag is `--title <lang>=<title>`. */
export function cliNotes(notes: readonly string[]): string[] {
  return notes.map((n) => n.replace(/re-run with titles\.([a-z-]+) set to it/g, 're-run with --title $1=<title>'));
}

export function presentResolve(result: ResolveResult) {
  const { source } = result;
  return {
    topic: result.topic,
    source: {
      language: source.language,
      status: source.status,
      article: source.article,
      ...(source.notes.length ? { notes: cliNotes(source.notes) } : {}),
      ...(source.candidates.length ? { candidates: source.candidates.map((c) => ({ title: c.title, description: c.description })) } : {}),
    },
    languages: result.results.map((r) => ({
      language: r.language,
      status: r.status,
      article: r.article,
      confidence: r.confidence,
      method: r.method,
      ...(r.redirectedFrom ? { redirectedFrom: r.redirectedFrom } : {}),
      ...(r.notes.length ? { notes: cliNotes(r.notes) } : {}),
      ...(r.candidates.length ? { candidates: r.candidates.map((c) => ({ title: c.title, description: c.description })) } : {}),
    })),
  };
}

export function presentAnalysis(analysis: Analysis, model: ReportModel) {
  const { comparison, assessment } = analysis;
  const labels = seriesLabels(comparison.analyses);
  const perMillion = comparison.ranking.byViewsPerMillion;
  const ranking = perMillion ?? comparison.ranking.byTotalViews;

  return {
    topic: analysis.resolution.topic,
    sourceArticle: { language: analysis.resolution.source.language, title: analysis.resolution.source.article },
    period: comparison.period,
    rankedBy: perMillion ? 'views_per_million' : 'total_views',
    languages: ranking.map((row, rank) =>
      presentLanguage(labels[row.index]!, rank + 1, comparison.analyses[row.index]!, assessment.members[row.index]!, analysis.analyzed[row.index]!.resolution),
    ),
    ...(comparison.analyses.length > 1
      ? {
          comparison: {
            ranking: ranking.map((r) => ({
              language: labels[r.index],
              value: round(r.value, perMillion ? 2 : 0),
              relativeToLeaderPct: pct(r.relativeToLeader),
            })),
          },
        }
      : {}),
    missing: analysis.missing.map((m) => ({ language: m.language, status: m.status, reason: m.reason, ...(m.candidates.length ? { candidates: m.candidates } : {}) })),
    confidence: { level: model.confidence.level, reasons: model.confidence.reasons },
    findings: model.findings,
    limitations: model.limitations,
  };
}

function presentLanguage(label: string, rank: number, a: SeriesAnalysis, member: SeriesAssessment, resolution: Analysis['analyzed'][number]['resolution']) {
  const t = a.trend;
  const shift = a.levelShift;
  const edition = editionShiftWithStep(a);
  const top = a.outliers.outliers.filter((o) => o.direction === 'spike').reduce<(typeof a.outliers.outliers)[number] | null>((best, o) => (best === null || o.views > best.views ? o : best), null);
  return {
    rank,
    language: label,
    article: a.article?.replaceAll('_', ' ') ?? null,
    resolution: { confidence: resolution.confidence, method: resolution.method, ...(resolution.notes.length ? { notes: cliNotes(resolution.notes) } : {}) },
    totalViews: a.summary.totalViews,
    dailyMean: round(a.summary.dailyMean),
    dailyMedian: round(a.summary.dailyMedian),
    viewsPerMillion: a.normalization ? round(a.normalization.viewsPerMillion, 2) : null,
    peakDay: a.summary.peakDay,
    yoyChangePct: a.yearOverYear.available ? pct(a.yearOverYear.relativeChange) : null,
    yoyChangeExcludingSpikesPct: a.yearOverYear.available ? pct(a.yearOverYear.relativeChangeExcludingSpikes) : null,
    recent90ChangePct: a.recentVsPrevious.available ? pct(a.recentVsPrevious.relativeChange) : null,
    trend: t.available
      ? { direction: t.direction, perYearPct: pct(t.relativeChangePerYear), significance: formatPValue(t.mannKendall.pValue), basis: t.basis, periods: t.periods }
      : { direction: 'not_available', reason: t.reason },
    levelShift:
      shift.assessed && shift.detected
        ? {
            between: [shift.lastPeriodBefore, shift.firstPeriodAfter],
            fromPerDay: round(shift.medianBefore),
            toPerDay: round(shift.medianAfter),
            editionChangePct: pct(edition),
          }
        : null,
    seasonality: a.seasonality.assessed ? (a.seasonality.detected ? 'detected' : 'not_detected') : 'not_assessed',
    spikes: { outlierDays: a.outliers.count, excessViewsSharePct: pct(a.outliers.excessViewsShare), ...(top ? { largest: { date: top.date, views: top.views, typical: round(top.baseline) } } : {}) },
    imputedDays: a.coverage.imputedDays,
    confidence: {
      level: member.level,
      reasons: member.reasons,
      trend: claim(member.claims.trend),
      yearOverYear: claim(member.claims.yearOverYear),
      recentVsPrevious: claim(member.claims.recentVsPrevious),
    },
  };
}

function claim(c: ClaimConfidence | null) {
  return c === null ? null : c.reasons.length ? c : { level: c.level };
}
