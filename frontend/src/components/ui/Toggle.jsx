import React from 'react';

/**
 * Controlled on/off switch. `checked` and `onChange(nextValue)` follow the
 * usual controlled-input pattern.
 */
export default function Toggle({ checked = false, onChange, disabled = false, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-on={checked}
      disabled={disabled}
      className="ui-toggle"
      onClick={() => onChange && onChange(!checked)}
      {...rest}
    >
      <span className="ui-toggle-thumb" />
    </button>
  );
}
