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
| 6  | Confidence / evidence model             | ✅ done     |
| 7  | Charts                                  | ✅ done     |
| 8  | Report generation (one-page PDF)        | ✅ done     |
| 9  | CLI / tool interface                    | ✅ done     |
| 10 | SKILL.md                                | ⏭ next      |
| 11 | End-to-end scenarios                    | pending     |
| 12 | Cheap-model evaluation (Haiku 4.5)      | pending     |
| 13 | Edge cases and robustness               | pending     |
| 14 | Final cleanup                           | pending     |

**Current stage:** Stage 9 is complete and awaiting review/commit. Stage 10 (SKILL.md) comes next.

## Decisions made (with the user)

- **Stack:** TypeScript + Node.js (≥ 22.12, ESM, `module: NodeNext`), native `fetch`, Vitest.
  - TypeScript 7.x (the native compiler), Vitest 5.x, `@types/node` 22.x to match the minimum supported Node.
  - Relative imports in `src/` must use the `.js` extension (NodeNext resolution).
- **Charts:** Vega-Lite 6 (`vega-lite` + `vega` 6) rendered to SVG in Node (pure JS, no native deps, no canvas).
- **PDF:** PDFKit 0.20 + svg-to-pdfkit 0.1.8 (vector charts), fontkit 2 for text measurement, embedded Noto Sans TTF committed in `assets/fonts/` (agreed: a font file in the repo, not an npm font package).
  - Native deps such as `canvas` are avoided on purpose: the repo lives under a OneDrive path with Cyrillic characters, where native builds on Windows are fragile.
- **User-Agent:** `wikipedia-interest-skill/<version> (<contact>)`. The contact comes from `WIKI_SKILL_CONTACT`; the fallback is a neutral placeholder (see `src/config.ts`).
- **`.env` support (added before Stage 4):** `loadDotEnv()` in `src/config.ts` wraps Node's native `process.loadEnvFile` (no dotenv). It always reads the project-root `.env` (resolved from `import.meta.url`, independent of cwd). Shell variables win over the file, and a missing file is ignored. It is called only in the CLI `main()` (so `run()` stays pure) and in `tests/integration/setup.ts`. Unit tests never load it. `.env.example` is committed; `.env` is gitignored.
- **CLI contract:** every command prints exactly one JSON envelope (one line) to stdout. On success: `{ok:true, command, data}`. On failure: `{ok:false, command, error:{code, message, details?}}` (`details` added in Stage 9, e.g. candidate titles). Exit code is 0 or 1. Outputs stay compact (metrics and file paths, never raw series) so a cheap model can use them.
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

**Additions made in Stage 6 (inputs for the confidence model):**
- `TrendResult.periodLabels` (one label per trend value).
- `SeriesAnalysis.levelShift` / `seasonality` (from `patterns.ts`) and `editionLevelShift` (the same step detector on the edition totals; null without edition data).
- `volatility.trendDeviation`: median |period − Theil–Sen line| / median level. It is robust, so a single spike month does not count twice (outliers already cover it). It replaced a first SD-based draft.
- `recentVsPrevious` / `yearOverYear` carry `relativeChangeExcludingSpikes` (the excess views of spike days in each window are subtracted). The type is `AnalyzedComparison`.
- `RankRow.index` = position in `analyses`.
- `stats.ts`: `ranks`, `pearson`, `spearman`. `trends.ts`: `pettitt`.

**Live check (2026-09-24), intermittent fasting, 2024-09-23..2026-09-22:**
- cs `Přerušovaný půst`: 6 716 views, 4.41 per million, YoY −54 %, decreasing (p < 0.001), 20 outliers carrying 18 % of views. The biggest outlier is 2025-04-14 (508 views vs a baseline of 14).
- uk `Інтервальне голодування`: 10 522 views, 6.72 per million, YoY −75 %, decreasing.
- uk shows a **level drop** (≈ 28 → 6 views/day). Stage 6 located it between 2025-05 and 2025-06 on complete months.

### Confidence / evidence model (Stage 6) — `src/analysis/patterns.ts`, `src/analysis/confidence.ts`

Decisions (agreed with the user): weakest-link aggregation; level-shift and seasonality detectors; volume thresholds weak < 5 and caution < 30 median views/day; assess both single series and comparisons.

- **`patterns.ts`:**
  - `detectLevelShift(trend)`: Pettitt's test on the trend values (monthly or weekly). A step is `detected` only if p < 0.05, both segments have ≥ 3 periods, **and** the two-level model (segment medians) has a mean absolute error ≤ that of the Theil–Sen line. The last condition is needed because a steady trend also gives a significant Pettitt change point. It also returns `stepDeviation` (median of |v − segment median| / segment median).
  - `detectSeasonality(monthly)`: ln(1 + daily average) of complete months, detrended by Theil–Sen. Months 12 apart are correlated with Spearman. It needs ≥ 10 pairs (22 complete months); `detected` if r ≥ 0.6 (≈ one-sided p < 0.025 at 11 pairs).
- **`confidence.ts`:**
  - `assessSeries(analysis, resolution?)` → `{level, reasons, factors[], claims:{trend, yearOverYear, recentVsPrevious}, caveats}`.
  - `assessComparison(comparison, resolutions?)`: `resolutions` are in the same order as the inputs. It returns `{level, reasons, factors, basis, rankingPairs, members, caveats}`.
  - **Factors** (`ok | caution | weak | info`, with `value` and a message). All thresholds are in the exported `CONFIDENCE_THRESHOLDS`:
    - `resolution`: high → ok, medium → caution (with the resolver notes), null → weak;
    - `period`: < 90 d weak, < 365 d caution;
    - `volume`: median daily views < 5 weak, < 30 caution;
    - `coverage`: imputed share > 5 % caution, > 20 % weak; first reported day > 30 d after the start → at least caution; no data → weak;
    - `outliers`: `excessViewsShare` > 10 % caution, > 25 % weak;
    - `consistency`: `trendDeviation` (or `stepDeviation` when a step is detected, because a line through a step fits badly by construction) > 20 % caution, > 40 % weak;
    - `level_shift`: detected → caution. If the edition totals shifted within ±1 period, the message says the change is partly edition-wide;
    - `seasonality`: always `info`.
  - **Level** = weakest link: any weak → low, any caution → medium, else high. `reasons` = the weak messages, then the caution ones.
  - **Claims:** never above the data level.
    - Trend: high only if Mann–Kendall p < 0.01 on ≥ 12 monthly periods with no step. No significant trend → medium ("not proof of stability"). Weekly basis, fewer than 12 months or a step → at most medium.
    - Changes: spike-driven (removing spikes flips the sign or halves the change, with a gap ≥ 10 pp) → medium. Recent vs previous → medium unless seasonality was checked and not found.
  - **Comparison factors:**
    - `normalization`: raw totals → caution;
    - `ranking_stability`: for each adjacent pair in the ranking (per million when available), the share of complete months in which the higher one is ahead (ties ½): ≥ 90 % ok, ≥ 70 % caution, else weak. It needs ≥ 3 complete months, otherwise `info`;
    - `members`: the worst member level.
  - **Caveats:** `DEMAND_CAVEAT` (pageviews ≠ market demand / willingness to pay) is always first. `SERIES_CAVEATS` add scope (one article, agent=user). `COMPARISON_CAVEATS` add edition coverage and audience effects.

**Live check (2026-09-25), 2024-09-23..2026-09-22** (pinned in `tests/integration/confidence.live.test.ts`):
- cs `Přerušovaný půst` → **medium** (volume: median 6/day; spikes carry 18 % of views). Trend: decreasing, medium (limited by the data).
- uk `Інтервальне голодування` → **medium**. There is a step between 2025-05 and 2025-06 (27.8 → 6.2/day), and the **whole uk edition fell 33 % at the same time**.
- cs vs uk (per million) → **low**: uk is ahead in only 15 of 23 months.
- uk `Астрономія` → **medium**: a step at the same point (48 → 13.5/day), low volume (median 20/day), no seasonality detected.
- The cs edition total also dropped ~20 % in June 2025. Treat any mid-2025 step on cs/uk articles as partly platform-wide.

### CLI (Stage 9) — `src/cli.ts`, `src/commands/`

Decisions (agreed with the user): commands `resolve` / `analyze` / `report` (no separate fetch/chart steps; the cache makes repeats cheap); an unresolved topic is an error with candidates in `error.details`; percentages are numbers already ×100 in fields ending in `Pct`.

- **Usage:** `node dist/cli.js <command> [options]` (`npm run cli -- ...`, bin `wiki-interest`). `help` lists the options.
  - Common: `--topic` (source-language title, default source `en`), `--languages pl,cs`, `[--source en]`, `[--title <lang>=<Title> ...]` (explicit article; repeatable), `[--no-cache]`.
  - `analyze` / `report`: `[--months 24 | --start YYYY-MM-DD] [--end YYYY-MM-DD]` (default: 24 calendar months ending yesterday UTC; `--months` 1–120, not together with `--start`), `[--charts]` (also write SVGs), `[--out DIR]` (default `<project>/output`).
  - `report`: `[--note "..."]` (analyst note, ≤ 600 characters).
- **`args.ts`:** strict `node:util parseArgs`; every problem is `CliError('INVALID_ARGUMENT', message-with-fix)`.
- **`pipeline.ts`:** `makeContext(deps, noCache)` wraps `fetch` to count every HTTP request (`apiRequests`, retries included), opens the file cache unless disabled, and warns when `WIKI_SKILL_CONTACT` is not set. `analyze()`: resolve → for each resolved language, cached daily series + edition totals → `compareLanguages` → `assessComparison` with the resolver's confidence/notes. Unresolved languages become `missing` (reason: "no article linked to the topic", `no article titled "X"`, "the title is a disambiguation page", "edition does not exist"; plus candidate titles). If none resolved: `TOPIC_AMBIGUOUS` / `TOPIC_NOT_FOUND` (`details.candidates` = `{title, description}`) or `NO_ARTICLES` (`details.missing`).
- **`present.ts`:** compact output. Per language (in ranking order): `rank, language, article, resolution{confidence, method, notes?}, totalViews, dailyMean, dailyMedian, viewsPerMillion, peakDay, yoyChangePct, yoyChangeExcludingSpikesPct, recent90ChangePct, trend{direction, perYearPct, significance, basis, periods}, levelShift{between, fromPerDay, toPerDay, editionChangePct}|null, seasonality, spikes{outlierDays, excessViewsSharePct, largest?}, imputedDays, confidence{level, reasons, trend, yearOverYear, recentVsPrevious}`. Top level: `topic, sourceArticle, period, rankedBy, languages, comparison.ranking` (2+ languages), `missing, confidence, findings, limitations` (the last three from `buildReportModel`, identical to the PDF), `files?, warnings?, apiRequests, cache`. The live cs/pl analysis is ≈ 2.8 KB of JSON.
- **`commands.ts`:** files are named `<topic-slug>_<sorted-langs>_<start>_<end>` + `.pdf` or `-<chart id>.svg` (chart ids: `timeline` | `comparison` | `yoy`; `ReportModel.charts` now carries the id).
- **Errors:** `CliError` codes as above; Wikimedia codes pass through (`RATE_LIMITED`, `TIMEOUT`, …; `INVALID_INPUT` → `INVALID_ARGUMENT`); `RangeError` → `INVALID_ARGUMENT`; anything else → `INTERNAL_ERROR`.
- **Tests:** `tests/cli.test.ts` with `tests/helpers/fake-wikimedia.ts` (URL-routed fake Action API + Pageviews API): arguments, period arithmetic, file names, resolve, analyze (ranking, rounding, compactness, cache on/off), `--charts`, ambiguous/not-found/no-article errors, 429 pass-through, report PDF, note validation.
- **Source language (found by the user, 2026-09-25):** `--topic` is looked up in the `--source` edition (default `en`). `report --topic "Море" --languages cs,uk,pl` fails with `TOPIC_NOT_FOUND` (candidates are unrelated English search hits); `--source uk` works (cs `Moře`, pl `Morze`, uk `Море`). The `TOPIC_NOT_FOUND` message now says to re-run with `--source <lang>` or an English title.
- **Live check (2026-09-25):** `analyze --topic "Intermittent fasting" --languages pl,cs` → cs 6 716 views, 4.41 per million, YoY −54.4 %, medium; pl missing. `analyze --topic "learning English"` → `TOPIC_AMBIGUOUS` with 5 candidates. `report --topic Astronomy --languages uk` → PDF written.

### Report (Stage 8) — `src/reports/`, `src/fonts.ts`, `assets/fonts/`

Decisions (agreed with the user): findings are templated by code, plus an optional short analyst note from the agent (labelled "written by the AI agent, not computed"); Noto Sans TTF committed in the repo; A4.

- **`content.ts`:** `buildReportModel(input)` → `{title, subtitle, attentionBanner, table, findings, analystNote, confidence, limitations, charts, warnings}`. Pure and testable.
  - Input: `{topic, comparison, assessment, series (same order as analyses), missing?: {language, reason}[], analystNote?, generatedAt}`. Throws RangeError for an empty/over-long topic (120), a note over 600 characters, or mismatched lengths.
  - Table columns: Edition, Article, Views, Median/day, Per million, YoY, Trend/year (compound rate if significant, else "no clear trend"), Confidence; ranked by per million (else total views), missing editions last with "—".
  - Findings (templates): the top of the ranking with values; "ranking holds" (only when stable — instability is under Confidence); one line for each of the top 3 series (trend, YoY with "(mostly spike days)" when spike-driven, level shift with the edition-wide change); single series: typical day and busiest day, seasonality; missing editions.
  - Confidence: comparison level and reasons ("see members" becomes "see the table"); for one series, that series' level and reasons. Limitations: the caveats (DEMAND_CAVEAT first) plus the count of zero-filled days.
  - Charts: single series → timeline + YoY; several → comparison + YoY (YoY omitted when unavailable).
  - Every string is checked against the font; unsupported characters become "?" with a warning.
- **`pdf.ts`:** `generateReport(input)` → `{pdf: Buffer, model}`; `renderReportPdf(model, svgs, generatedAt)`. A4, 36 pt margins, Noto Sans Regular/Bold. Order: title, subtitle, grey banner (attention ≠ demand), table, charts (one shared scale so text sizes match), two columns (Findings + analyst note | Confidence + Limitations), footer (source, "all numbers computed deterministically"). The page count is checked (bufferPages); overflow throws.
- **`confidence.ts` changes:** `editionShiftWithStep(analysis)` exported (used by the report); the unstable-ranking message names at most two pairs and counts the rest.
- **Visual check (2026-09-25):** real cs/uk intermittent-fasting and uk astronomy reports, plus a maximum-content case, were generated and inspected (samples in `output/stage8-preview/`, gitignored).

### Charts (Stage 7) — `src/charts/`

Decisions (agreed with the user): three charts (timeline, language comparison, year over year); builders return a Vega-Lite spec and `renderSvg`/`toChart` return `{spec, svg}`; nothing is written to disk (the CLI in Stage 9 writes `output/`).

- **`charts.ts`:**
  - `timelineSpec(series, analysis, size?)`: raw daily views (light gray), the 28-day moving average (blue) and the Theil–Sen line (orange, dashed; drawn between the mid-points of the first and last trend period). When `levelShift.detected`, it adds a dotted rule at the first period after the step, labelled "Step: a to b/day". **Axis cap (agreed with the user after a visual review):** when `analysis.dailyAxisCap` is set, the y-axis stops at the cap, lines are clipped, every clipped day gets a triangle marker at the top, the 5 largest (`MAX_CLIPPED_LABELS`) get their real value, and a second subtitle line explains it. It throws a RangeError if the analysis is not of that series.
  - `comparisonSpec(comparison, size?)`: monthly lines, one per series, in views per million when `ranking.byViewsPerMillion` exists, otherwise average views per day (the subtitle says raw views favour big editions). Colors follow input order; end-of-line labels are added because three palette slots are below 3:1 contrast. At most 8 lines (`MAX_COMPARISON_LINES`): the top 8 of the ranking, with a subtitle note.
  - `yoySpec(analyses, size?)`: one small panel per series (facet, independent y scales, because editions differ by orders of magnitude). Each panel has prior-vs-last-365-day average daily views and the relative change label. Series without YoY are listed in the subtitle. Returns null if none has YoY.
  - **Rules:** specs contain only precomputed values — no Vega-Lite `aggregate/transform/bin/timeUnit/impute/window` (a unit test enforces this). Every chart title/subtitle carries "Wikipedia attention, not market demand." All time axes use a UTC scale.
- **`render.ts`:** `renderSvg(spec)` compiles with Vega-Lite and renders with `new vega.View(..., {renderer: 'none'}).toSVG()`. `toChart(spec)` → `{spec, svg}`.
- **`text-metrics.ts`:** without canvas, Vega estimates text as 0.8 em per character, which made SVGs ~40 % too wide and pushed plots down (rotated axis titles). `render.ts` installs `vegaTextWidth` into Vega's `textMetrics.width` hook (the hook vl-convert uses; not in Vega's typings). Since Stage 8 it measures with the embedded Noto Sans (see "Fonts" below).
- **`theme.ts`:** the dataviz reference palette, light mode (the categorical order passed the palette validator's adjacent-pair CVD/normal-vision checks), recessive gray axes/grid, font `Noto Sans, Helvetica, Arial, sans-serif`.
- **`analyzeSeries` addition:** `dailyAxisCap = {cap, clippedDays[]}` with cap = ⌈`AXIS_CAP_FACTOR` (3) × highest 28-day average⌉, or null when no day exceeds it (or the series is shorter than 28 days). It is a display aid, computed in the analysis layer so the chart computes nothing.
- **`renderSvg`** calls `vega.resetSVGDefIds()` first: clip-path ids come from a global counter, and the reset keeps the output byte-for-byte reproducible.
- **Shared helpers added:** `seriesLabels(analyses)` in `compare.ts` (`cs`, or `cs:Title` when an edition repeats; used by confidence and charts) and `src/format.ts` (`formatNumber`, `formatPercent`, `formatSignedPercent`, `formatPValue`; moved out of `confidence.ts`).
- **Fonts (changed in Stage 8):** chart text is measured with the real embedded Noto Sans (`src/fonts.ts`, fontkit), not Helvetica estimates; the SVG font family is `Noto Sans, Helvetica, Arial, sans-serif`. Noto Sans has no `≈ → ▲`, so labels say "Step: a to b/day", "triangles mark …" and "from about a to b". Tests assert that chart specs and confidence texts only use characters the font can draw (`missingGlyphs`).
- **Visual check (2026-09-25):** real cs/uk data were rendered and inspected as PNG (converted with `@resvg/resvg-js` in the scratchpad only; not a project dependency).

## Planned design (not yet implemented; revisit in each stage)

- **SKILL.md (Stage 10):** the agent must detect the language the user wrote the topic in and pass `--source <lang>` (or translate the topic to its English Wikipedia title); never run a non-English topic against the default `en` source. The workflow is resolve (only when unsure) → analyze → report. Map resolver notes that say `titles.<lang>` to the CLI flag `--title <lang>=<Title>`. On `TOPIC_AMBIGUOUS` / `TOPIC_NOT_FOUND`, show the candidates and ask the user; never pick one. Quote numbers from the JSON; never compute. Always pass on `limitations[0]` (attention ≠ demand) and the confidence level with reasons.
- Generated artifacts go to `output/` (gitignored).

## Current layout

```
src/config.ts                  User-Agent / contact configuration, .env loading
src/dates.ts                   UTC ISO-date helpers
src/cli.ts                     CLI entry; async run(argv, deps) returns the envelope; commands version/help/resolve/analyze/report
src/commands/args.ts           argument parsing and validation (CliError)
src/commands/pipeline.ts       context (counted fetch, cache, warnings), resolve, analyze pipeline, unresolved-topic errors
src/commands/present.ts        compact JSON for the agent (rounding, Pct fields)
src/commands/commands.ts       resolve/analyze/report handlers, chart/PDF files in output/
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
src/analysis/patterns.ts       level-shift (Pettitt + step-vs-line) and seasonality (lag-12 Spearman) detectors
src/analysis/confidence.ts     evidence-based confidence: factors, weakest-link level, per-claim levels, caveats
src/format.ts                  number/percent/p-value formatting for messages and chart labels
src/charts/charts.ts           Vega-Lite spec builders: timeline, language comparison, year over year
src/charts/render.ts           spec → SVG (headless Vega), installs the text-width hook
src/charts/text-metrics.ts     Helvetica text-width estimate for Vega layout without canvas
src/charts/theme.ts            palette, ink colors, font, shared Vega-Lite config
src/fonts.ts                   embedded Noto Sans: file paths, text width (fontkit), missing-glyph check
src/reports/content.ts         report model: table rows, templated findings, confidence, limitations, chart specs
src/reports/pdf.ts             one-page A4 layout with PDFKit + svg-to-pdfkit; generateReport
assets/fonts/                  NotoSans-Regular.ttf, NotoSans-Bold.ttf (unhinted, v2.015) + OFL.txt
docs/wikimedia-api.md          verified Wikimedia API behavior + sources
tests/*.test.ts                config, CLI (fake Wikimedia), date helper, font tests
tests/helpers/fake-wikimedia.ts  URL-routed fake of the Action API and Pageviews API for CLI tests
tests/wikipedia/*.test.ts      http, languages, api, resolver unit tests (scripted fetch, no network)
tests/data/*.test.ts           series, cache, getDailySeries unit tests (fake API, MemoryCache)
tests/helpers/memory-cache.ts  in-memory JsonCache for tests
tests/helpers/series.ts        makeSeries / seriesOf fixtures
tests/analysis/*.test.ts       stats, trends, outliers, patterns, confidence, analyze/compare (reference values from Python)
tests/charts/*.test.ts         chart specs (data, encodings, no VL computations, font coverage), rendering
tests/fonts.test.ts            text widths match PDFKit's, missing-glyph detection, Vega text-width hook
tests/reports/*.test.ts        report model (ranking, findings, caps, validation, sanitizing), one-page PDF
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

- CLI: requests are sequential (per language: article series + edition totals); 20 languages without cache take ~40+ requests. Edition totals are always fetched (normalization); a failure there fails the command.
- CLI: `analyze`/`report` re-run the resolver each time (cached for 7 days). There is no separate fetch/chart command; SVGs come from `--charts`.
- CLI: the resolver's notes mention `titles.<lang>`; the matching CLI flag is `--title <lang>=<Title>` (SKILL.md must say so).
- The Mann–Kendall test assumes independent observations. Monthly averages are still autocorrelated, so p-values are somewhat optimistic. Weekly-basis trends (short periods) are the most affected.
- The trend is monotonic/linear only. Level shifts and seasonality are *flagged* (Stage 6), not modelled: the trend is still one Theil–Sen line.
- Confidence thresholds are explicit, documented heuristics (`CONFIDENCE_THRESHOLDS`), not calibrated probabilities. They were checked on the assignment's cs/uk data only.
- The level-shift detector finds at most one change point, needs a trend estimate (≥ 8 complete months or weeks), and ignores steps with fewer than 3 periods on one side. Pettitt is conservative on short series (e.g. n = 10: even a perfect 5/5 split gives p ≈ 0.066). The edition-shift note uses Pettitt significance and location only (not the step-vs-line check), because edition totals often combine a slow decline with a step.
- Seasonality needs 22 complete months. With 2-year windows there are only 11 pairs, so weak seasonality goes undetected, and a level shift can distort the lag-12 correlation. Recent-vs-previous is therefore capped at medium whenever seasonality is unknown.
- Ranking stability counts months only. It does not test whether a per-month difference is significant.
- Charts: the timeline's axis cap (3 × the highest 28-day average) is a fixed heuristic. Only the 5 largest clipped days get value labels, and labels of spikes a few days apart can overlap.
- Charts are static (for the PDF): no hover/tooltip, light mode only. Text widths are estimates, so a label can be a few pixels off in the final renderer; months with only a few days (first/last) are plotted like full months, since their values are daily averages or per-million ratios.
- The comparison chart shows at most 8 series; more would exceed the validated categorical palette.
- Report: the embedded Noto Sans covers Latin, Greek and Cyrillic only. CJK, Arabic, Hebrew and Indic titles are replaced with "?" in the report text (with a warning); inside charts they would render as empty boxes (a warning is added too).
- Report layout: text blocks are capped (10 table rows, 3 per-series findings, 4 confidence reasons, 4 limitations, 600-character note), and the charts shrink to the remaining height down to 45 %; below that the second chart (YoY) is dropped with a warning. Long cells are truncated with an ellipsis.
- svg-to-pdfkit quirks (observed): it sizes a drawing from the SVG's own width/height attributes and treats them as px unless `assumePt: true`; `pdf.ts` rewrites the attributes and sets `assumePt`. Ligatures are disabled in PDF text so extracted text reads correctly ("Confidence", not "Confdence").
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

Stages 10–14 (see the table above).
