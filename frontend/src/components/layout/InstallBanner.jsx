import React, { useEffect, useState } from 'react';
import { useInstallPrompt } from '../../context/InstallPromptContext';

const DISMISS_KEY = 'scoopr_install_banner_dismissed_at';
const RESHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissedRecently() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < RESHOW_AFTER_MS;
  } catch {
    // Storage unavailable (private browsing, etc.) — just show it.
    return false;
  }
}

/**
 * Small dismissible "Install Scoopr" banner (Phase 5, Prompt 2). Renders
 * nothing unless the browser has actually fired `beforeinstallprompt`
 * (via InstallPromptContext) — so browsers/situations that never fire it
 * (Safari, already installed, etc.) simply never see this banner rather
 * than a broken one.
 *
 * Dismissal is remembered for 7 days via localStorage so it doesn't
 * nag every session, but isn't permanently hidden either — the manual
 * "Install Scoopr" button in the Account tab (Account.jsx) is always
 * available as a fallback for anyone who dismissed this and changes
 * their mind later.
 */
export default function InstallBanner() {
  const { canInstall, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(isDismissedRecently());
  }, []);

  if (!canInstall || dismissed) return null;

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore — worst case the banner reappears next load.
    }
    setDismissed(true);
  }

  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted' || outcome === 'dismissed') {
      // Either way the native prompt has been resolved — don't show our
      // own banner again this "cycle".
      handleDismiss();
    }
  }

  return (
    <div className="install-banner" role="region" aria-label="Install Scoopr">
      <div className="install-banner-text">
        <p className="install-banner-title">Install Scoopr</p>
        <p className="install-banner-hint">Add it to your home screen for quick, full-screen access.</p>
      </div>
      <div className="install-banner-actions">
        <button type="button" className="install-banner-install" onClick={handleInstall}>
          Install
        </button>
        <button
          type="button"
          className="install-banner-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
