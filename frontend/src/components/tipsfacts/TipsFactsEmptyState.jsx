import React from 'react';
import { Card, Button, Spinner } from '../ui';

/**
 * Tips & Facts' starting state (Redesign Phase, Prompt 4). Previously
 * this only ever showed up when the fetched list was genuinely empty
 * (a new account, or dev/test data). As of this prompt it's the tab's
 * default entry point on every load — the tab no longer fetches or
 * shows the historical list at all (per the "no pile-up" direction), so
 * there's always a clean starting state here rather than a list, until
 * the user generates something. Unlike FeedEmptyState (which points to
 * Settings, since bulk generation there isn't built yet), this one
 * triggers generation directly — POST /api/tips-facts/generate is
 * already a self-contained, user-facing action with no setup required.
 */
export default function TipsFactsEmptyState({ onGenerate, generating }) {
  return (
    <Card style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-5)' }}>
      <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 'var(--space-2)' }}>
        Generate a tip or fact
      </p>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 'var(--space-5)'
        }}
      >
        Scoopr will come up with one evergreen tech tip or fact at a time — edit or share
        it, then generate another whenever you like.
      </p>
      <Button onClick={onGenerate} disabled={generating}>
        {generating ? <Spinner size={16} /> : 'Generate a tip or fact'}
      </Button>
    </Card>
  );
}
