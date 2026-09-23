# AGENTS.md — project state and development rules

This file is the handoff document between development sessions. **Read it first**, then
README.md, the relevant sources and tests, and `git status`. Then work out the current state
before changing anything.

The full assignment and roadmap are in [prompts/master_rules.md](prompts/master_rules.md).

## Development rules (mandatory)

1. **One roadmap stage per session.** Implement it, test it, update this file, summarize, then STOP.
2. **Never commit, reset, revert or rewrite Git history.** The user reviews and commits every stage themselves.
3. **Ask instead of assuming** when requirements, APIs or architecture are unclear.
4. **Never invent API behavior.** Check docs or installed types, or test against the real API. Probe Wikimedia politely: send a real contact in the User-Agent and pause between requests. Otherwise you get HTTP 429 (see docs).
5. **No significant architectural change without approval.** Explain what is wrong, why it matters, the proposal and its impact.
6. **Tests are part of the work.** Unit tests (`npm test`) are deterministic with no network. Live API tests live in `tests/integration/*.live.test.ts` and run only via `npm run test:integration`.
7. **The LLM never computes statistics.** All numbers come from deterministic code.
8. **Pageviews ≠ market demand.** This distinction must hold in every output.
9. Prefer simple code, strong typing and few dependencies. No speculative features.

## Roadmap status

| #  | Stage                                   | Status      |
| -- | --------------------------------------- | ----------- |
| 1  | Project setup                           | ✅ done     |
| 2  | Wikimedia Pageviews API client          | ✅ done     |
| 3  | Wikipedia article resolver              | ✅ done     |
| 4  | Data model, normalization, caching      | ⏭ next      |
| 5  | Analytics engine                        | pending     |
| 6  | Confidence / evidence model             | pending     |
| 7  | Charts                                  | pending     |
| 8  | Report generation (one-page PDF)        | pending     |
| 9  | CLI / tool interface                    | pending     |
| 10 | SKILL.md                                | pending     |
| 11 | End-to-end scenarios                    | pending     |
| 12 | Cheap-model evaluation (Haiku 4.5)      | pending     |
| 13 | Edge cases and robustness               | pending     |
| 14 | Final cleanup                           | pending     |

**Current stage:** Stage 3 is complete and awaiting review/commit. Stage 4 comes next.

## Decisions made (with the user)

- **Stack:** TypeScript + Node.js (≥ 22.12, ESM, `module: NodeNext`), native `fetch`, Vitest.
  - TypeScript 7.x (the native compiler), Vitest 5.x, `@types/node` 22.x to match the minimum supported Node.
  - Relative imports in `src/` must use the `.js` extension (NodeNext resolution).
- **Charts:** Vega-Lite rendered to SVG in Node (pure JS, no native deps). Installed in Stage 7.
- **PDF:** PDFKit + svg-to-pdfkit to embed vector charts. Installed in Stage 8.
  - Native deps such as `canvas` are avoided on purpose: the repo lives under a OneDrive path with Cyrillic characters, where native builds on Windows are fragile.
- **User-Agent:** `wikipedia-interest-skill/<version> (<contact>)`. The contact comes from `WIKI_SKILL_CONTACT`; the fallback is a neutral placeholder (see `src/config.ts`).
- **CLI contract:** every command prints exactly one JSON envelope to stdout. On success: `{ok:true, command, data}`. On failure: `{ok:false, command, error:{code, message}}`. Exit code is 0 or 1. Outputs stay compact (metrics and file paths, never raw series) so a cheap model can use them.
- **Stage 12 evaluation** will be run **manually by the user in Claude Code with Haiku 4.5**. The project supplies scenarios, a checklist and a results template.
- **Documentation language:** English.
- **Shared HTTP layer (approved in Stage 3):** retry, timeout, `Retry-After`, User-Agent and error mapping live in `src/wikipedia/http.ts` and are used by both the Pageviews client and the resolver. `PageviewsApiError` remains as an alias of `WikimediaApiError`.

## Implemented

All Wikimedia API assumptions are recorded, with their sources, in
[docs/wikimedia-api.md](docs/wikimedia-api.md). Read it before changing anything in `src/wikipedia/`.

### Shared HTTP layer — `src/wikipedia/http.ts`

- `requestWithRetry(url, options, {service, passStatuses})`, `readJson`, `parseRetryAfter`, `WikimediaApiError`.
- **Error codes:** `INVALID_INPUT | BAD_REQUEST | FORBIDDEN | RATE_LIMITED | SERVER_ERROR | HTTP_ERROR | TIMEOUT | NETWORK_ERROR | HOST_NOT_FOUND | INVALID_RESPONSE`.
- **Retries:** 429/5xx/timeout/network errors are retried (3 retries, backoff 1 s·2^n). `Retry-After` is honoured. A 429 without that header waits at least 5 s. A `Retry-After` over 60 s fails immediately. Other 4xx responses fail fast.
- A DNS `ENOTFOUND` becomes `HOST_NOT_FOUND` and is not retried. The resolver uses this to detect nonexistent language editions.
- The 429 message tells the user to set `WIKI_SKILL_CONTACT`.
- `fetch`, `sleep`, `now` and `userAgent` are injectable (`HttpOptions`).

### Language editions — `src/wikipedia/languages.ts`

- `toEdition(code)` normalizes a language code to the wiki subdomain, e.g. `nb`→`no`, `gsw`→`als`, `nan`→`zh-min-nan`, `be-x-old`→`be-tarask`. The static map comes from the sitematrix (2026-09-23).
- `wikipediaProject(lang)` returns `<edition>.wikipedia`; it now applies the alias map too.
- `actionApiUrl(edition)` builds the Action API URL.

### Pageviews API client (Stage 2) — `src/wikipedia/api.ts`

- `fetchPageviews(query, options)`, `normalizeArticleTitle`, `buildPageviewsUrl`. It also re-exports `wikipediaProject`, `parseRetryAfter` and `PageviewsApiError`.
- **Input:** `{project: "pl.wikipedia", article, start, end}` with ISO `YYYY-MM-DD` dates (inclusive). Defaults are `daily` / `all-access` / `user`. Invalid input throws `INVALID_INPUT` before any request is made.
- **Output:** `PageviewsResult` with the request metadata, sorted `points: {date, views}[]`, `noData` and `warnings[]`.
- **404 → `noData: true`, not an error.** The same 404 means a missing article, no views, or an unknown project.
- **Gaps are NOT filled.** The API omits days (observed; likely zero views). Stage 4 decides how to treat them.
- **Clamping and warnings:** a start before 2015-07-01 is clamped with a warning. An end ≥ today adds a data-lag warning. Partial months (monthly granularity) add a warning.
- **Response validation:** checks for an `items` array, valid timestamps, non-negative integer views, matching granularity and no duplicate dates.

### Article resolver (Stage 3) — `src/wikipedia/resolver.ts`

`resolveTopic({topic, languages, sourceLanguage='en', titles?, maxCandidates=5}, options)` returns `{topic, source, results[]}`.

**Algorithm:**
1. Look up `topic` as a title in the source edition, following redirects, with `pageprops` (disambiguation, Wikidata QID), description and all `langlinks`.
   - Missing, invalid or non-article title → `source.status = "not_found"` plus search candidates.
   - Disambiguation page → `"ambiguous"` plus search candidates (disambiguation pages filtered out).
   - **Nothing is auto-selected.** Targets are not attempted, and they mirror the source status.
2. For each target edition:
   - An explicit title (`titles[lang]`) is looked up and verified directly.
   - A target equal to the source reuses the source article.
   - Otherwise the resolver follows the source's interlanguage link (these are Wikidata sitelinks) and verifies the target page: canonical title, redirect, disambiguation, QID.
   - **No link → `not_found`, with no search.** Foreign-language search is noise (verified). A cheap `meta=siteinfo` call still confirms the edition exists.
   - `HOST_NOT_FOUND` → `language_unavailable`. The remaining languages continue.

**Per-language result:** `{language (edition), project, status: resolved|ambiguous|not_found|language_unavailable, article (canonical), wikidataId, confidence: high|medium|null, method: explicit_title|source_article|interlanguage_link, redirectedFrom, notes[], candidates[]}`.

**Confidence rules (for resolution only, not for data quality):**
- `high`: an exact title or curated redirect in the source, a Wikidata-backed interlanguage link, or an explicit title with the same QID as the source.
- `medium`: a redirect to a *section* of another article (the topic is only part of that article, so its views overstate interest); a Wikidata QID mismatch; an explicit title with a different or missing QID; or medium inherited from the source.

**Other behavior:**
- `article` is always the redirect target, because the Pageviews API counts redirect views separately.
- Languages are deduplicated after alias normalization (`nb`, `no` → one `no`). At most 20 languages are accepted.
- **Request cost:** 1 source lookup + 1 per target (lookup or siteinfo), plus 1 search per ambiguous/missing case. Requests are sequential.

**Assignment scenario findings (live, 2026-09-23):**
- pl.wikipedia has **no** article for Intermittent fasting (Q1666254). cs has `Přerušovaný půst`.
- `learning English` is a disambiguation page on en.wikipedia; `English as a second or foreign language` (Q130192) has no pl, uk or no article.
- The agent has to handle this in SKILL.md: report the missing editions, or ask the user and pass `titles`.

## Planned design (not yet implemented; revisit in each stage)

- **Data model and cache (Stage 4):** JSON files under `.cache/` (gitignored). Past days are immutable, so only recent days get re-fetched. The cache must also cover resolver lookups: the Action API rate limit is the tightest constraint. Stage 4 also decides how to treat missing days and reports their count.
- **Confidence (Stage 6):** a high/medium/low level from explicit rules (coverage, sample size, CV volatility, outlier share, trend fit), each with human-readable reasons. No fabricated percentages. The resolver's `confidence` and notes (e.g. section redirects) must feed into it.
- **CLI (Stage 9):** warn when `WIKI_SKILL_CONTACT` is not set.
- Generated artifacts go to `output/` (gitignored).

## Current layout

```
src/config.ts                  User-Agent / contact configuration
src/dates.ts                   UTC ISO-date helpers
src/cli.ts                     CLI entry; exported run(argv) is pure and testable; only `version` exists
src/wikipedia/http.ts          shared HTTP layer (retry, timeout, errors)
src/wikipedia/languages.ts     edition codes / aliases, URL helpers
src/wikipedia/api.ts           Pageviews API client
src/wikipedia/resolver.ts      topic → article resolver (MediaWiki Action API)
src/{analysis,charts,reports}/ empty (.gitkeep) — filled in later stages
docs/wikimedia-api.md          verified Wikimedia API behavior + sources
tests/*.test.ts                config, CLI, date helper tests
tests/wikipedia/*.test.ts      http, languages, api, resolver unit tests (scripted fetch, no network)
tests/integration/*.live.test.ts  live API tests (npm run test:integration)
examples/, evaluation/         empty (.gitkeep)
tsconfig.json                  strict type-check config (src + tests + configs), noEmit
tsconfig.build.json            build config (src → dist)
vitest.config.ts               unit tests; excludes tests/integration
vitest.integration.config.ts   live tests only, sequential, 60 s timeout
```

## Known limitations

- The CLI has only `version`. The client and resolver are not yet exposed through the CLI (Stage 9).
- There is no caching yet (Stage 4). Every resolve hits the network.
- **Rate limits:** with the default placeholder contact, the Action API is likely to treat the client as "unidentified" (10 req/min; 429 was observed during development). `WIKI_SKILL_CONTACT` should be a real email or URL.
- A timeout while reading the response body is reported as `TIMEOUT` but is not retried.
- There is no client-side rate limiter; requests are sequential.
- The resolver does not follow HTTP redirects between wiki hosts on its own. `nb.wikipedia.org` redirects to `no` in `fetch`, but the alias map already avoids that. Wikis that change host in the future need a map update.
- Search candidates are only as good as MediaWiki full-text search. They are never auto-selected.
- The resolver only uses the topic's source-language article. Wikis where the concept is covered in a broader article (e.g. pl `Głodówka lecznicza`, a different QID) are not found automatically. The agent can pass them as explicit titles, and they are then marked `medium`.
- The live tests assert historical values and Wikidata facts observed on 2026-09-23. Update them if Wikimedia data changes.
- A missing day is assumed to mean "zero views", but this is unverified.

## Remaining work

Stages 4–14 (see the table above).
