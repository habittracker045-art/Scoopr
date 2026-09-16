// Phase 4, Prompt 6: API layer for the Admin Panel.
//
// All calls hit Phase 1's existing /api/admin/* routes, which are already
// mounted behind requireAuth + requireRole('admin') on the backend (see
// routes/admin.js — the whole router uses that pair, not just individual
// routes), plus one new endpoint this prompt adds:
//   getUsers()      -> GET   /api/admin/users                  (Phase 1, unchanged)
//   resetPassword() -> POST  /api/admin/reset-password/:userId (Phase 1, unchanged)
//   setUserRole()   -> PATCH /api/admin/users/:userId/role     (new this prompt)
//
// A non-admin token hitting any of these gets a 403 straight from the
// backend regardless of what the frontend shows or hides — the /admin
// route guard in App.jsx is a UX nicety, not the actual security boundary.

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

async function request(path, token, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

/**
 * GET /api/admin/users — every user's username, email, role, status,
 * created_at. Never includes password hashes (see routes/admin.js's
 * explicit column select). Resolves to `{ users }`.
 */
export function getUsers({ token }) {
  return request('/admin/users', token);
}

/**
 * POST /api/admin/reset-password/:userId — generates a fresh temp
 * password, hashes and stores it, and returns the *plaintext* temp
 * password exactly once in this response. It is never logged, stored in
 * plaintext, or retrievable again after this call returns — the caller
 * (Admin.jsx) is responsible for showing it to the admin a single time.
 * Resolves to `{ message, userId, tempPassword }`.
 */
export function resetPassword({ token, userId }) {
  return request(`/admin/reset-password/${userId}`, token, { method: 'POST' });
}

/**
 * PATCH /api/admin/users/:userId/role — promotes/demotes a user between
 * 'member' and 'admin'. The backend also refuses to let an admin change
 * their own role (see routes/admin.js), so this can 400 even with a
 * valid role value if userId is the caller's own id. Resolves to
 * `{ message, user }`.
 */
export function setUserRole({ token, userId, role }) {
  return request(`/admin/users/${userId}/role`, token, {
    method: 'PATCH',
    body: JSON.stringify({ role })
  });
}
