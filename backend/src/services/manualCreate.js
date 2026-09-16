// Manual "Create" mode — Phase 3, Prompt 2.
//
// Different starting point from the Phase 2 auto pipeline: there, an item
// comes FROM Reddit/RSS/HN and gets polished by Gemini. Here, the USER
// types the starting idea, and Gemini's job is to enrich it — add general
// context, propose a short card caption, and suggest what kind of source
// or angle could support it.
//
// Deliberately reuses Phase 2's existing services rather than
// duplicating them:
//   - services/geminiCaption.js's `callGemini()` — same Gemini client,
//     same env config (GEMINI_API_KEY / GEMINI_MODEL / GEMINI_TIMEOUT_MS),
//     just a different prompt.
//   - services/imageHandler.js's `resolveImage()` — a manual idea never
//     has a source image, so this always produces the templated
//     topic-colored fallback graphic, exactly like an image-less
//     auto-pipeline item would.
//   - services/cardStore.js's `insertDraftCards()` — same `cards` table,
//     same upsert/dedup-by-source_id behavior, same 'draft' status.
//
// Resilience contract: mirrors geminiCaption.js. If Gemini enrichment
// fails for any reason (missing key, network error, timeout, blocked
// response), this falls back to using the user's own idea text as the
// caption rather than failing the whole request — a Gemini hiccup
// shouldn't block someone from drafting a manual card.

const crypto = require('crypto');
const { resolveTopicKey, TOPICS } = require('../config/topics');
const { callGemini } = require('./geminiCaption');
const { resolveImage } = require('./imageHandler');
const { insertDraftCards } = require('./cardStore');

const MAX_IDEA_LENGTH = 2000; // sanity cap on user input sent to Gemini
const MAX_CAPTION_LENGTH = 200; // same cap geminiCaption.js applies to captions

// Thrown for bad *input* (missing/empty idea, unknown topic) as opposed to
// a runtime failure — the route can catch this specifically and respond
// 400 instead of 500, same pattern as pipeline.js's PipelineInputError.
class ManualCreateInputError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ManualCreateInputError';
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

// Builds the enrichment prompt. This is the important part for keeping
// Gemini's output honest: it's told plainly that it has no live web
// access and cannot verify anything, so its job is creative/contextual
// enrichment, not fact-checking — and it's instructed not to present
// invented specifics (numbers, dates, quotes, named studies/sources) as
// if they were verified facts.
function buildEnrichmentPrompt(ideaText, topicLabel) {
  return [
    `You help draft short "${topicLabel}" news-style cards for an app called Scoopr, starting from an idea a user typed themselves.`,
    'IMPORTANT: you do NOT have live web access and cannot verify current facts. Treat this purely as creative/contextual enrichment, not fact-checking — never state a specific statistic, date, quote, name, or figure as if it were a verified fact, since you have no way to confirm any of that. Keep everything general and contextual. If you are tempted to invent a specific number or quote, describe it in general terms instead (e.g. "recent data suggests" rather than a made-up percentage).',
    '',
    "Given the user's idea below, do three things:",
    '1. Write ONE short, punchy card caption for the idea — well under 120 characters, no hashtags, no emoji, no surrounding quotation marks.',
    '2. Write 2-3 sentences of general contextual background that could plausibly surround this idea — conceptual and general, not invented specifics.',
    '3. In one short sentence, suggest what TYPE of source or angle could support a story like this (e.g. "an official earnings report", "player/coach interviews", "a government press release") — describe the type of source, not a specific named source, statistic, or quote.',
    '',
    'Output ONLY the three lines below, in exactly this format, with no other commentary:',
    'CAPTION: <caption>',
    'CONTEXT: <contextual background>',
    'ANGLE: <suggested source/angle type>',
    '',
    `User's idea: ${ideaText}`
  ].join('\n');
}

// Parses Gemini's CAPTION/CONTEXT/ANGLE response. Deliberately tolerant —
// if a line is missing or the model adds stray formatting, this just
// leaves that field empty rather than throwing; enrichIdea() below is
// what decides on a final fallback caption.
function parseEnrichment(raw) {
  const lines = String(raw || '').split('\n');
  const result = { caption: '', context: '', angle: '' };

  for (const line of lines) {
    const captionMatch = line.match(/^\s*CAPTION:\s*(.*)$/i);
    const contextMatch = line.match(/^\s*CONTEXT:\s*(.*)$/i);
    const angleMatch = line.match(/^\s*ANGLE:\s*(.*)$/i);
    if (captionMatch) result.caption = cleanLine(captionMatch[1]);
    if (contextMatch) result.context = cleanLine(contextMatch[1]);
    if (angleMatch) result.angle = cleanLine(angleMatch[1]);
  }

  result.caption = truncate(stripWrappingQuotes(result.caption), MAX_CAPTION_LENGTH);

  return result;
}

// Sends the idea to Gemini and resolves to { caption, context, angle }.
// Never rejects — on any failure it logs a warning and falls back to the
// cleaned-up idea text as the caption, with empty context/angle, exactly
// the same resilience contract geminiCaption.js uses for the auto
// pipeline.
async function enrichIdea(ideaText, topicKey) {
  const topicLabel = (TOPICS[topicKey] && TOPICS[topicKey].label) || topicKey;
  const fallbackCaption = truncate(cleanLine(ideaText), MAX_CAPTION_LENGTH);

  try {
    const raw = await callGemini(buildEnrichmentPrompt(ideaText, topicLabel));
    const parsed = parseEnrichment(raw);
    return {
      caption: parsed.caption || fallbackCaption,
      context: parsed.context,
      angle: parsed.angle
    };
  } catch (err) {
    console.warn(`[manualCreate] Gemini enrichment failed, falling back to raw idea text: ${err.message}`);
    return { caption: fallbackCaption, context: '', angle: '' };
  }
}

// Combines context + angle into the single freeform note stored in
// cards.enrichment_note. Returns null (not '') when there's nothing to
// show, so it round-trips cleanly through Supabase/JSON.
function buildEnrichmentNote({ context, angle }) {
  const parts = [];
  if (context) parts.push(`Context: ${context}`);
  if (angle) parts.push(`Suggested angle: ${angle}`);
  return parts.length ? parts.join(' | ') : null;
}

// Entry point: turns a user-typed idea into a finished, stored card.
// Options:
//   ideaText — required. The user's raw idea text.
//   topic    — required. Resolved via config/topics.js, same as the auto
//              pipeline (aliases like "technology" -> "tech" work here too).
//
// Resolves to the inserted `cards` row (snake_case, straight from
// Supabase) — the route is responsible for shaping that into the API
// response, same as pipeline.js hands back raw rows for its callers to
// shape.
async function createManualCard({ ideaText, topic }) {
  const cleanIdea = cleanLine(ideaText);
  if (!cleanIdea) {
    throw new ManualCreateInputError('Missing or empty "ideaText".');
  }
  if (cleanIdea.length > MAX_IDEA_LENGTH) {
    throw new ManualCreateInputError(
      `"ideaText" is too long (max ${MAX_IDEA_LENGTH} characters).`,
      { maxLength: MAX_IDEA_LENGTH }
    );
  }

  const topicKey = resolveTopicKey(topic);
  if (!topicKey) {
    throw new ManualCreateInputError('Missing or unknown "topic".', {
      validTopics: Object.keys(TOPICS)
    });
  }

  // Globally unique on its own (same role as "reddit:t3_..." /
  // "hackernews:..." sourceIds from the auto pipeline) — this is what
  // cardStore.js's unique index on cards.source_id keys off of, and what
  // imageHandler.js's fallback-image filename is derived from.
  const sourceId = `manual:${crypto.randomUUID()}`;

  const { caption, context, angle } = await enrichIdea(cleanIdea, topicKey);

  const item = {
    topic: topicKey,
    title: cleanIdea,
    caption,
    sourceType: 'manual',
    sourceId,
    url: null, // no source URL for a user-typed idea — cards.source_url is nullable (Phase 3, Prompt 2 migration)
    enrichmentNote: buildEnrichmentNote({ context, angle })
  };

  // Manual ideas never have a source image, so this always renders the
  // templated fallback graphic (same code path an image-less auto-pipeline
  // item already goes through).
  item.imageUrl = await resolveImage(item, topicKey);

  const insertedCards = await insertDraftCards([item]);

  if (!insertedCards.length) {
    // sourceId is a freshly generated uuid every call, so a conflict here
    // would mean insertDraftCards itself failed silently rather than a
    // realistic duplicate — surface it as an error instead of returning
    // an empty/undefined card to the route.
    throw new Error('[manualCreate] Card insert returned no row.');
  }

  return insertedCards[0];
}

module.exports = { createManualCard, ManualCreateInputError };
