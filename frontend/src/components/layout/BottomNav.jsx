import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IconFeed, IconCreate, IconTips, IconHistory } from '../icons/Icons';

const NAV_ITEMS = [
  { to: '/feed', label: 'Feed', Icon: IconFeed },
  { to: '/create', label: 'Create', Icon: IconCreate },
  { to: '/tips-facts', label: 'Tips & Facts', Icon: IconTips },
  { to: '/history', label: 'History', Icon: IconHistory }
];

/**
 * Floating pill-shaped bottom nav with 4 fixed items. Active item gets a
 * filled icon + brighter label; inactive items are muted outline icons.
 */
export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {NAV_ITEMS.map(({ to, label, Icon }) => {
        const active = pathname.startsWith(to);
        return (
          <button
            key={to}
            type="button"
            className={`bottom-nav-item ${active ? 'bottom-nav-item-active' : ''}`}
            onClick={() => navigate(to)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={22} filled={active} />
            <span className="bottom-nav-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
