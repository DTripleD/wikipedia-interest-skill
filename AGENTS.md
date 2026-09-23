# AGENTS.md — project state and development rules

This file is the handoff document between development sessions. **Read it first**, then
README.md, the relevant sources and tests, and `git status`. Then work out the current state
before changing anything.

The full assignment and roadmap are in [prompts/master_rules.md](prompts/master_rules.md).

## Development rules (mandatory)

1. **One roadmap stage per session.** Implement it, test it, update this file, summarize, then STOP.
2. **Never commit, reset, revert or rewrite Git history.** The user reviews and commits every stage themselves.
3. **Ask instead of assuming** when requirements, APIs or architecture are unclear.
4. **Never invent API behavior.** Check docs or installed types, or test against the real API.
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
| 3  | Wikipedia article resolver              | ⏭ next      |
| 4  | Data model, normalization, caching      | pending     |
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

**Current stage:** Stage 2 is complete and awaiting review/commit. Stage 3 comes next.

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

## Implemented: Pageviews API client (Stage 2)

`src/wikipedia/api.ts` exposes `fetchPageviews(query, options)`, `wikipediaProject(lang)`,
`normalizeArticleTitle`, `buildPageviewsUrl`, `parseRetryAfter` and `PageviewsApiError`.
Every API assumption is recorded and sourced in [docs/wikimedia-api.md](docs/wikimedia-api.md).
Read that file before changing the client.

- **Input:** `{project: "pl.wikipedia", article, start, end}` with ISO `YYYY-MM-DD` dates (inclusive). Defaults are `daily` / `all-access` / `user`. Invalid input throws `INVALID_INPUT` before any request is made.
- **Output:** `PageviewsResult` with the request metadata, sorted `points: {date, views}[]`, `noData` and `warnings[]`.
- **404 → `noData: true`, not an error.** The API returns the same 404 for a missing article, no views, and an unknown project, so existence checks belong to the resolver.
- **Gaps are NOT filled.** The API omits days (observed; likely zero views). Stage 4 must decide how to treat them and expose missing-day counts as a quality signal.
- **Clamping and warnings:** a start before 2015-07-01 is clamped with a warning. An end ≥ today adds a data-lag warning. Monthly ranges that don't cover whole months add a partial-month warning.
- **Errors:** `PageviewsApiError.code` ∈ `INVALID_INPUT | BAD_REQUEST | FORBIDDEN | RATE_LIMITED | SERVER_ERROR | HTTP_ERROR | TIMEOUT | NETWORK_ERROR | INVALID_RESPONSE`, with an optional HTTP `status`.
- **Retries:** 429/5xx/timeout/network errors are retried (3 retries, backoff 1 s·2^n). `Retry-After` is honoured. A 429 without that header waits at least 5 s. A `Retry-After` over 60 s fails immediately. Other 4xx responses fail fast.
- **Testability:** `fetch`, `sleep` and `now` are injectable. The unit tests use a scripted fetch and never touch the network.
- **Response validation:** checks for an `items` array, valid timestamps, non-negative integer views, matching granularity and no duplicate dates. Anything else → `INVALID_RESPONSE`.
- `src/dates.ts` holds shared UTC ISO-date helpers (`isIsoDate`, `toApiDate`, `fromApiTimestamp`, `todayUtc`).

## Planned design (not yet implemented; revisit in each stage)

- **Resolver (Stage 3):** search the source-language wiki → Wikidata QID → sitelinks for the target languages, with local search in the target wiki as a fallback. Detect redirects and disambiguation (`pageprops`). Return a confidence level and candidates rather than guessing. The resolver **must return the canonical (redirect-target) title**, because the Pageviews API counts redirect views separately. It must also verify that the language edition exists, because the Pageviews API cannot tell.
- **Cache (Stage 4):** JSON files under `.cache/` (gitignored). Past days are immutable, so only recent days get re-fetched.
- **Confidence (Stage 6):** a high/medium/low level from explicit rules (coverage, sample size, CV volatility, outlier share, trend fit), each with human-readable reasons. No fabricated percentages.
- Generated artifacts go to `output/` (gitignored).

## Current layout

```
src/config.ts                 User-Agent / contact configuration
src/dates.ts                  UTC ISO-date helpers
src/cli.ts                    CLI entry; exported run(argv) is pure and testable; only `version` exists
src/wikipedia/api.ts          Pageviews API client
src/{analysis,charts,reports}/   empty (.gitkeep) — filled in later stages
docs/wikimedia-api.md         verified Pageviews API behavior + sources
tests/config.test.ts          User-Agent tests
tests/cli.test.ts             CLI envelope tests
tests/dates.test.ts           date helper tests
tests/wikipedia/api.test.ts   client unit tests (scripted fetch, no network)
tests/integration/pageviews.live.test.ts   live API tests (npm run test:integration)
examples/, evaluation/        empty (.gitkeep)
tsconfig.json                 strict type-check config (src + tests + configs), noEmit
tsconfig.build.json           build config (src → dist)
vitest.config.ts              unit tests; excludes tests/integration
vitest.integration.config.ts  live tests only, sequential, 60 s timeout
```

## Known limitations

- The CLI has only `version`. The client is not yet exposed through the CLI (Stage 9).
- A timeout while reading the response body is reported as `TIMEOUT` but is not retried. Only failures before the response headers arrive are retried.
- There is no client-side rate limiter. Callers should issue requests sequentially, per Wikimedia guidance. With the planned small number of articles per analysis, this is far below 200 req/min.
- The live tests assert historical values observed on 2026-09-23 (e.g. en Astronomy 2024-01-01 = 1131). If Wikimedia ever reprocesses data, update them.
- A missing day is assumed to mean "zero views", but this is unverified (see docs/wikimedia-api.md).
- `.gitkeep` placeholders should be removed once their directories contain real files.

## Remaining work

Stages 3–14 (see the table above).
