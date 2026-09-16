// Scoopr — Phase 3, Cron Engine + Manual "Generate Now"
//
// Shared "run the pipeline for a user, across all their selected topics"
// helper. Both the cron scheduler (cron.js, triggered on a timer) and the
// manual POST /api/pipeline/generate-now route call THIS instead of
// touching services/pipeline.js directly, so:
//
//   1. There is exactly one place that turns a schedule_settings row
//      (topics[], freshnessWindow, updateType) into a sequence of
//      runPipeline() calls — no duplicated looping logic between the
//      cron path and the manual path.
//   2. Overlap protection (below) is enforced identically for both
//      triggers. A user can't have a scheduled run and a manual
//      "Generate Now" click stack on top of each other any more than
//      they could have two scheduled runs overlap.
//
// Nothing in services/pipeline.js (Phase 2/3's actual fetch -> freshness ->
// dedup -> polish -> image -> storage pipeline) is touched by this file —
// it only calls runPipeline() once per topic and collects the results.

const { runPipeline, PipelineInputError } = require('./pipeline');

// --- Overlap protection --------------------------------------------------
//
// A simple in-memory Set of user IDs currently mid-run. This is NOT
// persisted anywhere and NOT shared across processes — see the README
// ("Overlap protection") for why that's a deliberate, acceptable choice
// for a single-instance personal app rather than an oversight: Render's
// free tier runs one instance, there's no multi-process/multi-dyno
// fan-out to coordinate across, and a Map that resets on restart is
// exactly the behavior we want (a crash mid-run shouldn't leave a user
// permanently "stuck" as running forever — a restart clears it).
const runningUsers = new Set();

class RunInProgressError extends Error {
  constructor(userId) {
    super(`A pipeline run for user ${userId} is already in progress.`);
    this.name = 'RunInProgressError';
    this.userId = userId;
  }
}

function isUserRunning(userId) {
  return runningUsers.has(userId);
}

// Runs the pipeline once per topic in `topics`, sequentially (not in
// parallel) — this is a free-tier Gemini key shared across every topic in
// the run, and services/pipeline.js already internally throttles its own
// per-item Gemini calls via CONCURRENCY; running multiple topics'
// *pipelines* concurrently on top of that would multiply the in-flight
// request count for no real speed benefit on a personal app where nobody
// is waiting on sub-second latency here. A failure on one topic does not
// stop the others — each topic's outcome (success or error) is collected
// independently, mirroring how runPipeline() itself treats a single
// failed source as non-fatal to the rest of the run.
//
// Throws RunInProgressError synchronously (before doing any work) if this
// user already has a run in flight — callers decide what that means for
// them (cron.js logs-and-skips; the generate-now route responds 409).
async function runForUser(userId, { topics, freshnessWindow, updateType }) {
  if (isUserRunning(userId)) {
    throw new RunInProgressError(userId);
  }

  runningUsers.add(userId);
  try {
    const results = [];

    for (const topic of topics) {
      try {
        const result = await runPipeline({ topic, freshnessWindow, updateType });
        results.push({ topic, ok: true, result });
      } catch (err) {
        const message = err?.message || String(err);
        const isInputError = err instanceof PipelineInputError;
        console.error(
          `[scheduleRunner] Pipeline run failed for user ${userId}, topic "${topic}": ${message}`
        );
        results.push({
          topic,
          ok: false,
          error: message,
          details: isInputError ? err.details : undefined
        });
      }
    }

    return results;
  } finally {
    // Always clear the flag, even if something above threw unexpectedly
    // (it shouldn't — every topic is individually try/caught — but this
    // is the backstop that guarantees a user never gets stuck "running"
    // forever because of a bug in this file rather than the pipeline).
    runningUsers.delete(userId);
  }
}

module.exports = { runForUser, isUserRunning, RunInProgressError };
