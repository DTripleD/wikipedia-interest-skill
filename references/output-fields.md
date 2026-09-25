# CLI output fields

Every command prints one JSON line. All numbers are computed by the code: quote them, never
recompute them. Fields ending in `Pct` are percentages already multiplied by 100
(`-56.3` means −56.3 %). `null` means "not available" (too little data), not zero.

## Envelope

- Success: `{ "ok": true, "command": "...", "data": { ... } }`
- Failure: `{ "ok": false, "command": "...", "error": { "code", "message", "details"? } }`
  - `details.candidates`: `[{title, description}]` for `TOPIC_AMBIGUOUS` / `TOPIC_NOT_FOUND`.
  - `details.missing`: the same shape as `data.missing` below, for `NO_ARTICLES`.
- Error codes: `INVALID_ARGUMENT`, `UNKNOWN_COMMAND`, `TOPIC_AMBIGUOUS`, `TOPIC_NOT_FOUND`,
  `NO_ARTICLES`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `SERVER_ERROR`, `FORBIDDEN`,
  `BAD_REQUEST`, `HTTP_ERROR`, `HOST_NOT_FOUND`, `INVALID_RESPONSE`, `INTERNAL_ERROR`.

## `resolve` data

- `topic`: the `--topic` value.
- `source`: `{language, status: found|ambiguous|not_found, article, notes?, candidates?}`: the topic in the source edition.
- `languages[]`: `{language, status, article, confidence, method, redirectedFrom?, notes?, candidates?}`
  - `status`: `resolved` | `ambiguous` | `not_found` | `language_unavailable` (no such edition).
  - `confidence`: `high` (same concept, verified) | `medium` (partial or indirect match; read `notes`) | `null`.
  - `method`: `interlanguage_link` | `source_article` | `explicit_title` (from `--title`).
- Footer (all commands): `warnings?`, `apiRequests` (HTTP requests sent), `cache` (`on` | `off`).

## `analyze` / `report` data

- `topic`, `sourceArticle: {language, title}`.
- `period: {start, end, days}`: the common period of all languages.
- `rankedBy`: `views_per_million` (relative to edition size) or `total_views`.
- `languages[]`, in ranking order:
  - `rank`, `language` (edition code), `article`.
  - `resolution: {confidence, method, notes?}`: how well the article matches the topic.
  - `totalViews`: all views in the period. `dailyMean`, `dailyMedian`: views per day.
  - `viewsPerMillion`: views per million views of the whole edition in the period. Use this to compare editions.
  - `peakDay: {date, views}`.
  - `yoyChangePct`: last 365 days vs the 365 before. `yoyChangeExcludingSpikesPct`: the same with spike days removed.
  - `recent90ChangePct`: last 90 days vs the 90 before (can be seasonal).
  - `trend`: `{direction: increasing|decreasing|no_significant_trend, perYearPct, significance, basis: monthly|weekly, periods}` or `{direction: "not_available", reason}`. `perYearPct` is the fitted compound change per year; describe it only as "about".
  - `levelShift`: `null`, or `{between, fromPerDay, toPerDay, editionChangePct}`. `between` is two months (`YYYY-MM`): the last before and the first after the step; `fromPerDay` / `toPerDay` are the typical views per day before and after. `editionChangePct` not null → the whole edition changed at the same time.
  - `seasonality`: `detected` | `not_detected` | `not_assessed` (needs 22 complete months).
  - `spikes: {outlierDays, excessViewsSharePct, largest?: {date, views, typical}}`: `excessViewsSharePct` is the share of all views that came from spikes.
  - `imputedDays`: days with no data, counted as 0.
  - `confidence: {level, reasons, trend, yearOverYear, recentVsPrevious}`: each claim is `{level, reasons?}` or `null`.
- `comparison.ranking[]` (2+ languages): `{language, value, relativeToLeaderPct}`. `value` is views per million (or total views); the leader is 100.
- `missing[]`: `{language, status, reason, candidates?}`: requested editions with no usable article.
- `confidence: {level, reasons}`: overall level (the weakest factor, including ranking stability for comparisons).
- `findings[]`: templated sentences (the same as in the PDF).
- `limitations[]`: `limitations[0]` is always the attention-not-demand caveat.
- `files?`: `{report?, charts?}` with absolute paths (`report` command, or `--charts`).
