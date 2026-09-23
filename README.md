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

Early development. Stage 1 (project setup) is complete. See [AGENTS.md](AGENTS.md) for the
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
  cli.ts          JSON-in/JSON-out command interface for the agent
  wikipedia/      Pageviews API client, article resolver       (Stage 2–3)
  analysis/       trends, outliers, confidence                  (Stage 5–6)
  charts/         Vega-Lite → SVG                               (Stage 7)
  reports/        one-page PDF via PDFKit                       (Stage 8)
tests/            Vitest unit tests (deterministic, no network)
examples/         example requests and outputs
evaluation/       cheap-model (Haiku 4.5) evaluation materials
```

## Requirements

- Node.js ≥ 22.12
- npm

## Setup

```bash
npm install
npm run build
```

## Configuration

| Variable             | Purpose                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `WIKI_SKILL_CONTACT` | Contact info (email or URL) sent in the User-Agent, as the [Wikimedia User-Agent policy](https://meta.wikimedia.org/wiki/User-Agent_policy) requires. Set this before making real requests. |

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
| `npm test`          | Run the Vitest suite once           |
| `npm run test:watch`| Run Vitest in watch mode            |
