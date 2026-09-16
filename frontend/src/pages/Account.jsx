import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useInstallPrompt } from '../context/InstallPromptContext';
import { Button, Card, Pill } from '../components/ui';

const STATUS_LABEL = {
  active: 'Active',
  disabled: 'Disabled'
};

/**
 * Account tab (Phase 4, Prompt 6) — lives behind the profile menu for
 * every signed-in user, admin or not (see ProfileMenu.jsx / App.jsx's
 * /account route, both already wired since Prompt 1).
 *
 * Read-only profile info straight from AuthContext's `user` (already
 * loaded via GET /api/me on session start — no new fetch needed here),
 * plus two actions:
 *  1. Log out — clears the token via AuthContext.logout() and redirects
 *     to /login.
 *  2. A password-reset notice, not a form: per the Phase 1 architecture
 *     decision, there is no self-serve reset endpoint — only admins can
 *     trigger one (POST /api/admin/reset-password/:userId, see Admin.jsx).
 *     This page just states that plainly rather than pretending a form
 *     exists.
 */
export default function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { canInstall, promptInstall } = useInstallPrompt();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  async function handleInstall() {
    await promptInstall();
  }

  return (
    <div className="account-page">
      <h1 className="page-heading">Account</h1>

      <Card className="account-section">
        <div className="account-field">
          <p className="ui-label">Username</p>
          <p className="account-field-value">{user?.username}</p>
        </div>
        <div className="account-field">
          <p className="ui-label">Email</p>
          <p className="account-field-value">{user?.email}</p>
        </div>
        <div className="account-field">
          <p className="ui-label">Role</p>
          <Pill>{user?.role}</Pill>
        </div>
        <div className="account-field">
          <p className="ui-label">Status</p>
          <Pill>{STATUS_LABEL[user?.status] || user?.status}</Pill>
        </div>
      </Card>

      <Card className="account-section account-password-notice">
        <p className="account-row-label">Password</p>
        <p className="account-row-hint">Need a password reset? Contact an admin.</p>
      </Card>

      {/*
        Phase 5, Prompt 2: manual fallback for anyone who dismissed the
        AppShell install banner (or never saw it — this only renders once
        the browser has actually fired `beforeinstallprompt`, so unsupported
        browsers / already-installed sessions never see a broken button).
      */}
      {canInstall && (
        <Card className="account-section account-password-notice">
          <p className="account-row-label">Install app</p>
          <p className="account-row-hint">Add Scoopr to your home screen for quick, full-screen access.</p>
          <Button variant="secondary" onClick={handleInstall} fullWidth>
            Install Scoopr
          </Button>
        </Card>
      )}

      <Button variant="secondary" onClick={handleLogout} fullWidth>
        Log out
      </Button>
    </div>
  );
}
