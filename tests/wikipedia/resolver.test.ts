import { describe, expect, it, vi } from 'vitest';
import { WikimediaApiError } from '../../src/wikipedia/http.js';
import {
  RESOLVER_CACHE_TTL_MS,
  parseLookup,
  parseSearch,
  resolveTopic,
  type ResolveRequest,
} from '../../src/wikipedia/resolver.js';
import { MemoryCache } from '../helpers/memory-cache.js';

// ---------------------------------------------------------------------------
// Fixtures shaped like real MediaWiki action=query responses (formatversion=2),
// modelled on responses captured from the live API on 2026-09-23.
// ---------------------------------------------------------------------------

interface PageOpts {
  qid?: string;
  disambig?: boolean;
  langlinks?: Record<string, string>;
  ns?: number;
  description?: string;
}

function pageObj(title: string, o: PageOpts = {}) {
  const pageprops: Record<string, string> = {};
  if (o.qid) pageprops['wikibase_item'] = o.qid;
  if (o.disambig) pageprops['disambiguation'] = '';
  return {
    pageid: 1,
    ns: o.ns ?? 0,
    title,
    ...(Object.keys(pageprops).length ? { pageprops } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.langlinks ? { langlinks: Object.entries(o.langlinks).map(([lang, t]) => ({ lang, title: t })) } : {}),
  };
}

const page = (title: string, o: PageOpts = {}) => ({ batchcomplete: true, query: { pages: [pageObj(title, o)] } });
const missing = (title: string) => ({ batchcomplete: true, query: { pages: [{ ns: 0, title, missing: true }] } });
const redirect = (from: string, to: string, o: PageOpts = {}, fragment?: string) => ({
  batchcomplete: true,
  query: {
    redirects: [{ from, to, ...(fragment ? { tofragment: fragment } : {}) }],
    pages: [pageObj(to, o)],
  },
});
const results = (...pages: Array<[string, PageOpts?]>) => ({
  batchcomplete: true,
  query: { pages: pages.map(([t, o], i) => ({ ...pageObj(t, o), index: i + 1 })) },
});

/** Routes requests by `<edition>|lookup|<title>` or `<edition>|search|<text>`. Unknown editions → DNS failure. */
function router(routes: Record<string, unknown>, knownEditions: string[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const edition = url.hostname.replace('.wikipedia.org', '');
    const p = url.searchParams;
    const key = p.has('meta')
      ? `${edition}|siteinfo`
      : p.has('gsrsearch')
        ? `${edition}|search|${p.get('gsrsearch')}`
        : `${edition}|lookup|${p.get('titles')}`;
    calls.push(key);
    if (!knownEditions.includes(edition)) {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    }
    if (key.endsWith('|siteinfo')) {
      return new Response(JSON.stringify({ batchcomplete: true, query: { general: { lang: edition } } }), { status: 200 });
    }
    if (!(key in routes)) throw new Error(`Unexpected request: ${key}`);
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const options = { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, maxRetries: 0 };
  return { calls, options };
}

const IF_EN = page('Intermittent fasting', {
  qid: 'Q1666254',
  langlinks: { cs: 'Přerušovaný půst', de: 'Intermittierendes Fasten', nb: 'Periodisk faste' },
});

async function resolve(request: ResolveRequest, routes: Record<string, unknown>, editions = ['en', 'pl', 'cs', 'de', 'no', 'uk']) {
  const r = router(routes, editions);
  const result = await resolveTopic(request, r.options);
  return { result, calls: r.calls };
}

async function expectError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WikimediaApiError);
  expect((err as WikimediaApiError).code).toBe(code);
}

// ---------------------------------------------------------------------------

describe('resolveTopic: assignment scenario "intermittent fasting, pl vs cs"', () => {
  it('resolves cs via the interlanguage link and reports pl as not found (no search noise)', async () => {
    const { result, calls } = await resolve(
      { topic: 'intermittent fasting', languages: ['pl', 'cs'] },
      {
        'en|lookup|intermittent fasting': { ...IF_EN, query: { ...IF_EN.query, normalized: [{ from: 'intermittent fasting', to: 'Intermittent fasting' }] } },
        'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q1666254' }),
      },
    );

    expect(result.source).toMatchObject({ status: 'found', article: 'Intermittent fasting', wikidataId: 'Q1666254', confidence: 'high' });
    const [pl, cs] = result.results;
    expect(pl).toMatchObject({ language: 'pl', project: 'pl.wikipedia', status: 'not_found', article: null, candidates: [] });
    expect(pl!.notes.join(' ')).toMatch(/No pl\.wikipedia article is linked/);
    expect(cs).toMatchObject({
      status: 'resolved',
      article: 'Přerušovaný půst',
      project: 'cs.wikipedia',
      confidence: 'high',
      method: 'interlanguage_link',
      wikidataId: 'Q1666254',
    });
    // Source lookup, an edition-existence check for pl (no search), and one verification in cs.
    expect(calls).toEqual(['en|lookup|intermittent fasting', 'pl|siteinfo', 'cs|lookup|Přerušovaný půst']);
  });
});

describe('resolveTopic: source article', () => {
  it('follows a curated redirect in the source wiki with high confidence', async () => {
    const { result } = await resolve(
      { topic: 'IF diet', languages: ['cs'] },
      {
        'en|lookup|IF diet': redirect('IF diet', 'Intermittent fasting', { qid: 'Q1666254', langlinks: { cs: 'Přerušovaný půst' } }),
        'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q1666254' }),
      },
    );
    expect(result.source).toMatchObject({ status: 'found', article: 'Intermittent fasting', redirectedFrom: 'IF diet', confidence: 'high' });
    expect(result.results[0]).toMatchObject({ status: 'resolved', confidence: 'high' });
  });

  it('lowers confidence when the redirect points to a section of another article', async () => {
    const { result } = await resolve(
      { topic: 'Fasting mimicking diet', languages: ['en'] },
      { 'en|lookup|Fasting mimicking diet': redirect('Fasting mimicking diet', 'Valter Longo', { qid: 'Q3554167' }, 'Fasting mimicking diet') },
    );
    expect(result.source).toMatchObject({ status: 'found', article: 'Valter Longo', confidence: 'medium' });
    expect(result.results[0]).toMatchObject({ status: 'resolved', method: 'source_article', confidence: 'medium' });
    expect(result.results[0]!.notes.join(' ')).toMatch(/section "Fasting mimicking diet"/);
  });

  it('marks targets as medium when inherited from a section redirect', async () => {
    const { result } = await resolve(
      { topic: 'X diet', languages: ['cs'] },
      {
        'en|lookup|X diet': redirect('X diet', 'Parent', { qid: 'Q1', langlinks: { cs: 'Rodič' } }, 'X diet'),
        'cs|lookup|Rodič': page('Rodič', { qid: 'Q1' }),
      },
    );
    expect(result.results[0]).toMatchObject({ status: 'resolved', confidence: 'medium' });
    expect(result.results[0]!.notes.join(' ')).toMatch(/inherited/);
  });

  it('returns candidates and does not auto-select on a disambiguation page', async () => {
    const { result, calls } = await resolve(
      { topic: 'learning English', languages: ['de', 'pl'] },
      {
        'en|lookup|learning English': page('Learning English', { qid: 'Q16871974', disambig: true }),
        'en|search|learning English': results(
          ['Learning English', { disambig: true }],
          ['English as a second or foreign language', { qid: 'Q130192', description: 'Use of English by speakers with different native languages' }],
          ['BBC Learning English', { qid: 'Q2876734' }],
        ),
      },
    );
    expect(result.source.status).toBe('ambiguous');
    expect(result.source.article).toBeNull();
    expect(result.source.candidates).toEqual([
      { title: 'English as a second or foreign language', wikidataId: 'Q130192', description: 'Use of English by speakers with different native languages' },
      { title: 'BBC Learning English', wikidataId: 'Q2876734', description: null },
    ]);
    expect(result.results.map((r) => r.status)).toEqual(['ambiguous', 'ambiguous']);
    expect(calls).toHaveLength(2); // no requests to target wikis
  });

  it('returns search candidates when the topic is not a title', async () => {
    const { result } = await resolve(
      { topic: 'fasting intermittently', languages: ['cs'] },
      {
        'en|lookup|fasting intermittently': missing('Fasting intermittently'),
        'en|search|fasting intermittently': results(['Intermittent fasting', { qid: 'Q1666254' }], ['Fasting', { qid: 'Q44602' }]),
      },
    );
    expect(result.source.status).toBe('not_found');
    expect(result.source.candidates.map((c) => c.title)).toEqual(['Intermittent fasting', 'Fasting']);
    expect(result.results[0]).toMatchObject({ status: 'not_found', article: null });
  });

  it('rejects invalid titles and non-article namespaces', async () => {
    const invalid = await resolve(
      { topic: '[foo]', languages: ['cs'] },
      {
        'en|lookup|[foo]': { query: { pages: [{ title: '[foo]', invalid: true, invalidreason: 'contains invalid characters: "["' }] } },
        'en|search|[foo]': {},
      },
    );
    expect(invalid.result.source.status).toBe('not_found');
    expect(invalid.result.source.notes[0]).toMatch(/not a valid title/);

    const category = await resolve(
      { topic: 'Category:Astronomy', languages: ['cs'] },
      {
        'en|lookup|Category:Astronomy': page('Category:Astronomy', { ns: 14, qid: 'Q6508' }),
        'en|search|Category:Astronomy': {},
      },
    );
    expect(category.result.source.notes[0]).toMatch(/not an article \(namespace 14\)/);
  });

  it('supports a non-English source language', async () => {
    const { result } = await resolve(
      { topic: 'астрономія', sourceLanguage: 'uk', languages: ['uk', 'en'] },
      {
        'uk|lookup|астрономія': page('Астрономія', { qid: 'Q333', langlinks: { en: 'Astronomy' } }),
        'en|lookup|Astronomy': page('Astronomy', { qid: 'Q333' }),
      },
    );
    expect(result.results.map((r) => [r.language, r.article, r.method])).toEqual([
      ['uk', 'Астрономія', 'source_article'],
      ['en', 'Astronomy', 'interlanguage_link'],
    ]);
  });
});

describe('resolveTopic: target editions', () => {
  it('maps language-code langlinks to edition subdomains (nb → no)', async () => {
    const { result, calls } = await resolve(
      { topic: 'Intermittent fasting', languages: ['nb'] },
      { 'en|lookup|Intermittent fasting': IF_EN, 'no|lookup|Periodisk faste': page('Periodisk faste', { qid: 'Q1666254' }) },
    );
    expect(result.results[0]).toMatchObject({ language: 'no', project: 'no.wikipedia', status: 'resolved', article: 'Periodisk faste' });
    expect(calls).toContain('no|lookup|Periodisk faste');
  });

  it('reports a nonexistent edition as language_unavailable and continues with the rest', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['xx', 'cs'] },
      { 'en|lookup|Intermittent fasting': IF_EN, 'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q1666254' }) },
    );
    expect(result.results.map((r) => r.status)).toEqual(['language_unavailable', 'resolved']);
    expect(result.results[0]!.notes[0]).toMatch(/xx\.wikipedia\.org does not exist/);
  });

  it('detects a nonexistent edition that has a (bogus) interlanguage link', async () => {
    const withLink = page('Intermittent fasting', { qid: 'Q1666254', langlinks: { xx: 'Foo' } });
    const { result } = await resolve({ topic: 'Intermittent fasting', languages: ['xx'] }, { 'en|lookup|Intermittent fasting': withLink });
    expect(result.results[0]!.status).toBe('language_unavailable');
  });

  it('follows redirects of the linked title to the canonical article', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['cs'] },
      {
        'en|lookup|Intermittent fasting': IF_EN,
        'cs|lookup|Přerušovaný půst': redirect('Přerušovaný půst', 'Periodický půst', { qid: 'Q1666254' }),
      },
    );
    expect(result.results[0]).toMatchObject({ status: 'resolved', article: 'Periodický půst', redirectedFrom: 'Přerušovaný půst', confidence: 'high' });
  });

  it('flags a linked disambiguation page as ambiguous', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['cs'] },
      {
        'en|lookup|Intermittent fasting': IF_EN,
        'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { disambig: true }),
        'cs|search|Přerušovaný půst': results(['Přerušovaný půst', { disambig: true }], ['Půst', { qid: 'Q44602' }]),
      },
    );
    expect(result.results[0]).toMatchObject({ status: 'ambiguous', article: null });
    expect(result.results[0]!.candidates.map((c) => c.title)).toEqual(['Půst']);
  });

  it('lowers confidence on a Wikidata mismatch', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['cs'] },
      { 'en|lookup|Intermittent fasting': IF_EN, 'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q999' }) },
    );
    expect(result.results[0]).toMatchObject({ status: 'resolved', confidence: 'medium' });
    expect(result.results[0]!.notes.join(' ')).toMatch(/mismatch/);
  });
});

describe('resolveTopic: explicit titles', () => {
  it('uses and verifies an explicit title', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['pl'], titles: { pl: 'Głodówka lecznicza' } },
      { 'en|lookup|Intermittent fasting': IF_EN, 'pl|lookup|Głodówka lecznicza': page('Głodówka lecznicza', { qid: 'Q352490' }) },
    );
    expect(result.results[0]).toMatchObject({ status: 'resolved', method: 'explicit_title', article: 'Głodówka lecznicza', confidence: 'medium' });
    expect(result.results[0]!.notes.join(' ')).toMatch(/different \(possibly related\) concept/);
  });

  it('keeps high confidence when the explicit title matches the source Wikidata item', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['cs'], titles: { cs: 'Přerušovaný půst' } },
      { 'en|lookup|Intermittent fasting': IF_EN, 'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q1666254' }) },
    );
    expect(result.results[0]).toMatchObject({ status: 'resolved', method: 'explicit_title', confidence: 'high' });
  });

  it('searches the target wiki when an explicit title does not exist', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['pl'], titles: { pl: 'Post przerywany' } },
      {
        'en|lookup|Intermittent fasting': IF_EN,
        'pl|lookup|Post przerywany': missing('Post przerywany'),
        'pl|search|Post przerywany': results(['Głodówka lecznicza', { qid: 'Q352490' }]),
      },
    );
    expect(result.results[0]).toMatchObject({ status: 'not_found' });
    expect(result.results[0]!.candidates.map((c) => c.title)).toEqual(['Głodówka lecznicza']);
  });
});

describe('resolveTopic: validation and errors', () => {
  const noRoutes = {};

  it.each<[string, ResolveRequest]>([
    ['empty topic', { topic: '  ', languages: ['pl'] }],
    ['no languages', { topic: 'x', languages: [] }],
    ['bad language code', { topic: 'x', languages: ['p l'] }],
    ['title for a non-target language', { topic: 'x', languages: ['pl'], titles: { cs: 'Y' } }],
    ['empty explicit title', { topic: 'x', languages: ['pl'], titles: { pl: ' ' } }],
    ['bad maxCandidates', { topic: 'x', languages: ['pl'], maxCandidates: 0 }],
    ['topic too long', { topic: 'a'.repeat(256), languages: ['pl'] }],
  ])('%s → INVALID_INPUT', async (_name, request) => {
    const r = router(noRoutes, ['en']);
    await expectError(resolveTopic(request, r.options), 'INVALID_INPUT');
    expect(r.calls).toEqual([]);
  });

  it('deduplicates languages after alias normalization', async () => {
    const { result } = await resolve(
      { topic: 'Intermittent fasting', languages: ['nb', 'no', 'NO'] },
      { 'en|lookup|Intermittent fasting': IF_EN, 'no|lookup|Periodisk faste': page('Periodisk faste', { qid: 'Q1666254' }) },
    );
    expect(result.results).toHaveLength(1);
  });

  it('fails with INVALID_INPUT when the source edition does not exist', async () => {
    const r = router(noRoutes, []);
    await expectError(resolveTopic({ topic: 'x', sourceLanguage: 'xx', languages: ['pl'] }, r.options), 'INVALID_INPUT');
  });

  it('maps a MediaWiki error object to BAD_REQUEST', async () => {
    const r = router({ 'en|lookup|x': { error: { code: 'badvalue', info: 'Unrecognized value' } } }, ['en']);
    await expectError(resolveTopic({ topic: 'x', languages: ['pl'] }, r.options), 'BAD_REQUEST');
  });

  it('maps a malformed response to INVALID_RESPONSE', async () => {
    const r = router({ 'en|lookup|x': { query: { pages: [] } } }, ['en']);
    await expectError(resolveTopic({ topic: 'x', languages: ['pl'] }, r.options), 'INVALID_RESPONSE');
  });
});

describe('resolveTopic: cache', () => {
  const routes = {
    'en|lookup|intermittent fasting': IF_EN,
    'cs|lookup|Přerušovaný půst': page('Přerušovaný půst', { qid: 'Q1666254' }),
  };
  const request = { topic: 'intermittent fasting', languages: ['pl', 'cs'] };
  const at = (iso: string) => () => new Date(iso);

  it('serves a repeated resolve from the cache with identical results', async () => {
    const r = router(routes, ['en', 'pl', 'cs']);
    const cache = new MemoryCache();
    const first = await resolveTopic(request, { ...r.options, cache, now: at('2026-09-23T12:00:00Z') });
    expect(r.calls).toHaveLength(3);
    const second = await resolveTopic(request, { ...r.options, cache, now: at('2026-09-29T12:00:00Z') });
    expect(r.calls).toHaveLength(3);
    expect(second).toEqual(first);
  });

  it('re-fetches after the TTL', async () => {
    const r = router(routes, ['en', 'pl', 'cs']);
    const cache = new MemoryCache();
    await resolveTopic(request, { ...r.options, cache, now: at('2026-09-23T12:00:00Z') });
    const later = new Date(Date.parse('2026-09-23T12:00:00Z') + RESOLVER_CACHE_TTL_MS + 1);
    await resolveTopic(request, { ...r.options, cache, now: () => later });
    expect(r.calls).toHaveLength(6);
  });

  it('does not cache MediaWiki errors', async () => {
    const r = router({ 'en|lookup|x': { error: { code: 'badvalue', info: 'Unrecognized value' } } }, ['en']);
    const cache = new MemoryCache();
    await expectError(resolveTopic({ topic: 'x', languages: ['pl'] }, { ...r.options, cache }), 'BAD_REQUEST');
    expect(cache.entries.size).toBe(0);
  });
});

describe('parsers', () => {
  it('parseLookup treats interwiki titles as invalid', () => {
    const info = parseLookup({ query: { interwiki: [{ title: 'fr:Astronomie', iw: 'fr' }] } }, 'fr:Astronomie');
    expect(info.exists).toBe(false);
    expect(info.invalidReason).toMatch(/interwiki/);
  });

  it('parseSearch returns [] when MediaWiki omits "query" (no results)', () => {
    expect(parseSearch({ batchcomplete: true })).toEqual([]);
  });

  it('parseSearch orders by search rank, not by page order', () => {
    const body = {
      query: {
        pages: [
          { ...pageObj('Second'), index: 2 },
          { ...pageObj('First'), index: 1 },
        ],
      },
    };
    expect(parseSearch(body).map((c) => c.title)).toEqual(['First', 'Second']);
  });
});
