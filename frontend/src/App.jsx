import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { LoadingScreen } from './components/ui';
import AppShell from './components/layout/AppShell';

import Login from './pages/Login';
import Signup from './pages/Signup';
import Feed from './pages/Feed';
import Create from './pages/Create';
import TipsFacts from './pages/TipsFacts';
import History from './pages/History';
import Settings from './pages/Settings';
import Account from './pages/Account';
import Admin from './pages/Admin';
import Onboarding from './pages/Onboarding';

/**
 * Root path: routes a signed-in user to onboarding (if they haven't
 * completed it yet) or the feed, and everyone else to login.
 */
function RootRedirect() {
  const { token, loading, onboardingComplete } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (onboardingComplete === false) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/feed" replace />;
}

/**
 * Layout route for every authenticated screen. Redirects to /login if
 * there's no valid session, and to /onboarding if the session is valid
 * but the user hasn't completed first-run onboarding yet (Phase 4,
 * Prompt 7) — so navigating (or deep-linking) straight to /feed,
 * /settings, etc. can't skip past it. Otherwise renders the app shell
 * (profile menu + bottom nav) around whichever tab is active via
 * <Outlet />.
 */
function ProtectedLayout() {
  const { token, loading, onboardingComplete } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (onboardingComplete === false) return <Navigate to="/onboarding" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/**
 * Guard around /onboarding itself: requires a session (same as
 * ProtectedLayout), but — unlike ProtectedLayout — renders the flow with
 * no AppShell (no bottom nav, no profile menu) since the user hasn't
 * picked topics/settings yet and shouldn't be able to hop to other tabs
 * mid-flow. A user who has already completed onboarding is bounced to
 * /feed instead of being able to redo it by navigating here directly.
 */
function OnboardingRoute() {
  const { token, loading, onboardingComplete } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (onboardingComplete === true) return <Navigate to="/feed" replace />;
  return <Onboarding />;
}

/** Extra guard around /admin — only role 'admin' may render it. */
function AdminRoute() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/feed" replace />;
  return <Admin />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<OnboardingRoute />} />

      <Route element={<ProtectedLayout />}>
        <Route path="/feed" element={<Feed />} />
        <Route path="/create" element={<Create />} />
        <Route path="/tips-facts" element={<TipsFacts />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<AdminRoute />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
