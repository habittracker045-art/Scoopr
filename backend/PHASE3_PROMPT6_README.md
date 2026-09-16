# Phase 3, Prompt 6 — Final Consolidation + Robustness

This is the last prompt of Phase 3. Its job was **not** to add new
content-generation features — it was to review everything Prompts 1-5
built (cron engine + Generate Now, schedule management, manual Create
mode, real Tech Events generation, Tips & Facts generation) and make sure
it's actually wired together, consistent, and robust enough to run
unattended.

## 1. Wiring review — what I found

I went through `server.js` route-by-route against every route file in
`src/routes/`, and traced `updateType` from `schedule_settings` all the
way through `cronScheduler.js` → `scheduleRunner.js` → `pipeline.js`.

**The good news: I did not find a Phase-2-style "built but never wired
in" gap this time.** Specifically, I confirmed:

- `server.js` already mounted all five Phase 3 route modules —
  `schedule`, `create`, `tips-facts`, `pipeline` (generate-now), and the
  cron scheduler's `startScheduler()` call. Nothing was sitting in
  `src/routes/` or `src/services/` unused.
- `cronScheduler.js` reads `update_type` off each `schedule_settings` row
  and passes it straight through to `scheduleRunner.runForUser()` →
  `pipeline.runPipeline({ updateType })`, and `pipeline.js` genuinely
  branches on it (`'news'` / `'events'` / `'both'`) rather than treating
  it as an inert stub — that branching was already done in Prompt 3, and
  it's still correctly threaded through both the cron path and the
  manual "Generate Now" path (they share `scheduleRunner.js`, so there's
  only one place this logic could have drifted, and it didn't).

Since the instructions specifically warned that this kind of gap
happened in Phase 2, I verified this by actually booting the server with
a placeholder `.env` and hitting every Phase 3 endpoint without an auth
token — each one correctly returned `401` (proving it's mounted and its
`requireAuth` middleware runs), not a `404` (which would mean it wasn't
mounted at all). See the "How I verified this" section below for the
exact commands.

**What I added here instead of "fixing a gap":** a new authenticated
status-check route (`GET /api/test/phase3-status` — item 5 below) whose
whole point is to make this same kind of check trivial to re-run in the
future, at any point in Phase 4+, without needing five separate curl
commands and a log-reading session.

## 2. Consistent card shape

All content produced by the four Phase 3 sources is already
distinguishable and non-conflicting:

| Source | `cards.source_type` | Table |
|---|---|---|
| Auto pipeline (Reddit) | `reddit` | `cards` |
| Auto pipeline (RSS) | `rss` | `cards` |
| Auto pipeline (Hacker News) | `hackernews` | `cards` |
| Auto pipeline (generated events) | `generated-event` | `cards` |
| Manual Create | `manual` | `cards` |
| Tips & Facts | *(n/a — separate table)* | `tips_facts` |

Two things keep these from ever conflicting downstream:

- **Tips & Facts deliberately never touches `cards` at all** — it has
  its own table (`tips_facts`, Prompt 4's schema) with its own
  `category` (`tip`/`fact`) field, since a tip/fact has no
  `source_url`/`freshness window` in the news-pipeline sense. There's no
  shape to reconcile because it's not the same shape by design.
  Phase 4's frontend will need a separate `GET /api/tips-facts` call for
  its own tab rather than expecting tips/facts to show up in a
  cards feed — that's intentional, not a gap.
- **Within `cards`, `enrichment_note`** (added in Prompt 2 for manual
  cards, reused in Prompt 3 for generated events) is nullable and always
  `null` for plain Reddit/RSS/HN cards — no field collision, since a
  news card just never sets it. `source_url` is nullable (also Prompt 2)
  and is `null` only for `manual` and `generated-event` cards, which
  never had a real link to begin with — auto news/RSS/HN cards still
  always have one. Both fields tolerate being missing without special-
  casing in `cardStore.js`.

I did not find any field that two source types populate with
incompatible meanings, so no schema or mapping changes were needed here.

## 3. Error resilience pass

Checked every Phase 3 Gemini call site against Phase 2's
`geminiCaption.js` standard (log a clear reason, never crash the
process):

- **`eventsGenerator.js`** — a genuine Gemini failure (bad key, network
  error, unusable response) throws, but `pipeline.js`'s
  `runEventsBranch()` already catches it, logs
  `[pipeline] Events generation failed entirely for topic "X" — continuing with zero generated events. Reason: ...`,
  and reports it via `sourceErrors` instead of crashing the run. Already
  correct — no change needed.
- **`tipsFactsGenerator.js`** — same throw-on-failure contract, and
  `routes/tipsFacts.js` already catches it (`TipsFactsInputError` → 400,
  anything else → logged + 500) rather than letting it bubble up
  unhandled. Since this is only ever invoked from an HTTP route (not
  from the cron scheduler directly), an unhandled throw here would 500
  the request, not crash the process — already correct.
- **`manualCreate.js`'s `enrichIdea()`** — already never throws; it logs
  a warning (`[manualCreate] Gemini enrichment failed, falling back to
  raw idea text: ...`) and falls back to the user's own idea text as the
  caption. Already correct.
- **The cron scheduler itself** — `scheduleRunner.runForUser()` already
  wraps each topic's `runPipeline()` call in its own try/catch so one
  topic failing doesn't stop the others, and `cronScheduler.js`'s
  `.catch()` on the (deliberately un-awaited) `runForUser()` call logs
  any unexpected error rather than producing an unhandled promise
  rejection that could crash the Node process on an unattended cron
  tick. Already correct.

I did not find a Phase 3 Gemini call site that could crash the process —
everything already degrades to a logged failure at the right layer. No
code changes were needed for this item specifically.

## 4. Gemini rate-limit/quota awareness (new in this prompt)

This was a genuine gap: Phase 2 only ever called Gemini from one place
(`geminiCaption.js`'s caption polishing, already spread out a little by
`utils/concurrency.js`'s `CONCURRENCY` limit). Phase 3 added **three
more** call sites on top of that — `manualCreate.js`, `eventsGenerator.js`,
`tipsFactsGenerator.js` — and none of them, nor the original caption
polisher, had any pacing or retry behavior against Gemini's free-tier
per-minute limit. A scheduled `'both'` run can fire an events-generation
call *and* one caption-polish call per item, for every topic in a user's
schedule, back-to-back, with nothing watching Gemini's rate limit.

**New file: `src/utils/geminiThrottle.js`** — adapted from `reddit.js`'s
existing Phase 2 backoff pattern rather than inventing a new one:

- **Call pacing** — every Gemini call waits for a minimum gap
  (`GEMINI_MIN_INTERVAL_MS`, default `1100`ms) since the previous
  call *started*, via a small promise-chain queue. This mirrors
  `reddit.js`'s `REQUEST_STAGGER_MS` de-bursting of subreddit requests.
- **Retry with backoff on throttle** — a `429` or `503` response is
  retried (`GEMINI_MAX_RETRIES`, default `2`), honoring a `Retry-After`
  header if Gemini sends one, otherwise doubling the wait each attempt —
  the same shape as `reddit.js`'s `MAX_RETRIES`/`BASE_BACKOFF_MS`.

**Where it's wired in:** `geminiCaption.js`'s `callGemini()` — the ONE
function every Phase 2/3 Gemini call site already goes through
(`polishCaption()`, `manualCreate.js`'s `enrichIdea()`,
`eventsGenerator.js`'s `generateEventsForTopic()`,
`tipsFactsGenerator.js`'s `generateTipsFacts()` all call it or a function
that calls it). Wrapping the fetch inside `callGemini()` means all four
call sites are throttled from **one shared queue** without touching any
of those four files individually.

New optional env vars (both have sane defaults — nothing to configure
unless you want to tune them):

```
GEMINI_MIN_INTERVAL_MS=1100   # minimum gap between Gemini calls
GEMINI_MAX_RETRIES=2          # retries on 429/503 before giving up
```

## 5. Consolidated status endpoint (new in this prompt)

**`GET /api/test/phase3-status`** (authenticated) — `src/routes/testPhase3.js`.

Runs a lightweight, read-only check across every Phase 3 piece and
returns one JSON summary instead of requiring five separate manual
checks:

- `schedule_settings` table reachable (a `select count`, not a row dump)
- `tips_facts` table reachable (same)
- cron scheduler actually initialized (`cronScheduler.js`'s in-memory
  `started` flag, newly exposed via `isSchedulerRunning()`)
- **which routes this specific running process actually has mounted** —
  checked by walking the live Express app's router stack (`req.app._router.stack`),
  not by hardcoding `true` or checking whether the file exists on disk.
  This is deliberately the same category of check that would have caught
  a Phase-2-style "route built but never `app.use()`'d" gap immediately,
  rather than only surfacing as a mysterious 404 later.

Example response:

```json
{
  "phase": 3,
  "status": "ok",
  "checks": {
    "scheduleSettingsTable": { "reachable": true, "rowCount": 3 },
    "tipsFactsTable": { "reachable": true, "rowCount": 12 },
    "cronScheduler": { "running": true },
    "routesMounted": {
      "schedule": true,
      "generateNow": true,
      "create": true,
      "tipsFacts": true
    }
  }
}
```

Responds `200` when every check passes, `503` (with the same body, so
you can see exactly which check failed) otherwise.

```bash
curl -H "Authorization: Bearer <your JWT>" \
  http://localhost:4000/api/test/phase3-status
```

## 6. Phase 3 complete — summary

See the "Phase 3 Complete" section in the top-level `README.md` for the
full list of what's built and testable. Short version: **Phase 3 is
feature-complete.** Everything is backend/API only — there is still no
UI for any of it (schedule settings, Generate Now, manual Create, Tips &
Facts). Phase 4 builds the full 7-tab frontend that calls all of this.

## How I verified this

Since a wiring gap wouldn't show up just from reading the code carefully
(that's exactly how the Phase 2 gap slipped through), I actually booted
the server with a placeholder `.env` and hit every Phase 3 endpoint
without an auth token:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/test/phase3-status   # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/pipeline/generate-now  # 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/schedule              # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/create        # 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/tips-facts            # 401
```

All five returned `401` (proving each route IS mounted and its
`requireAuth` middleware ran), not `404` (which is what an unmounted
route returns from Express's catch-all handler in `server.js`). I also
confirmed the server boots and the cron scheduler starts
(`[cron] Starting scheduler — checking every minute for due schedules.`)
with no errors using only the dependencies already in `package.json` —
no new packages were added for this prompt.
