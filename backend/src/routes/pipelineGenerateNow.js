// Scoopr — Phase 3, Cron Engine + Manual "Generate Now"
//
// POST /api/pipeline/generate-now — authenticated. Runs the pipeline
// immediately for the logged-in user, using whatever's saved in their
// schedule_settings row (topics, freshness_window, update_type) — this
// deliberately ignores `enabled` and `scheduled_time` entirely, since
// clicking "Generate Now" means "run it right now regardless of my
// schedule", not "run it only if my schedule would currently allow it".
//
// Nothing in routes/schedule.js, services/pipeline.js, or the
// schedule_settings schema is touched by this file. It only reads the
// existing row and hands it to services/scheduleRunner.js — the same
// shared runner + overlap-protection the cron engine uses.

const express = require('express');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { runForUser, RunInProgressError } = require('../services/scheduleRunner');

const router = express.Router();

// Shapes a stored card row into the same finished-card response format
// used by GET /api/test/pipeline/full (see routes/testPipeline.js) —
// kept as an identical copy rather than a shared import so a future
// change to one test/diagnostic route's shape doesn't silently change
// this real, user-facing endpoint's response shape too.
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

// POST /api/pipeline/generate-now
router.post('/generate-now', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    const { data: schedule, error } = await supabase
      .from('schedule_settings')
      .select('topics, freshness_window, update_type')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!schedule || !schedule.topics || schedule.topics.length === 0) {
      return res.status(400).json({
        error:
          'No topics are configured yet. Save your schedule settings (PUT /api/schedule) with at least one topic before using Generate Now.'
      });
    }

    console.log(
      `[generate-now] Manual run triggered by user ${userId} (topics: ${schedule.topics.join(', ')}, ` +
        `window: ${schedule.freshness_window}, type: ${schedule.update_type})`
    );

    const results = await runForUser(userId, {
      topics: schedule.topics,
      freshnessWindow: schedule.freshness_window,
      updateType: schedule.update_type
    });

    // Same per-topic result shape as GET /api/test/pipeline/full, just
    // one entry per topic instead of one response per topic — a
    // schedule (and therefore a "Generate Now" click) can cover several
    // topics at once, which that single-topic test endpoint never had to
    // handle.
    const response = {
      results: results.map(({ topic, ok, result, error: errMessage, details }) => {
        if (!ok) {
          return { topic, ok: false, error: errMessage, details };
        }
        return {
          topic: result.topic,
          ok: true,
          window: result.window,
          updateType: result.updateType,
          cards: result.cards.map(toResponseCard),
          meta: {
            totalFetched: result.counts.totalFetched,
            totalAfterFreshness: result.counts.totalAfterFreshness,
            totalAfterDedup: result.counts.totalAfterDedup,
            sourceErrors: result.sourceErrors
          }
        };
      })
    };

    console.log(
      `[generate-now] Finished manual run for user ${userId}: ` +
        `${response.results.filter((r) => r.ok).length}/${response.results.length} topic(s) succeeded.`
    );

    return res.json(response);
  } catch (err) {
    if (err instanceof RunInProgressError) {
      return res.status(409).json({
        error: 'A pipeline run for your account is already in progress. Try again shortly.'
      });
    }
    console.error('[generate-now] Unexpected error:', err);
    return res.status(500).json({ error: 'Failed to generate now.' });
  }
});

module.exports = router;
