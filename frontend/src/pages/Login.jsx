import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { login } from '../api/authApi';
import { useAuth } from '../context/AuthContext';
import { Card, Input, Button } from '../components/ui';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { token, loginSuccess } = useAuth();
  const navigate = useNavigate();

  // Already signed in — no need to see the login form again.
  if (token) return <Navigate to="/feed" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await login({ identifier, password });
      loginSuccess(data.token, data.user);
      navigate('/feed');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-wordmark">Scoopr</div>
        <h1 className="auth-title">Log in</h1>
        <p className="auth-subtitle">Welcome back. Enter your details to continue.</p>

        <Card>
          <form className="auth-form" onSubmit={handleSubmit}>
            <Input
              label="Username or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </Button>
          </form>
        </Card>

        <p className="auth-footer">
          No account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
