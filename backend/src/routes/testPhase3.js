// GET /api/test/phase3-status — Phase 3, Prompt 6 (Final Consolidation +
// Robustness).
//
// A single "is everything from Prompts 1-5 actually alive" endpoint, so
// sanity-checking the whole phase doesn't mean separately hitting
// GET /api/schedule, GET /api/tips-facts, POST /api/pipeline/generate-now,
// POST /api/create, and checking server logs for the cron scheduler.
//
// Deliberately lightweight and read-only — this does NOT trigger a
// pipeline run, an events generation, a tips/facts generation, or a
// manual create. It only confirms each piece Phase 3 depends on is
// reachable/initialized:
//   - schedule_settings table reachable (a cheap `select count`, not a
//     full row fetch)
//   - tips_facts table reachable (same)
//   - cron scheduler initialized (in-memory flag from cronScheduler.js —
//     see isSchedulerRunning())
//   - which routes this server process actually has mounted, so a future
//     wiring regression (a route built but never require()'d into
//     server.js — the exact class of bug this prompt was asked to check
//     for) is visible here instead of only discoverable by manually
//     hitting each endpoint and getting a 404.
//
// Authenticated (same requireAuth pattern as every other real,
// user-facing Phase 3 route) rather than open like the Phase 2 test
// routes — this reports internal wiring/DB state, which isn't something
// to leave open to the public internet.

const express = require('express');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { isSchedulerRunning } = require('../services/cronScheduler');

const router = express.Router();

// Walks the live Express app's router stack to check whether a given
// mount path (e.g. '/api/schedule') actually has a router mounted on it
// in THIS running process — not just "does the route file exist on
// disk". This is what makes the wiring check below meaningful: a route
// file that was built but never require()'d + app.use()'d into
// server.js (the exact kind of gap this prompt was asked to check for —
// see PHASE3_PROMPT6_README.md) would show up here as `false`, the same
// way it'd show up as a 404 to a real client hitting it.
function isRouteMounted(app, mountPath) {
  const stack = app?._router?.stack || [];
  // Router-level middleware (app.use(path, router)) has a `regexp` built
  // from the mount path and a `handle` that's itself a router with its
  // own `.stack` of actual routes — presence of both, matching this
  // mount path, is enough to say "something is mounted here" without
  // needing to reproduce Express's internal path-to-regexp format.
  return stack.some(
    (layer) => Boolean(layer.regexp && layer.regexp.test(mountPath) && layer.handle && layer.handle.stack)
  );
}

// Runs a cheap `select count` against a table and reports whether it's
// reachable. Never throws — a DB hiccup here should show up as
// `reachable: false` in the JSON response, not a 500 that hides which
// piece actually failed.
async function checkTableReachable(tableName) {
  try {
    const { error, count } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    if (error) {
      return { reachable: false, error: error.message };
    }
    return { reachable: true, rowCount: count ?? null };
  } catch (err) {
    return { reachable: false, error: err?.message || String(err) };
  }
}

// GET /api/test/phase3-status
router.get('/phase3-status', requireAuth, async (req, res) => {
  const [scheduleSettings, tipsFacts] = await Promise.all([
    checkTableReachable('schedule_settings'),
    checkTableReachable('tips_facts')
  ]);

  const schedulerRunning = isSchedulerRunning();

  // Reflects what THIS running process actually require()'d + app.use()'d
  // into server.js (see isRouteMounted() above), not just what route
  // files exist on disk — that's the distinction that makes this catch a
  // real wiring gap instead of rubber-stamping "yes" because the file is
  // present. See PHASE3_PROMPT6_README.md: this is the exact class of bug
  // (built but never wired in) that happened in Phase 2.
  const routesMounted = {
    schedule: isRouteMounted(req.app, '/api/schedule'),
    generateNow: isRouteMounted(req.app, '/api/pipeline'),
    create: isRouteMounted(req.app, '/api/create'),
    tipsFacts: isRouteMounted(req.app, '/api/tips-facts')
  };

  const checks = {
    scheduleSettingsTable: scheduleSettings,
    tipsFactsTable: tipsFacts,
    cronScheduler: {
      running: schedulerRunning
    },
    routesMounted
  };

  const allHealthy =
    scheduleSettings.reachable &&
    tipsFacts.reachable &&
    schedulerRunning &&
    Object.values(routesMounted).every(Boolean);

  return res.status(allHealthy ? 200 : 503).json({
    phase: 3,
    status: allHealthy ? 'ok' : 'degraded',
    checks
  });
});

module.exports = router;
