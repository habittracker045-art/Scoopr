// Status filter options for the History tab (Phase 4, Prompt 5). Mirrors
// config/topics.js's FEED_TOPICS shape/convention: 'all' is a
// frontend-only pseudo-status meaning "don't filter", matching
// cardsApi.getCards's handling of status='all' (removes the filter
// server-side — see routes/cards.js).
//
// Keys line up with routes/cards.js's VALID_STATUSES ('draft' |
// 'approved' | 'skipped') plus this frontend-only 'all'.

export const HISTORY_STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'draft', label: 'Draft' }
];
