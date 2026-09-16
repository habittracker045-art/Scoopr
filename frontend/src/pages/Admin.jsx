import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getUsers, resetPassword, setUserRole } from '../api/adminApi';
import { Button, Card, Pill, Spinner } from '../components/ui';

const STATUS_LABEL = {
  active: 'Active',
  disabled: 'Disabled'
};

/**
 * Admin Panel (Phase 4, Prompt 6) - reachable only via the profile menu's
 * "Admin Panel" link, which ProfileMenu.jsx only renders for role
 * 'admin', AND via App.jsx's <AdminRoute> wrapper, which redirects any
 * non-admin straight to /feed if they land on /admin directly (e.g. by
 * typing the URL). Neither of those is the *real* security boundary,
 * though - every request this page makes goes to /api/admin/*, and that
 * whole router is gated server-side by requireAuth + requireRole('admin')
 * (see backend/src/routes/admin.js). A non-admin token gets a 403 from
 * the API regardless of what the frontend does or doesn't show - see
 * this project's README for the full writeup of both layers.
 *
 * Three things, one Card per user:
 *  - The full user list (GET /api/admin/users - Phase 1, unchanged).
 *  - Admin Reset (POST /api/admin/reset-password/:userId - Phase 1,
 *    unchanged): generates a temp password server-side and returns it
 *    exactly once. It's shown here in a one-time confirmation panel and
 *    never persisted anywhere on the frontend (no state variable holds
 *    it past that panel being dismissed) - matching the "no visible
 *    passwords ever" rule everywhere else in the app.
 *  - Role management (PATCH /api/admin/users/:userId/role - new this
 *    prompt): promote/demote between 'member' and 'admin', behind a
 *    confirm step since it's a meaningful permission change. The
 *    logged-in admin's own row has this action disabled - the backend
 *    refuses self role-changes too, so this is just surfacing that
 *    constraint rather than being the only thing enforcing it.
 */
export default function Admin() {
  const { token, user: currentUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Per-user transient UI state, keyed by user id, so one row's spinner
  // or error doesn't affect any other row.
  const [pendingAction, setPendingAction] = useState(null); // `${userId}:reset` | `${userId}:role`
  const [rowError, setRowError] = useState({});
  const [confirmRole, setConfirmRole] = useState(null); // { userId, username, nextRole } | null
  const [resetResult, setResetResult] = useState(null); // { username, tempPassword } | null

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getUsers({ token });
      setUsers(data.users || []);
    } catch (err) {
      setLoadError(err.message || 'Something went wrong loading users.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function setError(userId, message) {
    setRowError((prev) => ({ ...prev, [userId]: message }));
  }

  async function handleReset(u) {
    setError(u.id, null);
    setPendingAction(`${u.id}:reset`);
    try {
      const data = await resetPassword({ token, userId: u.id });
      setResetResult({ username: u.username, tempPassword: data.tempPassword });
    } catch (err) {
      setError(u.id, err.message || "Could not reset this user's password.");
    } finally {
      setPendingAction(null);
    }
  }

  function askRoleChange(u) {
    setError(u.id, null);
    setConfirmRole({
      userId: u.id,
      username: u.username,
      nextRole: u.role === 'admin' ? 'member' : 'admin'
    });
  }

  async function confirmRoleChange() {
    if (!confirmRole) return;
    const { userId, nextRole } = confirmRole;
    setPendingAction(`${userId}:role`);
    try {
      const data = await setUserRole({ token, userId, role: nextRole });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: data.user.role } : u)));
      setConfirmRole(null);
    } catch (err) {
      setError(userId, err.message || "Could not update this user's role.");
      setConfirmRole(null);
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <div className="admin-page">
        <h1 className="page-heading">Admin Panel</h1>
        <div className="admin-loading">
          <Spinner size={24} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="admin-page">
        <h1 className="page-heading">Admin Panel</h1>
        <div className="feed-error">
          <p>{loadError}</p>
          <button type="button" className="feed-retry-btn" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1 className="page-heading">Admin Panel</h1>
      <p className="admin-subheading">
        {users.length} user{users.length === 1 ? '' : 's'}
      </p>

      <div className="admin-user-list">
        {users.map((u) => {
          const isSelf = u.id === currentUser?.id;
          const busy = pendingAction === `${u.id}:reset` || pendingAction === `${u.id}:role`;

          return (
            <Card key={u.id} className="admin-user-card">
              <div className="admin-user-header">
                <div className="admin-user-identity">
                  <p className="admin-user-username">{u.username}</p>
                  <p className="admin-user-email">{u.email}</p>
                </div>
                <div className="admin-user-badges">
                  <Pill>{u.role}</Pill>
                  <Pill>{STATUS_LABEL[u.status] || u.status}</Pill>
                </div>
              </div>

              {rowError[u.id] && <p className="admin-row-error">{rowError[u.id]}</p>}

              <div className="admin-user-actions">
                <Button variant="secondary" size="sm" onClick={() => handleReset(u)} disabled={busy}>
                  {pendingAction === `${u.id}:reset` ? <Spinner size={14} /> : 'Admin Reset'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => askRoleChange(u)}
                  disabled={busy || isSelf}
                  title={isSelf ? 'You cannot change your own role.' : undefined}
                >
                  {u.role === 'admin' ? 'Demote to Member' : 'Promote to Admin'}
                </Button>
              </div>
              {isSelf && <p className="admin-self-hint">This is you — role locked.</p>}
            </Card>
          );
        })}
      </div>

      {confirmRole && (
        <div className="admin-modal-overlay" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true">
            <p className="admin-modal-title">Change role?</p>
            <p className="admin-modal-body">
              Make <strong>{confirmRole.username}</strong> a <strong>{confirmRole.nextRole}</strong>?
              {confirmRole.nextRole === 'admin'
                ? ' They will gain full Admin Panel access.'
                : ' They will lose Admin Panel access.'}
            </p>
            <div className="admin-modal-actions">
              <Button variant="secondary" size="sm" fullWidth onClick={() => setConfirmRole(null)}>
                Cancel
              </Button>
              <Button size="sm" fullWidth onClick={confirmRoleChange}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="admin-modal-overlay" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true">
            <p className="admin-modal-title">Temporary password</p>
            <p className="admin-modal-body">
              For <strong>{resetResult.username}</strong>. Share it securely — it will not be
              shown again.
            </p>
            <p className="admin-temp-password">{resetResult.tempPassword}</p>
            <Button fullWidth onClick={() => setResetResult(null)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
