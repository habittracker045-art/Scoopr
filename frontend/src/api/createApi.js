// Phase 4, Prompt 4: API layer for the Create tab.
//
// Deliberately its own file rather than folded into cardsApi.js — Create
// mode hits a different endpoint (POST /api/create, Phase 3's manual-
// create pipeline) with a different request shape (ideaText/topic in,
// one freshly-generated card out), even though the *response* card is
// shaped compatibly with cardsApi's cards so it can flow straight into
// <CarouselCard> — the same full-card display (headline/caption/
// enrichment note, Edit+Share) the Feed carousel uses (Redesign Phase,
// Prompt 3; see pages/Create.jsx). Keeping request() local (rather than
// importing cardsApi's private helper) keeps the two API modules
// independent, matching how tipsFactsApi.js is also its own file rather
// than merged into this one.

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
 * POST /api/create — turns a user-typed idea into a Gemini-enriched card
 * (Phase 3, Prompt 2's manual Create pipeline). Resolves to
 * `{ card }`, where `card` is shaped the same way cardsApi.getCards()
 * rows are (id/title/caption/imageUrl/topic/topicLabel/status/
 * enrichmentNote/...), so it can be handed straight to <CarouselCard>
 * for the Edit+Share flow, same as a Feed card.
 */
export function createCard({ token, ideaText, topic }) {
  return request('/create', token, {
    method: 'POST',
    body: JSON.stringify({ ideaText, topic })
  });
}
