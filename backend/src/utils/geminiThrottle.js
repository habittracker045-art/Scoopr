// Shared Gemini call-pacing + retry-on-throttle helper — Phase 3, Prompt 6
// (Final Consolidation + Robustness).
//
// WHY THIS EXISTS: Phase 2 only ever called Gemini from one place
// (services/geminiCaption.js's polishCaption(), one call per fetched
// item, already spread out a little by utils/concurrency.js's
// CONCURRENCY limit). Phase 3 added THREE more call sites on top of that
// — services/manualCreate.js (enrichment), services/eventsGenerator.js
// (events), services/tipsFactsGenerator.js (tips/facts) — and all of them
// can now fire back-to-back in a single unattended cron tick: a scheduled
// "both" run does an events-generation call PLUS one caption-polish call
// per fetched/generated item, for every topic in the user's schedule, in
// immediate sequence (services/scheduleRunner.js runs topics one after
// another, not in parallel). Nothing was pacing or retrying THOSE calls
// against Gemini's free-tier per-minute limit — this file is that missing
// piece, adapted from reddit.js's existing backoff pattern (Phase 2,
// Prompt 5) rather than inventing a new one:
//
//   1. Request pacing — mirrors reddit.js's REQUEST_STAGGER_MS. Every
//      Gemini call goes through waitForGeminiSlot() first, which enforces
//      a minimum gap since the last call STARTED, queueing callers in
//      order via a simple promise chain (no extra dependency). One shared
//      queue here means it throttles Gemini traffic app-wide, not just
//      within one call site.
//   2. Retry with backoff on throttle — mirrors reddit.js's
//      MAX_RETRIES/BASE_BACKOFF_MS, honoring a `Retry-After` header when
//      Gemini sends one, otherwise doubling each attempt.
//
// This is intentionally called from ONE place — geminiCaption.js's
// callGemini() — since every Phase 2/3 Gemini call site already funnels
// through that single function. Nothing else needs to import this file
// directly.

const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS) || 1100;
const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES) || 2;
const BASE_BACKOFF_MS = 1000; // doubles each retry if Gemini gives no Retry-After

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A promise chain used as a simple, dependency-free serial queue: each
// call to waitForGeminiSlot() appends itself to the chain and resolves
// only once MIN_INTERVAL_MS has elapsed since the previous slot was
// granted, regardless of how many callers are queued up concurrently
// (e.g. pipeline.js's mapWithConcurrency running several
// finishItem()/polishCaption() calls at once).
let queue = Promise.resolve(0);

function waitForGeminiSlot() {
  const next = queue.then(async (lastGrantedAt) => {
    const elapsed = Date.now() - lastGrantedAt;
    if (elapsed < MIN_INTERVAL_MS) {
      await sleep(MIN_INTERVAL_MS - elapsed);
    }
    return Date.now();
  });
  // Advance the queue regardless of what the caller does with `next`.
  queue = next.catch(() => Date.now());
  return next.then(() => undefined);
}

// Returns true for an HTTP status that means "back off" — 429 is Gemini's
// standard rate-limit response; 503 ("model overloaded") is included too
// since it's a transient capacity issue with the same "wait and retry"
// remedy, not a real error worth failing the caller over immediately.
function isThrottleStatus(status) {
  return status === 429 || status === 503;
}

// Runs `makeRequest()` (an async function that performs one fetch and
// returns the raw Response) with Gemini call pacing + throttle retry
// applied around it. `makeRequest` is called once per attempt, so it
// should build a fresh request each time.
async function callWithGeminiThrottle(makeRequest) {
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await waitForGeminiSlot();
    const response = await makeRequest();

    if (!isThrottleStatus(response.status) || attempt >= MAX_RETRIES) {
      return response;
    }

    const retryAfterHeader = response.headers?.get?.('retry-after');
    const retryAfterMs = retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))
      ? Number(retryAfterHeader) * 1000
      : BASE_BACKOFF_MS * 2 ** attempt;

    console.warn(
      `[geminiThrottle] Gemini responded ${response.status} (rate-limited/overloaded) — retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    await sleep(retryAfterMs);
    attempt += 1;
  }
}

module.exports = { callWithGeminiThrottle, waitForGeminiSlot };
