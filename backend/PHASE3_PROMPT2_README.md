# Phase 3 — Prompt 2: Manual "Create" Mode

This prompt adds the **manual creation flow** from the original spec:
"user types an idea, AI enriches with context/sources." This is a
different starting point from the Phase 2 auto pipeline — instead of an
item coming from Reddit/RSS/HN, the user supplies it directly, and Gemini's
job is to *enrich* it (context + a suggested caption + a suggested
source/angle) rather than to polish an existing title.

Nothing in Phase 1 (auth), the Phase 2 auto pipeline, or Phase 3 Prompt 1's
scheduling was touched. The existing Gemini client, image handler, and card
storage are reused as-is; the caption-generation code they live in was
given two small additive changes (see "What changed in existing files"
below) rather than being duplicated.

## What's new

```
backend/
  db/
    phase3_prompt2_schema.sql   # NEW — cards.source_url made nullable,
                                 #        cards.enrichment_note added
  src/
    routes/
      create.js                 # NEW — POST /api/create
    services/
      manualCreate.js            # NEW — enrichment prompt + card assembly
  server.js                      # MODIFIED — mounts the new /api/create route
```

## What changed in existing files

- **`src/services/geminiCaption.js`** — `callGemini()` (already existed,
  was private to this file) is now also exported, so `manualCreate.js` can
  send its own prompt through the exact same Gemini client/config/timeout
  handling instead of re-implementing an API call. `polishCaption()` and
  its behavior are completely unchanged.
- **`src/services/cardStore.js`** — `toCardRow()` now reads two additional
  optional fields off the item it's given: `enrichmentNote` (mapped to the
  new `cards.enrichment_note` column) and an explicit `null` fallback for
  `url`/`source_url`. Auto-pipeline items never set `enrichmentNote` and
  always have a `url`, so this is a no-op for the existing pipeline —
  it's purely there so manual cards can flow through the same function.
- **`server.js`** — mounts `POST /api/create` behind `requireAuth`, same
  pattern as `/api/schedule`.

## 1. Run the SQL

1. Open your Supabase project → **SQL Editor**.
2. Paste the contents of `backend/db/phase3_prompt2_schema.sql`.
3. Run it.

Safe to re-run. This:

- Drops the `NOT NULL` constraint on `cards.source_url` — a manually
  typed idea has no source link, and the spec calls for `sourceUrl: null`
  on those cards rather than a placeholder string.
- Adds `cards.enrichment_note` (nullable `text`) — holds the Gemini
  contextual-background + suggested-angle output for manual cards. Always
  `NULL` for auto-pipeline cards.

## 2. Endpoint

### `POST /api/create`

Requires a valid JWT (`Authorization: Bearer <token>`), same as every
other real endpoint in the app.

**Body:**

```json
{
  "ideaText": "A coffee shop downtown just installed a robot barista",
  "topic": "tech"
}
```

- `ideaText` — required, non-empty, max 2000 characters.
- `topic` — required, must resolve via `config/topics.js` (same
  topics/aliases the auto pipeline uses — e.g. `"technology"` resolves to
  `"tech"`).

**What happens:**

1. The idea + topic are validated.
2. The idea is sent to Gemini with a prompt that explicitly states Gemini
   has no live web access and must not present invented specifics
   (numbers, dates, quotes, named sources) as verified facts. Gemini is
   asked for three things: a short card caption, 2–3 sentences of general
   contextual background, and a suggested *type* of source/angle (not a
   specific fabricated one).
3. If Gemini fails or is unreachable, the flow falls back to using the
   user's own idea text as the caption (same resilience contract as the
   auto pipeline's caption polishing) — the request still succeeds.
4. `resolveImage()` (Phase 2's existing image handler) is called with no
   source image, so it always renders the templated topic-colored
   fallback graphic.
5. The result is saved via `insertDraftCards()` (Phase 2's existing card
   storage) with `source_type: 'manual'`, `source_url: null`, and
   `status: 'draft'` — same review-queue state auto-pipeline cards start
   in.
6. The finished card is returned immediately for review.

**Response (`201`):**

```json
{
  "card": {
    "title": "A coffee shop downtown just installed a robot barista",
    "caption": "Local coffee shop tries robot baristas",
    "imageUrl": "http://localhost:4000/generated/a376fc612090524b163f.png",
    "sourceUrl": null,
    "topic": "tech",
    "sourceType": "manual",
    "status": "draft",
    "createdAt": "2026-09-12T16:10:42.124Z",
    "enrichmentNote": "Context: ... | Suggested angle: ..."
  }
}
```

This matches the shape `testPipeline.js` returns for auto-pipeline cards
(`title`/`caption`/`imageUrl`/`sourceUrl`/`topic`/`status`), plus
`sourceType` (so History/Feed can tell manual and auto cards apart) and
`enrichmentNote` (additive — Gemini's context/angle suggestions, `null`
when there's nothing to show).

### Testing with curl

```bash
# 1. Get a token (same as every other authenticated route)
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your_username", "password": "your_password"}' \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

# 2. Create a manual card
curl -X POST http://localhost:4000/api/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ideaText": "A coffee shop downtown just installed a robot barista",
    "topic": "tech"
  }'
```

Error cases:

```bash
# Missing ideaText
curl -X POST http://localhost:4000/api/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"topic": "tech"}'
# -> 400 {"error":"Missing or empty \"ideaText\"."}

# Unknown topic
curl -X POST http://localhost:4000/api/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ideaText": "something", "topic": "crypto"}'
# -> 400 {"error":"Missing or unknown \"topic\".","validTopics":["tech","sports","finance","entertainment","general"]}

# No Authorization header
curl -X POST http://localhost:4000/api/create -H "Content-Type: application/json" \
  -d '{"ideaText": "something", "topic": "tech"}'
# -> 401 {"error":"Missing or invalid Authorization header."}
```

## Not built in this prompt

- No frontend UI for Create mode yet — this is the backend endpoint only.
- No dedicated GET-by-id/list-manual-cards endpoint — reading cards back
  (History/Feed) is separate Phase 3/4 work; this prompt only guarantees
  `source_type: 'manual'` is stored so that later work can filter on it.
