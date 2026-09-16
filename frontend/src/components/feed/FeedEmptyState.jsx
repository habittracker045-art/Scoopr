import React from 'react';
import { Link } from 'react-router-dom';
import { Card, Button } from '../ui';

/**
 * Shown when the Feed carousel has zero cards to show at all — e.g. a
 * brand-new account with nothing generated yet.
 *
 * Redesign Phase, Prompt 2: this no longer takes a `filtered` prop.
 * There's no topic filter on the carousel Feed anymore (it always fetches
 * the 6 most recent cards across every topic/status/source), so the old
 * "no cards for this topic" variant no longer applies — an empty Feed
 * always means "nothing generated yet."
 */
export default function FeedEmptyState() {
  return (
    <Card style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-5)' }}>
      <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 'var(--space-2)' }}>
        Your feed is empty
      </p>
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 'var(--space-5)'
        }}
      >
        Scoopr hasn't generated anything for you yet. Head to Settings to set up a schedule or
        generate your first batch now.
      </p>
      <Link to="/settings" style={{ textDecoration: 'none' }}>
        <Button variant="secondary">Go to Settings</Button>
      </Link>
    </Card>
  );
}
