---
name: wikipedia-interest-skill
description: Measures and compares interest in a topic across Wikipedia language editions using Wikimedia pageview data. Resolves the topic to the right article in each language, computes totals, per-million normalization, year-over-year change, trends, spikes and an evidence-based confidence level, and can write charts and a one-page PDF report. Use when a user asks how interest in a topic changes over time, compares interest between languages or topics on Wikipedia, asks which language audiences or topics to research next, asks how much to trust such a trend, or wants a short shareable report on Wikipedia interest.
license: MIT
compatibility: Requires Node.js 22.12+ and npm, and internet access to wikipedia.org and wikimedia.org. Runs a local CLI with a shell tool.
---

# Wikipedia interest analysis

All numbers come from the CLI in this folder. Your job: turn the request into CLI flags, run
one command, and explain the JSON it prints. **Never compute, estimate or invent numbers.**

Wikipedia pageviews measure **attention and information-seeking**, not market demand,
purchase intent or willingness to pay. Every answer must say so.

## 0. Setup (once per machine)

Run every command from this skill's folder (the folder that contains this SKILL.md).

1. If `dist/cli.js` does not exist: `npm ci` then `npm run build`.
2. If `.env` does not exist, tell the user once: copy `.env.example` to `.env` and put a real
   email in `WIKI_SKILL_CONTACT` (Wikimedia rate-limits clients without a contact). You can
   continue without it.

## 1. Read the request

Extract five things:

| Item | How |
| --- | --- |
| **Topic** | The English Wikipedia article title for the concept, e.g. "interval fasting" → `Intermittent fasting`, "астрономія" → `Astronomy`. Use the specific concept, not the user's phrase ("interest in learning English" → the concept of learning English as a foreign language). If you do not know the English title, use the user's own word and add `--source <language of that word>`, e.g. `--topic "Астрономія" --source uk`. Never run a non-English word with the default English source. |
| **Languages** | Wikipedia edition codes, comma-separated: `pl` Polish, `cs` Czech, `uk` Ukrainian, `de`, `fr`, `es`, `pt`, `it`, `ro`, `hu`, `tr`, `ru`, `ja`, `ko`, `zh`, `ar`, `hi`, `en` … (max 20). A language edition is an audience of readers of that language, not a country (`es` covers Spain and Latin America; `en` is global). The language the user writes in is **not** a language to analyze. |
| **Period** | Default: last 24 months (no flag). "last year" → `--months 12`; "last 3 years" → `--months 36`; exact dates → `--start YYYY-MM-DD --end YYYY-MM-DD`. |
| **Report?** | Use `report` only if the user asks for a report, PDF, something shareable or to send. Otherwise `analyze`. |
| **Charts?** | Add `--charts` if the user asks for charts or graphs (writes SVG files). `report` already contains charts. |

**Ask the user first (one short question, then stop) when:**
- no language edition is named or clearly implied: ask which Wikipedia language editions to compare. Do not choose them yourself.
- the topic could mean clearly different things and you cannot tell which one.

Do not ask about the period: use the default and say which period you used.

If the user asks about demand, sales or market size, answer with this skill but state that
pageviews only show attention on Wikipedia.

## 2. Run the CLI

```
node dist/cli.js resolve --topic "<Title>" --languages <codes>      # which article per language (no pageviews)
node dist/cli.js analyze --topic "<Title>" --languages <codes>      # metrics + confidence + findings
node dist/cli.js report  --topic "<Title>" --languages <codes> [--note "..."]   # same + one-page PDF
```

Options for all commands: `--source <code>` (language of `--topic`, default `en`),
`--title <code>=<Title>` (use this article for that language; repeatable), `--no-cache`.
`analyze` and `report` also take `--months N` or `--start`, `--end`, `--charts`, `--out <dir>`.
`report` takes `--note "<text>"` (see step 5). `node dist/cli.js help` lists everything.

Rules:
- Put **all** languages in one call. Never loop over languages.
- Run `resolve` first only when you are unsure the topic title is a real article. Otherwise go straight to `analyze` / `report` (they resolve too).
- Quote values that contain spaces. The command prints one JSON line: `{"ok":true,"data":{...}}` or `{"ok":false,"error":{"code","message","details"}}`.
- Repeated calls are cheap (results are cached). Reuse the same `--topic`, `--source` and `--title` flags in follow-up calls.

## 3. Handle errors and missing languages

Retry at most once per problem. Never loop.

| `error.code` | What to do |
| --- | --- |
| `TOPIC_AMBIGUOUS` | The title is a disambiguation page. Show `details.candidates` (title + description) and ask which one the user means. Never pick one yourself. Re-run with the chosen title as `--topic`. |
| `TOPIC_NOT_FOUND` | If the topic is not in the source language, re-run once with the correct English title or with `--source <code>`. Otherwise show `details.candidates` (unverified search hits) and ask. |
| `NO_ARTICLES` | None of the requested editions has an article. Tell the user (`details.missing`) and use the "missing editions" rule below. |
| `INVALID_ARGUMENT` | Fix the flag as the message says and re-run once. |
| `RATE_LIMITED` | Do not retry now. Tell the user to set `WIKI_SKILL_CONTACT` in `.env` and try again later. |
| `TIMEOUT`, `NETWORK_ERROR`, `SERVER_ERROR` | Re-run once. If it fails again, report the error. |
| anything else | Report `error.message`. Give no numbers. |

**Missing editions** (`data.missing` in a success, or `NO_ARTICLES`): name each edition and its
`reason` in your answer. The edition usually has no article on this exact concept. You may
suggest an article title you believe exists (e.g. a broader article). Verify it first:

```
node dist/cli.js resolve --topic "<same topic>" --languages pl --title "pl=<Title>"
```

Show the user what it matched (`article`, `confidence`, `notes`). Use it only after the user
agrees, by adding the same `--title` flag to `analyze` / `report`. Say that it is a different
or broader article, so its numbers are not directly comparable.

## 4. Read the result

Use only these fields (full list: [references/output-fields.md](references/output-fields.md)):

- `period` — the analyzed dates. Always state them.
- `rankedBy` — `views_per_million` means languages are compared relative to edition size. Use this ranking (`comparison.ranking`, `relativeToLeaderPct`) to compare languages. `totalViews` mostly reflects how big an edition is.
- Per language (`languages[]`): `article`, `totalViews`, `dailyMedian`, `viewsPerMillion`, `yoyChangePct`, `yoyChangeExcludingSpikesPct`, `recent90ChangePct`, `trend`, `levelShift`, `seasonality`, `spikes`, `resolution`, `confidence`.
- `trend.direction`: `increasing` / `decreasing` are statistically significant. `no_significant_trend` means no clear direction; it is not proof that interest is stable.
- `levelShift` not null: interest jumped or dropped once between the two months in `between`. If `editionChangePct` is set, the whole edition changed at the same time, so part of the change is not about the topic.
- `yoyChangePct` very different from `yoyChangeExcludingSpikesPct`: the change is driven by a few spike days.
- `resolution.confidence` = `medium`: the article only partly matches the topic (read `resolution.notes`).
- `confidence.level` (`high` / `medium` / `low`) and `confidence.reasons`: how far the numbers can be trusted as a measure of Wikipedia attention. Per-claim levels: `languages[].confidence.trend`, `.yearOverYear`, `.recentVsPrevious`.
- `findings` — ready-made sentences computed by the code. Prefer them.
- `limitations` — `limitations[0]` is the attention-not-demand caveat.
- `warnings` — mention any that affect the answer (e.g. shortened period).
- `files` — paths of the PDF (`files.report`) and SVG charts (`files.charts`).

## 5. Write the answer

Reply in the user's language. Name editions, not countries ("Czech Wikipedia", not "Czechia"
or "in Poland"). Keep it short:

1. **Answer** in one or two sentences (e.g. which edition shows more interest relative to its size, and whether interest is rising or falling).
2. **Key numbers**, copied from the JSON: per language `viewsPerMillion`, `totalViews`, `yoyChangePct`, trend direction and `perYearPct`. A small table is fine.
3. **Confidence**: `confidence.level` with its reasons in plain words. For trends and changes, give the per-claim level too.
4. **Missing editions** and their reasons, if any.
5. **Limitation**: pageviews show attention on Wikipedia, not market demand or willingness to pay (from `limitations[0]`). Add other limitations only if relevant.
6. **Next step** (for "what to research next" questions): which editions or topics look worth validating next and why, based only on the numbers and confidence above; suggest validating with real demand data (search volume, surveys, app-store data, pilot sales).
7. **Files**: the PDF / chart paths, if any.

For a report, `--note` is an optional analyst note printed in the PDF and labelled "written by
the AI agent, not computed". Write it after you have seen the numbers (run `analyze` first, or
re-run `report` with the note): max 600 characters, English, interpretation only, no numbers
that are not in the JSON.

**Before sending, check:** every number is in the JSON; the period is stated; the confidence
level and reasons are stated; missing editions are mentioned; the attention-not-demand
limitation is stated.

## Never

- Compute your own numbers: no sums, averages, ratios, differences or percentages. For "how much more", quote `relativeToLeaderPct` or both values.
- Invent article titles, language results, dates or data for missing editions.
- Pick a disambiguation or search candidate for the user.
- Call pageviews demand, market size, customers, users or willingness to pay.
- Raise a confidence level or drop its reasons.
- State a cause for a spike or level shift as fact. You may say it needs checking (news, article rename, search-engine changes).
- Write your own scripts or call Wikimedia directly instead of using the CLI.

## Follow-up requests

- Different period, languages or topic → re-run the same command with changed flags.
- "Make a PDF of that" → `report` with the same flags (add `--note` if useful).
- Compare topics in one language → run `analyze` once per topic and report each result separately. Compare topics only by the values the CLI printed, and note that different articles are not equally broad.
