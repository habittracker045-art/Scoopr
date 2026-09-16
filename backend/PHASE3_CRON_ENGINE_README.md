# Phase 3 — Cron Engine + Manual "Generate Now"

This prompt builds the **execution engine** that acts on the
`schedule_settings` table from Phase 3, Prompt 1 (`GET`/`PUT
/api/schedule`) — until now that table was pure storage; nothing read it.
Two things are added:

1. A cron poller that triggers each enabled user's pipeline at their
   configured `scheduled_time`.
2. `POST /api/pipeline/generate-now` — an authenticated "run it right now"
   button that ignores the schedule's `enabled`/`scheduled_time` and just
   uses the saved topics/window/type.

Nothing in `routes/schedule.js`, the `schedule_settings` schema, or
`services/pipeline.js` was touched. This is purely additive: two new
files plug into the existing pipeline entry point (`runPipeline()`) and
two new lines wire a scheduler start-up call into `server.js`.

> **Naming note:** this project's `backend/` already has
> `PHASE3_PROMPT2_README.md` (Manual "Create" mode), `_PROMPT3_`
> (real events logic), and `_PROMPT4_` (Tips & Facts) — those are a
> different feature track and were left completely untouched. To avoid
> colliding with those filenames, this prompt's README is named
> `PHASE3_CRON_ENGINE_README.md` instead of `_PROMPT2_`. Functionally,
> this is the "next prompt" the root `README.md` and
> `PHASE3_PROMPT1_README.md` both point to when they say "no
> cron/execution logic yet."

## What's new

```
backend/
  src/
    services/
      cronScheduler.js      NEW — the polling cron job
      scheduleRunner.js      NEW — shared "run pipeline for user" + overlap lock
    routes/
      pipelineGenerateNow.js NEW — POST /api/pipeline/generate-now
  server.js                  MODIFIED — starts the scheduler on boot, mounts the new route
  package.json                MODIFIED — added `node-cron`
```

## New npm package

- **`node-cron`** (`^3.0.3`) — a small `setInterval`-based cron scheduler.
  No native bindings, no background OS process, nothing to configure
  beyond a cron expression — a good fit for a single free-tier Render
  instance. Run `npm install` in `backend/` after pulling this to install
  it (it's already in `package.json`/`package-lock.json`).

No other new dependencies. Timezone handling uses Node's built-in `Intl`
API (`Intl.DateTimeFormat` with a `timeZone` option) rather than
`moment-timezone`/`luxon`, since all we need is "what's HH:MM right now in
this IANA timezone string" — one native call, zero extra install.

## Scheduling approach: one poller, not one job per user

`cronScheduler.js` registers a **single** `node-cron` job that runs every
minute (`* * * * *`). Each tick:

1. Loads every row from `schedule_settings` where `enabled = true`.
2. For each row, computes "what time is it right now" **in that user's
   own `timezone` column** (via `Intl.DateTimeFormat`), and compares it
   to that row's `scheduled_time` ("HH:MM").
3. If they match, and this exact user+minute hasn't already fired, calls
   `scheduleRunner.runForUser()` for that user's topics.

**Why this over one `node-cron` job per user:**

- A user can change their `scheduled_time`, `topics`, or `enabled` flag
  at any moment via `PUT /api/schedule` — that route (unchanged by this
  prompt) has no way to reach into a per-user cron job and
  reschedule/destroy it. A poller has no such problem: it re-reads the
  table fresh every single tick, so a settings change takes effect on
  the very next minute automatically, with zero coordination needed
  between `routes/schedule.js` and the scheduler.
- Per-user jobs mean per-user *scheduler state* to create on login/signup,
  destroy on account disable, and reconcile on every server restart
  (re-reading the table to recreate every job anyway) — the poller does
  that reconciliation implicitly, every minute, for free.
- At this scale (a personal app, presumably single-digit-to-low-dozens of
  users), one `SELECT * WHERE enabled = true` per minute is nothing.
  Per-user jobs would only start paying for themselves at a user count
  this app isn't designed for.

**Trade-off, stated plainly:** scheduling precision is "within the same
minute," not "within the same second" — fine for "my feed is ready at
8am," not fine for anything latency-sensitive. `scheduled_time` is only
ever stored to minute precision anyway (`"HH:MM"`), so there's no
accuracy left on the table by ticking once a minute instead of, say,
once every ten seconds.

### Per-minute double-fire guard

Comparing "now" to `scheduled_time` down to the minute means if a tick
somehow runs twice inside the same wall-clock minute (it shouldn't, but
"shouldn't" isn't "can't"), it would try to trigger the same user twice.
`cronScheduler.js` guards this with a tiny in-memory `Set` of
`"userId:date:HH:MM"` keys that a fired schedule adds itself to, and
which self-expires ~65 seconds later via `setTimeout(...).unref()` — no
manual cleanup job needed, no growth over time.

### Timezone handling

`schedule_settings.timezone` is an IANA string (e.g. `"America/New_York"`,
defaults to `"UTC"` — that column and default already existed from Prompt
1 and weren't changed here). If a row somehow has an invalid timezone
string (e.g. hand-edited directly in Supabase), `Intl.DateTimeFormat`
throws when constructed — `cronScheduler.js` catches that per-row, logs a
warning, and falls back to UTC for that row only, rather than letting one
bad row crash the whole tick.

## Overlap protection

`scheduleRunner.js` keeps an in-memory `Set<userId>` of users currently
mid-run. `runForUser(userId, ...)`:

- Throws `RunInProgressError` **immediately, synchronously** (before doing
  any work) if that user is already in the set.
- Otherwise adds them to the set, runs `runPipeline()` once per topic
  **sequentially** (not in parallel — see the comment in
  `scheduleRunner.js` for why: it's the same free-tier Gemini key across
  every topic in the run, and `pipeline.js` already throttles its own
  per-item Gemini calls internally), and removes them from the set in a
  `finally` block once every topic has finished (whether it succeeded or
  failed).

**Why an in-memory `Set` is enough here, and not something backed by a
`pipeline_runs` table or a Postgres advisory lock:**

- Render's free tier runs **one instance** of this app. There's no
  multi-process/multi-dyno fan-out where two separate Node processes
  could each think they're the only one running a given user's pipeline
  — that's the actual failure mode a DB-backed lock protects against, and
  it doesn't exist here.
- Both triggers that can start a run — the cron poller and
  `POST /api/pipeline/generate-now` — live in the same process and
  therefore share the same `Set`. A scheduled run and a manual "Generate
  Now" click for the same user are protected against each other just as
  much as two scheduled runs would be.
- A crash or restart clearing the `Set` is the *correct* behavior, not a
  gap: if the process died mid-run, the run is definitionally not "in
  progress" anymore, so a fresh, empty `Set` on restart is accurate, not
  stale.

If this ever moves to a platform with multiple instances behind a load
balancer, this in-memory lock stops being sufficient and would need to
become a real distributed lock (e.g. a `SELECT ... FOR UPDATE` /
`pg_advisory_lock` against Supabase, or a `running_since` timestamp column
on `schedule_settings` itself). Worth flagging now, not worth building for
a free-tier single instance today.

## `POST /api/pipeline/generate-now`

Authenticated (same `Authorization: Bearer <token>` as every other
protected route). Reads the caller's own `schedule_settings` row —
**ignoring** `enabled` and `scheduled_time` entirely — and runs the
pipeline immediately for their saved `topics` / `freshness_window` /
`update_type`. Uses the exact same `scheduleRunner.runForUser()` as the
cron path, so it's subject to the identical overlap protection.

- **No `schedule_settings` row yet, or an empty `topics` array** → `400`
  with a message pointing at `PUT /api/schedule`. There's nothing to run
  without at least one topic.
- **A run for this user is already in progress** (scheduled or manual) →
  `409`.
- **Success** → `200` with one entry per topic, each shaped like
  `GET /api/test/pipeline/full`'s response (`cards`, `meta` with
  `totalFetched`/`totalAfterFreshness`/`totalAfterDedup`/`sourceErrors`),
  wrapped in a `results` array since a schedule can cover multiple
  topics at once (that single-topic test endpoint never had to).

### Testing with curl

1. Log in to get a token (existing `/api/auth/login` — unchanged):

   ```bash
   curl -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username": "your_username", "password": "your_password"}'
   ```

   Copy the `token` from the response.

2. Make sure you have a schedule saved with at least one topic (existing
   `PUT /api/schedule` — unchanged):

   ```bash
   curl -X PUT http://localhost:4000/api/schedule \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "enabled": true,
       "scheduledTime": "08:00",
       "topics": ["tech", "sports"],
       "freshnessWindow": "24h",
       "updateType": "news"
     }'
   ```

3. Trigger a run right now, regardless of the `08:00`/`enabled` above:

   ```bash
   curl -X POST http://localhost:4000/api/pipeline/generate-now \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

   You should see a `results` array with one entry per topic and
   `insertedCards`/`cards` data, plus terminal logs like:

   ```
   [generate-now] Manual run triggered by user <uuid> (topics: tech, sports, window: 24h, type: news)
   [generate-now] Finished manual run for user <uuid>: 2/2 topic(s) succeeded.
   ```

4. To see the 409 overlap response, fire the same curl command twice back
   to back (fast enough that the first hasn't finished) — the second
   call returns:

   ```json
   { "error": "A pipeline run for your account is already in progress. Try again shortly." }
   ```

## Watching the cron engine run

No curl needed for this one — it's driven by the clock. With the server
running, terminal output every minute looks like:

```
[cron] Checking for due schedules...
[cron] No enabled schedules found.
```

or, once a user is due:

```
[cron] Checking for due schedules...
[cron] Triggering scheduled run for user <uuid> (topics: tech, sports, window: 24h, type: news, tz: America/New_York)
[cron] Finished scheduled run for user <uuid>: 2 topic(s) succeeded, 0 failed.
```

For fast local testing without waiting for a real clock match, temporarily
set a user's `scheduled_time` (via `PUT /api/schedule`) to whatever the
next minute will be in their timezone, save, and watch the terminal — it
should fire within ~60 seconds.

## Known limitation: Render free tier and sleeping instances

Render's free web-service tier spins the instance down after a period of
inactivity and spins it back up on the next incoming HTTP request. While
the instance is asleep, **the in-process cron poller is not running
either** — there's no clock ticking in the background if the process
itself isn't alive. A schedule whose fire-time falls while the instance
happens to be asleep will simply be missed for that day (it isn't queued
or caught up later).

This isn't something the cron engine itself can fix — it's a property of
the hosting tier, not a bug in the polling logic. Two practical options if
this becomes a problem in practice:

- Ping the deployed app's `/api/health` endpoint every few minutes from a
  free external uptime service (e.g. UptimeRobot, cron-job.org) to keep
  the instance awake — zero cost, but pings need to be frequent enough
  relative to Render's spin-down window.
- Move to a paid Render instance tier (or any always-on host) once/if the
  zero-cost constraint changes.

Both are deployment/infra decisions, not code changes — nothing here
needs to differ between local dev (`npm run dev`, never sleeps) and a
free-tier deploy for the logic itself to be correct.
