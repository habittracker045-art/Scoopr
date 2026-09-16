import React from 'react';

/*
 * Small self-contained icon set — no icon library dependency.
 * Every icon supports a `filled` prop: outline (stroke only) for inactive
 * nav state, solid (fill) for active nav state, per the design system.
 * Icons that have interior detail (Create, History) "punch through" that
 * detail using --color-bg so it reads on the filled shape.
 */

export function IconFeed({ size = 22, filled = false, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <rect x="3" y="4" width="18" height="4" rx="2" />
      <rect x="3" y="10" width="18" height="4" rx="2" />
      <rect x="3" y="16" width="12" height="4" rx="2" />
    </svg>
  );
}

export function IconCreate({ size = 22, filled = false, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.8"
      />
      <path
        d="M12 8v8M8 12h8"
        stroke={filled ? 'var(--color-bg)' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconTips({ size = 22, filled = false, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
      <path
        d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6v.5h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 18h6M10 21h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconHistory({ size = 22, filled = false, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...rest}>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth="1.8"
      />
      <path
        d="M12 7.5v5l3.2 1.8"
        stroke={filled ? 'var(--color-bg)' : 'currentColor'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Phase 4, Prompt 2: dark placeholder glyph shown in a card's thumbnail
// slot when a card has no image_url. Outline-only — never filled, since
// it's a placeholder, not a nav state.
export function IconImagePlaceholder({ size = 22, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4 16.5l5-4.5 3.2 2.8L16 11l4 4.5" />
    </svg>
  );
}

// Phase 4, Prompt 3: card action icons (Approve/Edit/Skip/Share). Same
// outline-only convention as IconImagePlaceholder above — these aren't
// nav items, so there's no `filled` state to support.
export function IconCheck({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function IconEdit({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M4 20l4.2-.9L18.3 8.9a1.5 1.5 0 0 0 0-2.1l-1.1-1.1a1.5 1.5 0 0 0-2.1 0L4.9 15.8 4 20z" />
      <path d="M13.2 6.8l4 4" />
    </svg>
  );
}

export function IconSkip({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconShare({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
    </svg>
  );
}

// Redesign Phase, Prompt 2: Feed carousel prev/next arrow controls. Same
// outline-only convention as the card-action icons above.
export function IconChevronLeft({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconChevronRight({ size = 20, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

// Redesign Phase, Prompt 6: History tab's search box. Same outline-only
// convention as the card-action icons above.
export function IconSearch({ size = 18, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

// Redesign Phase, Prompt 6: clears the History tab's search box.
export function IconClose({ size = 16, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconUser({ size = 22, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.6 4.4-5.4 7.5-5.4s6.1 1.8 7.5 5.4" />
    </svg>
  );
}
