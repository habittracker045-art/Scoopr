const express = require('express');
const bcrypt = require('bcrypt');
const supabase = require('../config/supabaseClient');
const { signToken } = require('../utils/jwt');

const router = express.Router();
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (existing) {
      return res.status(409).json({ error: 'Username or email already in use.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        username,
        email,
        hashed_password: hashedPassword,
        role: 'member',
        status: 'active'
      })
      .select('id, username, email, role, status, created_at')
      .single();

    if (insertError) throw insertError;

    const token = signToken({ id: newUser.id, role: newUser.role });

    return res.status(201).json({ user: newUser, token });
  } catch (err) {
    console.error('Signup error:', err.message);
    return res.status(500).json({ error: 'Something went wrong creating your account.' });
  }
});

// POST /api/auth/login
// "identifier" can be a username OR an email
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, hashed_password, role, status')
      .or(`username.eq.${identifier},email.eq.${identifier}`)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }

    const match = await bcrypt.compare(password, user.hashed_password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = signToken({ id: user.id, role: user.role });

    return res.json({
      user: { id: user.id, username: user.username, email: user.email, role: user.role, status: user.status },
      token
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Something went wrong logging you in.' });
  }
});

module.exports = router;
