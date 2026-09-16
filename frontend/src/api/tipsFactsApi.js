// Phase 4, Prompt 4: API layer for the Tips & Facts tab. Extended in the
// Redesign Phase, Prompt 4 ("no pile-up, one at a time" + editing).
//
// Calls against routes/tipsFacts.js:
//   getTipsFacts()      -> GET   /api/tips-facts            (list; no
//                          longer called on load by TipsFacts.jsx as of
//                          Redesign Phase, Prompt 4, but kept here in
//                          case something else ever needs it)
//   generateTipsFacts() -> POST  /api/tips-facts/generate    (generate;
//                          TipsFacts.jsx now always passes `count: 1`)
//   updateTipFact()     -> PATCH /api/tips-facts/:id         (new — Edit
//                          "save")

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
 * GET /api/tips-facts — saved tips/facts, most recent first. Resolves to
 * `{ tipsFacts }`, each shaped `{ id, content, category, topic, imageUrl,
 * createdAt, status }` (`category` is 'tip' or 'fact').
 */
export function getTipsFacts({ token, topic, limit } = {}) {
  const params = new URLSearchParams();
  if (topic && topic !== 'all') params.set('topic', topic);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();

  return request(`/tips-facts${qs ? `?${qs}` : ''}`, token);
}

/**
 * POST /api/tips-facts/generate — generates a fresh batch via Gemini and
 * saves it. Resolves to `{ tipsFacts, generatedCount }` — the newly
 * created rows only (not the full list), so the caller (TipsFacts.jsx)
 * appends them to what it already has rather than refetching everything.
 */
export function generateTipsFacts({ token, topic, category, count } = {}) {
  const body = {};
  if (topic) body.topic = topic;
  if (category) body.category = category;
  if (count) body.count = count;

  return request('/tips-facts/generate', token, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * PATCH /api/tips-facts/:id — (new, Redesign Phase, Prompt 4) updates a
 * tip/fact's `content`. Resolves to `{ tipFact }`, shaped the same as
 * one entry in `getTipsFacts()`'s `tipsFacts` array.
 */
export function updateTipFact({ token, id, content }) {
  return request(`/tips-facts/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ content })
  });
}
