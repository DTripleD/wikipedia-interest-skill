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
6. **Tests are part of the work.** Unit tests are deterministic with no network. Live API tests are opt-in (`RUN_INTEGRATION=1`).
7. **The LLM never computes statistics.** All numbers come from deterministic code.
8. **Pageviews ≠ market demand.** This distinction must hold in every output.
9. Prefer simple code, strong typing and few dependencies. No speculative features.

## Roadmap status

| #  | Stage                                   | Status      |
| -- | --------------------------------------- | ----------- |
| 1  | Project setup                           | ✅ done     |
| 2  | Wikimedia Pageviews API client          | ⏭ next      |
| 3  | Wikipedia article resolver              | pending     |
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

**Current stage:** Stage 1 is complete and awaiting review/commit. Stage 2 comes next.

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

## Planned design (not yet implemented; revisit in each stage)

- **Pageviews API (Stage 2):** `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}`. The default is `agent=user`, daily granularity. Verify all behavior (date formats, 404 on no data, data start date, rate limits) against the real API and document it. Do not trust memory.
- **Resolver (Stage 3):** search the source-language wiki → Wikidata QID → sitelinks for the target languages, with local search in the target wiki as a fallback. Detect redirects and disambiguation (`pageprops`). Return a confidence level and candidates rather than guessing.
- **Cache (Stage 4):** JSON files under `.cache/` (gitignored). Past days are immutable, so only recent days get re-fetched.
- **Confidence (Stage 6):** a high/medium/low level from explicit rules (coverage, sample size, CV volatility, outlier share, trend fit), each with human-readable reasons. No fabricated percentages.
- Generated artifacts go to `output/` (gitignored).

## Current layout

```
src/config.ts          User-Agent / contact configuration
src/cli.ts             CLI entry; exported run(argv) is pure and testable; only `version` exists
src/{wikipedia,analysis,charts,reports}/   empty (.gitkeep) — filled in later stages
tests/config.test.ts   User-Agent tests
tests/cli.test.ts      CLI envelope tests
examples/, evaluation/ empty (.gitkeep)
tsconfig.json          strict type-check config (src + tests), noEmit
tsconfig.build.json    build config (src → dist)
vitest.config.ts       tests/**/*.test.ts, node environment
```

## Known limitations

- The CLI has only `version`; nothing else is functional yet.
- `.gitkeep` placeholders should be removed once their directories contain real files.

## Remaining work

Stages 2–14 (see the table above).
