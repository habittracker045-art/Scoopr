// Tips & Facts routes — Phase 3, Prompt 4. Extended in the Redesign
// Phase, Prompt 4 ("no pile-up, one at a time" + editing).
//
// Three endpoints, all authenticated (same pattern as routes/create.js
// and routes/schedule.js):
//   POST  /api/tips-facts/generate — generates new tips/facts via
//     Gemini, saves them to `tips_facts`, and returns what was actually
//     saved (post-dedup — see services/tipsFactsGenerator.js). Accepts
//     an optional `count` (already supported since Phase 3, Prompt 4 —
//     see validateOptions() in tipsFactsGenerator.js); the Redesign
//     Phase, Prompt 4 frontend now always sends `count: 1` so a single
//     tip/fact comes back at a time instead of the old 5-per-batch
//     default, matching the "no pile-up" direction. No backend change
//     was needed for this — the `count` parameter already existed and
//     was already plumbed all the way through to Gemini's prompt.
//   PATCH /api/tips-facts/:id      — (new, Redesign Phase, Prompt 4)
//     updates a single tips_facts row's `content`. Added because the
//     tab previously had Share only, with no way to fix a generated
//     tip/fact's wording before sharing it — same gap Edit already
//     closes for Feed/Create cards via PATCH /api/cards/:id. Mirrors
//     that route's validation/response shape exactly (see below).
//   GET   /api/tips-facts          — returns saved tips/facts, most
//     recent first. No longer called on load by the Redesign Phase,
//     Prompt 4 Tips & Facts tab (which now starts from a clean "Generate
//     a tip or fact" state instead of fetching the historical list — see
//     that prompt's README section), but left completely unmodified and
//     in place: it's still a generically useful "list what's stored"
//     endpoint (e.g. for a future admin view, or if a future prompt
//     wants a "past tips" browsing surface), and removing a working,
//     harmless endpoint is outside this prompt's scope.
//
// This does not touch the news pipeline, events logic, scheduling, or
// manual create mode — tips/facts are a self-contained new content type
// alongside them, stored in their own table (see
// db/phase3_prompt4_schema.sql).

const express = require('express');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { generateTipsFacts, TipsFactsInputError } = require('../services/tipsFactsGenerator');

const router = express.Router();

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

// Shapes a stored `tips_facts` row into the camelCase API response shape,
// same convention routes/create.js and routes/schedule.js use for their
// own tables.
function toResponseShape(row) {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    topic: row.topic,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    status: row.status
  };
}

// POST /api/tips-facts/generate
// Body (all optional): { topic?: string, category?: 'tip'|'fact'|'mixed', count?: number }
router.post('/generate', requireAuth, async (req, res) => {
  const { topic, category, count } = req.body || {};

  try {
    const rows = await generateTipsFacts({ topic, category, count });
    return res.status(201).json({
      tipsFacts: rows.map(toResponseShape),
      generatedCount: rows.length
    });
  } catch (err) {
    if (err instanceof TipsFactsInputError) {
      return res.status(400).json({ error: err.message, ...err.details });
    }
    console.error('POST /api/tips-facts/generate error:', err.message);
    return res.status(500).json({ error: 'Failed to generate tips/facts.' });
  }
});

// GET /api/tips-facts
// Query params (all optional):
//   topic  — filter to a single topic (e.g. ?topic=tech)
//   limit  — max rows to return (default 50, capped at 200)
router.get('/', requireAuth, async (req, res) => {
  const { topic } = req.query;
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  try {
    let query = supabase
      .from('tips_facts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (topic) {
      query = query.eq('topic', String(topic).trim().toLowerCase());
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ tipsFacts: (data || []).map(toResponseShape) });
  } catch (err) {
    console.error('GET /api/tips-facts error:', err.message);
    return res.status(500).json({ error: 'Something went wrong loading tips & facts.' });
  }
});

// PATCH /api/tips-facts/:id
// (New — Redesign Phase, Prompt 4.)
// Body (JSON, required): { content: string }
//   content — replacement tip/fact text, non-empty after trimming. This
//     is the only editable field: `category`/`topic` are set at
//     generation time and aren't something the Edit UI exposes, and
//     `status`/`image_url` aren't touched by editing either. Mirrors
//     routes/cards.js's PATCH /api/cards/:id validation style (trim,
//     reject empty, 400 on bad input) for consistency across the app's
//     two Edit flows.
//
// There's no separate "save" step beyond this: generating already
// inserts the draft row (see services/tipsFactsGenerator.js), so Edit's
// "save" simply updates that same row's `content` in place via this
// endpoint — there's nothing else to persist.
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  if (!Object.prototype.hasOwnProperty.call(body, 'content')) {
    return res.status(400).json({ error: 'Provide "content" to update.' });
  }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return res.status(400).json({ error: 'content must be a non-empty string.' });
  }

  const content = body.content.trim();

  try {
    const { data, error } = await supabase
      .from('tips_facts')
      .update({ content })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // Malformed :id (not a UUID) — Postgres' invalid-input-syntax code.
      if (error.code === '22P02') {
        return res.status(400).json({ error: 'Invalid tip/fact id.' });
      }
      // .single() errors with this code when the filter matched zero rows.
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Tip/fact not found.' });
      }
      throw error;
    }

    return res.json({ tipFact: toResponseShape(data) });
  } catch (err) {
    console.error('PATCH /api/tips-facts/:id error:', err.message);
    return res.status(500).json({ error: 'Something went wrong updating that tip/fact.' });
  }
});

module.exports = router;
