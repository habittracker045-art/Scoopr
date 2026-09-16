// Cards routes — Phase 4, Prompts 2-3, 5 (Feed tab: browsing, then
// Approve/Edit/Skip; History tab: search).
//
// Prompt 2 added the one read endpoint the Feed tab needed (cards were
// previously write-only — cardStore.insertDraftCards, called from
// pipeline.js and manualCreate.js — nothing in routes/ read them back):
//
//   GET /api/cards  — paginated, filterable list of cards, most recent
//     first. Same auth + response-shaping conventions as
//     routes/tipsFacts.js (requireAuth, camelCase response shape).
//
// Prompt 3 adds the one write endpoint the Review & Share flow needs:
//
//   PATCH /api/cards/:id  — update a card's status and/or caption.
//     Powers all three review actions from the Feed UI: Approve
//     ({status:'approved'}), Skip ({status:'skipped'}), and Edit
//     ({caption:'...'}, optionally alongside a status change). There is
//     no separate "publish"/"post" endpoint anywhere in this codebase —
//     per the spec ("never auto-posts"), the only thing that happens
//     server-side on Approve is a status flip; actually sending the card
//     anywhere is the Share button's native-share-sheet handoff on the
//     client, which this endpoint has nothing to do with.
//
// Prompt 5 extends GET /api/cards with one more optional query param the
// History tab needs and nothing else already covered:
//
//   search — case-insensitive substring match against title OR caption.
//     History already gets "all statuses" and "one specific topic" for
//     free from the status/topic params Prompt 2 already built (status
//     already defaulted to 'draft' for the Feed, but ?status=all,
//     ?status=approved, ?status=skipped already worked — see
//     DEFAULT_STATUS below). Only the free-text search box needed new
//     backend support, so that's the only addition here.
//
// Redesign Phase, Prompt 6 (History: Search + Filters, Final
// Consolidation) adds one more optional query param — the only thing
// `search`/`topic`/`status` didn't already cover for the History tab's
// filter pills:
//
//   sourceType — 'auto' | 'manual' | 'all' (default: 'all', no filter).
//     Every row's `source_type` column is one of 'reddit' | 'rss' |
//     'hackernews' | 'generated-event' (all auto-pipeline sources — see
//     services/fetchAll.js, services/eventsGenerator.js) or 'manual'
//     (services/manualCreate.js). Rather than hardcode/duplicate that
//     auto-source list here (and have to remember to extend it if a new
//     auto source is ever added), 'manual' is treated as the only
//     distinguished value: ?sourceType=manual filters to exactly that,
//     ?sourceType=auto filters to "anything that isn't 'manual'"
//     (`.neq('source_type', 'manual')`), and anything else (including
//     omitted) applies no filter at all.
//
// Redesign Phase, Prompt 2 (Feed: Rebuild as a Carousel) makes two small
// additions, both here rather than a new endpoint — the carousel's "6
// most recent cards, any status, any source" need is already fully
// covered by the existing topic/status/limit/offset params (the Feed
// page now just calls GET /api/cards?status=all&limit=6):
//
//   1. toResponseShape() now includes `enrichmentNote`. The row was
//      always fetched (`select('*')`) but this endpoint's response
//      shaping silently dropped it — routes/create.js's toResponseCard
//      included it from Phase 3, Prompt 2 onward, but that shape is only
//      used for the just-created card handed back from POST /api/create,
//      never for cards re-fetched through this list endpoint. Anything
//      loaded via GET /api/cards (Feed, History) got enrichment_note
//      back from Postgres and then threw it away before it ever reached
//      the client. Purely additive — existing consumers that don't read
//      `enrichmentNote` are unaffected.
//   2. PATCH /api/cards/:id now also accepts `title` and `enrichmentNote`
//      (see that handler below) — the carousel's Edit action opens the
//      full card (headline + caption + enrichment note, when present),
//      not just the caption CardActions' Edit has always handled.
//
// None of this touches cardStore.js, the pipeline, dedup, or the
// `cards` schema — purely additive.

const express = require('express');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { TOPICS, resolveTopicKey } = require('../config/topics');

const router = express.Router();

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const VALID_STATUSES = ['draft', 'approved', 'skipped'];

// The Feed tab is the review queue for freshly-generated content, so
// "browse the feed" defaults to the cards nobody has actioned yet.
// Approve/Edit/Skip land in the next prompt; ?status=approved/skipped
// still works (e.g. for the later History tab, or manual testing) —
// this is a default, not a hard restriction.
const DEFAULT_STATUS = 'draft';

function topicLabel(topicKey) {
  return TOPICS[topicKey]?.label || topicKey;
}

// Escapes a user-supplied search term for safe use inside a PostgREST
// `.or()` filter string. Two independent things need escaping:
//   1. ILIKE wildcards (%, _) — escaped with a backslash so a literal
//      "%" or "_" the user typed is matched literally instead of acting
//      as a wildcard.
//   2. The `or()` filter syntax itself — values are wrapped in double
//      quotes below (required whenever a value might contain a comma or
//      parenthesis), so any double quote in the term must be escaped.
// Order matters: backslashes are escaped first so the later
// replacements' own backslashes aren't double-escaped.
function escapeSearchTerm(term) {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/"/g, '\\"');
}

// Shapes a stored `cards` row into the camelCase API response shape,
// same convention routes/tipsFacts.js and routes/create.js use.
function toResponseShape(row) {
  return {
    id: row.id,
    topic: row.topic,
    topicLabel: topicLabel(row.topic),
    title: row.title,
    caption: row.caption,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    createdAt: row.created_at,
    status: row.status,
    // Redesign Phase, Prompt 2: was queried (select('*')) but never
    // included in this response shape — see the file header comment.
    // null for auto-pipeline cards, which never populate this column.
    enrichmentNote: row.enrichment_note || null
  };
}

// GET /api/cards
// Query params (all optional):
//   topic  — filter to a single topic key (e.g. ?topic=tech). Accepts the
//            same aliases as the pipeline (resolveTopicKey). Omit or pass
//            "all" for every topic.
//   status — filter to one of 'draft' | 'approved' | 'skipped'.
//            Defaults to 'draft' (see DEFAULT_STATUS above). Pass
//            ?status=all to remove the status filter entirely.
//   search — (Phase 4, Prompt 5) case-insensitive substring match
//            against title OR caption. Powers the History tab's search
//            box. Omit for no text filtering.
//   sourceType — (Redesign Phase, Prompt 6) 'auto' | 'manual' | 'all'.
//            Powers the History tab's source-type filter pills. Omit or
//            pass "all" for no source filtering.
//   limit  — page size, default 20, capped at 50.
//   offset — how many rows to skip, default 0. Used for "load more" /
//            infinite scroll — see README for why offset pagination was
//            chosen here over a cursor.
router.get('/', requireAuth, async (req, res) => {
  const { topic, status, search, sourceType } = req.query;

  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  const requestedOffset = Number(req.query.offset);
  const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0
    ? Math.floor(requestedOffset)
    : 0;

  let topicKey = null;
  if (topic && String(topic).trim().toLowerCase() !== 'all') {
    topicKey = resolveTopicKey(topic);
    if (!topicKey) {
      return res.status(400).json({ error: `Unknown topic "${topic}".` });
    }
  }

  let statusFilter = DEFAULT_STATUS;
  const rawStatus = status ? String(status).trim().toLowerCase() : null;
  if (rawStatus === 'all') {
    statusFilter = null;
  } else if (rawStatus) {
    if (!VALID_STATUSES.includes(rawStatus)) {
      return res.status(400).json({ error: `Unknown status "${status}".` });
    }
    statusFilter = rawStatus;
  }

  const searchTerm = search && String(search).trim() ? String(search).trim() : null;

  const rawSourceType = sourceType ? String(sourceType).trim().toLowerCase() : null;
  const sourceTypeFilter = rawSourceType === 'auto' || rawSourceType === 'manual' ? rawSourceType : null;

  try {
    // Fetch one extra row past the page size so we can tell the client
    // whether there's a next page without a second COUNT query.
    let query = supabase
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit); // inclusive range, so this is limit+1 rows

    if (topicKey) {
      query = query.eq('topic', topicKey);
    }
    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }
    if (searchTerm) {
      const term = escapeSearchTerm(searchTerm);
      query = query.or(`title.ilike."%${term}%",caption.ilike."%${term}%"`);
    }
    if (sourceTypeFilter === 'manual') {
      query = query.eq('source_type', 'manual');
    } else if (sourceTypeFilter === 'auto') {
      query = query.neq('source_type', 'manual');
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    return res.json({
      cards: pageRows.map(toResponseShape),
      nextOffset: hasMore ? offset + limit : null,
      hasMore
    });
  } catch (err) {
    console.error('GET /api/cards error:', err.message);
    return res.status(500).json({ error: 'Something went wrong loading cards.' });
  }
});

// PATCH /api/cards/:id
// Body (JSON, at least one field required):
//   status         — one of 'draft' | 'approved' | 'skipped'.
//                    Approve sends {status:'approved'}; Skip sends
//                    {status:'skipped'}. ('draft' is accepted too — e.g.
//                    for an "un-skip" affordance later — not just a
//                    one-way street.)
//   caption        — replacement caption text, non-empty after trimming.
//                    Edit sends this on its own (save the edit, leave
//                    status as whatever it already was) — see README for
//                    why Edit and Approve are two separate taps rather
//                    than one combined "save & approve" request.
//   title          — (Redesign Phase, Prompt 2) replacement headline
//                    text, non-empty after trimming. The Feed carousel's
//                    Edit opens the full card, not just the caption.
//   enrichmentNote — (Redesign Phase, Prompt 2) replacement AI context/
//                    suggested-angle text. Unlike caption/title, an
//                    empty string is allowed here (clears the note) —
//                    only present on manually-created cards to begin
//                    with, and the carousel only shows this field in its
//                    Edit form when the card already has a note to edit.
//
// All fields can be sent together in one request if a caller wants to
// save several edits (or an edit + a status change) at once; the route
// doesn't care, it just applies whichever fields are present.
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    const status = String(body.status).trim().toLowerCase();
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Unknown status "${body.status}".` });
    }
    updates.status = status;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'caption')) {
    if (typeof body.caption !== 'string' || !body.caption.trim()) {
      return res.status(400).json({ error: 'caption must be a non-empty string.' });
    }
    updates.caption = body.caption.trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return res.status(400).json({ error: 'title must be a non-empty string.' });
    }
    updates.title = body.title.trim();
  }

  if (Object.prototype.hasOwnProperty.call(body, 'enrichmentNote')) {
    if (body.enrichmentNote !== null && typeof body.enrichmentNote !== 'string') {
      return res.status(400).json({ error: 'enrichmentNote must be a string or null.' });
    }
    // Unlike caption/title, an empty string is valid here — it clears
    // the note entirely rather than being rejected as "empty".
    const trimmed = typeof body.enrichmentNote === 'string' ? body.enrichmentNote.trim() : null;
    updates.enrichment_note = trimmed || null;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Provide at least one of "status", "caption", "title", or "enrichmentNote" to update.' });
  }

  try {
    const { data, error } = await supabase
      .from('cards')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // Malformed :id (not a UUID) — Postgres' invalid-input-syntax code.
      if (error.code === '22P02') {
        return res.status(400).json({ error: 'Invalid card id.' });
      }
      // .single() errors with this code when the filter matched zero rows.
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Card not found.' });
      }
      throw error;
    }

    return res.json({ card: toResponseShape(data) });
  } catch (err) {
    console.error('PATCH /api/cards/:id error:', err.message);
    return res.status(500).json({ error: 'Something went wrong updating that card.' });
  }
});

module.exports = router;
