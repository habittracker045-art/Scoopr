# Phase 3 — Prompt 4: Tips & Facts Generator

Adds a **dedicated "Tips & Facts" content type** — per the original spec:
"Dedicated 'Tips & Facts' tab — evergreen tech tips and trivia." This is
deliberately separate from news/events: short, timeless, bite-sized tips
or fun facts that are NOT tied to a freshness window the way news is, and
NOT run through the news pipeline at all.

Nothing in the news-fetching (Reddit/RSS/HN), events logic, scheduling,
or manual "Create" mode was touched. This is purely additive: a new
table, a new Gemini-backed generator service, and two new endpoints.

## What's new

```
backend/
  db/
    phase3_prompt4_schema.sql   # NEW — tips_facts table
  src/
    services/
      tipsFactsGenerator.js     # NEW — Gemini-generated tips/facts + dedup + image + store
    routes/
      tipsFacts.js              # NEW — POST /api/tips-facts/generate, GET /api/tips-facts
```

## What changed in existing files

- **`server.js`** — mounts the new router at `/api/tips-facts`. Nothing
  else in server.js changed.

No existing table, service, or route was modified.

## 1. Run the new SQL in Supabase

Open the Supabase SQL Editor for your project and run
`backend/db/phase3_prompt4_schema.sql` (safe to re-run — everything is
guarded with `if not exists`). It creates one new table:

```sql
create table if not exists tips_facts (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,
  category     text not null check (category in ('tip', 'fact')),
  topic        text not null default 'tech',
  image_url    text,
  content_hash text not null,   -- dedup key, see below
  created_at   timestamptz not null default now(),
  status       text not null default 'draft'
               check (status in ('draft', 'approved', 'skipped'))
);
```

Same RLS pattern as every other Scoopr table: RLS is enabled, no
policies are defined (deny-all for `anon`/`authenticated`), and table
privileges are explicitly revoked from those roles. The backend only
ever talks to Supabase with the **service role key**, which bypasses RLS
— nothing here is reachable from the frontend directly.

This does not touch `cards`, `seen_items`, or `schedule_settings` in any
way — tips/facts live in their own table because they don't fit the
news-pipeline shape (no `source_url`/`source_type`, no freshness window).

## 2. How generation works

`tipsFactsGenerator.js` asks Gemini for a batch (default 5, configurable
per-call and via `TIPS_FACTS_PER_BATCH` in `.env`) of short tips and/or
facts, using the same Gemini client `geminiCaption.js` and
`eventsGenerator.js` already use (`callGemini()` — same
`GEMINI_API_KEY`/`GEMINI_MODEL`/`GEMINI_TIMEOUT_MS`).

The prompt is written to keep the output genuinely evergreen and
factually careful:

- Explicitly told **not** to tie anything to current events, recent news,
  specific dates, or version numbers — it should read the same today or
  in five years.
- Explicitly told to be conservative about trivia: only include a fact
  it's genuinely confident is well-established, prefer well-known facts
  over obscure ones, and **produce fewer than requested rather than
  padding with something it's unsure about**. Uncertain/disputed claims
  are told to be left out entirely, never hedged-but-included.

Like `eventsGenerator.js` (and unlike `geminiCaption.js`/
`imageHandler.js`), a genuine Gemini failure (missing key, network error,
unusable response) **throws** — there's no sensible content fallback for
"the whole batch," so the route surfaces that as a 500 rather than
inventing placeholder tips.

### Dedup

Tips/facts have no URL/GUID to dedup on the way Reddit/RSS/HN items do.
Instead, each item's text is normalized (lowercased, punctuation/
whitespace collapsed — reusing `utils/hashDedupKey.js`, the same helper
`eventsGenerator.js` uses) and hashed into `content_hash`. Before saving,
new items are checked against every `content_hash` already in
`tips_facts`; anything that collides with an existing row (or a
duplicate within the same generated batch) is silently dropped rather
than reinserted. A unique index on `tips_facts.content_hash` enforces
this at the DB level too, as a second line of defense against races.

### Images

Tips/facts never have a source image, so every item always goes through
`imageHandler.js`'s existing templated fallback graphic (topic-colored
card with the tip/fact text rendered on it) — the exact same code path
an image-less news item or a manual "Create" card already uses. No
changes were needed in `imageHandler.js` itself.

## 3. New endpoints

Both require the same `Authorization: Bearer <token>` auth as every
other real endpoint (`/api/create`, `/api/schedule`, etc.) — get a token
via `POST /api/auth/login` first.

### `POST /api/tips-facts/generate`

Generates a new batch, saves whatever survives dedup, and returns it.

Body (all fields optional):

```json
{
  "topic": "tech",
  "category": "mixed",
  "count": 5
}
```

- `topic` — defaults to `"tech"`. Deliberately **not** restricted to
  `config/topics.js`'s five news topics — this field is kept flexible
  per the spec ("likely mostly 'tech' but keep it flexible").
- `category` — `"tip"`, `"fact"`, or `"mixed"` (default). `"mixed"` asks
  Gemini for a mix of both in the same batch.
- `count` — how many to request from Gemini this call (default 5, capped
  at 15). The number actually **saved** may be lower — some may get
  filtered out by dedup, or Gemini may simply produce fewer than asked if
  it isn't confident about that many.

Example:

```bash
curl -X POST http://localhost:4000/api/tips-facts/generate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"topic": "tech", "category": "mixed", "count": 5}'
```

Response (`201`):

```json
{
  "tipsFacts": [
    {
      "id": "…",
      "content": "…",
      "category": "fact",
      "topic": "tech",
      "imageUrl": "http://localhost:4000/generated/….png",
      "createdAt": "2026-…",
      "status": "draft"
    }
  ],
  "generatedCount": 5
}
```

An empty `tipsFacts: []` with `generatedCount: 0` is a valid response —
it means everything Gemini produced this call was a duplicate of
something already stored (or Gemini genuinely had nothing it was
confident enough about). That's expected behavior, not a bug.

Try requesting `category: "tip"` only, then `category: "fact"` only, to
confirm the category filter is actually being enforced on the parsed
output.

### `GET /api/tips-facts`

Returns saved tips/facts, most recent first — this is what Phase 4's
"Tips & Facts" tab will call.

Query params (both optional):

- `topic` — filter to one topic, e.g. `?topic=tech`
- `limit` — max rows (default 50, capped at 200)

```bash
curl http://localhost:4000/api/tips-facts \
  -H "Authorization: Bearer <token>"

curl "http://localhost:4000/api/tips-facts?topic=tech&limit=10" \
  -H "Authorization: Bearer <token>"
```

Response (`200`):

```json
{
  "tipsFacts": [
    {
      "id": "…",
      "content": "…",
      "category": "tip",
      "topic": "tech",
      "imageUrl": "…",
      "createdAt": "2026-…",
      "status": "draft"
    }
  ]
}
```

### Suggested manual test flow

1. Run `phase3_prompt4_schema.sql` in Supabase.
2. `npm install` in `backend/` if you haven't already (no new
   dependencies were added — this reuses `@supabase/supabase-js` and
   `sharp`, both already in `package.json`).
3. Start the backend (`npm run dev`), log in to get a token.
4. `POST /api/tips-facts/generate` a couple of times in a row with the
   same `topic`/`category` — you should see `generatedCount` shrink or
   hit `0` on repeat calls as Gemini's picks start colliding with what's
   already stored, confirming dedup is doing its job. Check the
   `tips_facts` table in Supabase directly to see the rows (and that
   `content_hash` has no duplicates).
5. `GET /api/tips-facts` and confirm the batch comes back, most recent
   first, and that each row's `imageUrl` opens a real generated PNG
   (topic-colored card with the tip/fact text on it).
6. Try an invalid `category` (e.g. `"nonsense"`) against `/generate` and
   confirm you get a `400` with a clear error, not a `500`.
