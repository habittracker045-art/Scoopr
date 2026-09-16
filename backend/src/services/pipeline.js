// Consolidated pipeline — Phase 2, Prompt 5 (Final Assembly + Robustness).
// MODIFIED — Phase 3, Prompt 3 (Real Tech Events Logic): `updateType` now
// actually branches (see below) instead of being a validated-but-inert
// stub.
//
// Single entry point for turning a topic into finished, stored cards:
//
//   fetch news (Reddit + RSS + HN)  and/or  generate events (Gemini)
//     -> freshness filter
//     -> dedup (seen_items)
//     -> Gemini caption polish + image resolution
//     -> insert into `cards`
//
// This replaces the Prompt 4 version of this file (`runPipelineForTopic`).
// The step sequence itself is unchanged — what's new in this prompt:
//
//   1. A single object-shaped entry point, `runPipeline({ topic,
//      freshnessWindow, updateType })`, so every caller (both test routes
//      now, and a future Phase 3 scheduler) goes through one function
//      instead of each re-deriving topic/window handling itself.
//   2. Input validation (unknown topic) lives here instead of being
//      duplicated in each route — see `PipelineInputError` below.
//   3. Source-level failures (an entire source failing, e.g. Reddit being
//      throttled or timing out) are surfaced back to the caller as
//      `sourceErrors` instead of only being console-logged and silently
//      dropped. The pipeline still completes using whatever the other
//      sources returned — see fetchAll.js for where that isolation
//      actually happens.
//   4. An `updateType` ('news' | 'events' | 'both') parameter is accepted,
//      validated, AND now actually changes behavior:
//        - 'news'   -> unchanged Prompt-5 behavior: fetchAllForTopic only.
//        - 'events' -> runs eventsGenerator.js (Gemini-generated tech/topic
//                      events) INSTEAD of fetchAllForTopic.
//        - 'both'   -> runs both and merges the results before the shared
//                      freshness/dedup/caption/image steps below, exactly
//                      the same way regardless of which branch(es) an item
//                      came from. See runEventsBranch() and the merge in
//                      runPipeline() itself.

const { resolveTopicKey, TOPICS } = require('../config/topics');
const { DEFAULT_WINDOW, filterByFreshness } = require('../services/freshness');
const { fetchAllForTopic } = require('./fetchAll');
const { generateEventsForTopic } = require('./eventsGenerator');
const { filterUnseenItems } = require('./dedup');
const { polishCaption } = require('./geminiCaption');
const { resolveImage } = require('./imageHandler');
const { insertDraftCards } = require('./cardStore');
const { mapWithConcurrency } = require('../utils/concurrency');

// How many items to polish/image-render at once. Kept modest by default
// since the Gemini free tier is rate-limited per-minute (see README) —
// override with PIPELINE_CONCURRENCY if your quota allows more.
const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY) || 3;

// --- updateType: 'news' vs 'events' vs 'both' --------------------------
//
// No longer a stub as of Phase 3, Prompt 3 — see runEventsBranch() and
// the branching in runPipeline() below for the actual behavior. This
// allowlist/normalizer is unchanged in shape from the Prompt-5 stub
// version, just with 'both' added to match what schedule.js /
// validateSchedule.js already accept at the settings layer.
const UPDATE_TYPES = ['news', 'events', 'both'];
const DEFAULT_UPDATE_TYPE = 'news';

function normalizeUpdateType(updateType) {
  if (!updateType) return DEFAULT_UPDATE_TYPE;

  const key = String(updateType).trim().toLowerCase();
  if (UPDATE_TYPES.includes(key)) return key;

  console.warn(
    `[pipeline] Unrecognized updateType "${updateType}" — defaulting to "${DEFAULT_UPDATE_TYPE}". Valid values: ${UPDATE_TYPES.join(', ')}.`
  );
  return DEFAULT_UPDATE_TYPE;
}

// Thrown for bad *input* (e.g. unknown topic) as opposed to a runtime
// failure — routes can catch this specifically and respond 400 instead of
// 500. `details` carries anything useful for the error response (e.g. the
// list of valid topics) without the route having to re-import topics.js
// just to build that list itself.
class PipelineInputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'PipelineInputError';
    this.details = details;
  }
}

// Runs caption polishing + image resolution for a single item and returns
// a new item with `caption` and `imageUrl` filled in. Both steps already
// degrade gracefully on their own (fallback caption / null image), so this
// never throws — a failure on one item never aborts the batch.
async function finishItem(item, topicKey) {
  const [caption, imageUrl] = await Promise.all([
    polishCaption(item),
    resolveImage(item, topicKey)
  ]);

  return { ...item, caption, imageUrl };
}

// Runs eventsGenerator.js for a topic/window and normalizes its outcome
// into the same { items, counts, sourceErrors } shape fetchAllForTopic()
// returns from fetchAll.js, so runPipeline() below can treat both
// branches identically when merging.
//
// generateEventsForTopic() throws on a genuine failure (missing Gemini
// key, network error, unusable response) — see the resilience-contract
// note at the top of eventsGenerator.js. That's caught here exactly the
// way fetchAll.js's Promise.allSettled catches a fully-failed
// Reddit/RSS/HN fetcher: log it, report it via `sourceErrors`, and carry
// on with zero items from this branch rather than failing the whole
// pipeline run over it.
async function runEventsBranch(topicKey, window) {
  try {
    const items = await generateEventsForTopic(topicKey, window);
    return { items, counts: { generatedEvents: items.length }, sourceErrors: [] };
  } catch (err) {
    const message = err?.message || String(err);
    console.error(`[pipeline] Events generation failed entirely for topic "${topicKey}" — continuing with zero generated events. Reason: ${message}`);
    return { items: [], counts: { generatedEvents: 0 }, sourceErrors: [{ source: 'generated-event', message }] };
  }
}

// Single entry point for the whole pipeline. Takes a plain options object
// (rather than positional args) so callers can't mix up argument order,
// and so a future new input doesn't change every call site's signature.
//
//   topic            — required. Resolved via config/topics.js
//                       (resolveTopicKey handles aliases, e.g.
//                       "technology" -> "tech").
//   freshnessWindow  — optional. "6h" | "24h" | "3d" (see
//                       services/freshness.js). Defaults to
//                       freshness.js's own DEFAULT_WINDOW if omitted.
//                       An unrecognized value is *not* fatal — freshness.js
//                       logs a warning and falls back to its default,
//                       same as it always has.
//   updateType       — optional. "news" | "events" | "both". Defaults to
//                       "news". See the branching note above — "news" only
//                       fetches Reddit/RSS/HN, "events" only generates via
//                       Gemini (eventsGenerator.js), "both" does both and
//                       merges before the shared steps below.
//
// Resolves to:
//   {
//     topic, window, updateType,
//     counts: {
//       totalFetched,       // items returned by all sources, pre-filter
//       totalAfterFreshness,// after the freshness-window filter
//       totalAfterDedup,    // after removing already-seen items
//       bySource: { reddit, rss, hackernews, generatedEvents }, // raw per-source counts
//       insertedCards       // rows actually written to `cards`
//     },
//     sourceErrors: [{ source, message }], // sources that failed entirely
//     cards: [ ...finished card rows from cardStore ]
//   }
//
// Error behavior is intentionally asymmetric:
//   - A single SOURCE failing (Reddit timing out, being throttled, RSS
//     feed down, generated-events Gemini call failing outright, etc.) is
//     NOT fatal. fetchAllForTopic isolates news-source failures (see
//     fetchAll.js) and runEventsBranch() above does the same for the
//     events branch — both report failures via `sourceErrors` instead —
//     the pipeline still runs to completion with whatever the healthy
//     branch(es) returned, even if that's zero items total.
//   - An unknown/missing `topic` throws `PipelineInputError` — that's a
//     caller mistake, not a runtime fluke, so it's worth failing loudly
//     and early rather than quietly returning an empty result.
//   - A dedup or storage (Supabase) failure still throws normally. Unlike
//     a flaky external content source, there's no reasonable partial
//     result to hand back if we can't tell what's already been shown to
//     the user, or can't persist what we fetched.
async function runPipeline({ topic, freshnessWindow, updateType } = {}) {
  const topicKey = resolveTopicKey(topic);
  if (!topicKey) {
    throw new PipelineInputError('Missing or unknown "topic".', {
      validTopics: Object.keys(TOPICS)
    });
  }

  const window = freshnessWindow || DEFAULT_WINDOW;
  const resolvedUpdateType = normalizeUpdateType(updateType);

  const runNews = resolvedUpdateType === 'news' || resolvedUpdateType === 'both';
  const runEvents = resolvedUpdateType === 'events' || resolvedUpdateType === 'both';

  // --- News branch (Reddit + RSS + HN) — untouched from Prompt 5, just
  // now conditional on updateType instead of always running. ------------
  let newsItems = [];
  let newsRawCounts = { reddit: 0, rss: 0, hackernews: 0 };
  let newsTotalBeforeFilter = 0;
  let sourceErrors = [];

  if (runNews) {
    const newsResult = await fetchAllForTopic(topicKey, window);
    newsItems = newsResult.items; // already freshness-filtered by fetchAll.js
    newsRawCounts = {
      reddit: newsResult.counts.reddit,
      rss: newsResult.counts.rss,
      hackernews: newsResult.counts.hackernews
    };
    newsTotalBeforeFilter = newsResult.counts.totalBeforeFilter;
    sourceErrors = sourceErrors.concat(newsResult.sourceErrors);
  }

  // --- Events branch (Gemini-generated) — new in this prompt. -----------
  let eventItems = [];
  let generatedEventsCount = 0;

  if (runEvents) {
    const eventsResult = await runEventsBranch(topicKey, window);
    eventItems = eventsResult.items;
    generatedEventsCount = eventsResult.counts.generatedEvents;
    sourceErrors = sourceErrors.concat(eventsResult.sourceErrors);
  }

  // --- Merge, then run the SAME shared steps over the combined set. -----
  // Re-running filterByFreshness here is a no-op for newsItems (already
  // filtered above) and a near-always-pass for eventItems (they're
  // stamped with publishedAt = generation time — see eventsGenerator.js
  // for why), but keeping one shared call site — rather than only
  // filtering the news branch — means 'events' and 'both' still go
  // through every step 'news' does, just with a branch that behaves
  // differently for content that has no real publish timestamp to filter
  // on to begin with.
  const combined = [...newsItems, ...eventItems];
  const freshItems = filterByFreshness(combined, window).sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  // filterUnseenItems (dedup.js) is untouched — it dedups purely on
  // `item.sourceId`, which eventsGenerator.js already populates with a
  // hash of title+timeframe (see utils/hashDedupKey.js) instead of a URL,
  // so generated events flow through the exact same seen_items check as
  // Reddit/RSS/HN items with no special-casing needed here.
  const unseenItems = await filterUnseenItems(freshItems);

  const finishedItems = await mapWithConcurrency(unseenItems, CONCURRENCY, (item) =>
    finishItem(item, topicKey)
  );

  const insertedCards = await insertDraftCards(finishedItems);

  return {
    topic: topicKey,
    window,
    updateType: resolvedUpdateType,
    counts: {
      totalFetched: newsTotalBeforeFilter + eventItems.length,
      totalAfterFreshness: freshItems.length,
      totalAfterDedup: unseenItems.length,
      bySource: {
        reddit: newsRawCounts.reddit,
        rss: newsRawCounts.rss,
        hackernews: newsRawCounts.hackernews,
        generatedEvents: generatedEventsCount
      },
      insertedCards: insertedCards.length
    },
    sourceErrors,
    cards: insertedCards
  };
}

module.exports = { runPipeline, PipelineInputError };
