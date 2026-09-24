/**
 * The work behind the commands: resolve the topic, fetch daily and edition-wide pageviews
 * (cached), analyze, compare and assess. Commands only format the result.
 */
import { compareLanguages, type ComparisonInput, type LanguageComparison } from '../analysis/compare.js';
import { assessComparison, type ComparisonAssessment } from '../analysis/confidence.js';
import { DEFAULT_CONTACT, getContact, getUserAgent } from '../config.js';
import { openCache, type JsonCache } from '../data/cache.js';
import { getDailySeries, getEditionDailySeries } from '../data/pageviews.js';
import type { PageviewSeries } from '../data/series.js';
import type { MissingEdition } from '../reports/content.js';
import type { HttpOptions } from '../wikipedia/http.js';
import { toEdition } from '../wikipedia/languages.js';
import { resolveTopic, type LanguageResolution, type ResolveResult } from '../wikipedia/resolver.js';
import { CliError, type AnalysisArgs, type TopicArgs } from './args.js';

/** Everything with side effects, injectable for tests. */
export interface CliDeps {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Cache to use; undefined opens the default file cache (WIKI_SKILL_CACHE_DIR), null disables it. */
  cache?: JsonCache | null;
  sleep?: (ms: number) => Promise<void>;
  /** Directory for charts and reports; default <project>/output. */
  outDir?: string;
}

export interface Context {
  http: HttpOptions & { cache: JsonCache | null };
  now: Date;
  /** HTTP requests sent to Wikimedia (every attempt, including retries). */
  requests: () => number;
  warnings: string[];
}

export function makeContext(deps: CliDeps, noCache: boolean): Context {
  const env = deps.env ?? process.env;
  const baseFetch = deps.fetch ?? globalThis.fetch;
  let requests = 0;
  const counted: typeof fetch = (input, init) => {
    requests++;
    return baseFetch(input, init);
  };
  const warnings: string[] = [];
  if (getContact(env) === DEFAULT_CONTACT) {
    warnings.push('WIKI_SKILL_CONTACT is not set: Wikimedia may rate-limit this client (HTTP 429). Set it to an email address or URL.');
  }
  const now = (deps.now ?? (() => new Date()))();
  return {
    http: {
      fetch: counted,
      userAgent: getUserAgent(env),
      now: () => now,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      cache: noCache ? null : deps.cache !== undefined ? deps.cache : openCache(env),
    },
    now,
    requests: () => requests,
    warnings,
  };
}

export function resolve(ctx: Context, args: TopicArgs): Promise<ResolveResult> {
  return resolveTopic({ topic: args.topic, languages: args.languages, sourceLanguage: args.sourceLanguage, titles: args.titles }, ctx.http);
}

export interface AnalyzedLanguage {
  resolution: LanguageResolution;
  series: PageviewSeries;
  editionSeries: PageviewSeries;
}

export interface Analysis {
  resolution: ResolveResult;
  /** In input (language) order; matches comparison.analyses and assessment.members. */
  analyzed: AnalyzedLanguage[];
  missing: Array<MissingEdition & { status: LanguageResolution['status']; candidates: string[] }>;
  comparison: LanguageComparison;
  assessment: ComparisonAssessment;
}

export async function analyze(ctx: Context, args: AnalysisArgs): Promise<Analysis> {
  const resolution = await resolve(ctx, args);
  const resolved = resolution.results.filter((r) => r.status === 'resolved' && r.article !== null);
  const missing = resolution.results
    .filter((r) => !resolved.includes(r))
    .map((r) => ({ language: r.language, status: r.status, reason: missingReason(r, args.titles), candidates: r.candidates.map((c) => c.title) }));

  if (resolved.length === 0) throw unresolvedError(resolution, missing);

  const analyzed: AnalyzedLanguage[] = [];
  for (const r of resolved) {
    const range = { language: r.language, start: args.start, end: args.end };
    const { series } = await getDailySeries({ ...range, article: r.article! }, ctx.http);
    const { series: editionSeries } = await getEditionDailySeries(range, ctx.http);
    analyzed.push({ resolution: r, series, editionSeries });
  }

  const inputs: ComparisonInput[] = analyzed.map((a) => ({ series: a.series, editionSeries: a.editionSeries }));
  const comparison = compareLanguages(inputs);
  const assessment = assessComparison(
    comparison,
    analyzed.map((a) => ({ confidence: a.resolution.confidence, notes: a.resolution.notes })),
  );
  return { resolution, analyzed, missing, comparison, assessment };
}

function missingReason(r: LanguageResolution, titles: Record<string, string>): string {
  switch (r.status) {
    case 'language_unavailable':
      return 'edition does not exist';
    case 'ambiguous':
      return 'the title is a disambiguation page';
    default: {
      const explicit = Object.entries(titles).find(([lang]) => toEdition(lang) === r.language)?.[1];
      return explicit ? `no article titled "${explicit}"` : 'no article linked to the topic';
    }
  }
}

function unresolvedError(resolution: ResolveResult, missing: Analysis['missing']): CliError {
  const { source } = resolution;
  const candidates = source.candidates.map((c) => ({ title: c.title, description: c.description }));
  if (source.status === 'ambiguous') {
    return new CliError(
      'TOPIC_AMBIGUOUS',
      `"${source.article ?? resolution.topic}" on ${source.language}.wikipedia is a disambiguation page. Ask the user which meaning they want, then re-run with that article title as --topic.`,
      { candidates },
    );
  }
  if (source.status === 'not_found') {
    return new CliError(
      'TOPIC_NOT_FOUND',
      `No ${source.language}.wikipedia article matches "${resolution.topic}". If the topic is written in another language, re-run with --source <that language code> (e.g. --source uk) or give the topic as a ${source.language}.wikipedia title. Otherwise ask the user to confirm one of the candidates (search results, not verified) and re-run with it as --topic.`,
      { candidates },
    );
  }
  return new CliError(
    'NO_ARTICLES',
    `"${source.article}" has no article in any requested edition. Report this to the user; if they know a title, re-run with --title <language>=<title>.`,
    { missing },
  );
}
