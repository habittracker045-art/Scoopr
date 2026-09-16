import React, { useState } from 'react';
import { Card, Button, Input, Spinner } from '../ui';
import { IconImagePlaceholder, IconEdit, IconShare } from '../icons/Icons';
import { formatRelativeTime } from '../../utils/relativeTime';
import { shareCard } from '../../utils/shareCard';
import { updateCard } from '../../api/cardsApi';
import { useAuth } from '../../context/AuthContext';

/**
 * Best-effort "via <source>" label for auto-pipeline cards sourced from a
 * real URL (e.g. "via techcrunch.com"). Manually-created cards have no
 * sourceUrl, so they get no label at all — there's nothing accurate to
 * show. Falls back to null (render nothing) if sourceUrl isn't a parsable
 * absolute URL for any reason, rather than showing a broken label.
 */
function deriveSourceLabel(sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
    return host ? `via ${host}` : null;
  } catch {
    return null;
  }
}

/**
 * One card in the Feed carousel (Redesign Phase, Prompt 2). Unlike the
 * old Feed list's <CardListItem>/<CardActions> (still used, unmodified,
 * by the Create tab — see that file's header comment), this is a new,
 * purpose-built component: large centered image, bigger type, and only
 * Edit + Share — there's no Approve/Skip here since the carousel is a
 * fixed "6 most recent" snapshot, not a queue to clear.
 *
 * Edit opens the FULL card — headline, caption, and (only when the card
 * already has one) the enrichment note — unlike CardActions' Edit, which
 * only ever touched the caption. Saves through the same
 * PATCH /api/cards/:id endpoint (extended, additively, to also accept
 * `title`/`enrichmentNote` — see routes/cards.js).
 *
 * Share reuses utils/shareCard.js completely unmodified — it only needs
 * a plain {title, caption, imageUrl, sourceUrl} object, which this card
 * already has.
 *
 * Mounted with `key={card.id}` by CardCarousel, so navigating to a
 * different card remounts this component fresh — editing state, the
 * image-load-failed flag, and any status message never leak from one
 * card to the next. A save that mutates the *current* card in place
 * (same id, same mount) is handled explicitly below instead.
 */
export default function CarouselCard({ card, onCardUpdate }) {
  const { token } = useAuth();

  const [imageFailed, setImageFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(card.title || '');
  const [draftCaption, setDraftCaption] = useState(card.caption || '');
  const [draftNote, setDraftNote] = useState(card.enrichmentNote || '');
  const [busy, setBusy] = useState(null); // 'save' | 'share' | null
  const [statusMsg, setStatusMsg] = useState(null);

  const showImage = card.imageUrl && !imageFailed;
  const hasEnrichment = Boolean(card.enrichmentNote);
  const sourceLabel = deriveSourceLabel(card.sourceUrl);

  function startEdit() {
    setDraftTitle(card.title || '');
    setDraftCaption(card.caption || '');
    setDraftNote(card.enrichmentNote || '');
    setStatusMsg(null);
    setEditing(true);
  }

  function cancelEdit() {
    setStatusMsg(null);
    setEditing(false);
  }

  async function saveEdit() {
    const title = draftTitle.trim();
    const caption = draftCaption.trim();

    if (!title) {
      setStatusMsg("Headline can't be empty.");
      return;
    }
    if (!caption) {
      setStatusMsg("Caption can't be empty.");
      return;
    }

    setBusy('save');
    setStatusMsg(null);
    try {
      const payload = { token, id: card.id, title, caption };
      // Only send enrichmentNote back if the card had one to begin with
      // — this form never offers to *add* a note to a card that never
      // had one, per spec ("if present, the enrichment note").
      if (hasEnrichment) payload.enrichmentNote = draftNote.trim();

      const { card: updated } = await updateCard(payload);
      onCardUpdate(card.id, updated);
      setEditing(false);
    } catch (err) {
      setStatusMsg(err.message || 'Something went wrong saving that card.');
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    setBusy('share');
    setStatusMsg(null);
    try {
      const result = await shareCard(card);
      setStatusMsg(result.message);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatusMsg(err.message || 'Something went wrong sharing that card.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="carousel-card">
      <div className="carousel-card-media">
        {showImage ? (
          <img
            src={card.imageUrl}
            alt=""
            className="carousel-card-img"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="carousel-card-img-fallback">
            <IconImagePlaceholder size={40} />
          </div>
        )}
      </div>

      <div className="carousel-card-body">
        <div className="carousel-card-meta">
          <span className="carousel-card-topic">{card.topicLabel}</span>
          <span className="carousel-card-dot" aria-hidden="true">
            &middot;
          </span>
          <span className="carousel-card-time">{formatRelativeTime(card.createdAt)}</span>
        </div>

        {editing ? (
          <div className="carousel-card-edit">
            <Input
              label="Headline"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={busy === 'save'}
            />
            <Input
              as="textarea"
              label="Caption"
              value={draftCaption}
              onChange={(e) => setDraftCaption(e.target.value)}
              rows={3}
              disabled={busy === 'save'}
            />
            {hasEnrichment && (
              <Input
                as="textarea"
                label="AI context & suggested angle"
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={3}
                disabled={busy === 'save'}
              />
            )}
            <div className="carousel-card-edit-actions">
              <Button size="sm" variant="primary" onClick={saveEdit} disabled={busy === 'save'}>
                {busy === 'save' ? <Spinner size={14} /> : 'Save'}
              </Button>
              <Button size="sm" variant="secondary" onClick={cancelEdit} disabled={busy === 'save'}>
                Cancel
              </Button>
            </div>
            {statusMsg && <p className="carousel-card-status">{statusMsg}</p>}
          </div>
        ) : (
          <>
            <h2 className="carousel-card-title">{card.title}</h2>

            {card.caption ? <p className="carousel-card-caption">{card.caption}</p> : null}

            {/* AI-generated context + suggested source angle
                (cards.enrichment_note) — manually-created cards only.
                Genuinely rendered here (not just fetched and discarded —
                see routes/cards.js's toResponseShape). */}
            {hasEnrichment ? (
              <div className="carousel-card-enrichment">
                {card.enrichmentNote.split(' | ').map((line, i) => (
                  <p key={i} className="carousel-card-enrichment-line">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}

            {sourceLabel ? <p className="carousel-card-source">{sourceLabel}</p> : null}

            <div className="carousel-card-actions">
              <Button size="sm" variant="secondary" onClick={startEdit} disabled={busy !== null}>
                <IconEdit size={16} /> Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={handleShare} disabled={busy !== null}>
                {busy === 'share' ? (
                  <Spinner size={14} />
                ) : (
                  <>
                    <IconShare size={16} /> Share
                  </>
                )}
              </Button>
            </div>
            {statusMsg && <p className="carousel-card-status">{statusMsg}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
