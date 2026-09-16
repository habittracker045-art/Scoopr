import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

/**
 * Shares the browser's `beforeinstallprompt` event across the app (Phase
 * 5, Prompt 2) so both the dismissible banner (AppShell) and the manual
 * "Install Scoopr" button (Account tab) can trigger the same install
 * flow, without either one holding its own copy of the deferred event.
 *
 * The event only fires when the browser decides the app is installable
 * AND not already installed — plenty of cases (Safari, an already-
 * installed PWA, a browser that just doesn't support it) never fire it
 * at all. `canInstall` starts `false` and only flips to `true` once the
 * event actually arrives, so anything reading it defaults to rendering
 * nothing rather than a broken button.
 */
const InstallPromptContext = createContext({
  canInstall: false,
  isInstalled: false,
  promptInstall: async () => 'unavailable'
});

export function InstallPromptProvider({ children }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    // Covers the "already installed" case up front — standalone display
    // mode on Android/desktop Chrome, or `navigator.standalone` on iOS
    // Safari — so an already-installed session never shows install UI.
    const standaloneQuery = window.matchMedia
      ? window.matchMedia('(display-mode: standalone)')
      : null;
    setIsInstalled(Boolean(standaloneQuery?.matches) || window.navigator?.standalone === true);

    function handleBeforeInstallPrompt(event) {
      // Stop the browser's own mini-infobar so Scoopr's own UI is the
      // one deliberate way to trigger install, per this prompt's spec.
      event.preventDefault();
      setDeferredPrompt(event);
    }

    function handleAppInstalled() {
      setDeferredPrompt(null);
      setIsInstalled(true);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return 'unavailable';
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The captured event can only be used once — clear it either way.
    setDeferredPrompt(null);
    return outcome; // 'accepted' | 'dismissed'
  }, [deferredPrompt]);

  const value = {
    canInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    promptInstall
  };

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
}

export function useInstallPrompt() {
  return useContext(InstallPromptContext);
}
