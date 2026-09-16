// TEMPORARY (Phase 2) test routes for manually exercising the full
// fetch -> freshness -> dedup -> polish -> image -> storage pipeline.
// Same spirit as testFetch.js: no auth, backend-only diagnostic endpoints,
// meant to be removed or protected once the real aggregation endpoint
// (Phase 4's Feed tab) exists.
//
// MODIFIED — Phase 2, Prompt 5 (Final Assembly + Robustness):
//   - Both routes now call the consolidated `runPipeline()` from
//     services/pipeline.js instead of the old `runPipelineForTopic()`.
//   - GET /pipeline is kept as-is (same query params, same response
//     shape) for backward compatibility with Prompt 4 testing.
//   - GET /pipeline/full is NEW — this is the "final assembly" endpoint
//     for this prompt: same underlying pipeline, but a response shape
//     built around the { totalFetched, totalAfterFreshness,
//     totalAfterDedup, sourceErrors } metadata this prompt asks for, plus
//     `type=` for updateType.
//
// MODIFIED — Phase 3, Prompt 3 (Real Tech Events Logic): no changes were
// needed in THIS file for events to work — `type=events` / `type=both`
// already flowed straight through to `runPipeline({ updateType })` as of
// Prompt 5; that parameter just used to be an inert stub inside
// pipeline.js. Now that pipeline.js actually branches on it, this same
// route/response shape returns real, different results for `type=news`
// vs `type=events` vs `type=both` — see pipeline.js and
// services/eventsGenerator.js for the actual logic.
//
// Neither route replaces /api/test/fetch — that route is still useful for
// inspecting raw fetch+freshness output without touching the database.

const express = require('express');
const { WINDOWS } = require('../services/freshness');
const { runPipeline, PipelineInputError } = require('../services/pipeline');

const router = express.Router();

// Shapes a stored card row into the finished-card response format:
// { title, caption, imageUrl, sourceUrl, topic, createdAt, status }
function toResponseCard(row) {
  return {
    title: row.title,
    caption: row.caption,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    topic: row.topic,
    createdAt: row.created_at,
    status: row.status
  };
}

function handlePipelineError(err, res, routeName) {
  if (err instanceof PipelineInputError) {
    return res.status(400).json({ error: err.message, ...err.details });
  }
  console.error(`[${routeName}] Unexpected error:`, err);
  return res.status(500).json({ error: 'Failed to run pipeline.' });
}

// GET /api/test/pipeline?topic=tech&window=24h
//
// Kept from Prompt 4 for backward compatibility. Same response shape as
// before; internally it now just calls the consolidated runPipeline() and
// reshapes its result to match this route's original `counts` format.
router.get('/pipeline', async (req, res) => {
  try {
    const result = await runPipeline({
      topic: req.query.topic,
      freshnessWindow: req.query.window
    });

    res.json({
      topic: result.topic,
      window: result.window,
      validWindows: Object.keys(WINDOWS),
      counts: {
        ...result.counts.bySource,
        totalBeforeFilter: result.counts.totalFetched,
        totalAfterFilter: result.counts.totalAfterFreshness,
        unseen: result.counts.totalAfterDedup,
        insertedCards: result.counts.insertedCards
      },
      cards: result.cards.map(toResponseCard)
    });
  } catch (err) {
    handlePipelineError(err, res, 'testPipeline:/pipeline');
  }
});

// GET /api/test/pipeline/full?topic=tech&window=24h&type=news
//
// The Prompt 5 "final assembly" endpoint: runs the fully consolidated
// pipeline and returns the finished cards plus the metadata this prompt
// specifically asks for — totalFetched / totalAfterFreshness /
// totalAfterDedup / sourceErrors. `sourceErrors` is what makes a partial
// failure (e.g. Reddit alone getting throttled) visible here instead of
// only in server logs: it'll be a non-empty array while everything else
// in the response still reflects the sources that succeeded.
router.get('/pipeline/full', async (req, res) => {
  try {
    const result = await runPipeline({
      topic: req.query.topic,
      freshnessWindow: req.query.window,
      updateType: req.query.type
    });

    res.json({
      topic: result.topic,
      window: result.window,
      updateType: result.updateType,
      validWindows: Object.keys(WINDOWS),
      cards: result.cards.map(toResponseCard),
      meta: {
        totalFetched: result.counts.totalFetched,
        totalAfterFreshness: result.counts.totalAfterFreshness,
        totalAfterDedup: result.counts.totalAfterDedup,
        sourceErrors: result.sourceErrors
      }
    });
  } catch (err) {
    handlePipelineError(err, res, 'testPipeline:/pipeline/full');
  }
});

module.exports = router;
