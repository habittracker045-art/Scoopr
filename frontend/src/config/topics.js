// Mirrors backend/src/config/topics.js's keys + labels (kept in sync by
// hand — small, stable list). 'all' is a frontend-only pseudo-topic that
// means "don't filter", matching cardsApi.getCards's default.

export const FEED_TOPICS = [
  { key: 'all', label: 'All' },
  { key: 'tech', label: 'Tech' },
  { key: 'sports', label: 'Sports' },
  { key: 'finance', label: 'Finance' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'general', label: 'General News' }
];
