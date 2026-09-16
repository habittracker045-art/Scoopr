# Phase 2 — Prompt 4: Gemini Polishing + Image Handling

## What's new / changed

```
backend/
  src/
    services/
      geminiCaption.js   # NEW — Gemini caption polishing (with fallback)
      imageHandler.js    # NEW — source image passthrough + fallback graphic
      pipeline.js         # NEW — extracts fetch→dedup→polish→image→store
                             sequence out of the route, adds the new steps
      cardStore.js         # MODIFIED — now persists caption/imageUrl instead
                             of always writing null
    utils/
      concurrency.js         # NEW — small concurrency-limit helper used by
                             pipeline.js to throttle Gemini calls
    routes/
      testPipeline.js          # MODIFIED — now calls pipeline.js and returns
                             the finished-card shape
```

**Untouched, as instructed:** `fetchAll.js`, `freshness.js`, `hackernews.js`,
`reddit.js`, `rss.js`, `dedup.js`, `supabaseClient.js`, `phase2_schema.sql`.
Polishing and imaging are wired *around* that logic, not into it.

## 1. Install the one new package

```bash
cd backend
npm install sharp
```

`sharp` renders the fallback graphic (an SVG built in code, converted to
PNG). Nothing else is new — Gemini calls use Node's built-in global
`fetch`, so no HTTP client package is needed if you're on **Node 18+**. If
you're on an older Node, either upgrade or `npm install node-fetch`
(`geminiCaption.js` will pick it up automatically as a fallback).

## 2. Env vars

**`GEMINI_API_KEY` is reused as-is** from Phase 1's `backend/.env` — it is
not re-requested or re-validated at startup, only read when a caption
actually needs polishing.

Everything else is optional, with sensible defaults:

```
# Optional — model to call. Defaults to 'gemini-flash-latest', Google's
# floating alias for the current recommended free-tier Flash model. Gemini
# model names shift fairly often (e.g. 2.0 Flash was retired from the free
# tier in mid-2026); if you start seeing 404s in the logs, check
# https://ai.google.dev/gemini-api/docs/models for the current alias/name
# and set this explicitly.
GEMINI_MODEL=gemini-flash-latest

# Optional — abort a Gemini call after this long (ms). Defaults to 12000.
GEMINI_TIMEOUT_MS=12000

# Optional — base URL used to build fallback-image URLs (imageUrl values
# for generated graphics). Defaults to http://localhost:<PORT or 4000>.
# Set this to your real backend URL once deployed, or the generated image
# links won't resolve for anyone but localhost.
PUBLIC_BASE_URL=http://localhost:4000

# Optional — how many items to polish/image-render concurrently per
# pipeline run. Defaults to 3. The Gemini free tier is rate-limited
# per-minute (commonly ~10-15 RPM depending on model), so keep this low
# unless you've confirmed your quota.
PIPELINE_CONCURRENCY=3
```

## 3. Serve the generated fallback images

Fallback graphics are written to `backend/public/generated/` (created
automatically on first use). Add static file serving in `server.js`,
alongside your other middleware:

```js
const path = require('path');
app.use('/generated', express.static(path.join(__dirname, 'public/generated')));
```

Add `backend/public/generated/` to `.gitignore` — these are generated
artifacts, not source.

## 4. Nothing else to re-wire

`testPipeline.js` already required `pipeline.js` internally — if
`server.js` already has:

```js
app.use('/api/test', require('./src/routes/testPipeline'));
```

...from Prompt 3, there's nothing more to mount. Same route path, new
behavior underneath.

## How captions work (`geminiCaption.js`)

- Builds a short prompt instructing Gemini to condense long titles or
  lightly polish already-short ones, aiming for social-card length
  (~120 chars, hard-capped at 200 with an ellipsis if Gemini ignores that).
- Strips accidental surrounding quotes and collapses whitespace.
- **On any failure** — missing key, network error, timeout, non-2xx
  response, empty/blocked output — logs a `console.warn` and falls back to
  a cleaned-up version of `item.title`. `polishCaption()` never rejects,
  so a Gemini outage never breaks the pipeline; captions just stop being
  "polished" and become "the original title" until it recovers.

## How images work (`imageHandler.js`)

- If the item already has an `imageUrl` (Reddit/RSS/HN often provide one),
  it's used directly — no generation, no extra cost.
- Otherwise, builds an SVG fallback card (topic-colored background, a
  small topic-label pill, word-wrapped title, "Scoopr" wordmark) and
  rasterizes it to PNG with `sharp`. Filenames are a hash of `sourceId`, so
  re-running the pipeline on the same item reuses the existing file
  instead of regenerating it.
- Topic → color mapping is a small local table in the file
  (`TOPIC_COLORS`). It covers common topic keys with a default color for
  anything unrecognized — adjust the keys to match `config/topics.js` if
  your `TOPICS` keys differ.
- **On any failure** (sharp not installed, disk error, etc.) logs a
  `console.warn` and resolves to `null`. `cards.image_url` is nullable, so
  this degrades gracefully rather than crashing the pipeline.

## Testing

```bash
curl "http://localhost:4000/api/test/pipeline?topic=tech&window=24h"
```

Response shape (per card, matching the spec for this prompt):

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
      "title": "Original source title",
      "caption": "Gemini-polished short caption",
      "imageUrl": "https://source-site.com/image.jpg",
      "sourceUrl": "https://source-site.com/article",
      "topic": "tech",
      "createdAt": "2026-09-11T…",
      "status": "draft"
    }
  ]
}
```

As before, running the same `topic`/`window` twice in a row should return
`"unseen": 0, "insertedCards": 0` and an empty `cards` array — dedup logic
from Prompt 3 is untouched.

To sanity-check the two new steps in isolation before running the full
pipeline:

```bash
node -e "
require('dotenv').config();
require('./src/services/geminiCaption').polishCaption({
  sourceId: 'test:1',
  title: 'Scientists Announce They Have Discovered Something Potentially Quite Significant About How Batteries Degrade Over Time'
}).then(console.log);
"
```

```bash
node -e "
require('./src/services/imageHandler').resolveImage(
  { sourceId: 'test:1', title: 'A sample headline for the fallback card' },
  'tech'
).then(console.log);
"
```

The second command should print a `http://localhost:4000/generated/....png`
URL and leave a corresponding PNG in `backend/public/generated/`.

## What's still not done (later prompts)

- Auth on the test routes — still open, temporary diagnostic endpoints.
- Any real scheduling/cron trigger for the pipeline — `runPipelineForTopic`
  in `pipeline.js` is written to be reusable from something other than the
  test route once that exists.
