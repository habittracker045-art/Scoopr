// Scoopr — Phase 3, Cron Engine
//
// Reads `schedule_settings` (Phase 3, Prompt 1's table — untouched by this
// file) and, once a minute, triggers services/scheduleRunner.js for every
// enabled user whose scheduled_time matches "now" in THEIR timezone.
//
// See PHASE3_CRON_ENGINE_README.md for the full design writeup (why one
// polling job instead of one node-cron job per user, why in-memory overlap
// protection is fine here, Render free-tier caveats, etc). Short version:
//
//   - ONE node-cron job, ticking every minute, does a single
//     `SELECT * FROM schedule_settings WHERE enabled = true` and checks
//     each row against the clock, instead of scheduling N separate cron
//     jobs (one per user) that would each need to be re-created/destroyed
//     any time a user changes their schedule via PUT /api/schedule. A
//     single poller with no per-user cron state to keep in sync is far
//     simpler to reason about for an app this size, at the cost of at
//     most ~60 seconds of scheduling slop — fine for a "your feed is
//     ready" personal aggregator, not fine for something billing by the
//     minute.

const cron = require('node-cron');
const supabase = require('../config/supabaseClient');
const { runForUser, RunInProgressError } = require('./scheduleRunner');

// How often the poller ticks. Every minute is the finest granularity
// scheduled_time supports anyway (it's stored as "HH:MM", no seconds), so
// there's no accuracy benefit to ticking faster — just more log noise and
// more Supabase reads.
const CRON_EXPRESSION = '* * * * *';

// Guards against firing the same user's schedule twice for the same
// minute. Keyed by `${userId}:${YYYY-MM-DD in user's tz}:${HH:MM}`, so it
// naturally resets itself as soon as the clock moves to the next minute —
// nothing to clean up or expire manually. This exists as a second,
// independent safety net on top of the isUserRunning() check in
// scheduleRunner.js: that one stops actual overlapping pipeline *work*,
// this one stops us from even attempting a second trigger call in the
// (very unlikely, but possible if a tick runs long) case where two ticks
// land within the same wall-clock minute.
const firedThisMinute = new Set();

// Formats "now" as { date: 'YYYY-MM-DD', time: 'HH:MM' } in the given IANA
// timezone, using the built-in Intl API — no moment-timezone/luxon
// dependency needed just to answer "what time is it for this user right
// now", which keeps this a zero-new-cost, zero-extra-package addition
// beyond node-cron itself.
function nowInTimezone(timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = {};
  for (const part of formatter.formatToParts(new Date())) {
    parts[part.type] = part.value;
  }

  // en-CA gives us YYYY-MM-DD ordering already; hour can come back as "24"
  // for midnight in some ICU versions, so normalize that to "00".
  const hour = parts.hour === '24' ? '00' : parts.hour;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`
  };
}

// Runs one polling tick: load every enabled schedule, check each against
// the clock, and trigger the ones that are due. Exported on its own (not
// just wired into cron.schedule) so it can also be called directly for
// manual testing/debugging without waiting for the minute to turn over.
async function checkAndTriggerDueSchedules() {
  console.log('[cron] Checking for due schedules...');

  const { data: rows, error } = await supabase
    .from('schedule_settings')
    .select('user_id, enabled, scheduled_time, topics, freshness_window, update_type, timezone')
    .eq('enabled', true);

  if (error) {
    console.error('[cron] Failed to load schedule_settings — skipping this tick:', error.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log('[cron] No enabled schedules found.');
    return;
  }

  for (const row of rows) {
    let date, time;
    try {
      ({ date, time } = nowInTimezone(row.timezone || 'UTC'));
    } catch (err) {
      // An invalid/unsupported IANA timezone string would throw from
      // Intl.DateTimeFormat's constructor. Rather than let one bad row
      // (e.g. hand-edited directly in Supabase) crash the whole tick,
      // log it and fall back to UTC for that row only.
      console.error(
        `[cron] Invalid timezone "${row.timezone}" for user ${row.user_id} — falling back to UTC.`
      );
      ({ date, time } = nowInTimezone('UTC'));
    }

    if (time !== row.scheduled_time) continue;

    const fireKey = `${row.user_id}:${date}:${time}`;
    if (firedThisMinute.has(fireKey)) continue;
    firedThisMinute.add(fireKey);
    // The Set would otherwise grow forever across days — it only ever
    // needs to remember the current minute's fires, so trim it back down
    // once it's served its purpose for this key. Cheap and simple over a
    // TTL cache for the handful of entries this will ever hold.
    setTimeout(() => firedThisMinute.delete(fireKey), 65 * 1000).unref();

    if (!row.topics || row.topics.length === 0) {
      console.log(`[cron] User ${row.user_id} is due at ${time} but has no topics selected — skipping.`);
      continue;
    }

    console.log(
      `[cron] Triggering scheduled run for user ${row.user_id} (topics: ${row.topics.join(', ')}, ` +
        `window: ${row.freshness_window}, type: ${row.update_type}, tz: ${row.timezone})`
    );

    // Deliberately not awaited — a tick shouldn't block on one user's
    // (potentially multi-topic, Gemini-throttled) run before checking or
    // triggering the rest. Each run's own success/failure is logged from
    // inside this .then/.catch instead of by the caller.
    runForUser(row.user_id, {
      topics: row.topics,
      freshnessWindow: row.freshness_window,
      updateType: row.update_type
    })
      .then((results) => {
        const succeeded = results.filter((r) => r.ok).length;
        const failed = results.length - succeeded;
        console.log(
          `[cron] Finished scheduled run for user ${row.user_id}: ${succeeded} topic(s) succeeded, ${failed} failed.`
        );
      })
      .catch((err) => {
        if (err instanceof RunInProgressError) {
          console.log(
            `[cron] Skipped scheduled run for user ${row.user_id} — a previous run for this user is still in progress.`
          );
        } else {
          console.error(`[cron] Unexpected error running scheduled pipeline for user ${row.user_id}:`, err);
        }
      });
  }
}

let started = false;

// Starts the polling cron job. Called once from server.js on boot.
// Guarded against double-start (e.g. if a future test harness imports
// server.js more than once in the same process) since node-cron would
// otherwise happily register two ticking jobs.
function startScheduler() {
  if (started) {
    console.warn('[cron] startScheduler() called again — scheduler is already running, ignoring.');
    return;
  }
  started = true;

  console.log('[cron] Starting scheduler — checking every minute for due schedules.');
  cron.schedule(CRON_EXPRESSION, () => {
    checkAndTriggerDueSchedules().catch((err) => {
      console.error('[cron] Unexpected error during scheduled tick:', err);
    });
  });
}

// Exposes whether startScheduler() has actually run — added in Phase 3,
// Prompt 6 so GET /api/test/phase3-status (routes/testPhase3.js) can
// report real scheduler state instead of just assuming server.js called
// startScheduler() successfully on boot.
function isSchedulerRunning() {
  return started;
}

module.exports = { startScheduler, checkAndTriggerDueSchedules, isSchedulerRunning };
