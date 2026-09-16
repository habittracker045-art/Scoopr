import React, { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createCard } from '../api/createApi';
import { Button, Input, Pill, Spinner } from '../components/ui';
import CarouselCard from '../components/feed/CarouselCard';
import { FEED_TOPICS } from '../config/topics';

// Same topic list the Feed's TopicFilter draws from, minus the 'all'
// pseudo-topic — that only makes sense as a *filter* (Feed), not as
// something you'd pick when creating one specific card.
const CREATE_TOPICS = FEED_TOPICS.filter((t) => t.key !== 'all');

/**
 * Create tab — manual "type an idea, Gemini enriches it" flow,
 * POST /api/create (Phase 3, Prompt 2's backend).
 *
 * Redesign Phase, Prompt 3: this used to hand the freshly-generated card
 * straight to <CardListItem>/<CardActions> (the pre-redesign Feed row —
 * bold headline + a *clamped* caption, Approve/Edit/Skip/Share, and
 * Edit that only ever touched the caption). That meant Create mode's
 * actual output — the AI-generated context + suggested source angle the
 * backend already computes and saves to cards.enrichment_note — was
 * being generated, stored, and then never shown. That was the main
 * complaint: Create felt thin because you never actually saw what it
 * produced.
 *
 * Fix: reuse <CarouselCard>, the exact component R2 built for the Feed
 * carousel, completely unmodified. It already does everything this
 * prompt asks for — full headline + caption + enrichment note (context
 * and suggested angle, clearly laid out, hairline-divided from the
 * caption) when the card has one, Edit + Share only (no Approve/Skip),
 * and an Edit form that opens the headline, caption, *and* the
 * enrichment note text (when present) for editing, saving through the
 * same PATCH /api/cards/:id every other Edit action uses. Pulling in
 * the Feed tab's own component (rather than re-implementing the same
 * layout a second time here) is what guarantees the two screens render
 * enrichment_note identically — see that file for the full layout/edit
 * logic. routes/create.js's response is already shaped compatibly with
 * cardsApi's cards (id/topicLabel/enrichmentNote/etc.), so no backend or
 * API-layer changes were needed for this reuse to work.
 *
 * <CardListItem>/<CardActions> (Approve/Edit/Skip/Share, caption-only
 * Edit) are no longer used anywhere after this change — Feed itself
 * already moved to <CarouselCard> in R2. They're left in place
 * unmodified rather than deleted, since removing shared feed/
 * components is outside this prompt's scope (see the README).
 *
 * Only one generated result is kept on screen at a time (`result`,
 * replaced — not appended to a list — on every successful Generate).
 * See the README for why: a full card (image, headline, caption,
 * enrichment note, actions) is a lot of vertical space per card, and
 * Create is a single-focus "type an idea, look at what came back" loop,
 * not a queue to review in bulk like Feed's — stacking several full
 * cards would work against that focus rather than support it. The
 * underlying database rows aren't affected either way: every generated
 * card is already saved (status 'draft') regardless of whether this
 * page keeps showing it.
 */
export default function Create() {
  const { token } = useAuth();

  const [ideaText, setIdeaText] = useState('');
  const [topic, setTopic] = useState(CREATE_TOPICS[0].key);
  const [result, setResult] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = useCallback(
    async (e) => {
      e.preventDefault();
      const trimmed = ideaText.trim();
      if (!trimmed || generating) return;

      setGenerating(true);
      setError(null);
      try {
        const { card } = await createCard({ token, ideaText: trimmed, topic });
        setResult(card);
        setIdeaText(''); // clear the input so the user can create another
      } catch (err) {
        setError(err.message || 'Something went wrong generating that card.');
      } finally {
        setGenerating(false);
      }
    },
    [ideaText, topic, token, generating]
  );

  // Same contract CarouselCard already expects from the Feed carousel:
  // `patch` is merged into the current result in place (an Edit save).
  // CarouselCard never sends `patch.removed` (there's no Approve/Skip
  // here to remove a card), but the id check keeps this a no-op if a
  // stale callback from a previous card ever fired after Generate
  // replaced `result` with a new one.
  const handleCardUpdate = useCallback((id, patch) => {
    setResult((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <div className="create-page">
      <h1 className="page-heading">Create</h1>

      <form className="create-form" onSubmit={handleGenerate}>
        <Input
          as="textarea"
          value={ideaText}
          onChange={(e) => setIdeaText(e.target.value)}
          placeholder="What's your idea?"
          rows={4}
          disabled={generating}
        />

        <div className="create-topic-picker" role="radiogroup" aria-label="Topic">
          {CREATE_TOPICS.map((t) => (
            <Pill
              key={t.key}
              active={topic === t.key}
              onClick={() => setTopic(t.key)}
              role="radio"
              aria-checked={topic === t.key}
              disabled={generating}
            >
              {t.label}
            </Pill>
          ))}
        </div>

        <Button type="submit" fullWidth disabled={generating || !ideaText.trim()}>
          {generating ? <Spinner size={16} /> : 'Generate'}
        </Button>

        {error && <p className="create-error">{error}</p>}
      </form>

      {result && (
        <div className="create-result">
          <CarouselCard card={result} onCardUpdate={handleCardUpdate} />
        </div>
      )}
    </div>
  );
}
