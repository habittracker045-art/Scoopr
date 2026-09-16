// Dedup layer that sits between the fetch pipeline (fetchAll.js — not
// touched) and storage (cardStore.js). Takes normalized items, checks
// each sourceId against the `seen_items` table, and returns only the
// ones that haven't been seen before — recording them as seen along the
// way so the next run won't re-process them.
//
// sourceId is the permanent uniqueness key here (see the note at the
// bottom of db/phase2_schema.sql) — sourceType is stored alongside it
// for filtering/debugging but isn't part of the uniqueness check, since
// every fetch module already prefixes sourceId with its source type.

const supabase = require('../config/supabaseClient'); // Phase 1's existing client (merge fix: was a duplicate lib/supabaseClient.js)

// How many sourceIds to check in a single `.in()` query. Supabase/Postgres
// can handle far more than this in practice, but batching keeps any one
// request small and avoids surprises if a pipeline run ever fetches an
// unusually large batch.
const CHECK_BATCH_SIZE = 500;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Queries `seen_items` for which of the given sourceIds already exist.
// Returns a Set of sourceIds that have been seen before.
async function getSeenSourceIds(supabase, sourceIds) {
  const seen = new Set();

  for (const batch of chunk(sourceIds, CHECK_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('seen_items')
      .select('source_id')
      .in('source_id', batch);

    if (error) {
      throw new Error(`[dedup] Failed to query seen_items: ${error.message}`);
    }

    for (const row of data || []) {
      seen.add(row.source_id);
    }
  }

  return seen;
}

// Inserts newly-seen items into `seen_items`. Uses upsert with
// ON CONFLICT DO NOTHING (via ignoreDuplicates) on the source_id unique
// index, so this is safe to call even if something slips past the
// in-memory filter above (e.g. a concurrent pipeline run).
async function recordSeen(supabase, items) {
  if (!items.length) return;

  const rows = items.map((item) => ({
    source_id: item.sourceId,
    source_type: item.sourceType,
    topic: item.topic
  }));

  const { error } = await supabase
    .from('seen_items')
    .upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true });

  if (error) {
    throw new Error(`[dedup] Failed to record seen items: ${error.message}`);
  }
}

// Takes normalized items (the same shape fetchAll.js produces), filters
// out anything already in `seen_items`, records the survivors as seen,
// and returns just the survivors — i.e. the items that are new to the
// pipeline and should go on to storage.
async function filterUnseenItems(items) {
  if (!items.length) return [];

  // (supabase client is imported directly above)

  // Guard against the same sourceId appearing twice within one batch
  // (e.g. a source module returning a duplicate) before we even hit the
  // DB, keeping the first occurrence.
  const dedupedWithinBatch = [];
  const seenInBatch = new Set();
  for (const item of items) {
    if (seenInBatch.has(item.sourceId)) continue;
    seenInBatch.add(item.sourceId);
    dedupedWithinBatch.push(item);
  }

  const sourceIds = dedupedWithinBatch.map((item) => item.sourceId);
  const alreadySeen = await getSeenSourceIds(supabase, sourceIds);

  const unseenItems = dedupedWithinBatch.filter(
    (item) => !alreadySeen.has(item.sourceId)
  );

  await recordSeen(supabase, unseenItems);

  return unseenItems;
}

module.exports = { filterUnseenItems };
