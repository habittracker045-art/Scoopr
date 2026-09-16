import React, { useEffect, useState } from 'react';
import { Button, Input, Spinner } from '../ui';
import { IconCheck, IconEdit, IconSkip, IconShare } from '../icons/Icons';
import { updateCard } from '../../api/cardsApi';
import { shareCard } from '../../utils/shareCard';
import { useAuth } from '../../context/AuthContext';

/**
 * Approve / Edit / Skip / Share for one Feed card. Controlled by the
 * parent (CardListItem) for the editing on/off switch, since the parent
 * also needs to know not to render the clamped caption <p> underneath
 * while an edit is in progress.
 *
 * Edit and Approve are two separate taps rather than one combined
 * "save & approve": the spec frames Edit as letting the user fix the
 * caption *before* approving, and keeping them separate means an edit
 * can be saved and reconsidered without also committing to approving it
 * in the same motion — Undo-by-navigation ("just don't tap Approve yet")
 * instead of needing an explicit Undo affordance.
 */
export default function CardActions({ card, editing, onEditingChange, onCardUpdate }) {
  const { token } = useAuth();
  const [draftCaption, setDraftCaption] = useState(card.caption || '');
  const [busy, setBusy] = useState(null); // 'approve' | 'skip' | 'save' | 'share' | null
  const [statusMsg, setStatusMsg] = useState(null);

  // Approve/Skip cause the parent (Feed.jsx) to drop this card from its
  // list — this component unmounts right after. Guards the `finally`
  // state updates below from firing on an already-unmounted component.
  const mountedRef = React.useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // Re-seed the draft whenever editing starts, so re-opening Edit after a
  // save (or after another tab updated the card) starts from the current
  // caption, not a stale one left over from a previous edit session.
  useEffect(() => {
    if (editing) {
      setDraftCaption(card.caption || '');
      setStatusMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function runAction(action, fn) {
    setBusy(action);
    setStatusMsg(null);
    try {
      await fn();
    } catch (err) {
      if (err?.name !== 'AbortError' && mountedRef.current) {
        setStatusMsg(err.message || 'Something went wrong.');
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  function handleApprove() {
    runAction('approve', async () => {
      const { card: updated } = await updateCard({ token, id: card.id, status: 'approved' });
      onCardUpdate(card.id, { ...updated, removed: true });
    });
  }

  function handleSkip() {
    runAction('skip', async () => {
      const { card: updated } = await updateCard({ token, id: card.id, status: 'skipped' });
      onCardUpdate(card.id, { ...updated, removed: true });
    });
  }

  function handleSaveEdit() {
    const trimmed = draftCaption.trim();
    if (!trimmed) {
      setStatusMsg("Caption can't be empty.");
      return;
    }
    runAction('save', async () => {
      const { card: updated } = await updateCard({ token, id: card.id, caption: trimmed });
      onCardUpdate(card.id, updated);
      onEditingChange(false);
    });
  }

  function handleCancelEdit() {
    setDraftCaption(card.caption || '');
    setStatusMsg(null);
    onEditingChange(false);
  }

  function handleShare() {
    runAction('share', async () => {
      const result = await shareCard(card);
      setStatusMsg(result.message);
    });
  }

  if (editing) {
    return (
      <div className="card-actions card-actions-editing">
        <Input
          as="textarea"
          value={draftCaption}
          onChange={(e) => setDraftCaption(e.target.value)}
          placeholder="Card caption"
          rows={3}
          autoFocus
        />
        <div className="card-actions-row">
          <Button size="sm" variant="primary" onClick={handleSaveEdit} disabled={busy === 'save'}>
            {busy === 'save' ? <Spinner size={14} /> : 'Save'}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleCancelEdit} disabled={busy === 'save'}>
            Cancel
          </Button>
        </div>
        {statusMsg && <p className="card-actions-status">{statusMsg}</p>}
      </div>
    );
  }

  return (
    <div className="card-actions">
      <div className="card-actions-row">
        <Button size="sm" variant="primary" onClick={handleApprove} disabled={busy !== null}>
          {busy === 'approve' ? (
            <Spinner size={14} />
          ) : (
            <>
              <IconCheck size={16} /> Approve
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onEditingChange(true)}
          disabled={busy !== null}
        >
          <IconEdit size={16} /> Edit
        </Button>
        <Button size="sm" variant="secondary" onClick={handleSkip} disabled={busy !== null}>
          {busy === 'skip' ? (
            <Spinner size={14} />
          ) : (
            <>
              <IconSkip size={16} /> Skip
            </>
          )}
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
      {statusMsg && <p className="card-actions-status">{statusMsg}</p>}
    </div>
  );
}
