import React from 'react';
import { Card, Skeleton } from '../ui';

/** Matches HistoryListItem's compact layout (thumb + body + share button) so loading -> loaded doesn't jump around. */
export default function HistoryListItemSkeleton() {
  return (
    <Card className="history-item">
      <div className="history-item-row">
        <Skeleton width={40} height={40} style={{ borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
        <div className="history-item-body">
          <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
          <Skeleton width={120} height={10} />
        </div>
        <Skeleton width={32} height={32} style={{ borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
      </div>
    </Card>
  );
}
