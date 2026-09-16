// Validation for the schedule settings payload accepted by PUT /api/schedule.
// Kept as a standalone helper (rather than inline in the route) so it can be
// unit tested on its own and reused if other endpoints ever need it.

const { TOPICS, resolveTopicKey } = require('../config/topics');

const VALID_FRESHNESS_WINDOWS = ['6h', '24h', '3d'];
const VALID_UPDATE_TYPES = ['news', 'events', 'both'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/; // strict 24h "HH:MM"

// Returns { valid: true, value } on success, or { valid: false, error } with
// a human-readable message on failure. Never throws — callers just check
// `.valid` and respond with 400 using `.error` if it's false.
function validateScheduleInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const { enabled, scheduledTime, topics, freshnessWindow, updateType } = body;

  // enabled — optional, defaults to false, but if present must be a boolean.
  let enabledValue = false;
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return { valid: false, error: '"enabled" must be true or false.' };
    }
    enabledValue = enabled;
  }

  // scheduledTime — required, strict "HH:MM" 24h format.
  if (typeof scheduledTime !== 'string' || !TIME_RE.test(scheduledTime.trim())) {
    return {
      valid: false,
      error: '"scheduledTime" must be a 24h "HH:MM" string, e.g. "08:00" or "23:45".'
    };
  }

  // topics — required, non-empty array, every entry must resolve to a topic
  // Phase 2 actually supports (via the same alias resolver the pipeline uses).
  if (!Array.isArray(topics) || topics.length === 0) {
    return { valid: false, error: '"topics" must be a non-empty array of topic names.' };
  }

  const resolvedTopics = [];
  const seen = new Set();
  for (const rawTopic of topics) {
    const key = resolveTopicKey(rawTopic);
    if (!key) {
      return {
        valid: false,
        error: `"${rawTopic}" is not a recognized topic. Valid topics: ${Object.keys(TOPICS).join(', ')}.`
      };
    }
    if (!seen.has(key)) {
      seen.add(key);
      resolvedTopics.push(key);
    }
  }

  // freshnessWindow — required, must be one of the pipeline's known windows.
  if (!VALID_FRESHNESS_WINDOWS.includes(freshnessWindow)) {
    return {
      valid: false,
      error: `"freshnessWindow" must be one of: ${VALID_FRESHNESS_WINDOWS.join(', ')}.`
    };
  }

  // updateType — required, must be one of the supported update types.
  if (!VALID_UPDATE_TYPES.includes(updateType)) {
    return {
      valid: false,
      error: `"updateType" must be one of: ${VALID_UPDATE_TYPES.join(', ')}.`
    };
  }

  return {
    valid: true,
    value: {
      enabled: enabledValue,
      scheduledTime: scheduledTime.trim(),
      topics: resolvedTopics,
      freshnessWindow,
      updateType
    }
  };
}

module.exports = { validateScheduleInput, VALID_FRESHNESS_WINDOWS, VALID_UPDATE_TYPES, TIME_RE };
