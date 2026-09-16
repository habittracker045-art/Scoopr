// Source-type filter options for the History tab (Redesign Phase,
// Prompt 6). Mirrors config/topics.js's FEED_TOPICS shape/convention:
// 'all' is a frontend-only pseudo-value meaning "don't filter", matching
// cardsApi.getCards's handling of sourceType='all' (removes the filter
// server-side — see routes/cards.js).
//
// Only two real values exist server-side ('auto' | 'manual' — see
// routes/cards.js's Redesign Phase, Prompt 6 header comment for how
// 'auto' is derived from every source_type that isn't 'manual'), so
// unlike FEED_TOPICS/HISTORY_STATUSES this list only ever has three
// entries total.

export const HISTORY_SOURCE_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'auto', label: 'Auto-generated' },
  { key: 'manual', label: 'Manually created' }
];
