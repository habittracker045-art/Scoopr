# Phase 3 — Prompt 3: Real Tech Events Logic

This prompt makes the **"events" half of the News / Events / Both toggle**
actually do something different from regular news fetching. Up through
Prompt 5 of Phase 2, `updateType` was accepted and validated everywhere
(the pipeline, `/api/schedule`) but the pipeline itself always ran the
Reddit/RSS/HN fetch regardless of what was passed — `'events'` silently
behaved exactly like `'news'`.

Nothing in the news-fetching (Reddit/RSS/HN), scheduling, or manual
"Create" mode logic was touched. This is purely additive: a new
Gemini-backed events source, wired into the existing pipeline as a
second branch alongside the existing fetch.

## What's new

```
backend/
  src/
    services/
      eventsGenerator.js     # NEW — Gemini-generated event cards
    utils/
      hashDedupKey.js         # NEW — dedup key for content with no natural sourceId
```

## What changed in existing files

- **`src/services/pipeline.js`** — `updateType` now actually branches:
  - `'news'` — unchanged: runs `fetchAllForTopic()` (Reddit/RSS/HN) only.
  - `'events'` — runs `eventsGenerator.js` instead of `fetchAllForTopic()`.
  - `'both'` — runs both and merges the results before the shared
    freshness/dedup/caption/image steps.

  The allowlist also gained `'both'`, matching what `schedule.js` /
  `validateSchedule.js` already accepted at the settings layer since
  Phase 3, Prompt 1 (it just had nowhere real to go until now). The
  response shape is unchanged except `counts.bySource` gaining a
  `generatedEvents` count alongside `reddit` / `rss` / `hackernews`.
- **`src/routes/testPipeline.js`** — comments only; the route itself
  already passed `?type=` straight through to `runPipeline()`, so no
  behavior change was needed here for `type=events` / `type=both` to
  start returning real, different results.

No database migration was needed. Generated events reuse
`cards.source_url` (already nullable, from Phase 3 Prompt 2) for their
`null` source link, and `cards.enrichment_note` (also from Prompt 2) to
carry the event's company/timeframe detail through to the finished card.

## What counts as a "tech event"

Something with a **specific date/time or a clearly bounded timeframe**
attached — a product launch, a conference, a scheduled major-company
announcement — as opposed to a general news article, which reports on
something that already happened with no particular date attached to it
as a standalone fact. That's the actual distinguishing test
`eventsGenerator.js` uses: "could this go on a calendar?"

The pipeline is generic across all of `config/topics.js`'s topics (tech,
sports, finance, entertainment, general), not tech-only, so
`eventsGenerator.js` extends the same idea per topic — tech product
launches and conferences, sports fixtures and tournament dates, finance
earnings calls and central bank meetings, entertainment release dates and
award shows, and so on (see `TOPIC_EVENT_GUIDANCE` in the file). Tech is
the spec's primary example and the one the test endpoint below
demonstrates, but the same "events" mode works for any scheduled topic.

## How it works (and its limitations)

There's no free dedicated "tech events API" — no ticketing/listings feed,
no company-announcements calendar — that fits the zero-ongoing-cost
constraint. So instead of fetching from a new external source,
`eventsGenerator.js` asks **Gemini itself**, using what it already knows,
via the exact same Gemini client `geminiCaption.js` already uses
(`callGemini()` — same API key, same model, same timeout config).

The prompt is written to make this honest rather than confident-sounding:

- Gemini is told plainly it has no live web access and its knowledge has
  a cutoff, so it may simply not know about things scheduled or
  announced very recently.
- It's explicitly told not to compensate by guessing: if it isn't
  confident about an exact date, give a rough timeframe instead
  ("expected Q1 2026", "date unconfirmed") rather than inventing one.
- If it can't think of enough events it's confident about, it's told to
  return fewer — never pad the list with a guess.
- If it has nothing it's confident about at all, it's told to respond
  with exactly `NONE`, which `eventsGenerator.js` treats as a legitimate
  empty result, not an error.

**The real limitation this creates:** very recent or genuinely future
announcements that postdate Gemini's training data won't show up here at
all, and rapidly-changing details (an exact date that gets moved, for
example) won't be reflected either. This is a knowledge-recall tool, not
a live feed — it's a deliberate tradeoff for staying on the free tier
with no new paid API, and it's the same tradeoff `manualCreate.js`
(Phase 3, Prompt 2) already made for its enrichment step. If/when a real
free events data source becomes available, it could replace or
supplement this without changing anything downstream — the output shape
is identical either way.

### Dedup: hash instead of a natural sourceId

Every existing source has something stable to dedup on: a Reddit
permalink, an RSS GUID, a Hacker News numeric id. A generated event has
none of that — there's no URL, no upstream id. `utils/hashDedupKey.js`
hashes the event's `title` + rough `timeframe` (normalized — lowercased,
whitespace-collapsed, light punctuation stripped) into a stable hex
digest, which becomes the item's `sourceId`
(`generated-event:<hash>`). That flows through the exact same
`seen_items` / `cards.source_id` uniqueness machinery every other source
already uses — `dedup.js` and `cardStore.js` needed zero changes.

One consequence worth knowing: if Gemini is asked again later and
recalls what reads as "the same" event with the same rough timeframe, it
hashes to the same key and gets treated as a duplicate rather than
posted twice — which is the desired behavior here, not a bug.

### Freshness: `publishedAt` is stamped as "now"

News items keep their real `publishedAt` from the source. Generated
events don't have a comparably reliable timestamp — Gemini's "timeframe"
output is a rough, possibly-future, possibly-hedged string
("unconfirmed", "expected Q1 2026"), not a timestamp you could filter
against a 6h/24h/3d window without either discarding real upcoming
events or requiring exact date parsing.

Instead, generated events are stamped with `publishedAt = generation
time`. The freshness window is instead handled as a **prompt-level**
instruction to Gemini ("events happening in about the next day", "in
the next few days", etc., depending on the requested window) rather than
a post-hoc filter — see `windowPhrase()` in `eventsGenerator.js`. The
shared `filterByFreshness()` step still runs over the merged
news+events list in `pipeline.js` (so `'both'` goes through one
consistent code path), it just never has a reason to reject a freshly
generated event.

### Caption + image: same finished shape as news cards

Generated events flow through **exactly** the same `finishItem()` step
in `pipeline.js` that news items do:

- `geminiCaption.js`'s `polishCaption()` — the event's description,
  company/product, and timeframe are packed into `item.summary`, which
  `polishCaption()` already reads as "additional context" alongside the
  title, so the polished caption isn't working from the bare title alone.
- `imageHandler.js`'s `resolveImage()` — a generated event never has a
  source image (`imageUrl: null`), so this always produces the same
  templated topic-colored fallback graphic a Reddit/RSS/HN item without
  an image would get. No changes were needed here.

The end result is a `cards` row in the identical shape whether it came
from Reddit, RSS, Hacker News, or Gemini — `title`, `caption`,
`image_url`, `source_url` (`null` for events), `source_type`
(`'generated-event'`), `topic`, `status: 'draft'`.

## Trying it out

### `GET /api/test/pipeline/full?topic=tech&window=24h&type=news`

Unchanged — Reddit/RSS/HN only, exactly as before this prompt.

### `GET /api/test/pipeline/full?topic=tech&window=24h&type=events`

Runs `eventsGenerator.js` only. Every card in the response will have
`sourceType: 'generated-event'` (visible via `meta`/raw inspection; the
route's `toResponseCard()` doesn't include `sourceType` in its shaped
response, but `source_url` will be `null` on every card, which
Reddit/RSS/HN cards never are).

```bash
curl "http://localhost:4000/api/test/pipeline/full?topic=tech&window=24h&type=events"
```

### `GET /api/test/pipeline/full?topic=tech&window=24h&type=both`

Runs both branches and merges the results — expect a mix of cards with a
real `source_url` (news) and `source_url: null` (generated events) in
the same response.

```bash
curl "http://localhost:4000/api/test/pipeline/full?topic=tech&window=24h&type=both"
```

`meta.sourceErrors` will include an entry with `source: "generated-event"`
if the Gemini call for the events branch fails outright (bad/missing
`GEMINI_API_KEY`, network error, etc.) — same pattern as a fully-failed
Reddit/RSS/HN source, and it doesn't fail the rest of the run.

## Config

No new environment variables are required — `eventsGenerator.js` reuses
`GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_TIMEOUT_MS` from
`geminiCaption.js`. One optional override:

- `EVENTS_PER_TOPIC` — how many events to ask Gemini for per call.
  Defaults to `5`. This is a ceiling, not a target — per the prompt,
  Gemini is told to return fewer rather than pad the list with a
  low-confidence guess.
