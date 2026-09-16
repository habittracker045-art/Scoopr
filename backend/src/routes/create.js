// POST /api/create — Manual "Create" mode (Phase 3, Prompt 2).
//
// A different flow from the auto pipeline (Reddit/RSS/HN -> Gemini polish
// -> card): here the user types an idea directly, Gemini enriches it with
// general context + a suggested caption + a suggested source/angle, and
// the result is saved as a `cards` row with sourceType 'manual' so
// History/Feed can distinguish it from auto-generated cards later.
//
// Auth-required, unlike the temporary Phase 2 test routes — this is a
// real user-facing endpoint, same pattern as routes/schedule.js.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createManualCard, ManualCreateInputError } = require('../services/manualCreate');
const { TOPICS } = require('../config/topics');

const router = express.Router();

function topicLabel(topicKey) {
  return TOPICS[topicKey]?.label || topicKey;
}

// Shapes a stored `cards` row into the same finished-card response shape
// testPipeline.js uses for the auto pipeline (title/caption/imageUrl/
// sourceUrl/topic/status), plus the two fields specific to this flow:
// sourceType (so callers can tell manual vs auto cards apart) and the
// optional enrichmentNote (Gemini's context/angle suggestions).
//
// Phase 4, Prompt 4: also includes `id` and `topicLabel` now, matching
// routes/cards.js's toResponseShape. The Create tab renders its freshly-
// generated card with the same <CardListItem>/<CardActions> components
// the Feed tab uses (Approve/Edit/Skip all PATCH /api/cards/:id by id,
// and CardListItem's meta row reads topicLabel directly) — without these
// two fields here, that reuse wouldn't be possible.
function toResponseCard(row) {
  return {
    id: row.id,
    title: row.title,
    caption: row.caption,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    topic: row.topic,
    topicLabel: topicLabel(row.topic),
    sourceType: row.source_type,
    status: row.status,
    createdAt: row.created_at,
    enrichmentNote: row.enrichment_note || null
  };
}

// POST /api/create
// Body: { ideaText: string, topic: string }
router.post('/', requireAuth, async (req, res) => {
  const { ideaText, topic } = req.body || {};

  try {
    const card = await createManualCard({ ideaText, topic });
    return res.status(201).json({ card: toResponseCard(card) });
  } catch (err) {
    if (err instanceof ManualCreateInputError) {
      return res.status(400).json({ error: err.message, ...err.details });
    }
    console.error('POST /api/create error:', err);
    return res.status(500).json({ error: 'Failed to create card.' });
  }
});

module.exports = router;
