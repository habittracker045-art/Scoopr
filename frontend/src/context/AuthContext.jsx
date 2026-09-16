import React, { createContext, useContext, useEffect, useState } from 'react';
import { getMe } from '../api/authApi';
import { getSchedule } from '../api/scheduleApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('scoopr_token'));
  const [user, setUser] = useState(null);

  // Onboarding (Phase 4, Prompt 7): null = not yet known, true/false once
  // resolved. Inferred from GET /api/schedule's `hasSchedule` — a user who
  // has never saved a schedule_settings row (e.g. straight after signup)
  // hasn't completed onboarding yet; one who has (including via the
  // onboarding flow itself, which saves one on finish) has. No separate
  // "onboarded" column needed — this mirrors the existing table's own
  // "no row = not scheduled" convention (see routes/schedule.js).
  const [onboardingComplete, setOnboardingComplete] = useState(null);

  // Polish pass (Phase 4, Prompt 7): `loading` used to be its own bit of
  // state, set to `false` in the fetch effect's `finally` — but never
  // reset back to `true` when `token` changed *after* the initial mount
  // (e.g. the instant after login/signup). Since it was already `false`
  // from the first, logged-out render, routes guarded on it would render
  // for one frame before `user`/`onboardingComplete` had actually loaded.
  // Deriving it instead — true whenever there's a token but the session
  // (user) or onboarding status isn't resolved yet — makes it correct by
  // construction on every render, with no separate flag to fall out of
  // sync with the state it's supposed to describe.
  const loading = Boolean(token) && (user === null || onboardingComplete === null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      if (!token) {
        if (!cancelled) {
          setUser(null);
          setOnboardingComplete(null);
        }
        return;
      }

      try {
        const data = await getMe(token);
        if (cancelled) return;
        setUser(data.user);

        try {
          const scheduleData = await getSchedule({ token });
          if (!cancelled) setOnboardingComplete(Boolean(scheduleData.hasSchedule));
        } catch (err) {
          // Don't let a failed onboarding-status check log the user out or
          // trap them — fail open (treat as already onboarded) so a
          // transient network hiccup can't wedge every screen behind
          // /onboarding. The real gate is still there next successful load.
          console.error('Failed to load onboarding status:', err.message);
          if (!cancelled) setOnboardingComplete(true);
        }
      } catch {
        if (cancelled) return;
        localStorage.removeItem('scoopr_token');
        setToken(null);
        setUser(null);
        setOnboardingComplete(null);
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function loginSuccess(newToken, newUser) {
    localStorage.setItem('scoopr_token', newToken);
    setToken(newToken);
    setUser(newUser);
    // Unknown until the effect above re-checks it for this (possibly
    // different) user — resetting it here matters if someone logs out and
    // straight back in as someone else without a full page reload, so a
    // previous session's "onboarded" status can't leak into the new one
    // and skip the new user's first-run flow.
    setOnboardingComplete(null);
  }

  function logout() {
    localStorage.removeItem('scoopr_token');
    setToken(null);
    setUser(null);
    setOnboardingComplete(null);
  }

  // Called by the onboarding flow right after it successfully saves the
  // user's initial schedule_settings row, so the router can immediately
  // stop redirecting to /onboarding without waiting on a second
  // GET /api/schedule round trip.
  function markOnboardingComplete() {
    setOnboardingComplete(true);
  }

  return (
    <AuthContext.Provider
      value={{ token, user, loading, onboardingComplete, loginSuccess, logout, markOnboardingComplete }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
