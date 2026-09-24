# wikipedia-interest-skill

A standalone **Agent Skill** that lets AI agents analyze Wikipedia pageviews across
language editions and topics. It resolves topics to articles, fetches historical pageviews,
computes statistics, trends and confidence indicators, and generates charts and a short
shareable PDF report.

It is meant to help B2C product founders decide which topics and languages are worth
researching further.

> **Wikipedia pageviews measure attention and information-seeking behavior, not market
> demand or willingness to pay.**

## Status

Early development. Stages 1–7 (project setup, Pageviews API client, article resolver, data model and caching, analytics engine, confidence model, charts) are complete. See [AGENTS.md](AGENTS.md) for the
current state and roadmap.

## Architecture (summary)

- **The LLM agent** interprets the request, picks topics and languages, asks clarifying
  questions, calls the CLI, and explains the results.
- **Deterministic TypeScript code** handles article resolution, Wikimedia API access,
  validation, caching, statistics, confidence scoring, charts and the PDF.

The LLM never computes statistics from raw data.

```
src/
  config.ts       shared runtime config (User-Agent)
  dates.ts        UTC ISO-date helpers
  cli.ts          JSON-in/JSON-out command interface for the agent
  wikipedia/      shared HTTP layer (http.ts), language editions (languages.ts),
                  Pageviews API client (api.ts), topic → article resolver (resolver.ts)
  data/           daily series model and monthly aggregation (series.ts),
                  file cache (cache.ts), cached incremental fetching (pageviews.ts)
  analysis/       statistics, trends (Theil–Sen, Mann–Kendall), outliers (Hampel),
                  level shifts (Pettitt) and seasonality, per-series analysis,
                  cross-language comparison, evidence-based confidence (high/medium/low)
  charts/         Vega-Lite specs → SVG in Node: timeline, language comparison,
                  year over year (no statistics computed in the chart layer)
  reports/        one-page PDF via PDFKit                       (Stage 8)
docs/             verified external API behavior (docs/wikimedia-api.md)
tests/            Vitest unit tests (deterministic, no network)
tests/integration live tests against the real Wikimedia API (opt-in)
examples/         example requests and outputs
evaluation/       cheap-model (Haiku 4.5) evaluation materials
```

## Confidence model

Every analysis gets a **high / medium / low** confidence level from explicit rules, never a
made-up percentage. Each factor is rated `ok`, `caution` or `weak` with a plain-language
reason:

- period length;
- traffic volume;
- missing days;
- share of views from spikes;
- month-to-month consistency;
- abrupt level shifts, noting when the whole edition shifted too;
- how well the article matches the topic.

The overall level is the weakest factor. Trends, year-over-year and recent changes get their
own levels, which are never higher than the data level. Comparisons also check whether the
ranking holds month by month. Thresholds live in `CONFIDENCE_THRESHOLDS` in
`src/analysis/confidence.ts`.

The confidence describes how reliable the numbers are **as a measure of Wikipedia attention**.
Every assessment carries the caveat that pageviews are not market demand.

## Charts

Three static SVG charts are built from the analysis results (Vega-Lite, rendered in Node
without a browser or canvas):

- **Timeline:** daily views, 28-day average, Theil–Sen trend line, and a marker for an
  abrupt level shift.
- **Interest by language:** monthly views per million edition pageviews (or average daily
  views when edition totals are missing), one line per language.
- **Year over year:** the prior vs the last 365 days for each language, with the change.

Every chart states that pageviews show Wikipedia attention, not market demand.

## Requirements

- Node.js ≥ 22.12
- npm

## Setup

```bash
npm install
npm run build
```

## Configuration

Settings are read from environment variables. You can also put them in a `.env` file at
the project root:

```bash
cp .env.example .env   # then edit WIKI_SKILL_CONTACT
```

- The file is loaded with Node's built-in `process.loadEnvFile`, with no extra dependency.
  The CLI and the live tests (`npm run test:integration`) load it. Unit tests do not.
- It is always read from the project root, whatever the current working directory is.
- Variables already set in the shell take precedence over the file.
- `.env` is gitignored. Only `.env.example` is committed.

| Variable             | Purpose                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WIKI_SKILL_CONTACT` | Contact info (an email or a full URL) sent in the User-Agent, as the [Wikimedia User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy) requires. **Set this before making real requests.** Without real contact info, Wikimedia may treat the client as "unidentified" and limit it to 10 requests/minute (HTTP 429). |
| `WIKI_SKILL_CACHE_DIR` | Cache directory. If unset, `.cache/` in the project root is used. Relative paths are resolved against the project root. An empty value disables caching. |

### Caching

Pageviews and resolver lookups are cached as JSON files, so repeated analyses make few or no
Wikimedia requests.

- **Pageviews:** each article's daily series is cached once and extended as needed. Only
  missing days are fetched. Days older than 3 days are treated as final. More recent days are
  re-fetched once the cached copy is older than 4 hours.
- **Resolver:** MediaWiki API responses (titles, redirects, interlanguage links, search) are
  kept for 7 days.
- Errors are never cached. You can delete the cache directory at any time.

## Usage

```bash
node dist/cli.js version
```

Every command prints one JSON object to stdout:

```json
{ "ok": true, "command": "version", "data": { ... } }
{ "ok": false, "command": "x", "error": { "code": "UNKNOWN_COMMAND", "message": "..." } }
```

## Scripts

| Script              | Description                         |
| ------------------- | ----------------------------------- |
| `npm run build`     | Compile `src/` to `dist/`           |
| `npm run typecheck` | Type-check `src/` and `tests/`      |
| `npm test`          | Run the unit tests once (no network) |
| `npm run test:watch`| Run the unit tests in watch mode     |
| `npm run test:integration` | Run live tests against the real Wikimedia API (needs internet; set `WIKI_SKILL_CONTACT`) |
