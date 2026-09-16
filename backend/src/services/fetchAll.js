// Runs Reddit + RSS + Hacker News for a given topic, merges the normalized
// results, and applies the freshness filter. This is the single function
// the pipeline (services/pipeline.js) calls.
//
// MODIFIED — Phase 2, Prompt 5 (Final Assembly + Robustness):
// Behavior is unchanged from Prompt 1/2 (still Promise.allSettled across
// sources, still "one source failing doesn't fail the others"). What's
// new is that a fully-failed source is no longer *only* logged — it's
// also collected into a `sourceErrors` array and returned to the caller,
// so callers (the pipeline, the test endpoint) can report exactly which
// source failed and why instead of that information living only in
// server logs.

const { fetchRedditForTopic } = require('./reddit');
const { fetchRssForTopic } = require('./rss');
const { fetchHackerNewsForTopic } = require('./hackernews');
const { filterByFreshness, DEFAULT_WINDOW } = require('./freshness');

const SOURCE_FETCHERS = [
  { sourceType: 'reddit', fetch: fetchRedditForTopic },
  { sourceType: 'rss', fetch: fetchRssForTopic },
  { sourceType: 'hackernews', fetch: fetchHackerNewsForTopic }
];

// Fetches all three sources in parallel. A single source failing entirely
// (e.g. Reddit is down, or every subreddit in the topic got throttled)
// doesn't fail the others — same "log and skip" behavior each individual
// service already uses internally for its own sub-sources, applied one
// level up.
async function fetchAllForTopic(topicKey, window = DEFAULT_WINDOW) {
  const results = await Promise.allSettled(
    SOURCE_FETCHERS.map(({ fetch }) => fetch(topicKey))
  );

  const rawCounts = {};
  const allItems = [];
  const sourceErrors = [];

  results.forEach((result, index) => {
    const { sourceType } = SOURCE_FETCHERS[index];

    if (result.status === 'fulfilled') {
      rawCounts[sourceType] = result.value.length;
      allItems.push(...result.value);
      return;
    }

    // Source failed entirely (its own internal per-sub-source resilience
    // — e.g. reddit.js skipping individual bad subreddits — already ran
    // and still came up empty, or the fetcher threw before that point).
    rawCounts[sourceType] = 0;
    const message = result.reason?.message || String(result.reason);

    // console.error (not .warn) here specifically: this means the WHOLE
    // source is down for this run, not just one sub-source within it —
    // worth standing out in the logs while testing.
    console.error(`[fetchAll] Source "${sourceType}" failed entirely — continuing with remaining sources. Reason: ${message}`);

    sourceErrors.push({ source: sourceType, message });
  });

  const freshItems = filterByFreshness(allItems, window).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  return {
    items: freshItems,
    counts: {
      ...rawCounts,
      totalBeforeFilter: allItems.length,
      totalAfterFilter: freshItems.length
    },
    sourceErrors
  };
}

module.exports = { fetchAllForTopic };
