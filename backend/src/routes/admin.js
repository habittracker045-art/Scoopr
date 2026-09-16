const express = require('express');
const bcrypt = require('bcrypt');
const supabase = require('../config/supabaseClient');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { generateTempPassword } = require('../utils/password');

const router = express.Router();
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10);
const VALID_ROLES = ['member', 'admin'];

router.use(requireAuth, requireRole('admin'));

// GET /api/admin/users — list all users, never passwords
router.get('/users', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, role, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('List users error:', error.message);
    return res.status(500).json({ error: 'Could not fetch users.' });
  }

  return res.json({ users: data });
});

// POST /api/admin/reset-password/:userId
router.post('/reset-password/:userId', async (req, res) => {
  const { userId } = req.params;

  const tempPassword = generateTempPassword(12);
  const hashedPassword = await bcrypt.hash(tempPassword, SALT_ROUNDS);

  const { data, error } = await supabase
    .from('users')
    .update({ hashed_password: hashedPassword })
    .eq('id', userId)
    .select('id, username, email')
    .single();

  if (error || !data) {
    console.error('Reset password error:', error?.message);
    return res.status(404).json({ error: 'User not found.' });
  }

  // The plaintext temp password is returned ONCE, here, and is never stored or logged.
  // The admin is responsible for relaying it to the user through a secure channel.
  return res.json({
    message: `Temporary password generated for ${data.username}. Share it securely — it will not be shown again.`,
    userId: data.id,
    tempPassword
  });
});

// POST /api/admin/disable-user/:userId — toggles active/disabled
router.post('/disable-user/:userId', async (req, res) => {
  const { userId } = req.params;

  const { data: user, error: lookupError } = await supabase
    .from('users')
    .select('id, status')
    .eq('id', userId)
    .single();

  if (lookupError || !user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const newStatus = user.status === 'active' ? 'disabled' : 'active';

  const { data, error } = await supabase
    .from('users')
    .update({ status: newStatus })
    .eq('id', userId)
    .select('id, username, status')
    .single();

  if (error) {
    console.error('Disable user error:', error.message);
    return res.status(500).json({ error: 'Could not update user status.' });
  }

  return res.json({ message: `User ${data.username} is now ${data.status}.`, user: data });
});

// PATCH /api/admin/users/:userId/role — promote/demote a user between
// 'member' and 'admin'. Phase 4, Prompt 6: new, minimal endpoint — Phase 1
// only ever set role at signup time (always 'member'); nothing before this
// prompt could change a role after the fact.
router.patch('/users/:userId/role', async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!role || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}.` });
  }

  // An admin can't change their own role — prevents a lone admin from
  // accidentally locking themselves (and everyone else) out of the panel.
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', userId)
    .select('id, username, email, role, status')
    .single();

  if (error || !data) {
    console.error('Update role error:', error?.message);
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.json({ message: `${data.username} is now ${data.role}.`, user: data });
});

module.exports = router;
