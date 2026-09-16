// TEMPORARY (Phase 2) test route for manually exercising the fetch
// pipeline. No auth required — this is a backend-only, no-UI-yet
// diagnostic endpoint and should be removed or protected once the real
// aggregation endpoint exists.

const express = require('express');
const { resolveTopicKey, TOPICS } = require('../config/topics');
const { fetchAllForTopic } = require('../services/fetchAll');
const { WINDOWS, DEFAULT_WINDOW } = require('../services/freshness');

const router = express.Router();

// GET /api/test/fetch?topic=tech&window=24h
//
// Runs Reddit + RSS + Hacker News for the given topic, merges the
// normalized results, applies the freshness filter, and returns the
// resulting JSON array. `window` accepts "6h", "24h", "3d" (or "3days");
// defaults to 24h if omitted or unrecognized.
//
// This supersedes the Prompt 1 endpoint (`/api/test/fetch-reddit-rss`).
router.get('/fetch', async (req, res) => {
  const topicKey = resolveTopicKey(req.query.topic);
  const window = req.query.window || DEFAULT_WINDOW;

  if (!topicKey) {
    return res.status(400).json({
      error: 'Missing or unknown "topic" query param.',
      validTopics: Object.keys(TOPICS)
    });
  }

  try {
    const { items, counts } = await fetchAllForTopic(topicKey, window);

    res.json({
      topic: topicKey,
      window,
      validWindows: Object.keys(WINDOWS),
      counts,
      items
    });
  } catch (err) {
    console.error('[testFetch] Unexpected error:', err);
    res.status(500).json({ error: 'Failed to fetch content.' });
  }
});

module.exports = router;
