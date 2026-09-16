import React from 'react';

/**
 * Primary/secondary button per the Scoopr design system.
 * variant: 'primary' | 'secondary'
 * size: 'md' | 'sm'
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  type = 'button',
  ...rest
}) {
  const classes = [
    'ui-btn',
    variant === 'secondary' ? 'ui-btn-secondary' : 'ui-btn-primary',
    size === 'sm' ? 'ui-btn-sm' : '',
    fullWidth ? 'ui-btn-full' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
