import React from 'react';

/** Small rotating ring spinner. */
export function Spinner({ size = 20, className = '', ...rest }) {
  return (
    <span
      className={`ui-spinner ${className}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
      {...rest}
    />
  );
}

/** Pulsing placeholder block — pass width/height for the shape you're standing in for. */
export function Skeleton({ width = '100%', height = 16, className = '', style, ...rest }) {
  return (
    <span
      className={`ui-skeleton ${className}`}
      style={{ display: 'block', width, height, ...style }}
      {...rest}
    />
  );
}

/** Centered full-height spinner — used while auth/session state is resolving. */
export function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)'
      }}
    >
      <Spinner size={28} />
    </div>
  );
}
