/**
 * A fake of the two Wikimedia services the CLI talks to, routed by URL:
 * - MediaWiki Action API (`<edition>.wikipedia.org/w/api.php`): lookups by title, search,
 *   siteinfo; unknown editions fail like a DNS error (ENOTFOUND);
 * - Pageviews REST API (`wikimedia.org/api/rest_v1/metrics/pageviews/...`): per-article and
 *   aggregate daily items generated from `views(project, article | null, date)`.
 * Response shapes follow the fixtures in tests/wikipedia (captured from the live APIs).
 */
import { vi } from 'vitest';

export interface FakePage {
  qid?: string;
  disambig?: boolean;
  description?: string;
  langlinks?: Record<string, string>;
}

export interface FakeWikimediaOptions {
  /** Keyed by `<edition>|<title>`; missing keys are reported as missing pages. */
  pages: Record<string, FakePage>;
  /** Search results keyed by `<edition>|<query>`. */
  search?: Record<string, string[]>;
  editions: string[];
  /** Daily views; undefined = not reported. `article` is null for edition totals. */
  views: (project: string, article: string | null, date: string) => number | undefined;
  /** Status code to return for every Pageviews request (e.g. 429). */
  pageviewsStatus?: number;
}

function pageObj(title: string, o: FakePage) {
  const pageprops: Record<string, string> = {};
  if (o.qid) pageprops['wikibase_item'] = o.qid;
  if (o.disambig) pageprops['disambiguation'] = '';
  return {
    pageid: 1,
    ns: 0,
    title,
    ...(Object.keys(pageprops).length ? { pageprops } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.langlinks ? { langlinks: Object.entries(o.langlinks).map(([lang, t]) => ({ lang, title: t })) } : {}),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

export function fakeWikimedia(options: FakeWikimediaOptions) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === 'wikimedia.org') {
      calls.push(`pageviews ${url.pathname}`);
      if (options.pageviewsStatus) return json({ title: 'error' }, options.pageviewsStatus);
      const parts = url.pathname.split('/').map(decodeURIComponent);
      const aggregate = parts.includes('aggregate');
      const [start, end] = parts.slice(-2) as [string, string];
      const project = parts[6]!; // /api/rest_v1/metrics/pageviews/{per-article|aggregate}/{project}/...
      const article = aggregate ? null : parts[9]!;
      const items = [];
      for (let d = new Date(`${iso(start)}T00:00:00Z`); d <= new Date(`${iso(end)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        const views = options.views(project, article, date);
        if (views !== undefined) {
          items.push({ project, ...(article ? { article } : {}), granularity: 'daily', access: 'all-access', agent: 'user', timestamp: `${date.replaceAll('-', '')}00`, views });
        }
      }
      return json({ items });
    }

    const edition = url.hostname.replace('.wikipedia.org', '');
    const p = url.searchParams;
    calls.push(`${edition} ${p.has('meta') ? 'siteinfo' : p.has('gsrsearch') ? 'search' : 'lookup'}`);
    if (!options.editions.includes(edition)) {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });
    }
    if (p.has('meta')) return json({ batchcomplete: true, query: { general: { lang: edition } } });
    if (p.has('gsrsearch')) {
      const titles = options.search?.[`${edition}|${p.get('gsrsearch')}`] ?? [];
      return json(titles.length ? { batchcomplete: true, query: { pages: titles.map((t, i) => ({ ...pageObj(t, {}), index: i + 1 })) } } : { batchcomplete: true });
    }
    const title = p.get('titles')!;
    const page = options.pages[`${edition}|${title}`];
    return json({ batchcomplete: true, query: { pages: [page ? pageObj(title, page) : { ns: 0, title, missing: true }] } });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}
