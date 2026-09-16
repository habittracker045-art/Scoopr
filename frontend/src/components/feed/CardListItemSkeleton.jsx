import React from 'react';
import { Card, Skeleton } from '../ui';

/** Matches CardListItem's layout so loading -> loaded doesn't jump around. */
export default function CardListItemSkeleton() {
  return (
    <Card className="feed-card">
      <Skeleton width={56} height={56} style={{ borderRadius: 'var(--radius-md)', flexShrink: 0 }} />
      <div className="feed-card-body">
        <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
        <Skeleton width="85%" height={16} style={{ marginBottom: 8 }} />
        <Skeleton width="60%" height={13} />
      </div>
    </Card>
  );
}
