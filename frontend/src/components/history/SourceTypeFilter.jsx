import React from 'react';
import { Pill } from '../ui';
import { HISTORY_SOURCE_TYPES } from '../../config/sourceTypes';

/**
 * Horizontal, scrollable row of source-type-filter pills (Redesign
 * Phase, Prompt 6) — same pattern as components/history/StatusFilter.jsx
 * and components/feed/TopicFilter.jsx (down to reusing the shared
 * `.topic-filter` CSS class, since the layout — a scrollable row of
 * small uppercase pills — is identical, just with a different option
 * list). Sits at the top of the History tab, alongside TopicFilter.
 */
export default function SourceTypeFilter({ value, onChange }) {
  return (
    <div className="topic-filter" role="tablist" aria-label="Filter history by source">
      {HISTORY_SOURCE_TYPES.map((sourceType) => (
        <Pill
          key={sourceType.key}
          active={value === sourceType.key}
          onClick={() => onChange(sourceType.key)}
          role="tab"
          aria-selected={value === sourceType.key}
        >
          {sourceType.label}
        </Pill>
      ))}
    </div>
  );
}
