import React, { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateTipsFacts } from '../api/tipsFactsApi';
import { Button, Spinner } from '../components/ui';
import TipFactCard from '../components/tipsfacts/TipFactCard';
import TipsFactsEmptyState from '../components/tipsfacts/TipsFactsEmptyState';

/**
 * Tips & Facts tab — Redesign Phase, Prompt 4: "no pile-up, generate one
 * at a time."
 *
 * Before this prompt, loading this tab called GET /api/tips-facts and
 * rendered every saved row as a growing, appended list (newest first),
 * with "Generate more" adding another 5 on top. Per updated direction,
 * that's gone: this tab now never fetches or displays the historical
 * list at all. It opens on a clean starting state (<TipsFactsEmptyState>,
 * "Generate a tip or fact"), and holds at most ONE tip/fact in memory at
 * a time (`item`) — generating always REPLACES whatever's currently
 * shown rather than appending to anything. This mirrors exactly how
 * Create.jsx's `result` state works (see that file and its R3 README
 * section) — single value, replaced on every successful Generate, same
 * "type/tap, look closely at the one thing that came back" shape.
 *
 * Every generate call now explicitly requests `count: 1` (routes/
 * tipsFacts.js's `count` param already existed and was already plumbed
 * through to Gemini — see services/tipsFactsGenerator.js — so this only
 * required a frontend change) instead of relying on the backend's
 * default batch size of 5. The response is still `{ tipsFacts: [...] }`
 * (an array, for API-shape consistency with before), just requested and
 * used as a single item now: `data.tipsFacts[0]`.
 *
 * Editing is new here too: <TipFactCard> now has an Edit action
 * alongside Share (previously Share-only), saving through the new
 * PATCH /api/tips-facts/:id endpoint. This page's role in that is the
 * same `onCardUpdate`-style callback Create.jsx uses for <CarouselCard>:
 * `handleItemUpdate` merges the saved row into `item` by id, so a
 * successful edit is reflected immediately without a refetch.
 *
 * GET /api/tips-facts and the "browse everything ever generated" idea it
 * implied are still available on the backend (untouched, in case
 * something else wants them later) but are simply no longer called from
 * here.
 */
export default function TipsFacts() {
  const { token } = useAuth();

  const [item, setItem] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generateTipsFacts({ token, count: 1 });
      const [fresh] = data.tipsFacts || [];
      if (!fresh) {
        setError("Didn't get a confident tip or fact back — try generating again.");
        return;
      }
      setItem(fresh);
    } catch (err) {
      setError(err.message || 'Something went wrong generating that.');
    } finally {
      setGenerating(false);
    }
  }, [token]);

  const handleItemUpdate = useCallback((updated) => {
    setItem((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }, []);

  return (
    <div className="tips-facts-page">
      <h1 className="page-heading">Tips &amp; Facts</h1>

      {error && <p className="tips-facts-error">{error}</p>}

      {item ? (
        <>
          <TipFactCard item={item} onItemUpdate={handleItemUpdate} />
          <Button onClick={handleGenerate} disabled={generating} fullWidth>
            {generating ? <Spinner size={16} /> : 'Generate another'}
          </Button>
        </>
      ) : (
        <TipsFactsEmptyState onGenerate={handleGenerate} generating={generating} />
      )}
    </div>
  );
}
