// Fetches posts from Reddit's free, public .json endpoints — NOT the
// registered Reddit API. No app registration, no OAuth, no login.
// e.g. https://www.reddit.com/r/technology/hot.json
//
// Reddit blocks requests that use generic/default User-Agents, so every
// request sends a descriptive one, as recommended by Reddit's API rules.
//
// MODIFIED — Phase 2, Prompt 5 (Final Assembly + Robustness). Reddit is
// the "most fragile" source here since it's an unofficial public endpoint
// with no guaranteed rate-limit contract. Two things changed to make that
// less likely to take the pipeline down or go unnoticed:
//
//   1. Retry with backoff. A 429 (Too Many Requests) or 403 (frequently
//      how Reddit signals "we're blocking you right now" rather than a
//      real permissions error) is retried a couple of times with
//      increasing delay — honoring `Retry-After` if Reddit sends one —
//      before giving up on that subreddit.
//   2. Request pacing. Subreddit requests for a topic used to all fire at
//      once (Promise.allSettled over a same-tick .map()). They're now
//      staggered with a small delay between each request *starting*, to
//      avoid presenting Reddit with a burst from one IP.
//
// Per-subreddit failures are still logged and skipped, same as before —
// the topic overall still returns whatever subreddits succeeded. The one
// behavior change: if EVERY subreddit for a topic fails, this now throws
// (instead of silently resolving to []), with a message that calls out
// rate-limiting specifically when that's what happened. That's what lets
// fetchAll.js's Promise.allSettled catch it and report Reddit as a failed
// source — see fetchAll.js's `sourceErrors`.

const { TOPICS } = require('../config/topics');
const { buildNormalizedItem } = require('../utils/normalize');

const USER_AGENT = 'scoopr-app/1.0 (personal news aggregator; contact: dev@scoopr.local)';
const POSTS_PER_SUBREDDIT = 15;
const FETCH_TIMEOUT_MS = 8000;

// Retry/backoff tuning for throttled (429) or blocked-looking (403)
// responses. Kept small and fast — this is a personal aggregator hitting
// a free endpoint, not a system that needs to patiently wait Reddit out.
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 800; // doubles each retry if Reddit gives no Retry-After

// Gap between *starting* each subreddit request for a topic. Subreddits
// per topic are few (2-3 in config/topics.js), so this adds well under a
// second to a topic fetch while meaningfully de-bursting the requests.
const REQUEST_STAGGER_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Reddit's preview image URLs come HTML-entity-escaped (e.g. "&amp;" instead
// of "&"), so they need to be unescaped before use.
function unescapeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function extractImageUrl(postData) {
  const preview = postData?.preview?.images?.[0]?.source?.url;
  if (preview) return unescapeHtmlEntities(preview);

  const thumbnail = postData?.thumbnail;
  if (thumbnail && /^https?:\/\//.test(thumbnail)) return thumbnail;

  return null;
}

function normalizeRedditPost(postData, topic) {
  return buildNormalizedItem({
    sourceType: 'reddit',
    sourceId: `reddit:${postData.id}`,
    title: postData.title,
    url: `https://www.reddit.com${postData.permalink}`,
    imageUrl: extractImageUrl(postData),
    topic,
    publishedAt: postData.created_utc ? postData.created_utc * 1000 : null,
    raw: postData
  });
}

// True for the two statuses Reddit's public endpoint realistically uses to
// signal "back off" — 429 is the textbook rate-limit response, 403 is what
// a blocked/flagged request commonly gets back from Reddit's edge instead
// of a "real" auth error (there's no auth here to be wrong about).
function isThrottleStatus(status) {
  return status === 429 || status === 403;
}

// Fetches one subreddit, retrying on a throttle-looking response. Resolves
// to the normalized items, or throws (after retries are exhausted) with a
// message tagged `[RATE_LIMITED]` when the failure looked like throttling,
// so callers can tell that apart from an unrelated HTTP error at a glance.
async function fetchSubredditWithRetry(subreddit, topic, attempt = 0) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${POSTS_PER_SUBREDDIT}`;

  let response;
  try {
    response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });
  } catch (err) {
    // Network-level failure (timeout/abort, DNS, connection reset) — not
    // a throttle response, so no backoff-retry here, just surface it.
    throw new Error(`Reddit r/${subreddit} request failed: ${err.message}`);
  }

  if (!response.ok) {
    if (isThrottleStatus(response.status) && attempt < MAX_RETRIES) {
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const backoffMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : BASE_BACKOFF_MS * 2 ** attempt;

      console.warn(
        `[reddit] r/${subreddit} throttled (HTTP ${response.status}) — retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      await sleep(backoffMs);
      return fetchSubredditWithRetry(subreddit, topic, attempt + 1);
    }

    const tag = isThrottleStatus(response.status) ? '[RATE_LIMITED] ' : '';
    throw new Error(
      `${tag}Reddit r/${subreddit} responded with HTTP ${response.status}${
        attempt > 0 ? ` after ${attempt} ${attempt === 1 ? 'retry' : 'retries'}` : ''
      }`
    );
  }

  const json = await response.json();
  const children = json?.data?.children || [];

  return children
    .filter((child) => child?.data && !child.data.stickied) // skip pinned/mod posts
    .map((child) => normalizeRedditPost(child.data, topic));
}

// Fetches every subreddit mapped to `topicKey` and returns one combined,
// normalized array. Requests are paced (see REQUEST_STAGGER_MS) rather
// than all fired in the same tick. Individual subreddit failures are
// logged and skipped — the topic still returns whatever succeeded.
//
// The one case this throws: every subreddit for the topic failed. That's
// treated as "Reddit itself is the problem right now" rather than "this
// topic just has nothing new", and is surfaced as a thrown error (tagged
// `[RATE_LIMITED]` when applicable) so fetchAll.js's Promise.allSettled
// catches it and reports Reddit as a failed source instead of silently
// returning zero Reddit items with no visible cause.
async function fetchRedditForTopic(topicKey) {
  const topicConfig = TOPICS[topicKey];
  if (!topicConfig) {
    throw new Error(`Unknown topic "${topicKey}"`);
  }

  const settledPromises = [];
  for (let i = 0; i < topicConfig.subreddits.length; i += 1) {
    if (i > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(REQUEST_STAGGER_MS);
    }
    const subreddit = topicConfig.subreddits[i];
    settledPromises.push(
      fetchSubredditWithRetry(subreddit, topicKey).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
      )
    );
  }

  const results = await Promise.all(settledPromises);

  const items = [];
  const failures = [];

  results.forEach((result, index) => {
    const subreddit = topicConfig.subreddits[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      failures.push({ subreddit, message });
      console.warn(`[reddit] Failed to fetch r/${subreddit}:`, message);
    }
  });

  const allFailed = failures.length > 0 && failures.length === topicConfig.subreddits.length;
  if (allFailed) {
    const rateLimited = failures.some((f) => f.message.includes('[RATE_LIMITED]'));
    const detail = failures.map((f) => `r/${f.subreddit}: ${f.message}`).join(' | ');
    throw new Error(
      `${rateLimited ? '[RATE_LIMITED] ' : ''}All ${failures.length} subreddit(s) failed for topic "${topicKey}" — ${
        rateLimited
          ? 'Reddit appears to be throttling or blocking this request'
          : 'Reddit may be down or unreachable'
      }. Details: ${detail}`
    );
  }

  return items;
}

module.exports = { fetchRedditForTopic };
