# Phase 2 — Prompt 1: Reddit + RSS Fetching

## What's new

```
backend/
  src/
    config/
      topics.js          # topic -> subreddits + RSS feeds mapping
    services/
      reddit.js           # fetches Reddit's public .json endpoints
      rss.js               # fetches RSS feeds via rss-parser
    routes/
      testFetch.js         # temporary GET /api/test/fetch-reddit-rss
    utils/
      normalize.js         # shared "normalized item" shape builder
  server.js                # updated: registers /api/test route
  package.json              # updated: adds rss-parser + node engine >=18
```

No changes were made to auth, the database schema, or the frontend.

## Install

From `/backend`:

```bash
npm install
```

This adds one new dependency: **rss-parser**. Everything else (Reddit
fetching) uses Node's built-in global `fetch`, which requires **Node 18+**
(added an `engines` field to `package.json` to flag this — Render's default
Node version is 18+, so no action needed there).

## Run

```bash
npm run dev
# Scoopr backend running on http://localhost:4000
```

## Test the endpoint

No auth required (temporary, for this prompt only):

```
GET http://localhost:4000/api/test/fetch-reddit-rss?topic=tech
```

Valid `topic` values: `tech`, `sports`, `finance`, `entertainment`,
`general` (a few aliases like `technology`, `news`, `general-news` are
also accepted — see `src/config/topics.js`).

Example:

```bash
curl "http://localhost:4000/api/test/fetch-reddit-rss?topic=sports"
```

Response shape:

```json
{
  "topic": "sports",
  "counts": { "reddit": 42, "rss": 18, "total": 60 },
  "items": [
    {
      "sourceType": "reddit",
      "sourceId": "reddit:1abc23",
      "title": "...",
      "url": "https://www.reddit.com/r/sports/comments/...",
      "imageUrl": "https://...",
      "topic": "sports",
      "publishedAt": "2026-09-11T12:34:56.000Z",
      "raw": { ... }
    }
  ]
}
```

Items are sorted newest-first as a convenience. **No freshness filtering or
deduplication yet** — that's the next prompt in this sequence.

## Notes / things to know

- **Reddit**: uses the free public JSON endpoints (`https://www.reddit.com/r/<sub>/hot.json`),
  not the registered Reddit API — no app registration, no OAuth. A
  descriptive `User-Agent` header is sent on every request, since Reddit
  blocks default/generic user agents.
- **Per-source failures don't kill the request**: if one subreddit or feed
  is down/rate-limited, it's logged to the console and skipped; the rest of
  the topic's sources still return.
- **This test route has no auth** and is meant to be temporary — either
  remove it or wrap it in `requireAuth` before this goes anywhere near
  production.
- Reddit does sometimes rate-limit unauthenticated requests, especially from
  shared IPs (like Render's), if hit too frequently — if you see empty
  Reddit results, wait a bit and retry.
