import React, { useState } from 'react';
import { Card, Button, Input, Spinner } from '../ui';
import { IconEdit, IconShare } from '../icons/Icons';
import { shareCard } from '../../utils/shareCard';
import { updateTipFact } from '../../api/tipsFactsApi';
import { useAuth } from '../../context/AuthContext';

/**
 * The one tip/fact card shown by the Tips & Facts tab (Redesign Phase,
 * Prompt 4). Previously rendered a compact row (label + content + a
 * bare share icon) with no way to edit — Share was the only action.
 *
 * Redesign Phase, Prompt 4 adds Edit alongside Share, following the same
 * self-contained Edit pattern `components/feed/CarouselCard.jsx` uses
 * (also reused unmodified by Create — see that component's header
 * comment): editing state lives entirely in this component, toggled by
 * Edit/Cancel, with its own draft value, save through a PATCH endpoint,
 * and an `onItemUpdate` callback so the parent (TipsFacts.jsx) can merge
 * the saved row into the single item it's holding. Mounted with
 * `key={item.id}` by the parent, same as CarouselCard, so a fresh
 * generate (a new id) always remounts clean rather than carrying over
 * stale editing/status state from the previous card.
 *
 * Edit here only ever touches one field — `content` — since that's all
 * a tip/fact has (no separate headline/caption/note the way a card
 * has). Saves go through PATCH /api/tips-facts/:id (new — see
 * routes/tipsFacts.js), which didn't exist before this prompt.
 *
 * Share is unchanged from before: reuses the same `shareCard()` util
 * Feed/Create use, passed `{ title: item.content, imageUrl: item.imageUrl }`
 * since a tip/fact has no title or link of its own.
 */
export default function TipFactCard({ item, onItemUpdate }) {
  const { token } = useAuth();

  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(item.content || '');
  const [busy, setBusy] = useState(null); // 'save' | 'share' | null
  const [statusMsg, setStatusMsg] = useState(null);

  function startEdit() {
    setDraftContent(item.content || '');
    setStatusMsg(null);
    setEditing(true);
  }

  function cancelEdit() {
    setStatusMsg(null);
    setEditing(false);
  }

  async function saveEdit() {
    const trimmed = draftContent.trim();
    if (!trimmed) {
      setStatusMsg("Content can't be empty.");
      return;
    }

    setBusy('save');
    setStatusMsg(null);
    try {
      const { tipFact: updated } = await updateTipFact({ token, id: item.id, content: trimmed });
      onItemUpdate(updated);
      setEditing(false);
    } catch (err) {
      setStatusMsg(err.message || 'Something went wrong saving that.');
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    setBusy('share');
    setStatusMsg(null);
    try {
      const result = await shareCard({ title: item.content, imageUrl: item.imageUrl });
      setStatusMsg(result.message);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatusMsg(err.message || 'Something went wrong.');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="tip-fact-card">
      <span className="tip-fact-card-label">{item.category === 'fact' ? 'Fact' : 'Tip'}</span>

      {editing ? (
        <div className="tip-fact-card-edit">
          <Input
            as="textarea"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            rows={4}
            autoFocus
            disabled={busy === 'save'}
          />
          <div className="tip-fact-card-edit-actions">
            <Button size="sm" variant="primary" onClick={saveEdit} disabled={busy === 'save'}>
              {busy === 'save' ? <Spinner size={14} /> : 'Save'}
            </Button>
            <Button size="sm" variant="secondary" onClick={cancelEdit} disabled={busy === 'save'}>
              Cancel
            </Button>
          </div>
          {statusMsg && <p className="tip-fact-card-status">{statusMsg}</p>}
        </div>
      ) : (
        <>
          <p className="tip-fact-card-content">{item.content}</p>

          <div className="tip-fact-card-actions">
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
          {statusMsg && <p className="tip-fact-card-status">{statusMsg}</p>}
        </>
      )}
    </Card>
  );
}
