import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight } from '../icons/Icons';
import CarouselCard from './CarouselCard';

// A touch move shorter than this is treated as a tap/scroll jitter, not
// a deliberate swipe — avoids advancing the carousel on tiny accidental
// finger movement.
const SWIPE_THRESHOLD_PX = 50;

/**
 * One-at-a-time carousel for the Feed tab (Redesign Phase, Prompt 2).
 * Renders exactly one <CarouselCard> at a time, with left/right arrow
 * buttons, a "N of total" counter, and swipe support on touch devices.
 *
 * Interaction approach chosen: this is a plain controlled-index slider
 * (no external carousel library, no CSS scroll-snap) — `index` state
 * plus touchstart/touchmove/touchend handlers on the stage div. That
 * keeps it dependency-free and consistent with the rest of the
 * codebase's "small, self-contained, no library where one isn't clearly
 * needed" pattern (see Icons.jsx, relativeTime.js). Swipe left -> next
 * card, swipe right -> previous card, mirroring the native feel of
 * photo/story viewers; a swipe shorter than SWIPE_THRESHOLD_PX is
 * ignored so an accidental tap-and-drag doesn't advance the carousel.
 *
 * Looping: past the last card wraps to the first (and vice versa) — see
 * the modulo arithmetic in goTo(). There is no "end of feed" state and
 * nothing here ever fetches more cards; `cards` is a fixed snapshot
 * (at most 6) owned by Feed.jsx.
 *
 * `card={card}` is keyed by `card.id`, so switching cards always mounts
 * a fresh <CarouselCard> — see that component's header comment for why.
 */
export default function CardCarousel({ cards, onCardUpdate }) {
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(null);
  const touchDeltaX = useRef(0);

  const count = cards.length;
  // Defensive clamp: if `cards` ever shrinks out from under an existing
  // index (not expected in normal use — this is a fixed snapshot — but
  // cheap to guard against), keep the index in range instead of reading
  // past the end of the array.
  const safeIndex = count > 0 ? ((index % count) + count) % count : 0;
  const card = cards[safeIndex];

  const goTo = useCallback(
    (nextIndex) => {
      if (count === 0) return;
      setIndex(((nextIndex % count) + count) % count);
    },
    [count]
  );

  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);
  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);

  // Keyboard arrow support for non-touch devices, in addition to the
  // on-screen arrow buttons.
  useEffect(() => {
    if (count <= 1) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [count, goPrev, goNext]);

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
  }

  function handleTouchMove(e) {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  }

  function handleTouchEnd() {
    if (touchStartX.current == null) return;
    if (touchDeltaX.current > SWIPE_THRESHOLD_PX) goPrev();
    else if (touchDeltaX.current < -SWIPE_THRESHOLD_PX) goNext();
    touchStartX.current = null;
    touchDeltaX.current = 0;
  }

  if (!card) return null;

  return (
    <div className="feed-carousel">
      <div
        className="feed-carousel-stage"
        onTouchStart={count > 1 ? handleTouchStart : undefined}
        onTouchMove={count > 1 ? handleTouchMove : undefined}
        onTouchEnd={count > 1 ? handleTouchEnd : undefined}
      >
        <CarouselCard key={card.id} card={card} onCardUpdate={onCardUpdate} />
      </div>

      {count > 1 && (
        <div className="feed-carousel-controls">
          <button
            type="button"
            className="feed-carousel-arrow"
            onClick={goPrev}
            aria-label="Previous card"
          >
            <IconChevronLeft size={20} />
          </button>
          <span className="feed-carousel-counter">
            {safeIndex + 1} of {count}
          </span>
          <button
            type="button"
            className="feed-carousel-arrow"
            onClick={goNext}
            aria-label="Next card"
          >
            <IconChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
