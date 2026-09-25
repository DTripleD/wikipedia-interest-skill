# wikipedia-interest-skill

An [Agent Skill](https://agentskills.io/specification) that lets an AI agent measure and compare
interest in a topic across Wikipedia language editions. The agent calls a local CLI for all the
data work. The CLI:

- resolves the topic to the right article in each language;
- fetches daily pageviews from Wikimedia (with a cache);
- computes totals, per-million normalization, year-over-year change, trends, spikes and an
  evidence-based confidence level;
- writes charts and a one-page PDF report.

It is built for B2C founders who want to decide which topics and language audiences are worth
researching next. It is designed to work with a small, cheap model such as Claude Haiku 4.5.

> **Wikipedia pageviews measure attention and information-seeking, not market demand or
> willingness to pay.** Every output of the skill says so.

---

## Contents

1. [Quick start](#quick-start)
2. [How the agent uses it](#how-the-agent-uses-it)
3. [CLI reference](#cli-reference)
4. [Architecture](#architecture)
5. [Methods](#methods)
6. [Configuration and caching](#configuration-and-caching)
7. [Testing and evaluation](#testing-and-evaluation)
8. [AI-assisted development](#ai-assisted-development)
9. [Developing the skill further](#developing-the-skill-further)
10. [Limitations](#limitations)

---

## Quick start

Requirements: Node.js ≥ 22.12 and npm. No native dependencies are needed (no canvas, no
browser).

```bash
npm ci            # reproducible install from package-lock.json
npm run build     # compiles src/ to dist/ (dist/ is not committed)
cp .env.example .env   # then set WIKI_SKILL_CONTACT to your email
```

Try it:

```bash
node dist/cli.js analyze --topic "Intermittent fasting" --languages pl,cs
node dist/cli.js report  --topic "Astronomy" --languages uk
node dist/cli.js help
```

### Installing it as a skill in Claude Code

This folder is the skill. Put it, or a link to it, into a skills directory **under its own
name**. The folder name becomes the skill's command name (`/wikipedia-interest-skill`).

- all projects: `~/.claude/skills/wikipedia-interest-skill/`
- one project: `<project>/.claude/skills/wikipedia-interest-skill/`

Claude Code follows symlinks and Windows junctions:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\wikipedia-interest-skill" -Target "<repo path>"
```

Start a new Claude Code session after creating the skills folder. The agent then picks the
skill on its own when a request is about Wikipedia interest. If `dist/cli.js` is missing,
[SKILL.md](SKILL.md) tells the agent to run `npm ci && npm run build`.

---

## How the agent uses it

[SKILL.md](SKILL.md) is the agent's instruction sheet. It is about 3 200 tokens and written for a
small model. A typical request goes through five steps:

1. **Read the request.** The agent extracts:
   - the topic, as an English Wikipedia title or with `--source <lang>`;
   - the language editions;
   - the period (default: 24 months);
   - whether a PDF was asked for.

   It asks one short question when the editions are not named or the topic has several meanings.
2. **Run one CLI command.** It calls `analyze` (or `report` for a PDF) with all editions at once:
   `node "${CLAUDE_SKILL_DIR}/dist/cli.js" analyze --topic "Astronomy" --languages uk`.
3. **Handle problems:**
   - `TOPIC_AMBIGUOUS` / `TOPIC_NOT_FOUND`: show the candidates and ask; never pick one.
   - Missing editions: report them, or propose a broader article, verify it with `--title` and
     use it only after the user agrees.
4. **Read the JSON.** Its fields are listed in
   [references/output-fields.md](references/output-fields.md).
5. **Answer.** The answer contains:
   - the key numbers, copied from the JSON;
   - the confidence level with all its reasons;
   - the missing editions;
   - the attention-not-demand caveat;
   - the PDF path, when there is one.

SKILL.md starts with seven **Hard rules**, added after the Haiku evaluation:

1. No numbers of the agent's own: gaps between editions only as `relativeToLeaderPct`.
2. Copy the confidence level and all its reasons.
3. "Views per million" means per million pageviews of that edition, never per person.
4. Make a PDF only when the user asks for one.
5. Never switch the topic without asking.
6. Every answer states the attention-not-demand caveat.
7. Name editions, not countries.

Recorded agent runs of the three assignment scenarios are in
[evaluation/end-to-end.md](evaluation/end-to-end.md).

---

## CLI reference

```
node dist/cli.js resolve --topic <title> --languages <codes> [options]   # article per edition
node dist/cli.js analyze --topic <title> --languages <codes> [options]   # metrics, confidence, findings
node dist/cli.js report  --topic <title> --languages <codes> [options]   # same + one-page PDF
node dist/cli.js help | version
```

| Option | Meaning |
| --- | --- |
| `--topic` | The topic as an article title in the source language. |
| `--languages` | Comma-separated edition codes (`pl,cs,uk`), at most 20; aliases like `nb` → `no` are normalized. |
| `--source <code>` | The edition in which `--topic` is looked up. Default `en`. |
| `--title <code>=<Title>` | Use this article for that edition instead of the interlanguage link. Repeatable. |
| `--months N` or `--start YYYY-MM-DD` | The period: N calendar months (1–120, default 24), or a start date. |
| `--end YYYY-MM-DD` | The last day. Default: yesterday (UTC). |
| `--charts` | Also write SVG charts. |
| `--out DIR` | Output folder. Default `output/` (gitignored). |
| `--note "..."` | `report` only: a short analyst note (≤ 600 characters), labelled in the PDF as not computed. |
| `--no-cache` | Bypass the local cache. |

**Output contract.** Every command prints exactly one JSON line and exits with 0 or 1:

```json
{ "ok": true,  "command": "analyze", "data": { "period": {...}, "languages": [...], "confidence": {...}, "findings": [...], "limitations": [...] } }
{ "ok": false, "command": "analyze", "error": { "code": "TOPIC_AMBIGUOUS", "message": "...", "details": { "candidates": [...] } } }
```

- The output is compact: no raw series, and a typical analysis is 3–7 KB.
- Numbers are rounded, and percentages are already ×100 (fields ending in `Pct`).
- `warnings` explain clamped dates or a late start, with the `--start` to use.
- `apiRequests` counts the HTTP calls made.
- Error codes:
  - arguments: `INVALID_ARGUMENT`;
  - topic: `TOPIC_AMBIGUOUS`, `TOPIC_NOT_FOUND`, `NO_ARTICLES`;
  - Wikimedia: `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `SERVER_ERROR`, …;
  - anything else: `INTERNAL_ERROR`.

---

## Architecture

The LLM interprets and explains; deterministic TypeScript code does all the data work. This
split follows the assignment's rules: numbers must be reproducible and testable, and the model
must never compute statistics from raw data.

```
 user ──► agent (SKILL.md) ──► CLI (src/cli.ts, src/commands/)          one JSON line back
                                  │
          ┌───────────────────────┼─────────────────────────────┐
          ▼                       ▼                             ▼
  wikipedia/resolver.ts     data/pageviews.ts             reports/, charts/
  topic → article per       cached daily series           report model, Vega-Lite
  edition (Action API,      (Pageviews API, per-article   specs → SVG, one-page
  Wikidata langlinks)       + edition totals)             PDF (PDFKit)
          │                       │                             ▲
          └──────────► analysis/ (stats, trends, outliers, patterns, compare, confidence) ─┘
```

| Folder | Responsibility |
| --- | --- |
| `src/wikipedia/` | Shared HTTP layer (User-Agent, retries, `Retry-After`, error codes), language-code normalization, Pageviews client, article resolver. |
| `src/data/` | The daily series model (gap filling, coverage), monthly/weekly aggregation, and an incremental JSON file cache. |
| `src/analysis/` | Statistics, trend and change metrics, outliers, level shifts and seasonality, cross-edition comparison, and the confidence model. |
| `src/charts/` | Vega-Lite specs built only from precomputed values (a test forbids Vega-Lite transforms), rendered to SVG in Node. |
| `src/reports/` | The report model (table, templated findings, confidence, limitations) and the A4 PDF layout with the embedded Noto Sans font. |
| `src/commands/` | Argument parsing, the resolve → fetch → analyze pipeline, compact JSON for the agent, output files. |
| `assets/fonts/` | Noto Sans (OFL), used for PDF text and chart text measurement. |
| `docs/wikimedia-api.md` | Wikimedia API behavior the code relies on, each point verified live or sourced from the docs. |
| `evaluation/` | End-to-end runs, the Haiku 4.5 evaluation, the edge-case matrix and the log-analysis scripts. |

Design decisions worth knowing:

- **Articles are matched through Wikidata**, not by searching foreign wikis. Search in another
  language returned unrelated pages. The resolver never auto-selects a search result. The only
  exception is a result whose title differs from the topic only in letter case.
- **Redirect targets are used**, because the Pageviews API counts redirect views separately.
- **Editions are compared by views per million edition pageviews.** Raw totals mostly reflect
  how big an edition is.
- **Missing days are imputed as 0 and counted.** The API omits zero-view days (observed but
  undocumented), and the imputed share feeds the confidence model.
- **The cache is incremental.** Days older than 3 days are treated as final; recent days are
  re-fetched after 4 hours. A repeated analysis makes 0–2 requests.
- **Findings in the JSON and the PDF are templated by code.** The agent quotes them; the only
  free text in the PDF is the labelled analyst note.

[AGENTS.md](AGENTS.md) is the detailed developer handoff: every decision, every stage, and the
implementation details.

---

## Methods

| Metric | Method |
| --- | --- |
| Trend | Theil–Sen slope on the average daily views of complete months (complete weeks for short periods), with a Mann–Kendall test; a direction is reported only if p < 0.05. |
| Rate per year | Compound rate from a Theil–Sen fit on log values. |
| Changes | Last 365 vs previous 365 days (YoY), last 90 vs previous 90 days, each also with spike days removed. |
| Outliers | Hampel filter (rolling median ± 3.5 robust z over a ±14-day window). |
| Level shift | Pettitt change point, kept only when two levels fit better than a line; checked against the edition-wide totals. |
| Seasonality | Lag-12 Spearman correlation of detrended monthly values (needs 22 complete months). |
| Normalization | Views per million pageviews of the whole edition (agent = user). |

**Confidence** (`high` / `medium` / `low`) is not a percentage. Each factor is rated `ok`,
`caution` or `weak` against explicit thresholds (`CONFIDENCE_THRESHOLDS` in
`src/analysis/confidence.ts`), and the level is the weakest factor. The factors are:

- how well the article matches the topic;
- period length;
- traffic volume;
- missing days and a late start;
- the share of views from spikes;
- month-to-month consistency;
- level shifts, noting when the whole edition shifted too;
- for comparisons, whether the ranking holds month by month.

Claims about the trend, YoY and recent change get their own levels, which are never higher than
the data level.

---

## Configuration and caching

| Variable | Purpose |
| --- | --- |
| `WIKI_SKILL_CONTACT` | An email or URL sent in the User-Agent, as the [Wikimedia policy](https://meta.wikimedia.org/wiki/User-Agent_policy) requires. Without it Wikimedia may rate-limit the client (HTTP 429). |
| `WIKI_SKILL_CACHE_DIR` | Cache folder. Default `.cache/` in the project root; an empty value disables the cache. |

- Variables can be set in the shell or in `.env` in the project root. The file is loaded with
  Node's built-in `process.loadEnvFile`, and shell values win.
- The CLI finds `.env`, the cache and `output/` from its own real location, so it works from any
  working folder and through a junction.
- Resolver responses are cached for 7 days. Errors are never cached. The cache folder can be
  deleted at any time.

---

## Testing and evaluation

| Command | What it runs |
| --- | --- |
| `npm test` | 268 deterministic unit tests, with no network. |
| `npm run test:integration` | 22 live tests against the real Wikimedia APIs, sequential. Set `WIKI_SKILL_CONTACT` first. |
| `npm run typecheck` | Strict TypeScript over `src/` and `tests/` (including unused-code checks). |
| `npm run build` | Compiles to `dist/`. |

What the unit tests cover:

- **Statistics** against reference values computed independently in Python (Theil–Sen,
  Mann–Kendall, Pettitt, normal CDF, correlations).
- **The data layer** with a fake Pageviews API and an in-memory cache.
- **The resolver** with fixtures shaped like captured MediaWiki responses.
- **The CLI end to end** with a URL-routed fake of both Wikimedia APIs
  (`tests/helpers/fake-wikimedia.ts`): arguments, errors, timeouts, the PDF.
- **Charts:** only precomputed values, and only characters the font can draw.
- **The report:** it fits on one page.
- **`tests/skill.test.ts`:** SKILL.md has valid frontmatter, and every command, flag, error code
  and field it names exists in the code.

Beyond the tests:

- [evaluation/end-to-end.md](evaluation/end-to-end.md): the three assignment scenarios, run by
  fresh agents that saw only SKILL.md. Every number in their answers was checked against the CLI
  output.
- [evaluation/haiku-4.5.md](evaluation/haiku-4.5.md): three runs with Claude Haiku 4.5 in Claude
  Code, covering 6 scenarios, cost, failures, the SKILL.md changes they led to, and a bug they
  exposed. The runbook is [evaluation/haiku-4.5-runbook.md](evaluation/haiku-4.5-runbook.md).
- [evaluation/edge-cases.md](evaluation/edge-cases.md): the assignment's edge-case list, run
  against the live APIs, before and after the fixes.
- `evaluation/scripts/`: `parse-session.mjs` turns a Claude Code session log into a readable
  timeline with token usage; `check-session.mjs` lists the numbers in an agent's answers that do
  not appear in the CLI output.

---

## AI-assisted development

The project was built with AI tools under explicit rules, and each AI output was checked by
something other than the AI that produced it.

**How it was built:**

- The development prompt, [prompts/master_rules.md](prompts/master_rules.md), was prepared with
  **ChatGPT**. It sets out the assignment, a 14-stage roadmap and the working rules.
- **Claude Code** (Claude Opus) implemented the project one stage per session, following
  [AGENTS.md](AGENTS.md). The rules were:
  - ask instead of assuming;
  - never invent API behavior;
  - no significant architectural change without approval;
  - tests are part of every stage;
  - the AI never commits.
- The developer reviewed every stage, answered the design questions (the decisions are
  recorded in AGENTS.md) and made each commit by hand. The git history has one commit per stage.
- Claude subagents and Claude Haiku 4.5 were used to test the skill as an agent would use it.

**How the AI's output was validated:**

- **API behavior:** every assumption about the Wikimedia APIs was verified with real requests
  before code depended on it, and recorded with its source in
  [docs/wikimedia-api.md](docs/wikimedia-api.md). Examples: zero-view days are omitted,
  redirects are counted separately, titles are case-sensitive, spelling suggestions exist.
- **Statistics:** unit tests compare against values computed independently in Python, not
  against the implementation's own output.
- **Real data:** live checks on the assignment topics were pinned in integration tests (e.g. the
  mid-2025 step in uk articles, which the edition totals showed to be partly platform-wide).
- **Charts and PDFs:** they were rendered and inspected visually at each stage. That review
  found and fixed text-width errors, an unreadable spike-dominated axis and a collapsed zero
  axis.
- **Agent behavior:** fresh agents that saw only SKILL.md ran the assignment scenarios, and a
  script checked every number in their answers against the CLI output. Three Haiku 4.5 runs
  measured instruction following. Own ratios fell from 3 of 6 answers to 0, and PowerShell
  failures from 4 to 0, after the SKILL.md changes. The runs also exposed a real CLI bug: a silent
  exit when the CLI was started through a junction.
- **Instructions vs code:** `tests/skill.test.ts` fails if SKILL.md names a command, flag, error
  code or field that the code does not have. It caught two made-up field names in an AI-written
  draft of the reference.

---

## Developing the skill further

The current version answers the basic requests well. The next steps, roughly in order of value,
are below.

1. **Topics bigger than one article.** Add an article's redirects and closely related articles
   (Wikidata "part of" / "subclass of", category members) into a topic cluster, so interest in
   "learning English" is not limited to one article that exists in 7 of 20 editions. The analysis
   layer already compares any list of series (`compareLanguages`). The missing piece is a
   `compare-topics` command that accepts several articles per edition.
2. **More editions and longer periods.** Run requests concurrently under a client-side rate
   limiter (Wikimedia allows 200 requests/min with a contact). Use monthly granularity for
   multi-year ranges. Share edition totals across topics. Add cache eviction. Today 20
   uncached editions cost about 40 sequential requests.
3. **Better methods where the data showed the need:**
   - model seasonality instead of only flagging it;
   - detect more than one change point;
   - add bootstrap intervals for YoY;
   - suppress the per-year rate on short periods;
   - start YoY at an article's creation date;
   - calibrate the confidence thresholds on a labelled set of topics.
4. **Other evidence, kept separate.** Show search volume, app-store data or survey results next
   to Wikipedia attention as clearly labelled sources, never merged into one "demand" number.
5. **Agent integration:**
   - an MCP server exposing the same commands with JSON schemas;
   - a small session-state file so follow-ups ("same for 5 years") reuse the previous flags;
   - an automated Haiku regression suite, with `evaluation/scripts/check-session.mjs` as the
     grader.
6. **Reports:** subset CJK/Arabic fonts (these titles are now "?"), an optional second page, and
   an interactive HTML version.

---

## Limitations

- Pageviews show attention on Wikipedia only. They are not demand, and they exclude people who
  read another language edition (often English) or use other sources.
- One article per edition. Coverage and article quality differ between editions; per-million
  normalization removes edition size, not these effects.
- The confidence thresholds are documented heuristics, checked mainly on the assignment's cs/uk
  data, not calibrated probabilities.
- The per-year trend rate can be extreme on short periods. YoY is inflated when an article was
  created within the previous year; the CLI then suggests a later `--start`.
- The PDF font covers Latin, Greek and Cyrillic only.

The full list is in AGENTS.md ("Known limitations").

## License

[MIT](LICENSE). Noto Sans is under the [SIL Open Font License](assets/fonts/OFL.txt).
