import React, { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { signup } from '../api/authApi';
import { useAuth } from '../context/AuthContext';
import { Card, Input, Button } from '../components/ui';

export default function Signup() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { token, loginSuccess } = useAuth();
  const navigate = useNavigate();

  if (token) return <Navigate to="/feed" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const data = await signup({ username, email, password });
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
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Set up Scoopr to start pulling in your feed.</p>

        <Card>
          <form className="auth-form" onSubmit={handleSubmit}>
            <Input
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
            {error && <p className="auth-error">{error}</p>}
            <Button type="submit" fullWidth disabled={submitting}>
              {submitting ? 'Creating account…' : 'Sign up'}
            </Button>
          </form>
        </Card>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
