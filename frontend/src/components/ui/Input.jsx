import React from 'react';

let idCounter = 0;
function useStableId(explicitId) {
  const ref = React.useRef(explicitId || `ui-field-${++idCounter}`);
  return ref.current;
}

/**
 * Text input or textarea with an optional uppercase label and error message.
 * Pass `as="textarea"` for a multi-line field.
 */
export default function Input({
  label,
  error,
  as = 'input',
  id,
  className = '',
  ...rest
}) {
  const fieldId = useStableId(id);
  const isTextarea = as === 'textarea';
  const Tag = isTextarea ? 'textarea' : 'input';
  const controlClass = [
    isTextarea ? 'ui-textarea' : 'ui-input',
    error ? (isTextarea ? 'ui-textarea-error' : 'ui-input-error') : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="ui-field">
      {label && (
        <label className="ui-label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <Tag id={fieldId} className={controlClass} {...rest} />
      {error && <span className="ui-error-text">{error}</span>}
    </div>
  );
}
