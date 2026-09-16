// Fetches stories from the official, free Hacker News API
// (https://hacker-news.firebaseio.com/v0/) — no API key, no auth, no rate
// limit issues in normal use. Hacker News only maps to the "tech" topic;
// every other topic simply gets an empty array back.

const { buildNormalizedItem } = require('../utils/normalize');

const BASE_URL = 'https://hacker-news.firebaseio.com/v0';
const FETCH_TIMEOUT_MS = 8000;

// How many of the current top stories to pull details for. HN's
// /topstories.json returns up to 500 ids; we only need a reasonable feed's
// worth, and the freshness filter will discard anything too old anyway.
const STORIES_TO_FETCH = 40;

// Cap how many item detail requests run at once, out of politeness to the
// (free, unauthenticated) API — no official rate limit is documented, but
// firing 40+ requests simultaneously on every call isn't good citizenship.
const CONCURRENCY = 10;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Runs `worker` over `items` with at most `limit` in flight at once.
// Individual failures are caught per-item so one bad story id doesn't
// abort the whole batch.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    const current = nextIndex++;
    if (current >= items.length) return;
    try {
      results[current] = await worker(items[current]);
    } catch (err) {
      results[current] = null;
      console.warn('[hackernews] Failed to fetch item:', err?.message || err);
    }
    await runNext();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(runners);
  return results;
}

function normalizeHnItem(item, topic) {
  // Ask HN / Show HN / job posts often have no external `url` — fall back
  // to the HN discussion page itself so the item still links somewhere.
  const discussionUrl = `https://news.ycombinator.com/item?id=${item.id}`;

  return buildNormalizedItem({
    sourceType: 'hackernews',
    sourceId: `hackernews:${item.id}`,
    title: item.title,
    url: item.url || discussionUrl,
    imageUrl: null, // HN's API doesn't provide story images
    topic,
    publishedAt: item.time ? item.time * 1000 : null,
    raw: item
  });
}

// Hacker News is inherently a tech-focused feed, so it's only wired up for
// the "tech" topic. Any other topic key returns an empty array rather than
// throwing, so it composes cleanly with fetchAll's Promise.allSettled.
async function fetchHackerNewsForTopic(topicKey) {
  if (topicKey !== 'tech') {
    return [];
  }

  const topStoryIds = await fetchWithTimeout(`${BASE_URL}/topstories.json`);
  const idsToFetch = (topStoryIds || []).slice(0, STORIES_TO_FETCH);

  const items = await mapWithConcurrency(idsToFetch, CONCURRENCY, async (id) => {
    const item = await fetchWithTimeout(`${BASE_URL}/item/${id}.json`);
    return item;
  });

  return items
    .filter((item) => item && item.type === 'story' && !item.deleted && !item.dead)
    .map((item) => normalizeHnItem(item, topicKey));
}

module.exports = { fetchHackerNewsForTopic };
