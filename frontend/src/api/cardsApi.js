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
 * GET /api/cards — paginated, filterable card list. Backs the History
 * tab (Prompt 5: passes `status` — often 'all' — and `search` on top of
 * topic/offset/limit; Redesign Phase Prompt 6 adds `sourceType` on top
 * of that for the source-type filter pills) and, as of Redesign Phase
 * Prompt 2, the Feed tab's carousel — a single call for
 * `status: 'all', limit: 6` (topic/sourceType left at their 'all'
 * defaults), since the carousel wants the 6 most recent cards regardless
 * of topic, status, or source, newest first.
 *
 * `topic` of 'all' (or omitted) fetches every topic. `status` of 'all'
 * removes the status filter entirely (server-side default is 'draft' if
 * omitted — a leftover from the old review-queue Feed; the carousel
 * always passes 'all' explicitly since it's not a queue). `search` is a
 * case-insensitive substring match against title/caption, added in
 * Prompt 5 for History — see routes/cards.js. `sourceType` of 'auto' |
 * 'manual' filters to auto-pipeline or manually-created cards
 * respectively; 'all' (or omitted) applies no source filter — see
 * routes/cards.js's Redesign Phase, Prompt 6 header comment for how
 * 'auto' is derived (anything that isn't 'manual'). `offset` drives
 * History's "load next page" infinite scroll — see History.jsx.
 */
export function getCards({ token, topic = 'all', status, search, sourceType, offset = 0, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (topic && topic !== 'all') params.set('topic', topic);
  if (status) params.set('status', status);
  if (search && search.trim()) params.set('search', search.trim());
  if (sourceType && sourceType !== 'all') params.set('sourceType', sourceType);
  params.set('offset', String(offset));
  params.set('limit', String(limit));

  return request(`/cards?${params.toString()}`, token);
}

/**
 * PATCH /api/cards/:id — updates a card's status, caption, title, and/or
 * enrichment note. The Feed carousel's <CarouselCard> Edit (Redesign
 * Phase, Prompt 2) sends `title`/`caption`/`enrichmentNote` together;
 * Create's freshly-generated result (Redesign Phase, Prompt 3) reuses
 * that exact same component and so hits this endpoint the same way. Only
 * fields actually passed in are sent, so a caller can update just the
 * ones it cares about without touching the rest. Resolves to
 * { card: <updated card, same shape as getCards() rows> }.
 */
export function updateCard({ token, id, status, caption, title, enrichmentNote }) {
  const body = {};
  if (status !== undefined) body.status = status;
  if (caption !== undefined) body.caption = caption;
  if (title !== undefined) body.title = title;
  if (enrichmentNote !== undefined) body.enrichmentNote = enrichmentNote;

  return request(`/cards/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}
