/**
 * Evidence-based confidence model. It turns the deterministic analysis into a
 * high / medium / low level with human-readable reasons. There are no made-up percentages.
 *
 * Method:
 * 1. Each factor (period length, volume, coverage, outliers, consistency, level shift,
 *    resolution) is rated `ok`, `caution` or `weak` against the fixed thresholds in
 *    CONFIDENCE_THRESHOLDS. `info` factors (seasonality) describe the data without rating it.
 * 2. The data level is the weakest link: any `weak` → low, any `caution` → medium, else high.
 * 3. Each finding (trend, year-over-year, recent vs previous) gets its own level. It never
 *    exceeds the data level and has claim-specific caps (e.g. a level shift caps the trend).
 *
 * What this measures: how much the numbers can be trusted as a description of Wikipedia
 * attention. It says nothing about market demand; see DEMAND_CAVEAT.
 */
import type { ResolutionConfidence } from '../wikipedia/resolver.js';
import type { AnalyzedComparison, SeriesAnalysis } from './analyze.js';
import type { LanguageComparison } from './compare.js';
import { addDays } from '../dates.js';
import { SIGNIFICANCE_LEVEL } from './trends.js';

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type FactorStatus = 'ok' | 'caution' | 'weak' | 'info';
export type FactorId =
  | 'resolution'
  | 'period'
  | 'volume'
  | 'coverage'
  | 'outliers'
  | 'consistency'
  | 'level_shift'
  | 'seasonality'
  | 'normalization'
  | 'ranking_stability'
  | 'members';

export interface Factor {
  id: FactorId;
  status: FactorStatus;
  /** The measured value the status is based on (full precision), or null. */
  value: number | null;
  message: string;
}

export interface ClaimConfidence {
  level: ConfidenceLevel;
  reasons: string[];
}

/** The parts of a resolver result (LanguageResolution) the model uses. */
export interface ResolutionEvidence {
  confidence: ResolutionConfidence | null;
  notes: readonly string[];
}

export interface SeriesAssessment {
  language: string;
  article: string | null;
  /** Confidence in the data as a description of Wikipedia attention. */
  level: ConfidenceLevel;
  /** Messages of the factors that set the level (weak first). */
  reasons: string[];
  factors: Factor[];
  /** Per-finding confidence; null when the finding is not available (see the analysis for why). */
  claims: {
    trend: ClaimConfidence | null;
    yearOverYear: ClaimConfidence | null;
    recentVsPrevious: ClaimConfidence | null;
  };
  /** Must accompany every presentation of the results. */
  caveats: string[];
}

export interface RankingPair {
  /** Indexes into LanguageComparison.analyses. */
  higher: number;
  lower: number;
  /** Complete months in which `higher` was ahead (ties count ½). */
  monthsAhead: number;
  months: number;
  share: number;
}

export interface ComparisonAssessment {
  level: ConfidenceLevel;
  reasons: string[];
  factors: Factor[];
  /** The ranking the assessment is about. */
  basis: 'views_per_million' | 'total_views';
  /** Month-by-month stability of each adjacent pair in that ranking. */
  rankingPairs: RankingPair[];
  /** One assessment per analysis, in the same order. */
  members: SeriesAssessment[];
  caveats: string[];
}

export const CONFIDENCE_THRESHOLDS = {
  /** Days in the period. Below a year there is no year-over-year and seasonality is unknown. */
  period: { weakBelow: 90, cautionBelow: 365 },
  /** Median daily views. At a few views/day single events and random noise dominate. */
  volume: { weakBelow: 5, cautionBelow: 30 },
  /** Share of days filled with 0 because the API reported nothing. */
  coverage: { cautionAbove: 0.05, weakAbove: 0.2, lateStartDays: 30 },
  /** Share of all views that are the excess over baseline on spike days. */
  outliers: { cautionAbove: 0.1, weakAbove: 0.25 },
  /** Typical relative deviation of the trend periods from the Theil–Sen line (volatility.trendDeviation). */
  consistency: { cautionAbove: 0.2, weakAbove: 0.4 },
  /** Trend: high only if p < highBelowP on at least minPeriodsForHigh monthly periods. */
  trend: { highBelowP: 0.01, minPeriodsForHigh: 12 },
  /** A change is spike-driven if removing spikes flips its sign or halves it, by at least minGap. */
  spikes: { minGap: 0.1 },
  /** Share of complete months in which the higher-ranked series is ahead. */
  ranking: { okFrom: 0.9, cautionFrom: 0.7, minMonths: 3 },
} as const;

export const DEMAND_CAVEAT =
  'Wikipedia pageviews measure attention and information-seeking on Wikipedia. They are not a measure of market demand, purchase intent or willingness to pay, and must not be presented as proof of commercial demand.';

export const SERIES_CAVEATS: readonly string[] = [
  DEMAND_CAVEAT,
  'Counts cover one article in one language edition (human traffic, agent=user). Views of redirects, related articles and other languages are not included, and automated-traffic filtering is imperfect.',
];

export const COMPARISON_CAVEATS: readonly string[] = [
  ...SERIES_CAVEATS,
  'Differences between editions also reflect how well each edition covers the topic, the article’s quality and search visibility, and how many speakers read Wikipedia in another language (often English). Views per million remove edition size, not these effects.',
];

const T = CONFIDENCE_THRESHOLDS;
const LEVEL_RANK: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };

// ---------------------------------------------------------------------------
// Single series
// ---------------------------------------------------------------------------

export function assessSeries(analysis: SeriesAnalysis, resolution?: ResolutionEvidence | null): SeriesAssessment {
  const factors: Factor[] = [];
  if (resolution) factors.push(resolutionFactor(resolution));
  factors.push(
    periodFactor(analysis),
    volumeFactor(analysis),
    coverageFactor(analysis),
    outliersFactor(analysis),
    consistencyFactor(analysis),
    levelShiftFactor(analysis),
    seasonalityFactor(analysis),
  );
  const { level, reasons } = weakestLink(factors);
  return {
    language: analysis.language,
    article: analysis.article,
    level,
    reasons,
    factors,
    claims: {
      trend: trendClaim(analysis, level),
      yearOverYear: changeClaim(analysis.yearOverYear, level, []),
      recentVsPrevious: changeClaim(analysis.recentVsPrevious, level, recentCaps(analysis)),
    },
    caveats: [...SERIES_CAVEATS],
  };
}

function resolutionFactor(resolution: ResolutionEvidence): Factor {
  if (resolution.confidence === 'high') {
    return { id: 'resolution', status: 'ok', value: null, message: 'The article was matched to the topic with high confidence.' };
  }
  if (resolution.confidence === 'medium') {
    const why = resolution.notes.length > 0 ? ` ${resolution.notes.join(' ')}` : '';
    return { id: 'resolution', status: 'caution', value: null, message: `The article matches the topic only partly or indirectly.${why}` };
  }
  return { id: 'resolution', status: 'weak', value: null, message: 'The topic was not resolved to a single article.' };
}

function periodFactor(a: SeriesAnalysis): Factor {
  const days = a.period.days;
  if (days < T.period.weakBelow) {
    return { id: 'period', status: 'weak', value: days, message: `Only ${days} days of data: too short for a reliable trend or period comparisons.` };
  }
  if (days < T.period.cautionBelow) {
    return {
      id: 'period',
      status: 'caution',
      value: days,
      message: `${days} days of data: less than a year, so there is no year-over-year comparison and seasonal effects cannot be separated from the trend.`,
    };
  }
  return { id: 'period', status: 'ok', value: days, message: `${days} days of data.` };
}

function volumeFactor(a: SeriesAnalysis): Factor {
  const m = a.summary.dailyMedian;
  const base = `Median of ${fmt(m)} views/day`;
  if (m < T.volume.weakBelow) {
    return { id: 'volume', status: 'weak', value: m, message: `${base}: very low traffic, so single events and random noise dominate the numbers.` };
  }
  if (m < T.volume.cautionBelow) {
    return { id: 'volume', status: 'caution', value: m, message: `${base}: low traffic, so single events and random noise move the numbers noticeably.` };
  }
  return { id: 'volume', status: 'ok', value: m, message: `${base}.` };
}

function coverageFactor(a: SeriesAnalysis): Factor {
  const c = a.coverage;
  if (c.firstReportedDate === null) {
    return { id: 'coverage', status: 'weak', value: 1, message: 'The API reported no views at all for this period.' };
  }
  const share = c.imputedShare;
  const base = `${c.imputedDays} of ${c.expectedDays} days (${pct(share)}) had no data and were counted as 0 views`;
  let status: FactorStatus = share > T.coverage.weakAbove ? 'weak' : share > T.coverage.cautionAbove ? 'caution' : 'ok';
  let message = c.imputedDays === 0 ? 'Every day in the period has data.' : `${base}.`;
  if (c.firstReportedDate > addDays(a.period.start, T.coverage.lateStartDays)) {
    if (status === 'ok') status = 'caution';
    message = `${base}. The first reported day is ${c.firstReportedDate}: the article may have been created (or renamed) during the period, so early zeros are not real disinterest.`;
  }
  return { id: 'coverage', status, value: share, message };
}

function outliersFactor(a: SeriesAnalysis): Factor {
  const o = a.outliers;
  const share = o.excessViewsShare;
  if (o.count === 0) return { id: 'outliers', status: 'ok', value: share, message: 'No outlier days.' };
  const top = o.outliers.reduce((best, x) => (x.robustZ > best.robustZ ? x : best));
  const biggest = top.direction === 'spike' ? ` The largest spike is ${top.date} (${top.views} views vs a typical ${fmt(top.baseline)}).` : '';
  const base = `${o.count} outlier day(s); spikes account for ${pct(share)} of all views.${biggest}`;
  if (share > T.outliers.weakAbove) {
    return { id: 'outliers', status: 'weak', value: share, message: `${base} Totals are dominated by short bursts (news, media, bots), not steady interest.` };
  }
  if (share > T.outliers.cautionAbove) {
    return { id: 'outliers', status: 'caution', value: share, message: `${base} Short bursts noticeably inflate the totals.` };
  }
  return { id: 'outliers', status: 'ok', value: share, message: base };
}

function consistencyFactor(a: SeriesAnalysis): Factor {
  // After a step, a straight line fits badly by construction; measure against the step instead.
  const step = a.levelShift.assessed && a.levelShift.detected;
  const cv = step && a.levelShift.assessed ? a.levelShift.stepDeviation : a.volatility.trendDeviation;
  if (cv === null || !a.trend.available) {
    return { id: 'consistency', status: 'info', value: null, message: 'Consistency over time was not assessed (no trend estimate).' };
  }
  const unit = a.trend.basis === 'monthly' ? 'month' : 'week';
  const base = `A typical ${unit} deviates by ${pct(cv)} from ${step ? 'the levels before and after the step' : 'the trend line'}`;
  if (cv > T.consistency.weakAbove) return { id: 'consistency', status: 'weak', value: cv, message: `${base}: very irregular interest.` };
  if (cv > T.consistency.cautionAbove) return { id: 'consistency', status: 'caution', value: cv, message: `${base}: fairly irregular interest.` };
  return { id: 'consistency', status: 'ok', value: cv, message: `${base}.` };
}

function levelShiftFactor(a: SeriesAnalysis): Factor {
  const s = a.levelShift;
  if (!s.assessed) return { id: 'level_shift', status: 'info', value: null, message: `Level shifts were not assessed. ${s.reason}` };
  if (!s.detected) return { id: 'level_shift', status: 'ok', value: s.pValue, message: 'No abrupt level shift detected.' };
  return { id: 'level_shift', status: 'caution', value: s.pValue, message: levelShiftText(a) };
}

function levelShiftText(a: SeriesAnalysis): string {
  const s = a.levelShift;
  if (!s.assessed) return '';
  return `Interest changed abruptly between ${s.lastPeriodBefore} and ${s.firstPeriodAfter} (≈ ${fmt(s.medianBefore)} → ${fmt(s.medianAfter)} views/day, Pettitt ${pValue(s.pValue)}); this looks like a one-time step, not a gradual trend.${editionShiftText(a)} Check for a cause (article rename or merge, search-engine or Wikipedia changes, news) before reading it as a change in interest.`;
}

/** A note when the whole edition shifted within one period of the article's step. */
function editionShiftText(a: SeriesAnalysis): string {
  const s = a.levelShift;
  const e = a.editionLevelShift;
  if (!s.assessed || !e?.assessed || e.pValue >= SIGNIFICANCE_LEVEL || e.medianBefore === 0 || !a.trend.available) return '';
  const labels = a.trend.periodLabels;
  if (Math.abs(labels.indexOf(e.firstPeriodAfter) - labels.indexOf(s.firstPeriodAfter)) > 1) return '';
  return ` The whole ${a.language} edition also shifted then (${signedPct(e.medianAfter / e.medianBefore - 1)} total views), so part of this change is edition-wide rather than topic-specific; compare views per million.`;
}

function seasonalityFactor(a: SeriesAnalysis): Factor {
  const s = a.seasonality;
  if (!s.assessed) return { id: 'seasonality', status: 'info', value: null, message: `Seasonality was not assessed. ${s.reason}` };
  const r = s.correlation === null ? 'n/a' : s.correlation.toFixed(2);
  return {
    id: 'seasonality',
    status: 'info',
    value: s.correlation,
    message: s.detected
      ? `A seasonal pattern repeats from year to year (correlation of months 12 apart: ${r}).`
      : `No clear yearly seasonal pattern (correlation of months 12 apart: ${r}).`,
  };
}

function trendClaim(a: SeriesAnalysis, dataLevel: ConfidenceLevel): ClaimConfidence | null {
  const t = a.trend;
  if (!t.available) return null;
  const p = t.mannKendall.pValue;
  let level: ConfidenceLevel;
  const reasons: string[] = [];
  if (t.direction === 'no_significant_trend') {
    level = 'medium';
    reasons.push(`No statistically significant trend (Mann–Kendall ${pValue(p)}); this means no clear direction, not proof that interest is stable.`);
  } else {
    level = p < T.trend.highBelowP ? 'high' : 'medium';
    reasons.push(`The ${t.direction === 'increasing' ? 'increase' : 'decrease'} is statistically significant (Mann–Kendall ${pValue(p)}, ${t.periods} ${t.basis === 'monthly' ? 'months' : 'weeks'}).`);
  }
  if (t.basis === 'weekly') {
    level = cap(level, 'medium');
    reasons.push('Based on weekly averages over a short period; weekly values are strongly autocorrelated, so the test is optimistic.');
  } else if (t.periods < T.trend.minPeriodsForHigh) {
    level = cap(level, 'medium');
    reasons.push(`Only ${t.periods} complete months.`);
  }
  if (a.levelShift.assessed && a.levelShift.detected) {
    level = cap(level, 'medium');
    reasons.push(
      `The change looks like a one-time step between ${a.levelShift.lastPeriodBefore} and ${a.levelShift.firstPeriodAfter}, not a gradual trend (see the level_shift factor).`,
    );
  }
  return capByData({ level, reasons }, dataLevel);
}

function recentCaps(a: SeriesAnalysis): Array<{ level: ConfidenceLevel; reason: string }> {
  if (!a.seasonality.assessed) {
    return [{ level: 'medium', reason: 'The two windows fall in different seasons and seasonality could not be checked; prefer the year-over-year change.' }];
  }
  if (a.seasonality.detected) {
    return [{ level: 'medium', reason: 'Interest is seasonal and the two windows fall in different seasons; prefer the year-over-year change.' }];
  }
  return [];
}

function changeClaim(
  c: AnalyzedComparison,
  dataLevel: ConfidenceLevel,
  caps: ReadonlyArray<{ level: ConfidenceLevel; reason: string }>,
): ClaimConfidence | null {
  if (!c.available) return null;
  let level: ConfidenceLevel = 'high';
  const reasons: string[] = [];
  const raw = c.relativeChange;
  const adjusted = c.relativeChangeExcludingSpikes;
  if (raw !== null && adjusted !== null && Math.abs(raw - adjusted) >= T.spikes.minGap) {
    if (Math.sign(raw) !== Math.sign(adjusted) || Math.abs(adjusted) < Math.abs(raw) / 2) {
      level = cap(level, 'medium');
      reasons.push(`Largely driven by spike days: ${signedPct(raw)} overall, ${signedPct(adjusted)} without them.`);
    }
  }
  for (const limit of caps) {
    level = cap(level, limit.level);
    reasons.push(limit.reason);
  }
  return capByData({ level, reasons }, dataLevel);
}

// ---------------------------------------------------------------------------
// Comparison of several series
// ---------------------------------------------------------------------------

export function assessComparison(
  comparison: LanguageComparison,
  resolutions: ReadonlyArray<ResolutionEvidence | null | undefined> = [],
): ComparisonAssessment {
  const analyses = comparison.analyses;
  const members = analyses.map((a, i) => assessSeries(a, resolutions[i]));
  const perMillion = comparison.ranking.byViewsPerMillion;
  const basis = perMillion ? 'views_per_million' : 'total_views';
  const ranking = perMillion ?? comparison.ranking.byTotalViews;
  const name = (i: number): string => label(analyses, i);

  const factors: Factor[] = [
    perMillion
      ? { id: 'normalization', status: 'ok', value: null, message: 'Ranked by views per million edition pageviews, which removes the effect of edition size.' }
      : {
          id: 'normalization',
          status: 'caution',
          value: null,
          message: 'Ranked by raw view totals, which largely reflect how big each edition is; edition totals were not available for every series.',
        },
  ];

  const completeMonths = analyses[0]!.monthly.map((m, k) => ({ m, k })).filter(({ m }) => m.complete).map(({ k }) => k);
  const monthValue = (i: number, k: number): number => {
    const row = analyses[i]!.monthly[k]!;
    return basis === 'views_per_million' ? (row.viewsPerMillion ?? 0) : row.dailyAverage;
  };
  const rankingPairs: RankingPair[] = [];
  if (analyses.length < 2) {
    factors.push({ id: 'ranking_stability', status: 'info', value: null, message: 'Only one series: there is no ranking to assess.' });
  } else if (completeMonths.length < T.ranking.minMonths) {
    factors.push({
      id: 'ranking_stability',
      status: 'info',
      value: null,
      message: `Ranking stability was not assessed: it needs at least ${T.ranking.minMonths} complete months; the period has ${completeMonths.length}.`,
    });
  } else {
    for (let r = 0; r + 1 < ranking.length; r++) {
      const higher = ranking[r]!.index;
      const lower = ranking[r + 1]!.index;
      let ahead = 0;
      for (const k of completeMonths) {
        const diff = monthValue(higher, k) - monthValue(lower, k);
        ahead += diff > 0 ? 1 : diff === 0 ? 0.5 : 0;
      }
      rankingPairs.push({ higher, lower, monthsAhead: ahead, months: completeMonths.length, share: ahead / completeMonths.length });
    }
    const worst = rankingPairs.reduce((w, p) => (p.share < w.share ? p : w));
    const status: FactorStatus = worst.share >= T.ranking.okFrom ? 'ok' : worst.share >= T.ranking.cautionFrom ? 'caution' : 'weak';
    const describe = (p: RankingPair): string => `${name(p.higher)} is ahead of ${name(p.lower)} in ${fmt(p.monthsAhead)} of ${p.months} complete months`;
    const unstable = rankingPairs.filter((p) => p.share < T.ranking.okFrom);
    factors.push({
      id: 'ranking_stability',
      status,
      value: worst.share,
      message:
        unstable.length === 0
          ? `The ranking holds month by month: ${rankingPairs.map(describe).join('; ')}.`
          : `The ranking is not stable month by month: ${unstable.map(describe).join('; ')}. Treat these positions as roughly equal.`,
    });
  }

  const weakMembers = members.map((m, i) => ({ m, i })).filter(({ m }) => m.level !== 'high');
  const worstMember = members.reduce((w, m) => (LEVEL_RANK[m.level] < LEVEL_RANK[w] ? m.level : w), 'high' as ConfidenceLevel);
  factors.push({
    id: 'members',
    status: worstMember === 'low' ? 'weak' : worstMember === 'medium' ? 'caution' : 'ok',
    value: null,
    message:
      weakMembers.length === 0
        ? 'Every series has high data confidence.'
        : `Data confidence per series: ${weakMembers.map(({ m, i }) => `${name(i)} ${m.level}`).join(', ')} (see members).`,
  });

  const { level, reasons } = weakestLink(factors);
  return { level, reasons, factors, basis, rankingPairs, members, caveats: [...COMPARISON_CAVEATS] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function weakestLink(factors: readonly Factor[]): { level: ConfidenceLevel; reasons: string[] } {
  const weak = factors.filter((f) => f.status === 'weak').map((f) => f.message);
  const caution = factors.filter((f) => f.status === 'caution').map((f) => f.message);
  if (weak.length > 0) return { level: 'low', reasons: [...weak, ...caution] };
  if (caution.length > 0) return { level: 'medium', reasons: caution };
  return { level: 'high', reasons: ['All data-quality checks passed.'] };
}

function cap(level: ConfidenceLevel, max: ConfidenceLevel): ConfidenceLevel {
  return LEVEL_RANK[level] <= LEVEL_RANK[max] ? level : max;
}

function capByData(claim: ClaimConfidence, dataLevel: ConfidenceLevel): ClaimConfidence {
  if (LEVEL_RANK[claim.level] <= LEVEL_RANK[dataLevel]) return claim;
  return { level: dataLevel, reasons: [...claim.reasons, `Limited by the ${dataLevel} data confidence (see reasons).`] };
}

function label(analyses: readonly SeriesAnalysis[], i: number): string {
  const a = analyses[i]!;
  const sameLanguage = analyses.filter((x) => x.language === a.language).length > 1;
  return sameLanguage && a.article !== null ? `${a.language}:${a.article.replaceAll('_', ' ')}` : a.language;
}

/** 1234.5 → "1235", 9.25 → "9.3", 0.5 → "0.5". */
function fmt(x: number): string {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function signedPct(change: number): string {
  const v = Math.round(change * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function pValue(p: number): string {
  return p < 0.001 ? 'p < 0.001' : `p = ${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`;
}
