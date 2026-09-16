// Hash-based dedup key helper — Phase 3, Prompt 3 (Real Tech Events Logic).
//
// Every existing fetch source (Reddit/RSS/HN) has a natural, stable
// `sourceId` to dedup on — a permalink, a GUID, a numeric HN id (see the
// note at the bottom of db/phase2_schema.sql). Generated tech events have
// no such thing: there's no URL, no upstream id, nothing Gemini returns
// that's guaranteed stable across calls except the text itself.
//
// This gives eventsGenerator.js a stable substitute: hash a small set of
// "identity" fields (title + rough date/timeframe) into a fixed-length
// hex string, normalizing first so trivial formatting differences
// ("Q1 2026" vs "q1  2026") still collapse to the same key. That hash
// becomes the `sourceId` an event item is stored/deduped under, going
// through the exact same `seen_items` / `cards.source_id` machinery
// (dedup.js, cardStore.js) as every other source — no changes needed
// there.
//
// This is a best-effort, not a cryptographic, use of hashing: two
// genuinely different events that happen to normalize to an identical
// title+timeframe pair would collide and get treated as "the same"
// (extremely unlikely, and arguably the right call anyway — if Gemini
// regenerates what reads as the same event with the same timeframe on a
// later run, treating it as a duplicate rather than posting it twice is
// the desired behavior).

const crypto = require('crypto');

// Lowercases, collapses whitespace, and strips a small set of punctuation
// that doesn't change identity ("iPhone 17 Launch" vs "iPhone 17 Launch."),
// so near-identical phrasings from separate Gemini calls still hash the
// same way.
function normalizePart(part) {
  return String(part || '')
    .trim()
    .toLowerCase()
    .replace(/[.,!?"'`]/g, '')
    .replace(/\s+/g, ' ');
}

// Hashes an ordered list of string parts into a stable hex digest. Order
// matters (this is NOT a set) — callers should always pass parts in the
// same order for the same kind of key (e.g. always [title, timeframe]).
function hashDedupKey(parts) {
  const normalized = (Array.isArray(parts) ? parts : [parts])
    .map(normalizePart)
    .join('|');

  return crypto.createHash('sha1').update(normalized).digest('hex');
}

module.exports = { hashDedupKey };
