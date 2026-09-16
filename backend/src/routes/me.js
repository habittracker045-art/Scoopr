const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/me — returns the currently authenticated user.
// Used by the frontend to verify a stored token is still valid on load.
router.get('/', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
