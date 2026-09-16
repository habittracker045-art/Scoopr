import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCards } from '../api/cardsApi';
import { Spinner } from '../components/ui';
import { IconSearch, IconClose } from '../components/icons/Icons';
import HistoryListItem from '../components/history/HistoryListItem';
import HistoryListItemSkeleton from '../components/history/HistoryListItemSkeleton';
import HistoryEmptyState from '../components/history/HistoryEmptyState';
import TopicFilter from '../components/feed/TopicFilter';
import SourceTypeFilter from '../components/history/SourceTypeFilter';

const PAGE_SIZE = 20;
const INITIAL_SKELETON_COUNT = 6;
const SEARCH_DEBOUNCE_MS = 400;

/**
 * History tab (Redesign Phase, Prompt 6: "History — Search + Filters,
 * Final Consolidation" — the last prompt of the Redesign Phase).
 *
 * R5 built this page as a core, unfiltered archive list on purpose,
 * deferring search and filters to this prompt (see that section's point
 * 6 in the README). This prompt adds them back:
 *
 *   - A free-text search box (title/caption substring match) — the
 *     `search` param `GET /api/cards` already supported since Phase 4,
 *     Prompt 5 (checked first, per the prompt; no backend change was
 *     needed for this part).
 *   - A topic filter — reuses `components/feed/TopicFilter.jsx`
 *     completely unmodified (it was left in the codebase, unused, since
 *     R5 — see that section's point 6). No backend change needed either;
 *     `topic` has existed on this endpoint since Phase 4, Prompt 2.
 *   - A source-type filter (Auto-generated / Manually created / All) —
 *     genuinely new. `GET /api/cards` never had a `sourceType` param
 *     before this prompt (R5's point 1 confirmed as much), so
 *     `routes/cards.js` was extended with one — see that file's header
 *     comment for how "auto" is derived (`source_type != 'manual'`)
 *     rather than needing to duplicate the list of every auto source.
 *     `components/history/SourceTypeFilter.jsx` + `config/sourceTypes.js`
 *     are new files, built on the exact same Pill-row pattern
 *     `StatusFilter`/`TopicFilter` already established.
 *
 * `components/history/StatusFilter.jsx` and `config/statuses.js`
 * (status: draft/approved/skipped) are **not** wired up here — the spec
 * for this prompt calls for a topic filter and a source-type filter
 * only. Both files are left exactly as R5 left them: untouched, in the
 * codebase, unused by any page.
 *
 * Combining with R5-1's infinite scroll (point 3 of this prompt): search
 * and both filters are query-param siblings of `topic`/`status` on the
 * same `GET /api/cards` call, so nothing about the pagination mechanism
 * itself changes — but changing any of them now needs to throw away
 * whatever pages were already loaded and start over at offset 0, or a
 * search/filter change would otherwise silently append onto (rather than
 * replace) results fetched under the *previous* filters. That's handled
 * by widening the reset-triggering effect below from "on mount only" (as
 * R5 left it) to "on mount, and again whenever topic/sourceType/the
 * debounced search term changes" — `loadPage(0, { reset: true })` already
 * did the necessary `setCards(reset ? data.cards : ...)` replace-not-
 * merge; it just wasn't being re-invoked by a filter change since there
 * were no filters yet. `requestIdRef` (already in place since R5) is
 * what makes this safe: typing quickly into search, or tapping filter
 * pills back-to-back, fires several overlapping requests, and only the
 * response matching the *current* `requestIdRef.current` is applied —
 * every stale one is silently dropped instead of momentarily flashing
 * onto the list or (worse) getting appended after a newer, correct page.
 */
export default function History() {
  const { token } = useAuth();

  const [topic, setTopic] = useState('all');
  const [sourceType, setSourceType] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [cards, setCards] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const sentinelRef = useRef(null);
  const requestIdRef = useRef(0);

  // Debounce the search box: only update `search` (the value actually
  // sent to the API) 400ms after the person stops typing, so every
  // keystroke doesn't fire its own request/reset.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Loads a page starting at `startOffset`. `reset` clears the current
  // list first — happens on the initial mount and whenever a filter/
  // search change means the previous page(s) no longer belong to the
  // current query (see the file header comment above).
  const loadPage = useCallback(
    async (startOffset, { reset }) => {
      const requestId = ++requestIdRef.current;
      if (reset) {
        setInitialLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        // status: 'all' — the full archive, not the draft-only default
        // GET /api/cards otherwise applies (that default exists for the
        // Feed's old review-queue meaning, which doesn't apply here).
        const data = await getCards({
          token,
          status: 'all',
          topic,
          sourceType,
          search,
          offset: startOffset,
          limit: PAGE_SIZE
        });
        // A newer request (a filter/search change, or a fast double-fire
        // of the scroll observer) has since started — drop this now-stale
        // response so it can't land after, and get merged with, a page
        // that belongs to a different query.
        if (requestId !== requestIdRef.current) return;

        setCards((prev) => (reset ? data.cards : [...prev, ...data.cards]));
        setOffset(data.nextOffset ?? startOffset + data.cards.length);
        setHasMore(Boolean(data.hasMore));
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err.message || 'Something went wrong loading your history.');
        if (reset) setCards([]);
        setHasMore(false);
      } finally {
        if (requestId !== requestIdRef.current) return;
        setInitialLoading(false);
        setLoadingMore(false);
      }
    },
    [token, topic, sourceType, search]
  );

  // Initial load, and again whenever the signed-in user, topic,
  // source-type, or (debounced) search term changes — always resetting
  // to page 0 rather than merging onto whatever was already loaded under
  // the previous query.
  useEffect(() => {
    loadPage(0, { reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, topic, sourceType, search]);

  // Infinite scroll: observe a sentinel div at the bottom of the list and
  // fetch the next page once it's in view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || initialLoading || loadingMore || !hasMore || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadPage(offset, { reset: false });
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [initialLoading, loadingMore, hasMore, error, offset, loadPage]);

  const isFiltered = topic !== 'all' || sourceType !== 'all' || Boolean(search);
  const showEmptyState = !initialLoading && !error && cards.length === 0;

  return (
    <div className="history-page">
      <h1 className="page-heading">History</h1>

      <div className="history-filters">
        <div className="history-search">
          <IconSearch size={16} className="history-search-icon" />
          <input
            type="text"
            className="history-search-input"
            placeholder="Search by title or caption"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search history by title or caption"
          />
          {searchInput && (
            <button
              type="button"
              className="history-search-clear"
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <IconClose size={14} />
            </button>
          )}
        </div>

        <TopicFilter value={topic} onChange={setTopic} />
        <SourceTypeFilter value={sourceType} onChange={setSourceType} />
      </div>

      {initialLoading ? (
        <div className="history-list">
          {Array.from({ length: INITIAL_SKELETON_COUNT }).map((_, i) => (
            <HistoryListItemSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="feed-error">
          <p>{error}</p>
          <button type="button" className="feed-retry-btn" onClick={() => loadPage(0, { reset: true })}>
            Try again
          </button>
        </div>
      ) : showEmptyState ? (
        <HistoryEmptyState filtered={isFiltered} />
      ) : (
        <>
          <div className="history-list">
            {cards.map((card) => (
              <HistoryListItem key={card.id} card={card} />
            ))}
          </div>

          {hasMore && (
            <div ref={sentinelRef} className="feed-sentinel">
              {loadingMore && <Spinner size={22} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
