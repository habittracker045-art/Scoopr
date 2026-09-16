import React from 'react';
import { Card } from '../ui';

/**
 * Shared placeholder for tabs/sections whose real content lands in a later
 * Phase 4 prompt. Keeps the page header + card pattern consistent everywhere.
 */
export default function ComingSoon({ title, description }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700 }}>{title}</h1>
      <Card style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-5)' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
          {description || 'Coming soon.'}
        </p>
      </Card>
    </div>
  );
}
