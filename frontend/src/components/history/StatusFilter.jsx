import React from 'react';
import { Pill } from '../ui';
import { HISTORY_STATUSES } from '../../config/statuses';

/**
 * Horizontal, scrollable row of status-filter pills — same pattern as
 * components/feed/TopicFilter.jsx (down to reusing its `.topic-filter`
 * CSS class, since the layout — a scrollable row of small uppercase
 * pills — is identical, just with a different option list). Sits at the
 * top of the History tab, alongside TopicFilter.
 */
export default function StatusFilter({ value, onChange }) {
  return (
    <div className="topic-filter" role="tablist" aria-label="Filter history by status">
      {HISTORY_STATUSES.map((status) => (
        <Pill
          key={status.key}
          active={value === status.key}
          onClick={() => onChange(status.key)}
          role="tab"
          aria-selected={value === status.key}
        >
          {status.label}
        </Pill>
      ))}
    </div>
  );
}
