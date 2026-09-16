// Tiny dependency-free concurrency limiter. Runs `fn` over `items` with at
// most `limit` in flight at once, preserving input order in the returned
// array. Used by pipeline.js to throttle Gemini API calls (free tier is
// rate-limited per-minute) and image generation, instead of firing one
// request per item all at once.

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

module.exports = { mapWithConcurrency };
