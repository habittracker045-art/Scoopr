// Phase 4, Prompt 5: API layer for the Settings tab.
//
// Three calls against existing Phase 3 backend routes — nothing new
// server-side (see routes/schedule.js and routes/pipelineGenerateNow.js):
//   getSchedule()    -> GET  /api/schedule                (load current settings)
//   updateSchedule() -> PUT  /api/schedule                (save settings)
//   generateNow()    -> POST /api/pipeline/generate-now   ("Generate Now" button)
//
// Own file rather than folded into cardsApi.js/tipsFactsApi.js, matching
// how each tab's backend surface gets its own thin wrapper in this
// codebase (see createApi.js's comment on the same convention).

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

async function request(path, token, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

/**
 * GET /api/schedule — the current user's auto-generate schedule.
 * Resolves to `{ schedule, hasSchedule }`, where `schedule` is shaped
 * `{ enabled, scheduledTime, topics, freshnessWindow, updateType,
 * timezone, createdAt, updatedAt }`. `hasSchedule: false` just means the
 * user has never saved one yet — `schedule` is still populated with
 * sensible defaults in that case (see routes/schedule.js's
 * DEFAULT_SCHEDULE), so the Settings form always has something to render.
 */
export function getSchedule({ token }) {
  return request('/schedule', token);
}

/**
 * PUT /api/schedule — creates or updates (upsert) the user's schedule.
 * All five fields are required by the backend's validator
 * (validateScheduleInput) regardless of `enabled` — there's no partial
 * update here, so callers should send the full current form state, not
 * just the field that changed. Resolves to `{ schedule }` (same shape as
 * getSchedule(), which Settings.jsx uses to resync its form after a save).
 */
export function updateSchedule({ token, enabled, scheduledTime, topics, freshnessWindow, updateType }) {
  return request('/schedule', token, {
    method: 'PUT',
    body: JSON.stringify({ enabled, scheduledTime, topics, freshnessWindow, updateType })
  });
}

/**
 * POST /api/pipeline/generate-now — runs the pipeline immediately using
 * whatever is currently *saved* in the user's schedule_settings row
 * (topics/freshnessWindow/updateType) — it deliberately ignores
 * `enabled`/`scheduledTime` and, importantly, ignores any unsaved edits
 * still sitting in the Settings form. Save first if the user just
 * changed topics and wants Generate Now to use them.
 *
 * Resolves to `{ results }`, one entry per topic in the saved schedule.
 * Settings.jsx only needs to know whether the whole run succeeded, not
 * the per-topic card payloads (those show up in the Feed tab).
 */
export function generateNow({ token }) {
  return request('/pipeline/generate-now', token, { method: 'POST' });
}
