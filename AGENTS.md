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
| 4  | Data model, normalization, caching      | ✅ done     |
| 5  | Analytics engine                        | ✅ done     |
| 6  | Confidence / evidence model             | ⏭ next      |
| 7  | Charts                                  | pending     |
| 8  | Report generation (one-page PDF)        | pending     |
| 9  | CLI / tool interface                    | pending     |
| 10 | SKILL.md                                | pending     |
| 11 | End-to-end scenarios                    | pending     |
| 12 | Cheap-model evaluation (Haiku 4.5)      | pending     |
| 13 | Edge cases and robustness               | pending     |
| 14 | Final cleanup                           | pending     |

**Current stage:** Stage 5 is complete and awaiting review/commit. Stage 6 comes next.

## Decisions made (with the user)

- **Stack:** TypeScript + Node.js (≥ 22.12, ESM, `module: NodeNext`), native `fetch`, Vitest.
  - TypeScript 7.x (the native compiler), Vitest 5.x, `@types/node` 22.x to match the minimum supported Node.
  - Relative imports in `src/` must use the `.js` extension (NodeNext resolution).
- **Charts:** Vega-Lite rendered to SVG in Node (pure JS, no native deps). Installed in Stage 7.
- **PDF:** PDFKit + svg-to-pdfkit to embed vector charts. Installed in Stage 8.
  - Native deps such as `canvas` are avoided on purpose: the repo lives under a OneDrive path with Cyrillic characters, where native builds on Windows are fragile.
- **User-Agent:** `wikipedia-interest-skill/<version> (<contact>)`. The contact comes from `WIKI_SKILL_CONTACT`; the fallback is a neutral placeholder (see `src/config.ts`).
- **`.env` support (added before Stage 4):** `loadDotEnv()` in `src/config.ts` wraps Node's native `process.loadEnvFile` (no dotenv). It always reads the project-root `.env` (resolved from `import.meta.url`, independent of cwd). Shell variables win over the file, and a missing file is ignored. It is called only in the CLI `main()` (so `run()` stays pure) and in `tests/integration/setup.ts`. Unit tests never load it. `.env.example` is committed; `.env` is gitignored.
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

### Data model, normalization, caching (Stage 4) — `src/data/`

Decisions (agreed with the user): impute missing days as 0 with a flag and count them; incremental pageview cache; resolver cache TTL of 7 days; `.cache/` by default, configurable via `WIKI_SKILL_CACHE_DIR`.

- **`series.ts` (model):** `PageviewSeries` = `SeriesMeta` (`language` edition, `project`, `article` in API form with underscores, `access`, `agent`) + `start`/`end` + dense `points: {date, views, imputed}[]` (one per day, sorted) + `coverage` + `warnings[]`.
  - `coverage` = `{expectedDays, reportedDays, imputedDays, imputedShare, firstReportedDate, lastReportedDate}`. This is a data-quality input for Stage 6: a late `firstReportedDate` suggests the article was created later.
  - `buildSeries(meta, start, end, reported, warnings)` validates the points (in range, unique, non-negative integers) and fills gaps. `validateSeries` checks the invariants of an existing series.
  - `totalViews(points)` and `aggregateMonthly(series)` → `{month, views, days, calendarDays, complete, imputedDays}`. Partial first/last months are flagged, never scaled. Stage 5 should build on these rather than duplicate them.
- **`cache.ts`:** `JsonCache` interface (`get(ns, key)` → `{storedAt, value}` | null, `set(ns, key, value, now)`). `FileCache` stores `<dir>/<ns>/<sha256(key)>.json` with `{version, key, storedAt, value}` and writes atomically (temp file + rename). Corrupt or foreign-version files count as misses; write errors are ignored. `openCache(env)` honours `WIKI_SKILL_CACHE_DIR` (`getCacheDir` in `config.ts`). `CACHE_VERSION` must be bumped when a cached shape changes.
- **`pageviews.ts`:** `getDailySeries({language, article, start, end, access?, agent?}, {cache, ...http})` → `{series, apiRequests}`.
  - It always fetches **daily** data. `end` is clamped to yesterday (UTC) and `start` to 2015-07-01, with warnings. A start of today or later is `INVALID_INPUT`.
  - The cache holds one entry per `project|access|agent|article`: a single contiguous `[from, to]` of the reported points, plus `finalThrough` (today − 3 days at fetch time) and `tailFetchedAt`.
  - A request fetches at most 2 ranges: `[start, from−1]`, and `[finalThrough+1, max(end, to)]`. The second runs only when `end > to`, or when the non-final tail is older than 4 h (`RECENT_TTL_MS`). A range that does not overlap the cache is joined by fetching the gap, which keeps the cached range contiguous.
  - Trailing unreported days after `finalThrough` are **trimmed** (with a warning), not imputed. If nothing remains, the result is `INVALID_INPUT`. A series with no reported days gets a warning; a 404 counts as "no reported days".
- **Resolver cache:** `ResolverOptions.cache`. Successful Action API bodies are cached by URL for `RESOLVER_CACHE_TTL_MS` (7 days) inside `callApi`. MediaWiki errors are never cached.
- **Library functions do not cache by default** (`cache` omitted means no cache), so they stay pure and testable. The CLI (Stage 9) must pass `openCache()`.
- **Edition totals (added in Stage 5):** `getEditionDailySeries({language, start, end})` uses the same caching and trimming, but a separate cache namespace (`edition-pageviews`). It returns a `PageviewSeries` with `article: null`.
- **Helpers added in Stage 5:** `sliceSeries(series, start, end)` recomputes coverage; `aggregateWeekly(series)` groups by ISO week (Monday start) and flags `complete`.

### Analytics engine (Stage 5) — `src/analysis/`

Decisions (agreed with the user): Theil–Sen + Mann–Kendall for the trend; Hampel (rolling median + MAD) for outliers; normalization by edition-wide pageviews; 90-day recent-vs-previous and 365-day YoY windows.

- **`stats.ts`:** `sum`, `mean`, `median`, `sampleStdDev`, `coefficientOfVariation`, `medianAbsoluteDeviation`, `meanAbsoluteDeviation`, `normalCdf` (Abramowitz–Stegun erf, error < 1.5e-7).
- **`trends.ts`:**
  - `theilSen(ys)` and `mannKendall(ys)` (tie correction, continuity correction, two-sided p; p = 1 exactly when z = 0).
  - `analyzeTrend(series)` runs on the **average daily views of complete months**. It falls back to complete ISO weeks, and needs at least `MIN_TREND_PERIODS` = 8 periods; otherwise it returns `{available: false, reason}`. Daily data are never used, because weekday seasonality and autocorrelation would inflate significance.
  - `direction` is `increasing`/`decreasing` only if p < 0.05; otherwise `no_significant_trend`.
  - `slopePerPeriod`, `fittedStart` and `fittedEnd` come from the linear Theil–Sen fit (for chart lines).
  - `relativeChangePerYear` = `expm1(slope_of_ln(values) × periods per year)`, i.e. a compound rate that is always > −100 %. It is null if any period has 0 views. The linear-slope/median alternative was rejected because it gave −186 %/year on the real uk data after a level drop.
  - `comparePeriods(series, windowDays)`: the last N days vs the N days before, by **daily mean**. `relativeChange` is null if the previous mean is 0. It returns `{available: false, reason}` when the series has fewer than 2N days.
  - `movingAverage(points, window)` is trailing and null until the window is full.
- **`outliers.ts`:** `detectOutliers(series)` = Hampel filter with a ±14-day centred window (truncated at the edges) and robust z = 0.6745·(x − median)/MAD, flagged if |z| > 3.5. If MAD = 0, it falls back to z = (x − median)/(1.253314·meanAD). It returns spikes and dips, `share`, and `excessViewsShare` (views above the baseline on spike days / total views). Imputed zeros are treated as data.
- **`analyze.ts`:** `analyzeSeries(series, {editionSeries?, recentDays=90, yoyDays=365})` → `SeriesAnalysis` with:
  - `period`, `coverage`, `summary` (total, daily mean and median, peak day), `normalization` (`viewsPerMillion` of edition views, or null);
  - `monthly` rows (views, days, complete, `dailyAverage`, `viewsPerMillion`), `movingAverages` {7, 28};
  - `recentVsPrevious`, `yearOverYear`, `trend`, `volatility` (`dailyCv`; `monthlyCv` of complete-month daily averages, which needs at least 3 months), `outliers`, `warnings`.
  - The edition series must match project/access/agent (otherwise RangeError). If it does not cover the period, normalization is null with a warning; gaps in it also produce a warning.
- **`compare.ts`:** `compareLanguages([{series, editionSeries?}], options)` cuts all series to their **common period** (with a warning for each one that was cut), runs `analyzeSeries` on each, and ranks `byTotalViews` and `byViewsPerMillion`. The latter is null unless every input has edition data. Each row has `relativeToLeader`. It works for different articles in the same language too.
- Results keep full-precision numbers and full arrays (moving averages, outlier lists). The CLI (Stage 9) must round and trim them for the agent.

**Live check (2026-09-24), intermittent fasting, 2024-09-23..2026-09-22:**
- cs `Přerušovaný půst`: 6 716 views, 4.41 per million, YoY −54 %, decreasing (p < 0.001), 20 outliers carrying 18 % of views. The biggest outlier is 2025-04-14 (508 views vs a baseline of 14).
- uk `Інтервальне голодування`: 10 522 views, 6.72 per million, YoY −75 %, decreasing.
- uk shows a **level drop** in April 2025 (≈ 28 → 6 views/day). Stage 6 should treat step changes as a reason for caution when interpreting a trend.

## Planned design (not yet implemented; revisit in each stage)

- **Confidence (Stage 6):** a high/medium/low level from explicit rules, each with human-readable reasons. No fabricated percentages. Inputs available from Stage 5:
  - `coverage.imputedShare` and `firstReportedDate`; period length;
  - `trend.available`, `direction` and `mannKendall.pValue`; `volatility.dailyCv` / `monthlyCv`;
  - `outliers.share` and `excessViewsShare`; whether YoY/recent comparisons are available; the absolute level (a low daily mean makes the data noisy);
  - the resolver's `confidence` and notes (e.g. section redirects).
  - Consider detecting level shifts (see the uk finding above) and seasonality.
- **CLI (Stage 9):** warn when `WIKI_SKILL_CONTACT` is not set. Wire `openCache()` into resolve/fetch, add `--no-cache`, and report `apiRequests` in the output. Fetch edition totals for normalization (1 extra request per language, cached). Round numbers and drop large arrays from the JSON.
- Generated artifacts go to `output/` (gitignored).

## Current layout

```
src/config.ts                  User-Agent / contact configuration, .env loading
src/dates.ts                   UTC ISO-date helpers
src/cli.ts                     CLI entry; exported run(argv) is pure and testable; only `version` exists
src/wikipedia/http.ts          shared HTTP layer (retry, timeout, errors)
src/wikipedia/languages.ts     edition codes / aliases, URL helpers
src/wikipedia/api.ts           Pageviews API client (per-article + aggregate/edition totals)
src/wikipedia/resolver.ts      topic → article resolver (MediaWiki Action API), optional response cache
src/data/series.ts             PageviewSeries model, normalization (gap filling), slicing, monthly/weekly aggregation
src/data/cache.ts              JsonCache interface, FileCache (JSON files), openCache
src/data/pageviews.ts          getDailySeries / getEditionDailySeries: cached incremental daily fetching
src/analysis/stats.ts          descriptive statistics, normal CDF
src/analysis/trends.ts         Theil–Sen, Mann–Kendall, trend, period comparison, moving average
src/analysis/outliers.ts       Hampel outlier detection
src/analysis/analyze.ts        analyzeSeries: full per-series analysis (+ edition normalization)
src/analysis/compare.ts        compareLanguages: common period, rankings
src/{charts,reports}/          empty (.gitkeep) — filled in later stages
docs/wikimedia-api.md          verified Wikimedia API behavior + sources
tests/*.test.ts                config, CLI, date helper tests
tests/wikipedia/*.test.ts      http, languages, api, resolver unit tests (scripted fetch, no network)
tests/data/*.test.ts           series, cache, getDailySeries unit tests (fake API, MemoryCache)
tests/helpers/memory-cache.ts  in-memory JsonCache for tests
tests/helpers/series.ts        makeSeries / seriesOf fixtures
tests/analysis/*.test.ts       stats, trends, outliers, analyze/compare (reference values from Python)
tests/integration/*.live.test.ts  live API tests (npm run test:integration)
tests/integration/setup.ts     loads .env for live tests
.env.example                   template for .env (WIKI_SKILL_CONTACT)
examples/, evaluation/         empty (.gitkeep)
tsconfig.json                  strict type-check config (src + tests + configs), noEmit
tsconfig.build.json            build config (src → dist)
vitest.config.ts               unit tests; excludes tests/integration
vitest.integration.config.ts   live tests only, sequential, 60 s timeout
```

## Known limitations

- The CLI has only `version`. The client and resolver are not yet exposed through the CLI (Stage 9).
- The cache and the analytics are not yet used by any command, because the CLI (Stage 9) does not exist yet.
- The Mann–Kendall test assumes independent observations. Monthly averages are still autocorrelated, so p-values are somewhat optimistic. Weekly-basis trends (short periods) are the most affected.
- The trend is monotonic/linear only. Level shifts, seasonality and structural breaks are not modelled (Stage 6 should flag them).
- YoY compares the last 365 days with the 365 before. Leap days shift the alignment by one day.
- In outlier detection, a sustained level shift produces a few flagged days until the rolling window catches up. Low-traffic series (a few views/day) can produce outliers from noise alone.
- Normalization by edition totals controls for edition size, but not for audience composition or for how well the topic is covered in each edition.
- Days older than 3 days are assumed never to change (unverified). If Wikimedia backfills data, the cache keeps the old values until `.cache/` is deleted.
- Trailing unreported days in the last 3 days are trimmed, so a low-traffic article with real zero views at the end of the range gets a slightly shorter series.
- There is no cache eviction or size limit. The files are small (about 25 bytes per reported day).
- Concurrent processes writing the same entry: the last writer wins, and each file stays valid thanks to atomic rename.
- **Rate limits:** with the default placeholder contact, the Action API is likely to treat the client as "unidentified" (10 req/min; 429 was observed during development). `WIKI_SKILL_CONTACT` should be a real email or URL.
- A timeout while reading the response body is reported as `TIMEOUT` but is not retried.
- There is no client-side rate limiter; requests are sequential.
- The resolver does not follow HTTP redirects between wiki hosts on its own. `nb.wikipedia.org` redirects to `no` in `fetch`, but the alias map already avoids that. Wikis that change host in the future need a map update.
- Search candidates are only as good as MediaWiki full-text search. They are never auto-selected.
- The resolver only uses the topic's source-language article. Wikis where the concept is covered in a broader article (e.g. pl `Głodówka lecznicza`, a different QID) are not found automatically. The agent can pass them as explicit titles, and they are then marked `medium`.
- The live tests assert historical values and Wikidata facts observed on 2026-09-23. Update them if Wikimedia data changes.
- A missing day is assumed to mean "zero views", but this is unverified. Such days are imputed as 0, flagged, and counted in `coverage`.

## Remaining work

Stages 6–14 (see the table above).
