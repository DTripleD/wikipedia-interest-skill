# Wikimedia Pageviews API — verified assumptions

This file records what the client in [src/wikipedia/api.ts](../src/wikipedia/api.ts) relies on.
Each point is marked with where it comes from:

- **[verified]**: observed against the live API with real requests on 2026-09-23.
- **[docs]**: stated in the official Wikimedia documentation.
- **[observed, undocumented]**: seen in practice but not documented; treat it with care.

Re-check this file whenever the client starts behaving unexpectedly.

## Endpoint

```
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
    {project}/{access}/{agent}/{article}/{granularity}/{start}/{end}
```

| Segment       | Values                                                        | Source     |
| ------------- | ------------------------------------------------------------- | ---------- |
| `project`     | `pl.wikipedia` or `pl.wikipedia.org` both work; `plwiki` → 404 | [verified] |
| `access`      | `all-access`, `desktop`, `mobile-app`, `mobile-web`           | [verified] (400 error lists them) |
| `agent`       | `all-agents`, `user`, `spider`, `automated`                   | [verified] (400 error lists them) |
| `granularity` | `daily`, `monthly` (`hourly` → 400)                           | [verified] |
| `start`/`end` | `YYYYMMDD` or `YYYYMMDDHH`, inclusive; `2024-01-01` → 400     | [verified] |

The client always sends `{lang}.wikipedia` and defaults to `all-access` / `user` / `daily`.
`agent=user` leaves out self-identified spiders and heuristically detected automated
traffic [docs].

## Responses

- **200:** `{"items":[{project, article, granularity, timestamp:"YYYYMMDD00", access, agent, views}]}`,
  sorted by timestamp. `article` comes back with underscores. [verified]
- **404** (`application/problem+json`): *"The date(s) you used are valid, but we either do
  not have data for those date(s), or the project you asked for is not loaded yet."*
  [verified] The same 404 comes back for:
  - a nonexistent article;
  - an existing article with no views in the range;
  - an unknown project (e.g. `xx.wikipedia`).

  The client therefore returns `noData: true` rather than throwing. Checking that the
  project and article exist is the resolver's job (Stage 3).
- **400:** invalid parameters, including start > end. Includes a human-readable `detail`. [verified]
- **403:** returned when no User-Agent is sent. [verified]

## Data coverage

- Data starts on **2015-07-01** [docs, verified]. If `start` is earlier, the API silently
  truncates it. The client clamps the start date itself and adds a warning.
- An `end` in the future is fine: the API returns data up to the latest loaded day. [verified]
- On 2026-09-23 at ~19:00 UTC the latest available day was 2026-09-22, a lag of about one
  day. [observed, undocumented]
- **Monthly granularity counts partial months.** A range of `20240115–20240420` returns
  January = 24 876 views (Jan 15–31 only), versus 43 527 for the full month. [verified]
  The client warns when a monthly range does not cover whole months. Later stages should
  fetch daily data and aggregate it themselves.
- One daily request covering 2015-07-01 → 2026-09-22 (~4 100 items, ~600 KB) worked in
  ~1.2 s, so no pagination is needed. [verified]

## Missing days / zero views [observed, undocumented]

For a low-traffic article (`cs.wikipedia/Hvězdná_astronomie`, January 2024), `agent=user`
returned only 13 of 31 days, and 11 of those had `views: 0`. With `agent=all-agents`, the
same 13 days came back, each with views ≥ 1.

Working hypothesis: a day is omitted when the article had no views from any agent that day,
so a missing day most likely means 0 views. This is not documented. The client does not
fill gaps. Stage 4 (normalization) decides how to treat missing dates and must report them
as a data-quality signal.

## Titles

- Case-sensitive: `astronomy` → 404, `Astronomy` → 200. [verified]
- Spaces work like underscores: `Intermittent%20fasting` returns article `Intermittent_fasting`. [verified]
- `/` must be percent-encoded (`AC%2FDC` works). The client uses `encodeURIComponent`. [verified]
- Non-ASCII titles work when percent-encoded as UTF-8 (`Астрономія`). [verified]
- **Redirects are counted separately:** views of a redirect title are not counted as views
  of the target article [docs, Research:Page view]. The resolver must return the canonical
  (target) title.

## Rate limits and etiquette [docs]

- Every request must carry a User-Agent in the form
  `<client>/<version> (<contact>) <library>/<version>`. The client sends
  `wikipedia-interest-skill/<version> (<WIKI_SKILL_CONTACT>)`.
- Unauthenticated clients with a compliant User-Agent may make 200 requests/minute
  ("User-Agent only" category). Unidentified clients get 10 requests/minute.
- The docs advise waiting for each request to finish before sending the next one.
- 429 and 503 responses usually include `Retry-After`. Clients must respect it. Without
  it, they should wait at least 5 s or back off exponentially.
- Successful responses carry `cache-control: s-maxage=14400, max-age=14400` (4 h). [verified]

Sources:
- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html
- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html
- https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html
- https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits

## Client retry policy

| Condition                    | Behavior                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------- |
| 200                          | parse and validate `items`                                                        |
| 404                          | `noData: true`, no error                                                          |
| 400 / 403 / other 4xx        | fail immediately (`BAD_REQUEST` / `FORBIDDEN` / `HTTP_ERROR`)                     |
| 429                          | retry after `Retry-After`, otherwise after max(5 s, backoff) → `RATE_LIMITED`     |
| 503                          | retry after `Retry-After`, otherwise after backoff → `SERVER_ERROR`               |
| other 5xx                    | retry after backoff → `SERVER_ERROR`                                              |
| timeout (15 s) / network     | retry after backoff → `TIMEOUT` / `NETWORK_ERROR`                                 |
| `Retry-After` > 60 s         | fail immediately rather than block the agent                                     |

Backoff is `1 s × 2^retry`. There are at most 3 retries. There is no jitter, because the
client makes low-volume, sequential requests.
