# Edge cases and robustness (Stage 13)

Each case from the assignment's Stage 13 list was run through the real CLI against the live
Wikimedia APIs on 2026-09-25. Cases that cannot be forced live (network errors, timeouts,
server errors, zero views over a whole period) are covered by unit tests with a fake Wikimedia
(`tests/cli.test.ts`, `tests/helpers/fake-wikimedia.ts`).

| Case | Example | Result before | Result now |
| --- | --- | --- | --- |
| Article does not exist | `Xqzzy foobarium nonexistent` | `TOPIC_NOT_FOUND`, no candidates | unchanged (correct) |
| Incorrect title (typo) | `Astronmy` | `TOPIC_NOT_FOUND`, **no candidates** | candidates from MediaWiki's spelling suggestion: `Astronomy` first |
| Wrong letter case | `Intermittent Fasting` | `TOPIC_NOT_FOUND` (titles are case-sensitive) | **resolved** to `Intermittent fasting`, with a note |
| Lower-case first letter | `astronomy` | resolved (MediaWiki capitalizes it) | unchanged |
| Redirect to a section | `Fasting mimicking diet` → `Valter Longo#…` | resolved, confidence medium, explained | unchanged |
| Disambiguation page | `Mercury`, `learning English` | `TOPIC_AMBIGUOUS` with candidates | unchanged |
| Edition unavailable | `tlh`, `xx-yy` | `missing`: "edition does not exist" | unchanged |
| Odd language codes | `PL, uk ,nb,no,uk` | normalized: pl, uk, no (deduplicated) | unchanged |
| Too many languages | 21 codes | `INVALID_ARGUMENT` | unchanged |
| API errors | 429 / 503 | `RATE_LIMITED` / `SERVER_ERROR` after retries | tested for both |
| Timeout, network error | also when only the edition totals fail | not tested at CLI level | `TIMEOUT` / `NETWORK_ERROR` tested |
| Incomplete data (article created mid-period) | `ChatGPT` uk, 2022–2023 | low confidence ("first reported day …") | plus a warning: re-run with `--start <first day>`, one date for a whole comparison |
| Zero views over the whole period | `ChatGPT` uk, 2021 | "no clear trend", "busiest day 2021-01-01 with 0 views", chart axis "0.000000" | "no views reported", no busiest day, "no interest to measure", axis 0–1 |
| Very low traffic | cs `Stelární astronomie` (median 0–1/day) | low confidence with volume, missing-day and spike reasons | unchanged (correct) |
| Extreme outliers | uk `Єлизавета II`, 2022 (141 058 views on one day vs 2 408 typical) | low; spikes carry 56 % of views | unchanged (correct) |
| Very large gap between editions | `Astronomy` en / uk / ga | ga (1 view/day) ranked first per million without comment | the finding adds "ga has low data confidence" |
| Small per-million values | 0.12 vs 0.28 | shown as "0.1" and "0.3" in the PDF | three significant digits ("0.12", "3.94", "57.5") |
| Short periods | 1 day, 7 days, 1 month | work, confidence low, "Only 1 days" | "Only 1 day" |
| Start in the future / before 2015-07-01 | | `INVALID_ARGUMENT` / clamped with a warning | unchanged |
| Non-Latin titles in the PDF | ja, zh | "?" with a warning (font coverage) | unchanged (known limitation) |

## Not changed (decided with the user)

- **Trend rate per year on short periods.** On a 185-day weekly trend with a step, the
  compound rate per year was +31 799 %. The direction and p-value are sound; the extrapolated
  rate is not. This is documented as a known limitation.
- **Year-over-year after an article was created.** The previous year is mostly imputed zeros,
  so YoY becomes huge (+4 539 % for uk `ChatGPT` 2022–2023). The confidence is already low, and
  the new `--start` hint points to a fair period. This is documented as a known limitation.
