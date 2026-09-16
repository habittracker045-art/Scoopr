# Phase 2 — Prompt 2: Hacker News + Freshness Filter

## What's new

```
backend/
  src/
    services/
      hackernews.js   # NEW — fetches the official free HN API (tech topic only)
      freshness.js     # NEW — shared filterByFreshness() utility (6h/24h/3d)
      fetchAll.js       # NEW — runs Reddit + RSS + HN, merges, applies freshness filter
    routes/
      testFetch.js       # UPDATED — replaces /fetch-reddit-rss with /fetch
```

Reddit and RSS fetch logic (`src/services/reddit.js`, `src/services/rss.js`)
were **not touched**. `server.js` and `package.json` also don't need any
changes — see below.

## Install

**No new npm packages.** Hacker News fetching uses the same built-in global
`fetch` that Reddit fetching already relies on (Node 18+, already required
by Prompt 1). So `npm install` is only needed if you're setting up the repo
fresh — there's nothing new to add to `package.json`.

## Run

```bash
npm run dev
# Scoopr backend running on http://localhost:4000
```

## Test the endpoint

No auth required (temporary, same as Prompt 1):

```
GET http://localhost:4000/api/test/fetch?topic=tech&window=24h
```

- `topic` — same topic keys/aliases as before: `tech`, `sports`, `finance`,
  `entertainment`, `general` (see `src/config/topics.js`). Hacker News only
  contributes items when `topic=tech`; every other topic still works, just
  with `hackernews: 0` in the counts.
- `window` — `6h`, `24h`, or `3d` (`3days` also accepted). Defaults to `24h`
  if omitted or unrecognized.

Examples:

```bash
curl "http://localhost:4000/api/test/fetch?topic=tech&window=6h"
curl "http://localhost:4000/api/test/fetch?topic=sports&window=3d"
curl "http://localhost:4000/api/test/fetch?topic=finance"   # window defaults to 24h
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
    "totalAfterFilter": 68
  },
  "items": [
    {
      "sourceType": "hackernews",
      "sourceId": "hackernews:41823901",
      "title": "...",
      "url": "https://...",
      "imageUrl": null,
      "topic": "tech",
      "publishedAt": "2026-09-11T10:12:00.000Z",
      "raw": { ... }
    }
  ]
}
```

Items are merged across all three sources, filtered to the requested
freshness window, and sorted newest-first.

**This replaces `/api/test/fetch-reddit-rss` from Prompt 1** — that route
is gone; use `/api/test/fetch` going forward.

## Notes / things to know

- **Hacker News**: uses the official free API at
  `https://hacker-news.firebaseio.com/v0/` — no key, no auth. It pulls the
  current top ~40 stories (`/topstories.json` + `/item/{id}.json` for each,
  fetched with a concurrency cap of 10 so it doesn't hammer the API). HN is
  only wired up for the `tech` topic; any other topic key gets an empty HN
  array by design (returns `[]` immediately, doesn't hit the network).
- **No images from HN**: the API doesn't provide story thumbnails, so
  `imageUrl` is always `null` for `sourceType: "hackernews"` items. Ask
  HN / Show HN / job posts with no external `url` fall back to the HN
  discussion page link instead.
- **Freshness filter** (`src/services/freshness.js`) is a small, dependency-
  free utility: `filterByFreshness(items, window)`. It's intentionally
  generic (just reads each item's `publishedAt`) so it works the same way
  regardless of source, and it's exported separately from `fetchAll.js` so
  it can be reused later (e.g. filtering items already stored in the DB,
  not just freshly fetched ones).
- **Per-source failures still don't kill the request**: if HN, Reddit, or
  RSS fails entirely, `fetchAll.js` logs it and returns whatever the other
  sources produced (via `Promise.allSettled`), same pattern used inside
  `reddit.js`/`rss.js` for individual subreddits/feeds.
- **Still no dedup** — the same story appearing on Reddit, an RSS feed, and
  HN will show up three times. That's intentionally out of scope for this
  prompt.
- **This test route still has no auth** and is still meant to be
  temporary — wrap it in `requireAuth` or remove it before shipping.
