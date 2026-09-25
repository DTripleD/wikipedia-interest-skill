/**
 * Resolves a human-readable topic to Wikipedia articles in one or more language editions.
 *
 * Strategy (see docs/wikimedia-api.md, "MediaWiki Action API"):
 * 1. Anchor: look the topic up as a title in the *source* edition (default `en`), following
 *    redirects and reading its Wikidata item, disambiguation flag and interlanguage links.
 *    - If the topic is missing or lands on a disambiguation page, the source is unresolved:
 *      full-text search candidates are returned and NOTHING is auto-selected. The one
 *      exception is a search result whose title differs from the topic only in letter case
 *      ("Intermittent Fasting" → "Intermittent fasting"): that is the same title, so it is used.
 *      When search finds nothing, MediaWiki's spelling suggestion is searched once (typos).
 * 2. Targets: for each target edition, follow the anchor's interlanguage link (these come
 *    from Wikidata sitelinks, so they point to the same concept), then verify the linked
 *    page in the target wiki (canonical title, redirect, disambiguation).
 *    - No link → `not_found` (no search: foreign-language search results are noise).
 * 3. Explicit titles supplied by the caller override step 2 for that edition. They are
 *    verified in the target wiki; a missing explicit title gets search candidates there.
 *
 * The resolver never picks a search result on its own: search in a foreign-language wiki
 * returns mostly unrelated pages (verified), so such results are only "candidates".
 * Titles returned in `article` are canonical (redirect targets), because the Pageviews API
 * counts views of redirect titles separately from the target article.
 *
 * With `options.cache`, successful Action API responses are cached for RESOLVER_CACHE_TTL_MS
 * (keyed by request URL). The Action API has the tightest rate limit, so repeated
 * analyses of the same topic should not hit it again. Errors are never cached.
 */
import { isFresh, type JsonCache } from '../data/cache.js';
import { WikimediaApiError, readJson, requestWithRetry, type HttpOptions } from './http.js';
import { actionApiUrl, toEdition } from './languages.js';

export interface ResolveRequest {
  /** Human-readable topic, written in `sourceLanguage`, e.g. "intermittent fasting". */
  topic: string;
  /** Target language codes or edition subdomains, e.g. ["pl", "cs"]. */
  languages: readonly string[];
  /** Language the topic is written in. Default "en". */
  sourceLanguage?: string;
  /** Explicit article titles per language (e.g. given by the user); bypass interlanguage links. */
  titles?: Readonly<Record<string, string>>;
  /** Max candidates listed for ambiguous/not-found results. Default 5. */
  maxCandidates?: number;
}

export type ResolutionStatus = 'resolved' | 'ambiguous' | 'not_found' | 'language_unavailable';
export type ResolutionMethod = 'explicit_title' | 'source_article' | 'interlanguage_link';
/** `high`: exact title, curated redirect, Wikidata-backed link or explicit title. `medium`: see notes. */
export type ResolutionConfidence = 'high' | 'medium';

export interface Candidate {
  title: string;
  wikidataId: string | null;
  description: string | null;
}

export interface LanguageResolution {
  /** Edition subdomain, e.g. "pl" (note: "nb" is normalized to "no"). */
  language: string;
  /** Pageviews API project id, e.g. "pl.wikipedia". */
  project: string;
  status: ResolutionStatus;
  /** Canonical article title; set only when status is "resolved". */
  article: string | null;
  wikidataId: string | null;
  confidence: ResolutionConfidence | null;
  method: ResolutionMethod | null;
  /** Original title if a redirect was followed. */
  redirectedFrom: string | null;
  /** Human-readable explanations; always read these. */
  notes: string[];
  /** Unverified alternatives for "ambiguous" / "not_found". Never auto-select. */
  candidates: Candidate[];
}

export interface SourceResolution {
  language: string;
  status: 'found' | 'ambiguous' | 'not_found';
  article: string | null;
  wikidataId: string | null;
  confidence: ResolutionConfidence | null;
  redirectedFrom: string | null;
  notes: string[];
  candidates: Candidate[];
}

export interface ResolveResult {
  topic: string;
  source: SourceResolution;
  results: LanguageResolution[];
}

export interface ResolverOptions extends HttpOptions {
  /** Cache for Action API responses; null or omitted disables caching. */
  cache?: JsonCache | null;
}

/** Titles, redirects and interlanguage links change rarely: 7 days. */
export const RESOLVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_NAMESPACE = 'mediawiki';

const SERVICE = 'MediaWiki API';
const MAX_TOPIC_LENGTH = 255;
const MAX_LANGUAGES = 20;
const SEARCH_NOTE = 'Candidates come from full-text search and are NOT verified to be the same topic; confirm with the user before using one.';

/** Result of looking up one title in one edition. */
interface PageInfo {
  title: string;
  exists: boolean;
  invalidReason: string | null;
  namespace: number | null;
  isDisambiguation: boolean;
  wikidataId: string | null;
  description: string | null;
  redirectedFrom: string | null;
  redirectFragment: string | null;
  langlinks: Array<{ lang: string; title: string }>;
}

export async function resolveTopic(request: ResolveRequest, options: ResolverOptions = {}): Promise<ResolveResult> {
  const { topic, sourceEdition, targets, titles, maxCandidates } = validateRequest(request);
  const ctx: Ctx = { options, maxCandidates };

  let sourcePage: PageInfo;
  try {
    sourcePage = await lookupTitle(ctx, sourceEdition, topic, true);
  } catch (err) {
    if (err instanceof WikimediaApiError && err.code === 'HOST_NOT_FOUND') {
      throw new WikimediaApiError('INVALID_INPUT', `Source language "${sourceEdition}" has no Wikipedia edition (${sourceEdition}.wikipedia.org does not exist).`);
    }
    throw err;
  }
  // A title that differs only in letter case ("Intermittent Fasting") is the same article, not an
  // ambiguity: MediaWiki titles are case-sensitive after the first letter, so look it up via search.
  let searchResults: Candidate[] | undefined;
  let caseNote: string | null = null;
  if (!sourcePage.exists && sourcePage.invalidReason === null) {
    searchResults = await search(ctx, sourceEdition, topic);
    const match = searchResults.find((c) => sameTitleIgnoringCase(c.title, topic));
    if (match) {
      const page = await lookupTitle(ctx, sourceEdition, match.title, true);
      if (page.exists && page.namespace === 0) {
        caseNote = `No article is titled exactly "${topic}" on ${sourceEdition}.wikipedia; using "${page.title}", which differs only in letter case.`;
        sourcePage = page;
      }
    }
  }
  const source = await resolveSource(ctx, sourceEdition, topic, sourcePage, searchResults);
  if (caseNote) source.notes.unshift(caseNote);

  const results: LanguageResolution[] = [];
  for (const edition of targets) {
    try {
      results.push(await resolveTarget(ctx, edition, titles[edition], source, sourcePage));
    } catch (err) {
      if (err instanceof WikimediaApiError && err.code === 'HOST_NOT_FOUND') {
        results.push({
          ...emptyResolution(edition, 'language_unavailable'),
          notes: [`There is no "${edition}" Wikipedia edition (${edition}.wikipedia.org does not exist).`],
        });
        continue;
      }
      throw err;
    }
  }

  return { topic, source, results };
}

interface Ctx {
  options: ResolverOptions;
  maxCandidates: number;
}

function validateRequest(request: ResolveRequest) {
  const invalid = (msg: string) => new WikimediaApiError('INVALID_INPUT', msg);
  const topic = request.topic.trim().replace(/\s+/g, ' ');
  if (topic.length === 0) throw invalid('Topic must not be empty.');
  if (topic.length > MAX_TOPIC_LENGTH) throw invalid(`Topic is longer than ${MAX_TOPIC_LENGTH} characters.`);

  const sourceEdition = toEdition(request.sourceLanguage ?? 'en');
  const targets = [...new Set(request.languages.map(toEdition))];
  if (targets.length === 0) throw invalid('At least one target language is required.');
  if (targets.length > MAX_LANGUAGES) throw invalid(`At most ${MAX_LANGUAGES} languages can be resolved at once.`);

  const titles: Record<string, string> = {};
  for (const [lang, title] of Object.entries(request.titles ?? {})) {
    const edition = toEdition(lang);
    if (!targets.includes(edition)) throw invalid(`Explicit title given for "${lang}", which is not among the target languages.`);
    if (title.trim().length === 0) throw invalid(`Explicit title for "${lang}" is empty.`);
    titles[edition] = title.trim();
  }

  const maxCandidates = request.maxCandidates ?? 5;
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 20) {
    throw invalid('maxCandidates must be an integer between 1 and 20.');
  }
  return { topic, sourceEdition, targets, titles, maxCandidates };
}

/** Title equality ignoring letter case and "_" vs " " (MediaWiki treats underscores as spaces). */
function sameTitleIgnoringCase(a: string, b: string): boolean {
  const norm = (t: string) => t.replaceAll('_', ' ').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  return norm(a) === norm(b);
}

async function resolveSource(ctx: Ctx, edition: string, topic: string, page: PageInfo, searchResults?: Candidate[]): Promise<SourceResolution> {
  const base: SourceResolution = {
    language: edition,
    status: 'not_found',
    article: null,
    wikidataId: null,
    confidence: null,
    redirectedFrom: null,
    notes: [],
    candidates: [],
  };
  const retry = `Re-run with one of the candidate titles as the topic, or ask the user which one they mean.`;

  const problem = pageProblem(page, edition);
  if (problem) {
    return {
      ...base,
      notes: [problem, SEARCH_NOTE, retry],
      candidates: searchResults ?? (await search(ctx, edition, topic)),
    };
  }
  if (page.isDisambiguation) {
    return {
      ...base,
      status: 'ambiguous',
      notes: [`"${page.title}" on ${edition}.wikipedia is a disambiguation page: the topic has several meanings.`, retry],
      candidates: (await search(ctx, edition, topic)).filter((c) => c.title !== page.title),
    };
  }

  const notes = redirectNotes(page, edition);
  if (!page.wikidataId) notes.push('The source article has no Wikidata item, so no interlanguage links can be followed.');
  return {
    ...base,
    status: 'found',
    article: page.title,
    wikidataId: page.wikidataId,
    confidence: page.redirectFragment ? 'medium' : 'high',
    redirectedFrom: page.redirectedFrom,
    notes,
  };
}

async function resolveTarget(
  ctx: Ctx,
  edition: string,
  explicitTitle: string | undefined,
  source: SourceResolution,
  sourcePage: PageInfo,
): Promise<LanguageResolution> {
  if (explicitTitle !== undefined) {
    const page = await lookupTitle(ctx, edition, explicitTitle, false);
    const result = await evaluatePage(ctx, edition, page, 'explicit_title', 'high', explicitTitle);
    if (result.status === 'resolved' && source.wikidataId && result.wikidataId !== source.wikidataId) {
      result.confidence = 'medium';
      result.notes.push(
        result.wikidataId
          ? `This article's Wikidata item (${result.wikidataId}) differs from the source article's (${source.wikidataId}): it is a different (possibly related) concept.`
          : `This article has no Wikidata item, so it cannot be confirmed to match the source article (${source.wikidataId}).`,
      );
    }
    return result;
  }

  if (source.status !== 'found' || source.article === null || source.confidence === null) {
    return {
      ...emptyResolution(edition, source.status === 'ambiguous' ? 'ambiguous' : 'not_found'),
      notes: [`Not attempted: the topic could not be matched to a single ${source.language}.wikipedia article. See source.candidates.`],
    };
  }

  if (edition === source.language) {
    return {
      ...emptyResolution(edition, 'resolved'),
      article: source.article,
      wikidataId: source.wikidataId,
      confidence: source.confidence,
      method: 'source_article',
      redirectedFrom: source.redirectedFrom,
      notes: [...source.notes],
    };
  }

  const link = sourcePage.langlinks.find((l) => safeEdition(l.lang) === edition);
  if (!link) {
    // No search here: searching a foreign-language wiki with the source-language topic
    // returns mostly unrelated pages (verified), which is noise for the agent.
    // A cheap siteinfo call still confirms the edition exists (throws HOST_NOT_FOUND otherwise).
    await callApi(ctx, edition, { meta: 'siteinfo', siprop: 'general' });
    const qid = source.wikidataId ? ` (${source.wikidataId})` : '';
    return {
      ...emptyResolution(edition, 'not_found'),
      notes: [
        `No ${edition}.wikipedia article is linked to "${source.article}"${qid}: the topic most likely has no dedicated article in this edition.`,
        `If the article exists under a known ${edition} title, re-run with titles.${edition} set to it; otherwise report that this edition has no dedicated article.`,
      ],
    };
  }

  const page = await lookupTitle(ctx, edition, link.title, false);
  const result = await evaluatePage(ctx, edition, page, 'interlanguage_link', source.confidence, link.title);
  if (result.status === 'resolved') {
    result.notes.unshift(`Found via the interlanguage link from ${source.language}:"${source.article}".`);
    if (source.wikidataId && result.wikidataId && result.wikidataId !== source.wikidataId) {
      result.confidence = 'medium';
      result.notes.push(`Wikidata item mismatch: ${result.wikidataId} here vs ${source.wikidataId} in the source article.`);
    }
    if (source.confidence === 'medium') result.notes.push('Confidence inherited from the source article (see source.notes).');
  }
  return result;
}

async function evaluatePage(
  ctx: Ctx,
  edition: string,
  page: PageInfo,
  method: ResolutionMethod,
  baseConfidence: ResolutionConfidence,
  requestedTitle: string,
): Promise<LanguageResolution> {
  const problem = pageProblem(page, edition);
  if (problem) {
    return {
      ...emptyResolution(edition, 'not_found'),
      notes: [problem, SEARCH_NOTE],
      candidates: await search(ctx, edition, requestedTitle),
    };
  }
  if (page.isDisambiguation) {
    return {
      ...emptyResolution(edition, 'ambiguous'),
      notes: [`"${page.title}" on ${edition}.wikipedia is a disambiguation page. Ask the user which meaning they want.`],
      candidates: (await search(ctx, edition, page.title)).filter((c) => c.title !== page.title),
    };
  }
  return {
    ...emptyResolution(edition, 'resolved'),
    article: page.title,
    wikidataId: page.wikidataId,
    confidence: page.redirectFragment ? 'medium' : baseConfidence,
    method,
    redirectedFrom: page.redirectedFrom,
    notes: redirectNotes(page, edition),
  };
}

/** Returns a reason when the page cannot be used as an article, otherwise null. */
function pageProblem(page: PageInfo, edition: string): string | null {
  if (page.invalidReason !== null) return `"${page.title}" is not a valid title on ${edition}.wikipedia: ${page.invalidReason}`;
  if (!page.exists) return `No article titled "${page.title}" exists on ${edition}.wikipedia.`;
  if (page.namespace !== 0) return `"${page.title}" on ${edition}.wikipedia is not an article (namespace ${page.namespace}).`;
  return null;
}

function redirectNotes(page: PageInfo, edition: string): string[] {
  if (page.redirectedFrom === null) return [];
  const notes = [
    `"${page.redirectedFrom}" redirects to "${page.title}" on ${edition}.wikipedia; using the target (views of the redirect title are counted separately).`,
  ];
  if (page.redirectFragment) {
    notes.push(
      `The redirect points to the section "${page.redirectFragment}" of "${page.title}": the topic is only part of that article, so its pageviews overstate interest in the topic.`,
    );
  }
  return notes;
}

function emptyResolution(edition: string, status: ResolutionStatus): LanguageResolution {
  return {
    language: edition,
    project: `${edition}.wikipedia`,
    status,
    article: null,
    wikidataId: null,
    confidence: null,
    method: null,
    redirectedFrom: null,
    notes: [],
    candidates: [],
  };
}

function safeEdition(lang: string): string | null {
  try {
    return toEdition(lang);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// MediaWiki Action API access
// ---------------------------------------------------------------------------

async function callApi(ctx: Ctx, edition: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params });
  const url = `${actionApiUrl(edition)}?${query.toString()}`;
  const cache = ctx.options.cache ?? null;
  const now = ctx.options.now?.() ?? new Date();
  const cached = cache?.get(CACHE_NAMESPACE, url);
  if (cached && isObject(cached.value) && isFresh(cached.storedAt, RESOLVER_CACHE_TTL_MS, now)) return cached.value;

  const response = await requestWithRetry(url, ctx.options, { service: SERVICE });
  const body = await readJson(response, ctx.options, SERVICE);
  if (!isObject(body)) throw invalidResponse('body is not an object.');
  if (isObject(body['error'])) {
    const info = typeof body['error']['info'] === 'string' ? body['error']['info'] : 'unknown error';
    throw new WikimediaApiError('BAD_REQUEST', `${SERVICE} error on ${edition}.wikipedia: ${info}`);
  }
  cache?.set(CACHE_NAMESPACE, url, body, now);
  return body;
}

async function lookupTitle(ctx: Ctx, edition: string, title: string, withLanglinks: boolean): Promise<PageInfo> {
  const params: Record<string, string> = {
    titles: title,
    redirects: '1',
    prop: withLanglinks ? 'pageprops|description|langlinks' : 'pageprops|description',
    ppprop: 'disambiguation|wikibase_item',
  };
  if (withLanglinks) params['lllimit'] = 'max';
  const body = await callApi(ctx, edition, params);
  return parseLookup(body, title);
}

/** Exported for tests: parses an action=query title lookup (formatversion=2). */
export function parseLookup(body: Record<string, unknown>, requestedTitle: string): PageInfo {
  const query = body['query'];
  if (!isObject(query)) throw invalidResponse('missing "query".');

  // Interwiki-prefixed titles (e.g. "fr:Foo") produce no page at all.
  if (Array.isArray(query['interwiki'])) {
    return { ...missingPage(requestedTitle), invalidReason: 'the title is an interwiki link to another site.' };
  }

  const pages = query['pages'];
  if (!Array.isArray(pages) || pages.length !== 1 || !isObject(pages[0])) {
    throw invalidResponse('expected exactly one page in "query.pages".');
  }
  const page = pages[0];
  const title = typeof page['title'] === 'string' ? page['title'] : requestedTitle;

  const redirects = Array.isArray(query['redirects']) ? query['redirects'].filter(isObject) : [];
  const firstRedirect = redirects[0];
  const lastRedirect = redirects[redirects.length - 1];
  const pageprops = isObject(page['pageprops']) ? page['pageprops'] : {};
  const langlinks = Array.isArray(page['langlinks'])
    ? page['langlinks'].filter(isObject).flatMap((l) =>
        typeof l['lang'] === 'string' && typeof l['title'] === 'string' ? [{ lang: l['lang'], title: l['title'] }] : [],
      )
    : [];

  return {
    title,
    exists: page['missing'] !== true && page['invalid'] !== true,
    invalidReason: page['invalid'] === true ? String(page['invalidreason'] ?? 'invalid title') : null,
    namespace: typeof page['ns'] === 'number' ? page['ns'] : null,
    isDisambiguation: 'disambiguation' in pageprops,
    wikidataId: typeof pageprops['wikibase_item'] === 'string' ? pageprops['wikibase_item'] : null,
    description: typeof page['description'] === 'string' ? page['description'] : null,
    redirectedFrom: firstRedirect && typeof firstRedirect['from'] === 'string' ? firstRedirect['from'] : null,
    redirectFragment: lastRedirect && typeof lastRedirect['tofragment'] === 'string' ? lastRedirect['tofragment'] : null,
    langlinks,
  };
}

/**
 * Full-text search. When nothing matches (typically a typo, e.g. "Astronmy"), MediaWiki's spelling
 * suggestion ("astronomy") is searched once instead. Candidates are never auto-selected.
 */
async function search(ctx: Ctx, edition: string, text: string, allowSuggestion = true): Promise<Candidate[]> {
  const body = await callApi(ctx, edition, {
    generator: 'search',
    gsrsearch: text,
    gsrnamespace: '0',
    gsrlimit: String(ctx.maxCandidates + 1), // +1 leaves room for a filtered-out disambiguation page
    gsrinfo: 'suggestion',
    prop: 'pageprops|description',
    ppprop: 'disambiguation|wikibase_item',
  });
  const candidates = parseSearch(body).slice(0, ctx.maxCandidates);
  const suggestion = parseSuggestion(body);
  if (candidates.length === 0 && allowSuggestion && suggestion !== null && !sameTitleIgnoringCase(suggestion, text)) {
    return search(ctx, edition, suggestion, false);
  }
  return candidates;
}

/** Exported for tests: MediaWiki's spelling suggestion (query.searchinfo.suggestion), if any. */
export function parseSuggestion(body: Record<string, unknown>): string | null {
  const query = body['query'];
  const info = isObject(query) ? query['searchinfo'] : undefined;
  const suggestion = isObject(info) ? info['suggestion'] : undefined;
  return typeof suggestion === 'string' && suggestion.trim() !== '' ? suggestion : null;
}

/** Exported for tests: parses generator=search results into ranked non-disambiguation candidates. */
export function parseSearch(body: Record<string, unknown>): Candidate[] {
  const query = body['query'];
  if (query === undefined) return []; // no results: MediaWiki omits "query" entirely
  if (!isObject(query)) throw invalidResponse('missing "query" in search results.');
  if (query['pages'] === undefined) return []; // no results, but "query.searchinfo" (suggestion) is present
  if (!Array.isArray(query['pages'])) throw invalidResponse('"query.pages" in search results is not an array.');

  return query['pages']
    .filter(isObject)
    .filter((p) => typeof p['title'] === 'string')
    .sort((a, b) => Number(a['index'] ?? 0) - Number(b['index'] ?? 0))
    .filter((p) => !(isObject(p['pageprops']) && 'disambiguation' in p['pageprops']))
    .map((p) => {
      const props = isObject(p['pageprops']) ? p['pageprops'] : {};
      return {
        title: p['title'] as string,
        wikidataId: typeof props['wikibase_item'] === 'string' ? props['wikibase_item'] : null,
        description: typeof p['description'] === 'string' ? p['description'] : null,
      };
    });
}

function missingPage(title: string): PageInfo {
  return {
    title,
    exists: false,
    invalidReason: null,
    namespace: null,
    isDisambiguation: false,
    wikidataId: null,
    description: null,
    redirectedFrom: null,
    redirectFragment: null,
    langlinks: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(msg: string): WikimediaApiError {
  return new WikimediaApiError('INVALID_RESPONSE', `Unexpected ${SERVICE} response: ${msg}`);
}
