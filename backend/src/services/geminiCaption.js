// Gemini caption polishing — Phase 2, Prompt 4.
//
// Takes a raw fetched item (title + whatever source text is available) and
// asks Gemini to turn it into a short, clean, shareable caption: condensed
// if the source title is long, lightly polished if it's already short.
//
// Reuses the EXISTING GEMINI_API_KEY from backend/.env (set up in Phase 1)
// — nothing new to configure there. Two optional env vars if you want to
// override defaults:
//   GEMINI_MODEL   — defaults to 'gemini-flash-latest' (see README)
//   GEMINI_TIMEOUT_MS — defaults to 12000
//
// Resilience contract: this function NEVER throws. Any failure (missing
// key, network error, timeout, malformed response, empty output) logs a
// warning and resolves to a cleaned-up version of the original title
// instead, so a Gemini hiccup can never take down the pipeline.

// MODIFIED — Phase 3, Prompt 6 (Final Consolidation + Robustness):
// callGemini() is the ONE function every Gemini call site in the app goes
// through (this file's own polishCaption(), plus manualCreate.js's
// enrichIdea(), eventsGenerator.js's generateEventsForTopic(), and
// tipsFactsGenerator.js's generateTipsFacts() — all import callGemini
// from here rather than duplicating a fetch call). That makes it the
// single natural choke point for rate-limit awareness across all four
// Gemini-calling code paths, so utils/geminiThrottle.js's call-pacing +
// throttle-retry (adapted from reddit.js's existing backoff pattern) is
// applied HERE ONCE rather than separately in each of those four
// services. See utils/geminiThrottle.js for why this was needed as of
// Phase 3 (Phase 2 only ever had this one call site; Phase 3 added three
// more that can now fire back-to-back in a single unattended cron tick).
const { callWithGeminiThrottle } = require('../utils/geminiThrottle');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 12000;
const MAX_CAPTION_LENGTH = 200; // hard safety cap; prompt asks for ~120

function getFetch() {
  if (typeof fetch === 'function') return fetch;
  // Fallback for Node < 18 (global fetch landed in Node 18). Only required
  // if you're on an older Node — see README.
  try {
    // eslint-disable-next-line global-require
    return require('node-fetch');
  } catch (err) {
    return null;
  }
}

// Best-effort cleanup applied to BOTH the Gemini output and the fallback
// (original title), so callers always get a consistently-shaped string.
function cleanCaption(text) {
  if (!text) return '';

  let cleaned = String(text).trim();

  // Gemini sometimes wraps the answer in quotes despite instructions not to.
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith('\u201c') && cleaned.endsWith('\u201d'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Collapse newlines/extra whitespace — this is a one-line social caption.
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length > MAX_CAPTION_LENGTH) {
    cleaned = `${cleaned.slice(0, MAX_CAPTION_LENGTH - 1).trim()}\u2026`;
  }

  return cleaned;
}

function buildPrompt(item) {
  const extra = (item.text || item.summary || item.snippet || '').trim();

  return [
    'You write short, punchy captions for social-style news cards for an app called Scoopr.',
    'Given the news item below, produce exactly ONE caption for the card.',
    '',
    'Rules:',
    '- Aim for well under 120 characters — this is a social card, not an article summary.',
    '- If the source title is long or wordy, condense it down to the core news.',
    '- If the source title is already short and clean, lightly polish grammar/tone but keep it punchy — do not pad it out.',
    '- No hashtags, no emoji, no surrounding quotation marks.',
    '- Output ONLY the caption text. No preamble, no labels, no explanation.',
    '',
    `Title: ${item.title}`,
    extra ? `Additional context: ${extra.slice(0, 500)}` : null
  ]
    .filter(Boolean)
    .join('\n');
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set (expected in backend/.env from Phase 1).');
  }

  const fetchFn = getFetch();
  if (!fetchFn) {
    throw new Error('No fetch implementation available (Node < 18 and node-fetch not installed).');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`;

  // Call pacing + throttle-retry (see the require() above) wraps the
  // actual request. `makeRequest` is handed to callWithGeminiThrottle()
  // so it can be re-invoked on a retry, each attempt getting its own
  // timeout/AbortController rather than reusing one across retries.
  const response = await callWithGeminiThrottle(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 400,
            thinkingConfig: { thinkingBudget: 0 }
          }
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Gemini API returned ${response.status} ${response.statusText}: ${bodyText.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text || !text.trim()) {
    throw new Error('Gemini API response had no usable text (possibly blocked by safety filters).');
  }

  return text;
}

// Takes a normalized item ({ title, text?/summary?/snippet?, ... }) and
// resolves to a short caption string. Never rejects.
async function polishCaption(item) {
  const fallback = cleanCaption(item.title);

  try {
    const raw = await callGemini(buildPrompt(item));
    const polished = cleanCaption(raw);
    return polished || fallback;
  } catch (err) {
    console.warn(`[geminiCaption] Falling back to original title for "${item.sourceId}": ${err.message}`);
    return fallback;
  }
}

// Exported alongside polishCaption (Phase 3, Prompt 2) so other services —
// e.g. services/manualCreate.js — can send their own prompts through the
// same Gemini client/config/error-handling instead of duplicating it.
// Callers are responsible for their own fallback behavior; this function
// itself still throws on failure exactly as it did when it was private.
module.exports = { polishCaption, callGemini };
