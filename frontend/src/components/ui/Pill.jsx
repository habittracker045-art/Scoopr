import React from 'react';

/**
 * Small uppercase label used for topic tags (e.g. "TECH") and selector pills.
 * Pass `active` to invert to a filled white pill (selected state).
 * Pass `onClick` to make it interactive (adds hover affordance + button semantics).
 */
export default function Pill({ children, active = false, onClick, className = '', ...rest }) {
  const classes = [
    'ui-pill',
    active ? 'ui-pill-active' : '',
    onClick ? 'ui-pill-selectable' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {children}
      </button>
    );
  }

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
