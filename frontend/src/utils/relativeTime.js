// Small self-contained relative-time formatter (e.g. "2h ago") — no date
// library dependency, matching the rest of the frontend (see Icons.jsx).

const UNITS = [
  { limit: 60, divisor: 1, suffix: 's ago' },
  { limit: 3600, divisor: 60, suffix: 'm ago' },
  { limit: 86400, divisor: 3600, suffix: 'h ago' },
  { limit: 604800, divisor: 86400, suffix: 'd ago' },
  { limit: 2629800, divisor: 604800, suffix: 'w ago' },
  { limit: 31557600, divisor: 2629800, suffix: 'mo ago' }
];

export function formatRelativeTime(isoString) {
  if (!isoString) return '';

  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSeconds < 5) return 'just now';

  for (const { limit, divisor, suffix } of UNITS) {
    if (diffSeconds < limit) {
      return `${Math.max(1, Math.floor(diffSeconds / divisor))}${suffix}`;
    }
  }

  const years = Math.floor(diffSeconds / 31557600);
  return `${years}y ago`;
}
