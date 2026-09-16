# Phase 2 — Prompt 5: Final Assembly + Robustness (Phase 2 Complete)

## What's new / changed this prompt

```
backend/
  src/
    services/
      pipeline.js     # REWRITTEN — single consolidated entry point,
                         runPipeline({ topic, freshnessWindow, updateType }).
                         Replaces Prompt 4's runPipelineForTopic().
      fetchAll.js      # MODIFIED — now returns `sourceErrors` (which
                         source failed + why) alongside items/counts,
                         instead of only console-logging failures.
      reddit.js         # MODIFIED — retry-with-backoff on throttled/
                         blocked responses (429/403), paced (staggered)
                         subreddit requests instead of firing them all at
                         once, and a clear [RATE_LIMITED] tag in error
                         messages when that's specifically what happened.
    routes/
      testPipeline.js      # MODIFIED — GET /pipeline kept for backward
                         compatibility; GET /pipeline/full added (this
                         prompt's target endpoint).
```

**Untouched:** `dedup.js`, `freshness.js`, `hackernews.js`, `rss.js`,
`config/topics.js`, `lib/supabaseClient.js`, `geminiCaption.js`,
`imageHandler.js`, `cardStore.js`, `utils/concurrency.js`,
`utils/normalize.js`, the `users` table/schema, auth, and the frontend —
none of that needed to change for this prompt.

## 1. The consolidated pipeline

Everything — fetch, freshness filter, dedup, Gemini polish, image
resolution, storage — now runs through one function:

```js
const { runPipeline } = require('./services/pipeline');

const result = await runPipeline({
  topic: 'tech',            // required
  freshnessWindow: '24h',   // optional, defaults to freshness.js's default
  updateType: 'news'        // optional, defaults to 'news' — see stub note below
});
```

`result` looks like:

```js
{
  topic: 'tech',
  window: '24h',
  updateType: 'news',
  counts: {
    totalFetched: 107,
    totalAfterFreshness: 68,
    totalAfterDedup: 12,
    bySource: { reddit: 45, rss: 22, hackernews: 40 },
    insertedCards: 12
  },
  sourceErrors: [],          // non-empty if a whole source failed — see below
  cards: [ /* finished card rows, as inserted into `cards` */ ]
}
```

Both test routes (`/pipeline` and the new `/pipeline/full`) call this same
function and just shape the HTTP response differently — there's no
duplicated fetch/dedup/polish/store sequencing anywhere anymore.

`runPipeline` throws `PipelineInputError` for a missing/unknown `topic`
(routes map this to HTTP 400). Any other thrown error is an unexpected
failure in dedup or storage — those still throw by design, since there's
no reasonable partial result to return if the DB itself is unreachable.

## 2. Error resilience — one bad source doesn't take down the run

This was already partially true from Prompt 1/2 (`fetchAll.js` used
`Promise.allSettled` across Reddit/RSS/HN, and `reddit.js` did the same
across individual subreddits). What changed this prompt: those failures
are no longer *only* visible in server logs.

- If Reddit, RSS, or HN fails entirely for a run, `fetchAllForTopic`
  still returns whatever the other sources found, **and** adds an entry
  to `sourceErrors`: `{ source: 'reddit', message: '...' }`.
- `runPipeline` passes `sourceErrors` straight through to its result.
- The `/pipeline/full` route surfaces it at `meta.sourceErrors`.

So a Reddit outage during testing looks like: `cards` and `bySource.rss`/
`bySource.hackernews` still populated normally, `bySource.reddit: 0`, and
`sourceErrors: [{ source: 'reddit', message: '[RATE_LIMITED] All 3
subreddit(s) failed for topic "tech" — Reddit appears to be throttling or
blocking this request. Details: ...' }]` — rather than a crashed request
or a silently-empty topic with no explanation.

## 3. Reddit-specific rate-limit handling

Reddit's public `.json` endpoint is unofficial and has no documented rate
limit contract, so it's treated as the most likely source to misbehave:

- **Retry with backoff.** A `429` or `403` response is retried up to 2
  times, honoring `Retry-After` if Reddit sends one, otherwise backing off
  800ms then 1600ms.
- **Request pacing.** Subreddit requests for a topic (2-3 per topic in
  `config/topics.js`) are staggered ~350ms apart at the start, instead of
  all firing in the same tick — a small change, but it avoids presenting
  Reddit with a burst from one IP on every pipeline run.
- **Clear tagging.** Any failure that looks like throttling (429/403) gets
  an explicit `[RATE_LIMITED]` prefix in its error message, both in the
  per-subreddit `console.warn` and in the aggregated error thrown if every
  subreddit for a topic fails — so it's obvious in logs or in
  `sourceErrors` that Reddit specifically, not "something", was the
  problem.
- Per-subreddit failures still don't fail the whole topic — this only
  throws (surfacing as a `sourceErrors` entry) if **every** subreddit for
  that topic failed.

## 4. The final test endpoint

```bash
curl "http://localhost:4000/api/test/pipeline/full?topic=tech&window=24h&type=news"
```

Response shape:

```json
{
  "topic": "tech",
  "window": "24h",
  "updateType": "news",
  "validWindows": ["6h", "24h", "3d", "3days"],
  "cards": [
    {
      "title": "Original source title",
      "caption": "Gemini-polished short caption",
      "imageUrl": "https://source-site.com/image.jpg",
      "sourceUrl": "https://source-site.com/article",
      "topic": "tech",
      "createdAt": "2026-09-11T...",
      "status": "draft"
    }
  ],
  "meta": {
    "totalFetched": 107,
    "totalAfterFreshness": 68,
    "totalAfterDedup": 12,
    "sourceErrors": []
  }
}
```

`GET /api/test/pipeline` (the Prompt 4 route) still works unchanged, for
anyone with existing test scripts pointed at it — it now runs through the
same `runPipeline()` internally, just reshapes the response to its
original `counts` format instead of `meta`.

As before, running the same `topic`/`window` twice in a row should return
`totalAfterDedup: 0` / `insertedCards: 0` and an empty `cards` array —
dedup logic from Prompt 3 is untouched and still the source of that
behavior.

### A note on `updateType` / `?type=`

`updateType` ("news" vs "events") is accepted and validated
(`news`/`events`, case-insensitive, defaults to `news`) and echoed back in
the response — but it's currently a **stub**. `config/topics.js` only maps
topics to subreddits + RSS feeds today; there's no events-specific source
(a schedule API, a listings feed, etc.) for it to route to yet. Wiring
real behavior behind this flag is Phase 3 ("Scheduling & Alternate Modes")
work. Passing `type=events` right now runs the identical fetch as
`type=news` — this is intentionally in place early so the endpoint
signature and response shape won't need to change again once real
News/Events sourcing exists.

## Phase 2: Complete

Phase 2 (the ingestion pipeline) is now feature-complete:

- **Fetch:** Reddit (public `.json`, no auth) + RSS + Hacker News, per
  topic, merged and freshness-filtered.
- **Dedup:** against `seen_items`, so re-running a topic doesn't
  re-surface the same content.
- **Finishing:** Gemini caption polishing (with graceful fallback to the
  original title on any failure) and image resolution (source image, or a
  generated templated fallback graphic).
- **Storage:** finished cards written to `cards` with `status: 'draft'`.
- **Robustness:** per-source failure isolation with visible error
  reporting, Reddit-specific throttle handling, and one consolidated,
  reusable pipeline function.

**Testable now**, with no UI, via:

```bash
curl "http://localhost:4000/api/test/pipeline/full?topic=tech&window=24h&type=news"
```

(also `topic=sports|finance|entertainment|general`, `window=6h|24h|3d`)

**No frontend exists yet, on purpose.** There is no Feed tab, no card UI,
nothing rendering these cards for a user to see — this prompt's deliverable
is the backend pipeline and its JSON output, full stop. **Phase 4** is
where a Feed tab gets built that calls this same pipeline (most likely via
a new authenticated, non-`/test` route wrapping `runPipeline()`) and
renders the returned cards.

**Next up — Phase 3 (Scheduling & Alternate Modes):** a cron/scheduled
trigger to run `runPipeline()` automatically per topic instead of only via
manual test requests, and real behavior behind the `updateType` stub
described above.
