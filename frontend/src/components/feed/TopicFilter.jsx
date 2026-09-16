import React from 'react';
import { Pill } from '../ui';
import { FEED_TOPICS } from '../../config/topics';

/**
 * Horizontal, scrollable row of topic-filter pills (per the design system:
 * small uppercase muted-gray labels, filled white when active). Sits at
 * the top of the Feed tab.
 */
export default function TopicFilter({ value, onChange }) {
  return (
    <div className="topic-filter" role="tablist" aria-label="Filter feed by topic">
      {FEED_TOPICS.map((topic) => (
        <Pill
          key={topic.key}
          active={value === topic.key}
          onClick={() => onChange(topic.key)}
          role="tab"
          aria-selected={value === topic.key}
        >
          {topic.label}
        </Pill>
      ))}
    </div>
  );
}
