import React, { useState } from 'react';
import { Card, Button, Spinner } from '../ui';
import { IconImagePlaceholder, IconShare } from '../icons/Icons';
import { formatRelativeTime } from '../../utils/relativeTime';
import { shareCard } from '../../utils/shareCard';

/**
 * One row in the History archive list (Redesign Phase, Prompt 5) —
 * deliberately more compact than the Feed carousel's <CarouselCard>: a
 * small 40px thumbnail, a single-line headline, a muted source/date meta
 * line, and a single Share action underneath.
 *
 * No Edit here, and no Approve/Skip (which this component never had even
 * before this prompt) — per spec, History is a settled record of what
 * was already generated, not an active editing surface. Edit lives on
 * Feed/Create/Tips & Facts, where content is freshly generated; Share is
 * the only thing that makes sense to do with a card after the fact.
 *
 * Share reuses utils/shareCard.js completely unmodified — same
 * image-then-text-then-clipboard fallback chain as CarouselCard's Share,
 * just wired to a plain {title, caption, imageUrl, sourceUrl} object
 * built from this row's `card` prop.
 */
export default function HistoryListItem({ card }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const showImage = card.imageUrl && !imageFailed;

  async function handleShare() {
    setBusy(true);
    setStatusMsg(null);
    try {
      const result = await shareCard(card);
      setStatusMsg(result.message);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatusMsg(err.message || 'Something went wrong sharing that card.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="history-item">
      <div className="history-item-row">
        <div className="history-item-thumb">
          {showImage ? (
            <img
              src={card.imageUrl}
              alt=""
              className="history-item-thumb-img"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <IconImagePlaceholder size={18} className="history-item-thumb-placeholder" />
          )}
        </div>

        <div className="history-item-body">
          <h3 className="history-item-title">{card.title}</h3>
          <div className="history-item-meta">
            <span className="history-item-topic">{card.topicLabel}</span>
            <span className="history-item-dot" aria-hidden="true">
              &middot;
            </span>
            <span className="history-item-time">{formatRelativeTime(card.createdAt)}</span>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="history-item-share-btn"
          onClick={handleShare}
          disabled={busy}
          aria-label={`Share "${card.title}"`}
        >
          {busy ? <Spinner size={14} /> : <IconShare size={16} />}
        </Button>
      </div>
      {statusMsg && <p className="history-item-status">{statusMsg}</p>}
    </Card>
  );
}
