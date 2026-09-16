import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCards } from '../api/cardsApi';
import { Spinner } from '../components/ui';
import CardCarousel from '../components/feed/CardCarousel';
import FeedEmptyState from '../components/feed/FeedEmptyState';

// The carousel is a fixed "most recent N" snapshot, not a paginated
// queue — see the header comment below for why this replaced the old
// infinite-scroll list entirely.
const CAROUSEL_SIZE = 6;

/**
 * Feed tab (Redesign Phase, Prompt 2: "Feed — Rebuild as a Carousel").
 *
 * Previously an infinitely-scrolling, topic-filterable list of draft
 * cards with Approve/Edit/Skip/Share per row (see git history / the old
 * PAGE_SIZE-based version of this file). That queue metaphor is gone:
 * this now fetches the user's 6 most recent cards — across BOTH
 * auto-pipeline and manually-created cards, and across every status, not
 * just 'draft' — and shows them one at a time in a carousel with
 * left/right arrows, swipe support, and a wrap-around "N of total"
 * counter. There is no "load more" and nothing here ever fetches a 7th
 * card; going past the last card loops back to the first.
 *
 * No new backend endpoint was needed: GET /api/cards already supported
 * `limit` (added Phase 4, Prompt 2) and `status=all` (to remove the
 * default 'draft'-only filter, also Phase 4, Prompt 2/5) — see
 * cardsApi.js and routes/cards.js for what *did* change (adding
 * `enrichmentNote` to the response shape, and `title`/`enrichmentNote` to
 * the PATCH body, both purely additive).
 *
 * Approve/Skip are gone from this screen entirely — see
 * components/feed/CarouselCard.jsx, which only offers Edit and Share.
 * The old <CardListItem>/<CardActions> pair (Approve/Edit/Skip/Share)
 * is untouched and still used, as before, by the Create tab.
 *
 * Fewer than 6 cards (including zero) is not an error state — the
 * carousel just shows however many came back; see the empty-state branch
 * below for the zero case.
 */
export default function Feed() {
  const { token } = useAuth();

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // status: 'all' — the carousel is "your most recent updates,
      // period," not a drafts-only review queue, so every status (and,
      // since there's no sourceType filter in this endpoint at all,
      // implicitly every source) is included. offset/topic are left at
      // their defaults (0 / every topic).
      const data = await getCards({ token, status: 'all', limit: CAROUSEL_SIZE });
      setCards(data.cards || []);
    } catch (err) {
      setError(err.message || 'Something went wrong loading your feed.');
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Bubbled up from a card's Edit save (see CarouselCard). There's no
  // "removed" case anymore — Approve/Skip don't exist on this screen —
  // so this only ever merges an updated card into place by id.
  const handleCardUpdate = useCallback((id, patch) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const showEmptyState = !loading && !error && cards.length === 0;

  return (
    <div className="feed-page">
      <h1 className="feed-heading">Feed</h1>

      {loading ? (
        <div className="feed-carousel-loading">
          <Spinner size={28} />
        </div>
      ) : error ? (
        <div className="feed-error">
          <p>{error}</p>
          <button type="button" className="feed-retry-btn" onClick={load}>
            Try again
          </button>
        </div>
      ) : showEmptyState ? (
        <FeedEmptyState />
      ) : (
        <CardCarousel cards={cards} onCardUpdate={handleCardUpdate} />
      )}
    </div>
  );
}
