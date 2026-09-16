// Events generation — Phase 3, Prompt 3 (Real Tech Events Logic).
//
// This is the 'events' half of the News/Events/Both toggle actually doing
// something. Up to this prompt, `updateType: 'events'` was accepted by
// the pipeline but silently ran the exact same Reddit/RSS/HN fetch as
// 'news' (see the old stub note this file's comment block replaces in
// pipeline.js).
//
// --- What counts as an "event" here -----------------------------------
//
// A "tech event" (or more generally, a topic event — see below) is
// something with a specific date/time or a clearly bounded timeframe
// attached — a product launch, a conference, an earnings call, a
// scheduled announcement. That's the thing that makes it distinct from
// an ordinary news article: a news article reports on something that
// happened; an event is a dated/datable happening you could put on a
// calendar, whether it's upcoming or just occurred.
//
// There's no free dedicated "tech events API" (a ticketing/listings feed,
// a company-announcements calendar, etc.) to pull this from — same
// zero-ongoing-cost constraint as the rest of Scoopr. So this asks Gemini
// itself, using what it already knows, instead of fetching from a new
// external source. That has one real limitation worth being upfront
// about: Gemini's knowledge has a cutoff, so very recent or genuinely
// future announcements it hasn't "heard of" yet won't show up here. The
// prompt below is written to make Gemini honest about that gap (say
// "unconfirmed" or return fewer/zero events) rather than invent a
// plausible-sounding date to fill space — see buildEventsPrompt().
//
// --- Why Gemini here and not a search/fetch --------------------------
//
// The existing sources (reddit.js, rss.js, hackernews.js) all fetch real,
// currently-live content over HTTP. eventsGenerator.js is different on
// purpose: it's a single Gemini completion call, prompted to recall
// events it's reasonably confident about, not fetch anything live. That
// tradeoff (knowledge-cutoff gaps vs. zero new API/cost) is the same one
// Scoopr already made for manualCreate.js's enrichment step — this reuses
// the exact same Gemini client (geminiCaption.js's `callGemini`) for
// consistency.
//
// --- Output shape --------------------------------------------------
//
// generateEventsForTopic() resolves to a list of items in the SAME
// normalized shape fetchAll.js's sources produce (see utils/normalize.js)
// — sourceType/sourceId/title/url/imageUrl/topic/publishedAt/raw — plus
// one extra field this module adds, `summary` (short generated-event
// details, fed into geminiCaption.js's caption prompt as "additional
// context") and `enrichmentNote` (same field manualCreate.js already
// populates on cards.enrichment_note, reused here to carry the
// company/timeframe detail through to the finished card without a schema
// change). That means these items can flow through the EXACT SAME
// pipeline.js steps that news items do afterward (freshness / dedup /
// caption polish / image resolution / storage) with no special-casing
// needed downstream — see pipeline.js's `runEventsBranch()`.
//
// One deliberate deviation: `publishedAt` is stamped as "now" (the
// generation time), not the event's own date. The freshness window here
// is about how recently Scoopr generated/surfaced this update, not the
// event's calendar date — an event 6 weeks out is still a *fresh update*
// if it was just generated in this run, and filtering it out by its own
// future date would defeat the point of surfacing upcoming events at
// all. Gemini is still asked to bias its picks toward what's relevant to
// the requested window (see buildEventsPrompt()) — publishedAt=now just
// keeps that a prompt-level judgment call instead of a hard filter that
// would incorrectly discard "happening in 3 weeks" events.
//
// Resilience contract: DELIBERATELY DIFFERENT from geminiCaption.js /
// imageHandler.js. Those never throw, because a caption/image is a
// nice-to-have with an obvious fallback (the original title / no image).
// There is no equivalent fallback for "the entire list of events" — a
// fabricated placeholder event would violate the whole point of this
// prompt (never invent specifics). So a genuine failure (missing API
// key, network error, unusable response) DOES throw here, exactly like
// reddit.js/rss.js/hackernews.js throw on a total source failure — the
// caller (pipeline.js) catches it and reports it via `sourceErrors`,
// same pattern fetchAll.js already uses for those three sources. Gemini
// legitimately having nothing to report (see NONE below) is NOT a
// failure and resolves to an empty array instead.

const { TOPICS } = require('../config/topics');
const { callGemini } = require('./geminiCaption');
const { buildNormalizedItem } = require('../utils/normalize');
const { hashDedupKey } = require('../utils/hashDedupKey');

// How many events to ask Gemini for per call. Kept small and deliberately
// modest — this is "a short list of notable events" per the spec, not an
// exhaustive calendar, and a shorter ask also means less room for Gemini
// to reach for a low-confidence pick just to fill the count.
const EVENTS_REQUESTED = Number(process.env.EVENTS_PER_TOPIC) || 5;

// What "an event" means for each topic, folded into the prompt so Gemini
// picks the right KIND of dated thing per topic instead of only ever
// reaching for tech examples. Tech is the spec's primary example (product
// launches, conference dates, major company announcements); the others
// extend the same "has a specific date/timeframe, distinct from a plain
// news article" idea to whichever topic the pipeline is running for, so
// updateType: 'events' behaves sensibly no matter which of config/topics.js's
// topics a user has scheduled it against.
const TOPIC_EVENT_GUIDANCE = {
  tech: 'product launches, hardware/software releases, developer conferences and keynotes, and major announcements from tech companies (e.g. Apple, Google, Microsoft, OpenAI, Nvidia, Samsung, Amazon)',
  sports: 'major matches, tournaments, championship fixtures, transfer-window deadlines, and season-opener/finals dates for well-known leagues and competitions',
  finance: 'earnings calls, central bank meetings (e.g. the Federal Reserve), IPOs, and major scheduled economic data releases',
  entertainment: 'movie/album/show release dates, award ceremonies, and major premieres or tour announcements',
  general: 'elections, international summits, and other broadly notable happenings with an official scheduled date'
};
const DEFAULT_GUIDANCE = 'announcements or happenings with a specific date or clearly bounded timeframe attached';

// How to describe the freshness window to Gemini in plain language. This
// is deliberately non-binding phrasing ("roughly", "or so") since Gemini
// has no live clock beyond what's in the prompt and no way to verify
// exact recency — it's steering, not a hard filter (the hard filter is
// dedup + the caller's own freshness pass over publishedAt afterward).
const WINDOW_PHRASES = {
  '6h': 'happening within about the next 6 hours, or that occurred in roughly the last 6 hours',
  '24h': 'happening today or in about the next day, or that occurred very recently (roughly the last day)',
  '3d': 'happening within about the next few days, or that occurred very recently (roughly the last few days)',
  '3days': 'happening within about the next few days, or that occurred very recently (roughly the last few days)'
};
const DEFAULT_WINDOW_PHRASE = WINDOW_PHRASES['24h'];

function windowPhrase(window) {
  return WINDOW_PHRASES[String(window || '').trim().toLowerCase()] || DEFAULT_WINDOW_PHRASE;
}

function topicLabel(topicKey) {
  return (TOPICS[topicKey] && TOPICS[topicKey].label) || topicKey;
}

// Builds the Gemini prompt. The "do not fabricate" block is the important
// part — Gemini has no live web access here (same caveat manualCreate.js
// already gives it for enrichment), so this explicitly gives it outs:
// return fewer events, hedge with a rough timeframe, or return NONE
// outright, all of which are treated as valid, non-error results by
// parseEventsResponse() below.
function buildEventsPrompt(topicKey, window) {
  const label = topicLabel(topicKey);
  const guidance = TOPIC_EVENT_GUIDANCE[topicKey] || DEFAULT_GUIDANCE;
  const phrase = windowPhrase(window);

  return [
    `You are identifying notable "${label}" EVENTS for a news app called Scoopr — distinct from ordinary news articles.`,
    '',
    `An "event" here means something with a specific date/time or a clearly bounded timeframe attached — for example: ${guidance}. It is NOT a general news article, opinion piece, or ongoing story with no specific date.`,
    '',
    `Based on your own knowledge, list up to ${EVENTS_REQUESTED} notable "${label}" events that are ${phrase}.`,
    '',
    'IMPORTANT — you do not have live web access and your knowledge has a cutoff date, so you may simply not be aware of things scheduled or announced very recently. That is expected. Do NOT compensate by guessing:',
    '- Only include events you are reasonably confident are/were real, based on what you actually know.',
    '- If you are not confident about an exact date, give a rough timeframe instead (e.g. "expected Q1 2026", "date unconfirmed") rather than inventing a specific one.',
    `- If you cannot think of ${EVENTS_REQUESTED} events you are reasonably confident about, list fewer — never pad the list with a guess.`,
    '- If you have no events at all that you are reasonably confident about, respond with exactly the single word: NONE',
    '',
    'Output format — for each event, output exactly these four lines, and separate events with a line containing only three dashes (---):',
    'TITLE: <short event title>',
    'DESCRIPTION: <1-2 sentence description>',
    'COMPANY: <associated company or product, or N/A if not applicable>',
    'TIMEFRAME: <a specific date if you are confident, otherwise a rough timeframe, or "unconfirmed" if you genuinely do not know>',
    '',
    'No other commentary, no preamble, no numbering, no markdown formatting.'
  ].join('\n');
}

function cleanLine(text) {
  if (!text) return '';
  return String(text).replace(/\s+/g, ' ').trim();
}

// Parses one TITLE:/DESCRIPTION:/COMPANY:/TIMEFRAME: block. Tolerant like
// manualCreate.js's parseEnrichment() — a missing line just leaves that
// field empty rather than throwing; only a missing TITLE disqualifies the
// whole block (see parseEventsResponse below).
function parseEventBlock(block) {
  const lines = String(block || '').split('\n');
  const event = { title: '', description: '', company: '', timeframe: '' };

  for (const line of lines) {
    const titleMatch = line.match(/^\s*TITLE:\s*(.*)$/i);
    const descMatch = line.match(/^\s*DESCRIPTION:\s*(.*)$/i);
    const companyMatch = line.match(/^\s*COMPANY:\s*(.*)$/i);
    const timeframeMatch = line.match(/^\s*TIMEFRAME:\s*(.*)$/i);

    if (titleMatch) event.title = cleanLine(titleMatch[1]);
    if (descMatch) event.description = cleanLine(descMatch[1]);
    if (companyMatch) event.company = cleanLine(companyMatch[1]);
    if (timeframeMatch) event.timeframe = cleanLine(timeframeMatch[1]);
  }

  return event;
}

// Splits Gemini's raw response into events. Returns `[]` (a legitimate,
// non-error result) if the model responded with NONE or nothing usable at
// all — see the resilience-contract note at the top of this file for why
// that's different from throwing.
function parseEventsResponse(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /^NONE$/i.test(trimmed)) return [];

  const blocks = trimmed.split(/\n\s*-{3,}\s*\n/);

  return blocks
    .map(parseEventBlock)
    .filter((event) => event.title); // a block with no title isn't usable
}

// Normalizes a parsed { title, description, company, timeframe } event
// into the same shape fetchAll.js's sources produce, plus the two extra
// fields noted at the top of this file (summary / enrichmentNote).
function toNormalizedEventItem(event, topicKey) {
  const timeframe = event.timeframe || 'unconfirmed';
  const dedupKey = hashDedupKey([event.title, timeframe]);

  const item = buildNormalizedItem({
    sourceType: 'generated-event',
    sourceId: `generated-event:${dedupKey}`,
    title: event.title,
    url: null, // no source URL — this is Gemini-recalled, not fetched from a link
    imageUrl: null, // never has a source image; imageHandler.js renders the fallback graphic
    topic: topicKey,
    // Generation time, not the event's own date — see the file-level
    // comment above ("Why publishedAt is 'now'") for the reasoning.
    publishedAt: new Date().toISOString(),
    raw: event
  });

  // Fed into geminiCaption.js's prompt as "Additional context" (it reads
  // item.text / item.summary / item.snippet) so caption polishing has
  // more than just the bare title to work with.
  const contextParts = [event.description];
  if (event.company && !/^n\/a$/i.test(event.company)) contextParts.push(`Company/product: ${event.company}`);
  contextParts.push(`Timeframe: ${timeframe}`);
  item.summary = contextParts.filter(Boolean).join(' | ');

  // Reuses cards.enrichment_note (added in Phase 3, Prompt 2 for
  // manualCreate.js) instead of a new column — same "freeform extra
  // detail Gemini produced" role, just for a generated event instead of
  // a manual idea.
  const notableParts = [];
  if (event.description) notableParts.push(`Context: ${event.description}`);
  if (event.company && !/^n\/a$/i.test(event.company)) notableParts.push(`Company/product: ${event.company}`);
  notableParts.push(`Timeframe: ${timeframe}`);
  item.enrichmentNote = notableParts.join(' | ');

  return item;
}

// Entry point. Resolves to a list of normalized event items for the given
// topic (may be empty — see parseEventsResponse). THROWS on a genuine
// failure (missing API key, network error, unusable response) — see the
// resilience-contract note at the top of this file; pipeline.js is
// responsible for catching that and reporting it via `sourceErrors`,
// exactly like fetchAll.js already does for Reddit/RSS/HN.
async function generateEventsForTopic(topicKey, window) {
  const raw = await callGemini(buildEventsPrompt(topicKey, window));
  const events = parseEventsResponse(raw);
  return events.map((event) => toNormalizedEventItem(event, topicKey));
}

module.exports = { generateEventsForTopic };
