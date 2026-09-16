import React, { useState } from 'react';
import { Card } from '../ui';
import { IconImagePlaceholder } from '../icons/Icons';
import { formatRelativeTime } from '../../utils/relativeTime';
import CardActions from './CardActions';

/**
 * One row in the Feed's card list: rounded thumbnail (or a dark
 * placeholder if the card has no image), bold headline, muted caption,
 * small muted-gray uppercase topic label, relative timestamp, and (Phase
 * 4, Prompt 3) an Approve/Edit/Skip/Share action row underneath.
 *
 * `editing` lives here rather than inside CardActions so this component
 * can hide the clamped caption <p> while an edit is in progress — showing
 * both it and the edit textarea at once would just be confusing.
 *
 * `onCardUpdate(id, patch)` bubbles up to Feed.jsx: `patch.removed` tells
 * the Feed list to drop this card (Approve/Skip both move it out of the
 * default draft-only view), otherwise `patch` is merged into the card in
 * place (an Edit save, which just changes the caption).
 */
export default function CardListItem({ card, onCardUpdate }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const showImage = card.imageUrl && !imageFailed;

  return (
    <Card className="feed-card">
      <div className="feed-card-thumb">
        {showImage ? (
          <img
            src={card.imageUrl}
            alt=""
            className="feed-card-thumb-img"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <IconImagePlaceholder size={26} className="feed-card-thumb-placeholder" />
        )}
      </div>

      <div className="feed-card-body">
        <div className="feed-card-meta">
          <span className="feed-card-topic">{card.topicLabel}</span>
          <span className="feed-card-dot" aria-hidden="true">
            &middot;
          </span>
          <span className="feed-card-time">{formatRelativeTime(card.createdAt)}</span>
        </div>
        <h3 className="feed-card-title">{card.title}</h3>
        {!editing && card.caption ? <p className="feed-card-caption">{card.caption}</p> : null}

        {/* Manual Create cards only: the context + suggested angle Gemini
            generates alongside the caption. This was being saved to the
            database (cards.enrichment_note) but never actually rendered
            anywhere — silently discarding the main value-add of "AI
            enriches with context/sources" from the Create mode spec. */}
        {!editing && card.enrichmentNote ? (
          <div className="feed-card-enrichment">
            {card.enrichmentNote.split(' | ').map((line, i) => (
              <p key={i} className="feed-card-enrichment-line">
                {line}
              </p>
            ))}
          </div>
        ) : null}

        <CardActions
          card={card}
          editing={editing}
          onEditingChange={setEditing}
          onCardUpdate={onCardUpdate}
        />
      </div>
    </Card>
  );
}
