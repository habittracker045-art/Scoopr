/**
 * Registers /sw.js in the background (Phase 5, Prompt 2).
 *
 * Deliberately defensive: a service worker is "nice to have" (fast
 * repeat loads, installability), never "must have" — a failed or
 * unsupported registration must not block or break rendering the app.
 * Called once from main.jsx, after the initial render kicks off.
 */
export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    // Unsupported browser (or SSR/test environment) — silently skip.
    return;
  }

  // Wait for the load event so registration never competes with the
  // initial page render/paint for resources.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Fail silently from the user's perspective — just a console
      // warning for whoever's debugging. The app works fine without it.
      console.warn('Scoopr: service worker registration failed; continuing without it.', error);
    });
  });
}
