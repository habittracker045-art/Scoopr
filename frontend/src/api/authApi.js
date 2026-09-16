const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

export function signup({ username, email, password }) {
  return request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, email, password })
  });
}

export function login({ identifier, password }) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password })
  });
}

export function getMe(token) {
  return request('/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
}
