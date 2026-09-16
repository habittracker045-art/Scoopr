// Tips & Facts generator — Phase 3, Prompt 4.
//
// Per the original spec: "Dedicated 'Tips & Facts' tab — evergreen tech
// tips and trivia." This is a SEPARATE content type from news/events —
// short, timeless, bite-sized tech tips or fun facts, deliberately NOT
// run through pipeline.js's freshness window the way news/events are
// (there's no "published at" for a tip like "keyboard shortcuts save
// time" — it's evergreen by definition).
//
// Mirrors the shape of services/manualCreate.js and
// services/eventsGenerator.js rather than duplicating their machinery:
//   - services/geminiCaption.js's `callGemini()` — same Gemini client,
//     same env config (GEMINI_API_KEY / GEMINI_MODEL / GEMINI_TIMEOUT_MS).
//   - services/imageHandler.js's `resolveImage()` — tips/facts never
//     have a source image, so this always produces the templated
//     topic-colored fallback graphic.
//   - utils/hashDedupKey.js's `hashDedupKey()` — same normalize-then-sha1
//     approach eventsGenerator.js uses for content with no natural URL
//     to dedup on, applied here to the tip/fact text itself.
//
// New here (not reused from elsewhere): dedup is checked directly
// against the `tips_facts` table's `content_hash` column, rather than
// against `seen_items` — tips/facts are a wholly separate content type
// from cards/news, so there's no reason to share that ledger. See
// db/phase3_prompt4_schema.sql.
//
// Resilience contract: DIFFERENT from geminiCaption.js/imageHandler.js,
// SAME as eventsGenerator.js — a Gemini call failure (missing key,
// network error, unusable response) THROWS. There's no sensible fallback
// for "the entire generated batch of tips/facts" the way there is for a
// single caption (fall back to the title) or a single image (fall back
// to the templated graphic, which still happens here). The route is
// responsible for catching that and responding accordingly.

const { callGemini } = require('./geminiCaption');
const { resolveImage } = require('./imageHandler');
const { hashDedupKey } = require('../utils/hashDedupKey');
const supabase = require('../config/supabaseClient');

// How many tips/facts to ask Gemini for per batch. Kept small and
// deliberately modest, same reasoning as EVENTS_REQUESTED in
// eventsGenerator.js — "a short batch," not an exhaustive dump, which
// also means less room for Gemini to reach for a shaky, low-confidence
// claim just to fill the count.
const DEFAULT_BATCH_SIZE = Number(process.env.TIPS_FACTS_PER_BATCH) || 5;
const MAX_BATCH_SIZE = 15; // sanity cap regardless of what the caller requests
const MAX_CONTENT_LENGTH = 300; // a tip/fact is a short card, not a paragraph

const VALID_CATEGORIES = ['tip', 'fact', 'mixed'];
const DEFAULT_TOPIC = 'tech';

// Thrown for bad *input* (bad category/count) as opposed to a runtime
// failure — the route can catch this specifically and respond 400
// instead of 500, same pattern as ManualCreateInputError in
// manualCreate.js.
class TipsFactsInputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'TipsFactsInputError';
    this.details = details;
  }
}

function cleanLine(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max - 1).trim()}\u2026` : text;
}

function stripWrappingQuotes(text) {
  if (!text) return text;
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('\u201c') && text.endsWith('\u201d'))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

// How to describe what's wanted to Gemini in plain language, based on
// the requested category. 'mixed' explicitly asks for a mix of both in
// the same batch rather than leaving it to chance.
function categoryGuidance(category) {
  if (category === 'tip') return 'Every item MUST be a TIP (a practical piece of advice), not a fact.';
  if (category === 'fact') return 'Every item MUST be a FACT (an interesting/fun piece of trivia), not a tip.';
  return 'Produce a MIX of both TIPS and FACTS across the batch (roughly half and half, order doesn\u2019t matter).';
}

// Builds the Gemini prompt. The "factually careful" block is the
// important part — same honesty framing as eventsGenerator.js's
// buildEventsPrompt() and manualCreate.js's buildEnrichmentPrompt(), just
// aimed at "don't state shaky trivia as confirmed fact" instead of "don't
// invent a date."
function buildPrompt({ topicLabel, category, count }) {
  return [
    `You write short, evergreen "${topicLabel}" tips and fun facts for a dedicated "Tips & Facts" tab in a news app called Scoopr.`,
    '',
    `Generate exactly ${count} short items. ${categoryGuidance(category)}`,
    '',
    'What "evergreen" means here — this is the most important constraint:',
    '- Do NOT tie any item to current events, recent news, a specific date, a specific software/hardware version number, or anything with a limited shelf life. It should read the same whether someone sees it today or in five years.',
    '- A TIP is a practical, generally-applicable piece of advice (e.g. a keyboard shortcut, a habit, a way to do something better/safer/faster).',
    '- A FACT is an interesting, well-established piece of trivia (e.g. the origin of a term, how something works, a notable historical detail).',
    '',
    'Be factually careful — this matters more than being interesting:',
    '- Only include a fact if you are genuinely confident it is well-established and correct. Prefer a well-known, easily-verified fact over an obscure or "cool-sounding" one you are not fully sure about.',
    '- Never state something uncertain, disputed, or that you are not confident about as if it were confirmed fact. If in doubt, leave it out and produce fewer than the requested count instead.',
    '- Do not include specific statistics, dates, or figures unless you are confident they are accurate and stable (i.e. not something that changes over time, like a company\u2019s current market cap or user count).',
    '',
    'Output format — for each item, output exactly these two lines, and separate items with a line containing only three dashes (---):',
    'TYPE: <tip or fact>',
    'CONTENT: <the tip or fact text, one to two sentences, well under 200 characters>',
    '',
    'No other commentary, no preamble, no numbering, no markdown formatting, no surrounding quotation marks.'
  ].join('\n');
}

// Parses one TYPE:/CONTENT: block. Tolerant like manualCreate.js's
// parseEnrichment() — a block with no usable CONTENT is simply dropped
// rather than throwing (see parseBatchResponse below).
function parseBlock(block) {
  const lines = String(block || '').split('\n');
  const result = { type: '', content: '' };

  for (const line of lines) {
    const typeMatch = line.match(/^\s*TYPE:\s*(.*)$/i);
    const contentMatch = line.match(/^\s*CONTENT:\s*(.*)$/i);
    if (typeMatch) result.type = cleanLine(typeMatch[1]).toLowerCase();
    if (contentMatch) result.content = cleanLine(contentMatch[1]);
  }

  result.content = truncate(stripWrappingQuotes(result.content), MAX_CONTENT_LENGTH);

  return result;
}

// Splits Gemini's raw response into { type, content } items, dropping
// anything unusable (no content, or a type that isn't tip/fact — e.g. if
// Gemini ever produces a stray line). Legitimately returning fewer than
// requested (including zero) is expected behavior, not an error — same
// as eventsGenerator.js's parseEventsResponse().
function parseBatchResponse(raw, category) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];

  const blocks = trimmed.split(/\n\s*-{3,}\s*\n/);

  return blocks
    .map(parseBlock)
    .filter((item) => item.content && (item.type === 'tip' || item.type === 'fact'))
    .filter((item) => category === 'mixed' || item.type === category);
}

// Queries `tips_facts` for which of the given content hashes already
// exist. Returns a Set of hashes that have been seen before — mirrors
// dedup.js's getSeenSourceIds(), just against tips_facts.content_hash
// instead of seen_items.source_id.
async function getExistingHashes(hashes) {
  if (!hashes.length) return new Set();

  const { data, error } = await supabase
    .from('tips_facts')
    .select('content_hash')
    .in('content_hash', hashes);

  if (error) {
    throw new Error(`[tipsFactsGenerator] Failed to query tips_facts for dedup: ${error.message}`);
  }

  return new Set((data || []).map((row) => row.content_hash));
}

// Takes raw { type, content } items, computes each one's dedup hash, and
// filters out anything already stored in tips_facts (as well as
// duplicates within the same batch, in case Gemini repeats itself).
async function filterUnseenItems(items) {
  const withHashes = items.map((item) => ({
    ...item,
    contentHash: hashDedupKey([item.content])
  }));

  const dedupedWithinBatch = [];
  const seenInBatch = new Set();
  for (const item of withHashes) {
    if (seenInBatch.has(item.contentHash)) continue;
    seenInBatch.add(item.contentHash);
    dedupedWithinBatch.push(item);
  }

  const alreadyStored = await getExistingHashes(dedupedWithinBatch.map((item) => item.contentHash));

  return dedupedWithinBatch.filter((item) => !alreadyStored.has(item.contentHash));
}

// Resolves the fallback graphic for a tip/fact. Tips/facts never have a
// source image (there's no upstream article/post to pull one from), so
// this always renders imageHandler.js's templated topic-colored graphic —
// same code path an image-less auto-pipeline item or a manual-create card
// already goes through. `sourceId` here is only used by imageHandler.js
// to derive a stable cache filename; it's not stored anywhere.
async function resolveTipImage(item, topicKey) {
  const pseudoItem = {
    sourceId: `tip-fact:${item.contentHash}`,
    title: item.content,
    imageUrl: null
  };
  return resolveImage(pseudoItem, topicKey);
}

function toRow({ content, type, contentHash, imageUrl, topicKey }) {
  return {
    content,
    category: type,
    topic: topicKey,
    image_url: imageUrl || null,
    content_hash: contentHash,
    status: 'draft'
  };
}

// Inserts finished tips/facts and returns the rows actually inserted.
// Uses upsert + ON CONFLICT DO NOTHING against the unique index on
// tips_facts.content_hash, same belt-and-suspenders pattern
// cardStore.js's insertDraftCards() uses — if a hash somehow reaches here
// twice (a race with a concurrent generate call, say), it's silently
// skipped rather than creating a duplicate row.
async function insertTipsFacts(rows) {
  if (!rows.length) return [];

  const { data, error } = await supabase
    .from('tips_facts')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select();

  if (error) {
    throw new Error(`[tipsFactsGenerator] Failed to insert tips_facts: ${error.message}`);
  }

  return data || [];
}

function validateOptions({ topic, category, count }) {
  const topicKey = topic ? String(topic).trim().toLowerCase() : DEFAULT_TOPIC;
  if (!topicKey) {
    throw new TipsFactsInputError('Missing "topic".');
  }

  const normalizedCategory = category ? String(category).trim().toLowerCase() : 'mixed';
  if (!VALID_CATEGORIES.includes(normalizedCategory)) {
    throw new TipsFactsInputError('Invalid "category" — must be "tip", "fact", or "mixed".', {
      validCategories: VALID_CATEGORIES
    });
  }

  let requestedCount = count === undefined || count === null ? DEFAULT_BATCH_SIZE : Number(count);
  if (!Number.isFinite(requestedCount) || requestedCount <= 0) {
    throw new TipsFactsInputError('Invalid "count" — must be a positive number.');
  }
  requestedCount = Math.min(Math.floor(requestedCount), MAX_BATCH_SIZE);

  return { topicKey, category: normalizedCategory, count: requestedCount };
}

// Entry point: generates a new batch of tips/facts, dedups them against
// what's already stored, resolves fallback images, saves them, and
// resolves to the list of inserted rows (may be empty — Gemini having
// nothing new/confident to add, or everything it produced being a
// duplicate, are both legitimate non-error outcomes, same philosophy as
// eventsGenerator.js).
//
// Options:
//   topic    — optional, defaults to 'tech'. Deliberately NOT restricted
//              to config/topics.js's keys — tips/facts are a separate
//              content type from the news topic list (per the spec:
//              "topic (likely mostly 'tech' but keep it flexible)").
//   category — optional, 'tip' | 'fact' | 'mixed' (default 'mixed').
//   count    — optional, how many to request from Gemini this call
//              (default TIPS_FACTS_PER_BATCH env var or 5, capped at 15).
//
// THROWS on a genuine Gemini/DB failure — see the resilience-contract
// note at the top of this file. The route is responsible for catching
// that.
async function generateTipsFacts(options = {}) {
  const { topicKey, category, count } = validateOptions(options);
  const topicLabel = topicKey.charAt(0).toUpperCase() + topicKey.slice(1);

  const raw = await callGemini(buildPrompt({ topicLabel, category, count }));
  const parsed = parseBatchResponse(raw, category);

  const unseen = await filterUnseenItems(parsed);
  if (!unseen.length) return [];

  const rows = [];
  for (const item of unseen) {
    // Sequential rather than Promise.all — sharp (imageHandler.js's PNG
    // renderer) does synchronous CPU work per call; running these one at
    // a time avoids piling up 5-15 concurrent renders for what is, at
    // most, a once-in-a-while batch generation call.
    // eslint-disable-next-line no-await-in-loop
    const imageUrl = await resolveTipImage(item, topicKey);
    rows.push(toRow({ content: item.content, type: item.type, contentHash: item.contentHash, imageUrl, topicKey }));
  }

  return insertTipsFacts(rows);
}

module.exports = { generateTipsFacts, TipsFactsInputError };
