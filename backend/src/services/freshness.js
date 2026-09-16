// Shared freshness-window utility. Given a list of normalized items (each
// with an ISO `publishedAt`) and a window like "6h" / "24h" / "3d", returns
// only the items published within that window of "now".

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Named windows exposed to callers/routes so ?window= values map to a
// single source of truth. "3days" and "3d" both resolve to the same thing.
const WINDOWS = {
  '6h': 6 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '3d': 3 * DAY_MS,
  '3days': 3 * DAY_MS
};

const DEFAULT_WINDOW = '24h';

// Accepts a known window key ("6h", "24h", "3d") or a raw duration like
// "12h" / "2d" and returns the equivalent milliseconds. Falls back to the
// 24h default for anything unrecognized rather than throwing, since this
// is read straight from a query param.
function parseWindowToMs(window) {
  if (!window) return WINDOWS[DEFAULT_WINDOW];

  const key = String(window).trim().toLowerCase();
  if (WINDOWS[key]) return WINDOWS[key];

  const match = key.match(/^(\d+)(h|d)$/);
  if (match) {
    const amount = Number(match[1]);
    const unitMs = match[2] === 'h' ? HOUR_MS : DAY_MS;
    return amount * unitMs;
  }

  console.warn(`[freshness] Unrecognized window "${window}", defaulting to ${DEFAULT_WINDOW}.`);
  return WINDOWS[DEFAULT_WINDOW];
}

// Discards any item whose publishedAt is older than `window` relative to
// now. Items with an unparseable publishedAt are dropped rather than kept,
// since we can't verify they're actually fresh.
function filterByFreshness(items, window = DEFAULT_WINDOW, now = Date.now()) {
  const windowMs = parseWindowToMs(window);
  const cutoff = now - windowMs;

  return items.filter((item) => {
    const publishedMs = new Date(item.publishedAt).getTime();
    if (Number.isNaN(publishedMs)) return false;
    return publishedMs >= cutoff;
  });
}

module.exports = { filterByFreshness, parseWindowToMs, WINDOWS, DEFAULT_WINDOW };
