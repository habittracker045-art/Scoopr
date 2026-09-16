# Phase 2 — Prompt 3: Dedup + Storage

## What's new

```
backend/
  db/
    phase2_schema.sql     # NEW — seen_items + cards tables, RLS
  src/
    lib/
      supabaseClient.js    # NEW — service-role Supabase client (see note below)
    services/
      dedup.js              # NEW — filters fetched items against seen_items
      cardStore.js           # NEW — inserts draft cards
    routes/
      testPipeline.js         # NEW — GET /api/test/pipeline
```

Nothing in `fetchAll.js`, `freshness.js`, `hackernews.js`, `reddit.js`, or
`rss.js` was touched — dedup is wired *around* them, not into them.
`testFetch.js` / `/api/test/fetch` is also untouched and still works
exactly as before, for inspecting raw fetch output without writing to the DB.

## 1. Run the SQL

Same process as Phase 1's `schema.sql`:

1. Open your Supabase project → **SQL Editor**.
2. Paste the contents of `backend/db/phase2_schema.sql`.
3. Run it.

It's safe to re-run — table/index creation is guarded with
`IF NOT EXISTS`. This creates:

- **`seen_items`** — dedup ledger. `source_id` is unique; `source_type`
  and `topic` are stored alongside for debugging/filtering.
- **`cards`** — draft content cards. `source_id` is also unique here as a
  second line of defense (see the note in the SQL file).

Both tables have RLS enabled with **no policies** (deny-all for `anon`/
`authenticated`), matching how Phase 1's `users` table is locked down —
only the service-role key (used server-side) can read/write them.

## 2. Env vars / Supabase client

`src/lib/supabaseClient.js` expects:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

**If Phase 1 already set up a Supabase client helper somewhere else in the
repo** (it almost certainly did, for the `users` table), use that one
instead:

- Delete `src/lib/supabaseClient.js`.
- In `dedup.js` and `cardStore.js`, change the `require('../lib/supabaseClient')`
  line to point at the existing helper — as long as it exposes something
  equivalent to `getSupabaseClient()` (a function returning a configured
  `@supabase/supabase-js` client), no other changes are needed.

If `@supabase/supabase-js` isn't already a dependency (it should be, from
Phase 1), install it:

```bash
npm install @supabase/supabase-js
```

## 3. Mount the new route

In `server.js`, alongside wherever `testFetch.js` is mounted (something
like `app.use('/api/test', require('./src/routes/testFetch'))`), add:

```js
app.use('/api/test', require('./src/routes/testPipeline'));
```

Both routes share the `/api/test` prefix but expose different paths
(`/fetch` vs `/pipeline`), so this is a straightforward second `app.use`
line, not a replacement.

## Test the endpoint

```bash
curl "http://localhost:4000/api/test/pipeline?topic=tech&window=24h"
```

Response shape:

```json
{
  "topic": "tech",
  "window": "24h",
  "validWindows": ["6h", "24h", "3d", "3days"],
  "counts": {
    "reddit": 45,
    "rss": 22,
    "hackernews": 40,
    "totalBeforeFilter": 107,
    "totalAfterFilter": 68,
    "unseen": 12,
    "insertedCards": 12
  },
  "cards": [
    {
      "id": "…uuid…",
      "topic": "tech",
      "title": "…",
      "caption": null,
      "image_url": null,
      "source_url": "https://…",
      "source_type": "hackernews",
      "source_id": "hackernews:41823901",
      "created_at": "2026-09-11T…",
      "status": "draft"
    }
  ]
}
```

Run it twice in a row with the same `topic`/`window` — the second call
should return `"unseen": 0, "insertedCards": 0` and an empty `cards`
array, since everything from the first run is now in `seen_items`.

## How dedup behaves, long-term

`sourceId` (e.g. `hackernews:41823901`, `reddit:t3_abc123`) is the
permanent uniqueness key for a piece of content, for as long as it exists
in the source system:

1. **Pre-storage check** — `dedup.js` queries `seen_items` for the
   sourceIds in the current fetch batch and drops anything already there
   *before* it ever reaches `cardStore.js`.
2. **DB-level backstop** — `cards.source_id` also has a unique index, and
   inserts use `ON CONFLICT DO NOTHING`. Even if two pipeline runs
   overlapped or a bug slipped an already-seen item through step 1, the
   database itself won't create a second card for the same sourceId.

So re-running the pipeline on the same content is idempotent: fetch
happens again, freshness filtering happens again, but dedup reduces the
batch to nothing new and zero cards get inserted. Only content with a
sourceId that's never been seen before produces a new card.

One implication worth knowing: if a card is later deleted or its
`status` changed (approved/skipped), its `sourceId` stays in
`seen_items` — the pipeline won't resurrect it as a new draft card on a
later run. That's intentional (this is a dedup ledger, not a cache of
`cards`), but if you ever need to "forget" an item and let it be
re-ingested, that means deleting its row from `seen_items` directly.

## What's still not done (later prompts)

- **Gemini caption polishing** — `caption` stays `null` for every card
  inserted here. That's Prompt 4 (per your numbering, "Prompt 3" in the
  original plan), not this one.
- **Auth on the test routes** — both `/api/test/fetch` and
  `/api/test/pipeline` are still open, temporary diagnostic endpoints.
