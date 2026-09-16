import React from 'react';
import ProfileMenu from './ProfileMenu';
import BottomNav from './BottomNav';
import InstallBanner from './InstallBanner';

/**
 * Wraps every authenticated screen with the profile avatar (top-right) and
 * the floating bottom nav. Page content is centered with room reserved at
 * top/bottom so it never sits under either fixed element.
 *
 * Phase 5, Prompt 2: also renders the dismissible "Install Scoopr" banner
 * at the top of the content area. InstallBanner renders nothing of its
 * own accord when the browser hasn't offered an install prompt, so this
 * is safe to always mount here.
 */
export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <ProfileMenu />
      <main className="app-shell-content">
        <InstallBanner />
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
