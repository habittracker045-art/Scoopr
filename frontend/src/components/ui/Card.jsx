import React from 'react';

/**
 * Base rounded surface. Pass `bordered` for a hairline border variant
 * (used sparingly — the design system prefers surface contrast over borders).
 */
export default function Card({ children, bordered = false, className = '', ...rest }) {
  const classes = ['ui-card', bordered ? 'ui-card-bordered' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
