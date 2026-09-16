// Inserts items into `cards`. As of Phase 2 Prompt 4, items arriving here
// have already been through Gemini caption polishing and image resolution
// (see pipeline.js) — caption/image_url are filled in, not null. Rows are
// still inserted with status 'draft'; that's a review-queue state, not an
// indicator of whether the fields are populated.

const supabase = require('../config/supabaseClient'); // Phase 1's existing client (merge fix: was a duplicate lib/supabaseClient.js)

function toCardRow(item) {
  return {
    topic: item.topic,
    title: item.title,
    caption: item.caption || null,
    image_url: item.imageUrl || null,
    // Auto-pipeline items always have a url. Manual "Create" mode items
    // (Phase 3, Prompt 2) explicitly pass url: null — there's no
    // Reddit/RSS/HN link for a user-typed idea. `item.url ?? null` keeps
    // that null explicit instead of Supabase silently dropping an
    // `undefined` field.
    source_url: item.url ?? null,
    source_type: item.sourceType,
    source_id: item.sourceId,
    // Phase 3, Prompt 2: optional freeform note holding the Gemini
    // contextual-background + suggested-angle enrichment for manual
    // cards. Always null/undefined for auto-pipeline items, which don't
    // set this field — no behavior change for the existing pipeline.
    enrichment_note: item.enrichmentNote || null,
    status: 'draft'
  };
}

// Inserts finished cards for the given items and returns the rows that
// were actually inserted. Uses upsert + ON CONFLICT DO NOTHING against the
// unique index on cards.source_id, so if an item somehow reaches this
// function twice (it shouldn't, since dedup.js already filtered against
// seen_items), it's silently skipped here rather than creating a
// duplicate card.
async function insertDraftCards(items) {
  if (!items.length) return [];

  // (supabase client is imported directly above)
  const rows = items.map(toCardRow);

  const { data, error } = await supabase
    .from('cards')
    .upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true })
    .select();

  if (error) {
    throw new Error(`[cardStore] Failed to insert cards: ${error.message}`);
  }

  return data || [];
}

module.exports = { insertDraftCards };
